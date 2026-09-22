# ============================================================
# MAIN ENTRY POINT - backend/main.py
# Complete Production-Ready FastAPI Application
# Render runs: uvicorn main:app
#
# CHANGES IN THIS VERSION
#   1. NEW  /api/admin/payments/collect  and  /api/admin/payments/status/{id}
#           Staff-initiated STK push, protected by the Supabase login token
#           + staff/role check (see "ADMIN PAYMENT COLLECTION" section).
#   2. FIX  activate_registration() only activates a member/chama for
#           REGISTRATION payments (monthly/top-up/add-on no longer flip
#           registration_fee_paid / member_status).
#   3. FIX  get_payment_status() now returns the M-Pesa receipt for
#           payments that were already confirmed by the callback.
#   4. FIX  admin_collect_payment() now maps PaymentTypeEnum's lowercase
#           values (registration/monthly/topup/addon) onto the payments
#           table's actual `payment_type` Postgres enum labels, which are
#           uppercase (REGISTRATION/MONTHLY/TOPUP/ADDON).
#   5. NEW  TextSMS integration: welcome SMS on registration, and a
#           payment-confirmation SMS whenever a payment completes.
#   6. FIX  /api/public/payment/stk-push: a payment row is NEVER left
#           'pending' when M-Pesa did not return a usable CheckoutRequestID.
#           If STK initiation fails, or returns success with no
#           CheckoutRequestID, the row is marked 'failed' with a
#           failure_reason, and the endpoint responds success=False.
#   7. FIX  /api/public/payment/callback: ResultCode is compared as a
#           string (str(result_code).strip() == "0") so both int 0 and
#           str "0" from Safaricom are recognized as success.
#   8. FIX  /api/public/payment/callback: the existing-payment idempotency
#           check normalizes status to str(x).strip().lower() so
#           "COMPLETED"/"Completed"/" completed " are all treated as
#           terminal.
#   9. FIX  /api/public/payment/reconcile: rows with no
#           checkout_request_id are skipped; a payment is only ever
#           completed by an explicit M-Pesa success result, never because
#           it is old.
#
# NEW ENV VARS (Render -> Environment)
#   ALLOWED_ORIGINS         = https://masika-murex.vercel.app,https://www.masikabbs.com,https://masikabbs.com
#   PAYMENT_COLLECTOR_ROLES = SUPER_ADMIN        (comma-separated role_codes)
#   ADMIN_MAX_COLLECT_AMOUNT = 250000            (optional)
#   TEXTSMS_API_KEY         = <from TextSMS dashboard>
#   TEXTSMS_PARTNER_ID      = <from TextSMS dashboard>
#   TEXTSMS_SHORTCODE       = <your approved sender ID / shortcode>
#
# DB MIGRATION REQUIRED FOR THIS VERSION
#   ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'TOPUP';
#   ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'ADDON';
# ============================================================

import os
import sys
import logging
from pathlib import Path
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Any
from enum import Enum
from contextlib import asynccontextmanager
import re
import secrets
import hashlib
import base64

# ============================================================
# FASTAPI IMPORTS
# ============================================================

from fastapi import FastAPI, HTTPException, status, Query, Request, Depends, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# ============================================================
# THIRD PARTY IMPORTS (with fallbacks)
# ============================================================

try:
    from pydantic import BaseModel, EmailStr, Field
except ImportError:
    from pydantic import BaseModel, EmailStr, Field

try:
    from supabase import create_client, Client
except ImportError:
    print("Supabase not installed. Run: pip install supabase")
    Client = None
    create_client = None

try:
    import httpx
except ImportError:
    print("httpx not installed. Run: pip install httpx. M-Pesa features will be disabled.")
    httpx = None

import asyncio
import ipaddress
import json as _json

try:
    import jwt
except ImportError:
    print("PyJWT not installed. JWT features will be disabled.")
    jwt = None

# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================================
# ENVIRONMENT VARIABLES
# ============================================================

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://wpxzlcdrirlcyvfiquld.supabase.co")
# IMPORTANT: this must be the service_role key, not anon — public registration routes
# in this file bypass RLS via this client. Never hardcode a fallback key here.
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_KEY:
    raise RuntimeError(
        "SUPABASE_SERVICE_ROLE_KEY environment variable is not set. "
        "main.py requires the service role key to perform member registration writes."
    )

SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

APP_ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
_PLACEHOLDER_SECRETS = {"your-secret-key-change-in-production", "your-secret-key-here", ""}
if APP_ENVIRONMENT == "production" and SECRET_KEY in _PLACEHOLDER_SECRETS:
    raise RuntimeError(
        "ENVIRONMENT=production but SECRET_KEY is still a placeholder value. "
        "This key signs every login JWT — generate a real one "
        "(python -c \"import secrets; print(secrets.token_urlsafe(48))\") "
        "and set it on Render before deploying."
    )

# M-Pesa Configuration
# NOTE: no fallback default for the shortcode in production — the sandbox
# value 174379 must never silently apply to a production deploy.
MPESA_CONSUMER_KEY = os.getenv("MPESA_CONSUMER_KEY", "")
MPESA_CONSUMER_SECRET = os.getenv("MPESA_CONSUMER_SECRET", "")
MPESA_PASSKEY = os.getenv("MPESA_PASSKEY", "")
MPESA_SHORTCODE = os.getenv("MPESA_SHORTCODE", "174379")
MPESA_ENVIRONMENT = os.getenv("MPESA_ENVIRONMENT", "sandbox").lower()
BASE_URL = os.getenv("BASE_URL", "https://masika-c921.onrender.com").rstrip("/")

# If MPESA_CALLBACK_URL is set explicitly, it wins over BASE_URL + a hardcoded
# path — that way whatever's actually configured on Render is the source of
# truth instead of a guessed default. The route this points to is registered
# below (both /api/public/payment/callback and this path serve the same
# handler, so whichever one Safaricom is actually configured to hit works).
MPESA_CALLBACK_URL_OVERRIDE = os.getenv("MPESA_CALLBACK_URL", "").strip().rstrip("/")
MPESA_CALLBACK_URL = MPESA_CALLBACK_URL_OVERRIDE or f"{BASE_URL}/api/public/payment/callback"

# How long to wait on Safaricom's own API before giving up on a single attempt,
# and how many times to retry a transient (network/5xx/timeout) failure.
MPESA_TIMEOUT_SECONDS = float(os.getenv("MPESA_TIMEOUT_SECONDS", "20"))
MPESA_MAX_RETRIES = int(os.getenv("MPESA_MAX_RETRIES", "2"))

# Shared secret required on the internal reconciliation endpoint
# (guards against anyone hitting it to force-poll M-Pesa on your credentials).
RECONCILE_SECRET = os.getenv("RECONCILE_SECRET", "")

# Optional allowlist for the /payment/callback webhook, as a comma-separated
# list of IPs or CIDR ranges. Safaricom publishes its Daraja callback source
# ranges in the Daraja portal docs — copy the current list into this env var
# rather than hardcoding it here, since Safaricom can change it. Leave unset
# to skip IP filtering (rely on unguessable checkout_request_id + idempotency
# instead, which is safe on its own but IP filtering is defense in depth).
MPESA_CALLBACK_IP_WHITELIST = [
    ip.strip() for ip in os.getenv("MPESA_CALLBACK_IP_WHITELIST", "").split(",") if ip.strip()
]

# Roles (roles.role_code, upper case) allowed to collect payments from the
# admin panel. Comma-separated in the env var.
PAYMENT_COLLECTOR_ROLES = {
    r.strip().upper()
    for r in os.getenv("PAYMENT_COLLECTOR_ROLES", "SUPER_ADMIN").split(",")
    if r.strip()
}

# Safaricom's per-transaction ceiling is KES 250,000.
ADMIN_MAX_COLLECT_AMOUNT = float(os.getenv("ADMIN_MAX_COLLECT_AMOUNT", "250000"))

# M-Pesa URLs
if MPESA_ENVIRONMENT == "production":
    MPESA_BASE_URL = "https://api.safaricom.co.ke"
else:
    MPESA_BASE_URL = "https://sandbox.safaricom.co.ke"

MPESA_AUTH_URL = f"{MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials"
MPESA_STK_PUSH_URL = f"{MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest"
MPESA_STK_QUERY_URL = f"{MPESA_BASE_URL}/mpesa/stkpushquery/v1/query"

# Fail fast rather than silently taking live payments against sandbox
# defaults or an unreachable callback URL.
if MPESA_ENVIRONMENT == "production":
    _mpesa_errors = []
    if not MPESA_CONSUMER_KEY or not MPESA_CONSUMER_SECRET:
        _mpesa_errors.append("MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET not set")
    if not MPESA_PASSKEY:
        _mpesa_errors.append("MPESA_PASSKEY not set")
    if MPESA_SHORTCODE == "174379":
        _mpesa_errors.append("MPESA_SHORTCODE is still the sandbox default (174379)")
    if not MPESA_CALLBACK_URL.startswith("https://"):
        _mpesa_errors.append("MPESA_CALLBACK_URL (or BASE_URL) must resolve to a public HTTPS URL for Safaricom's callback")
    if _mpesa_errors:
        raise RuntimeError(
            "MPESA_ENVIRONMENT=production but M-Pesa config is incomplete: "
            + "; ".join(_mpesa_errors)
        )

# ============================================================
# SUPABASE CLIENT
# ============================================================

supabase = None
if create_client:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Supabase client initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize Supabase client: {e}")

# ============================================================
# SMS NOTIFICATIONS (TextSMS)
# ============================================================
# Best-effort SMS via TextSMS (https://sms.textsms.co.ke). Every function
# here returns a bool and never raises — a down SMS gateway must never fail
# a registration or a payment request. Call sites fire these with
# asyncio.create_task(...) (or plain await, since failures are swallowed)
# and log on failure; they never block the response on SMS delivery.

TEXTSMS_URL = "https://sms.textsms.co.ke/api/services/sendsms/"
TEXTSMS_API_KEY = os.getenv("TEXTSMS_API_KEY", "")
TEXTSMS_PARTNER_ID = os.getenv("TEXTSMS_PARTNER_ID", "")
TEXTSMS_SHORTCODE = os.getenv("TEXTSMS_SHORTCODE", "")


def _sms_normalize(phone: str) -> str:
    """Convert phone to 254XXXXXXXXX format (no plus) for TextSMS."""
    phone = (phone or "").strip().replace(" ", "")
    if phone.startswith("+254"):
        return phone[1:]
    if phone.startswith("0"):
        return "254" + phone[1:]
    if phone.startswith("254"):
        return phone
    return "254" + phone


async def _send_textsms(mobile: str, message: str) -> bool:
    """Shared TextSMS sender used by both notification helpers below."""
    if not httpx:
        logger.warning("SMS not sent (httpx unavailable): %s", mobile)
        return False
    if not (TEXTSMS_API_KEY and TEXTSMS_PARTNER_ID and TEXTSMS_SHORTCODE):
        logger.warning("SMS not sent (TextSMS env vars not configured): %s", mobile)
        return False

    payload = {
        "apikey": TEXTSMS_API_KEY,
        "partnerID": TEXTSMS_PARTNER_ID,
        "shortcode": TEXTSMS_SHORTCODE,
        "mobile": mobile,
        "message": message,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(TEXTSMS_URL, json=payload)
            data = resp.json()
            code = data.get("responses", [{}])[0].get("response-code")
            if code != 200:
                logger.warning(f"TextSMS failed for {mobile}: {data}")
            return code == 200
    except Exception as e:
        logger.error(f"TextSMS error for {mobile}: {e}")
        return False


async def send_registration_sms(phone: str, member_number: str, name: str = "") -> bool:
    """Send a welcome SMS with the member's membership number after registration."""
    mobile = _sms_normalize(phone)
    message = (
        f"Welcome to Masika{', ' + name if name else ''}! "
        f"Your membership number is {member_number}. "
        f"Keep it safe for payments and claims."
    )
    return await _send_textsms(mobile, message)


async def send_payment_confirmation_sms(phone: str, amount: str, member_number: str) -> bool:
    """Send a confirmation SMS after a successful M-Pesa payment."""
    mobile = _sms_normalize(phone)
    message = (
        f"Payment of KES {amount} received for membership {member_number}. "
        f"Thank you for staying current with Masika."
    )
    return await _send_textsms(mobile, message)

# ============================================================
# ENUMS
# ============================================================

class GenderEnum(str, Enum):
    MALE = "MALE"
    FEMALE = "FEMALE"

class MemberStatusEnum(str, Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    CANCELLED = "CANCELLED"

class PlanEnum(str, Enum):
    COMFORT = "comfort"
    DIGNITY = "dignity"
    WAZAZI = "wazazi"

class BenefitOptionEnum(str, Enum):
    CASH = "cash"
    SERVICE = "service"

class RelationshipEnum(str, Enum):
    SPOUSE = "spouse"
    CHILD = "child"
    PARENT = "parent"
    IN_LAW = "in_law"

class PaymentStatusEnum(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REFUNDED = "refunded"

class PaymentTypeEnum(str, Enum):
    REGISTRATION = "registration"
    MONTHLY = "monthly"
    TOPUP = "topup"
    ADDON = "addon"

# ============================================================
# PYDANTIC MODELS
# ============================================================

class LoginRequest(BaseModel):
    identifier: str
    password: str

class LoginResponse(BaseModel):
    success: bool
    user: dict
    message: str
    token: Optional[str] = None
    refresh_token: Optional[str] = None

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class DependantBase(BaseModel):
    first_name: str
    last_name: str
    relationship: RelationshipEnum
    date_of_birth: str
    phone: Optional[str] = None
    email: Optional[EmailStr] = None

class MemberBase(BaseModel):
    first_name: str
    last_name: str
    other_name: Optional[str] = None
    email: EmailStr
    phone: str
    alternative_phone: Optional[str] = None
    id_number: str
    date_of_birth: str
    gender: GenderEnum
    county: str
    location: Optional[str] = None
    town: Optional[str] = None
    address: Optional[str] = None
    plan: PlanEnum
    benefit_option: BenefitOptionEnum
    sales_code: Optional[str] = None

class MemberCreate(MemberBase):
    password: str
    dependants: List[DependantBase] = []
    accept_terms: bool = True

class MemberUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    other_name: Optional[str] = None
    phone: Optional[str] = None
    alternative_phone: Optional[str] = None
    address: Optional[str] = None
    location: Optional[str] = None
    town: Optional[str] = None
    plan: Optional[PlanEnum] = None
    benefit_option: Optional[BenefitOptionEnum] = None

class MemberResponse(BaseModel):
    id: str
    member_number: str
    username: str
    first_name: str
    last_name: str
    other_name: Optional[str]
    email: str
    phone: str
    alternative_phone: Optional[str]
    id_number: str
    date_of_birth: str
    gender: str
    county: str
    location: Optional[str]
    town: Optional[str]
    address: Optional[str]
    plan: str
    benefit_option: str
    sales_code: Optional[str]
    member_status: str
    is_active: bool
    registration_date: str
    waiting_period_months: int
    registration_fee_paid: bool
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime]

class DependantCreate(DependantBase):
    member_id: str

class DependantUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    relationship: Optional[RelationshipEnum] = None
    date_of_birth: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    is_active: Optional[bool] = None

class PaymentCreate(BaseModel):
    amount: float
    payment_type: PaymentTypeEnum
    phone: str
    member_id: str
    description: Optional[str] = None

class PaymentUpdate(BaseModel):
    status: PaymentStatusEnum
    mpesa_receipt: Optional[str] = None
    checkout_request_id: Optional[str] = None

class PaymentResponse(BaseModel):
    id: str
    member_number: str
    amount: float
    payment_type: str
    payment_method: str
    mpesa_receipt: Optional[str]
    status: str
    payment_date: str
    created_at: datetime

class PlanResponse(BaseModel):
    slug: str
    name: str
    description: str
    registration_fee: float
    monthly_fee: float
    waiting_period_months: int

class AgentResponse(BaseModel):
    id: str
    agent_code: str
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    branch: Optional[str] = None
    status: str
    commission_rate: Optional[float] = None

class BranchResponse(BaseModel):
    id: str
    name: str
    code: str
    location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool

class DashboardStats(BaseModel):
    member_id: str
    member_number: str
    plan: str
    benefit_option: str
    dependants_count: int
    payments_count: int
    total_payments: float
    last_payment_date: Optional[str]
    coverage_status: str
    registration_date: str
    waiting_period_months: int
    active_dependants: int

# ============================================================
# PUBLIC REGISTRATION MODELS
# ============================================================

class PublicRegistrationRequest(BaseModel):
    """Schema for public registration endpoint."""
    first_name: str
    last_name: str
    other_name: Optional[str] = None

    phone: str
    alternative_phone: Optional[str] = None
    email: Optional[EmailStr] = None

    id_number: str
    date_of_birth: Optional[str] = None
    gender: Optional[GenderEnum] = None

    county: Optional[str] = None
    location: Optional[str] = None
    town: Optional[str] = None
    address: Optional[str] = None

    sales_code: Optional[str] = None

    plan: PlanEnum
    benefit_option: Optional[BenefitOptionEnum] = None

    dependants: List[Dict[str, Any]] = []

class PublicRegisterResponse(BaseModel):
    """Response schema for public registration."""
    success: bool
    member_id: str
    member_number: str
    registration_amount: float

# Minimum number of members a chama/group must register.
MIN_CHAMA_MEMBERS = 30

class ChamaRegistrationRequest(BaseModel):
    group_name: str
    phone: str
    # Number of members typed on the registration form. Used as the member
    # count when no CSV member list is uploaded.
    number_of_members: Optional[int] = None
    chairperson: Dict[str, str]
    treasurer: Dict[str, str]
    secretary: Dict[str, str]
    # Optional: only sent when the CSV member list was uploaded.
    members: List[Dict[str, Any]] = []

class STKPushRequest(BaseModel):
    phone: str
    amount: float
    member_id: Optional[str] = None
    group_id: Optional[str] = None
    transaction_desc: str = "Masika Benevolent Payment"

class STKPushResponse(BaseModel):
    success: bool
    message: str
    checkout_request_id: Optional[str] = None
    merchant_request_id: Optional[str] = None

class PaymentStatusResponse(BaseModel):
    status: str
    amount: Optional[float] = None
    receipt: Optional[str] = None
    transaction_id: Optional[str] = None

class MemberStatusResponse(BaseModel):
    member_id: str
    member_number: str
    status: str
    registration_fee_paid: bool
    waiting_period_months: int
    coverage_status: str
    registration_date: str
    dependants_count: int

class ReceiptResponse(BaseModel):
    payment_id: str
    member_number: str
    amount: float
    payment_date: str
    receipt_number: str
    member_name: str
    plan: str

class IDCardResponse(BaseModel):
    member_id: str
    member_number: str
    full_name: str
    plan: str
    status: str
    registration_date: str
    qr_code: Optional[str] = None

# ============================================================
# SECURITY HELPERS
# ============================================================

security = HTTPBearer()

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return hash_password(plain_password) == hashed_password

def generate_member_number() -> str:
    if not supabase:
        return "MSK-000001"
    try:
        result = supabase.table("members").select("member_number").order("member_number", desc=True).limit(1).execute()
        if result.data and len(result.data) > 0:
            last_number = result.data[0]["member_number"]
            match = re.search(r"MSK-(\d+)", last_number)
            if match:
                next_num = int(match.group(1)) + 1
                return f"MSK-{next_num:06d}"
    except:
        pass
    return "MSK-000001"

def generate_password() -> str:
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*"
    return ''.join(secrets.choice(chars) for _ in range(12))

def generate_jwt_token(user_id: str, email: str) -> str:
    if not jwt:
        return secrets.token_urlsafe(32)
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_jwt_token(token: str) -> Optional[dict]:
    if not jwt:
        return None
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except:
        return None

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    payload = verify_jwt_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return payload.get("sub")

# ============================================================
# DATABASE HELPERS
# ============================================================

def find_member_by_identifier(identifier: str) -> Optional[dict]:
    if not supabase:
        return None
    try:
        for field in ["member_number", "username", "email"]:
            result = supabase.table("members").select("*").eq(field, identifier).execute()
            if result.data and len(result.data) > 0:
                return result.data[0]
        return None
    except Exception as e:
        logger.error(f"Error finding member: {e}")
        return None

def find_member_by_id(member_id: str) -> Optional[dict]:
    if not supabase:
        return None
    try:
        result = supabase.table("members").select("*").eq("id", member_id).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except:
        return None

def get_member_safe(member: dict) -> dict:
    return {k: v for k, v in member.items() if k not in ["password_hash", "temp_password"]}


# ------------------------------------------------------------
# DEPENDANT INSERT HELPER
# ------------------------------------------------------------
# The `dependants` table schema does NOT match DependantBase/DependantCreate
# field-for-field. Actual columns (confirmed via information_schema):
#   id, principal_member_id, dependant_number, full_name, national_id,
#   birth_certificate_number, date_of_birth, gender, relationship, phone,
#   status, created_at, updated_at, email
#
# In particular: there is no first_name/last_name (combined into full_name)
# and no is_active (it's a `status` varchar instead). This single helper is
# now the only place that builds a dependants insert row, so a future schema
# change only needs fixing here instead of in three separate call sites.
def build_dependant_row(
    principal_member_id: str,
    first_name: str,
    last_name: str,
    relationship: str,
    date_of_birth: Optional[str],
    phone: Optional[str] = None,
    email: Optional[str] = None,
    gender: Optional[str] = None,
    status_value: str = "ACTIVE",
) -> dict:
    full_name = f"{(first_name or '').strip()} {(last_name or '').strip()}".strip()
    row = {
        "principal_member_id": principal_member_id,
        "full_name": full_name,
        "relationship": (relationship or "").upper(),
        "date_of_birth": date_of_birth,
        "phone": phone,
        "email": email,
        "status": status_value,
        "created_at": datetime.now().isoformat(),
    }
    if gender:
        row["gender"] = gender.upper()
    return row


# ------------------------------------------------------------
# LIVE PRICING HELPER
# ------------------------------------------------------------
# Single source of truth for plan pricing: the Supabase `plans` table —
# the SAME table admin-pricing.html writes to. Nothing in this file
# should hardcode a fee; every place that needs a price calls this.
#
# Requires a `dependant_fee` numeric column on `plans` (used for the
# Wazazi per-parent fee; defaults to 0 if unset):
#   alter table public.plans add column if not exists dependant_fee numeric default 0;

def get_live_plan_pricing(plan_slug: str) -> Dict[str, float]:
    """
    Fetch the CURRENT registration fee (and per-dependant fee, if
    configured) for a plan from Supabase's `plans` table.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    result = (
        supabase.table("plans")
        .select("registration_fee, dependant_fee, is_active")
        .ilike("plan_code", plan_slug)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=400,
            detail=f"Plan '{plan_slug}' was not found in pricing. Contact support before retrying."
        )

    row = result.data[0]

    if row.get("is_active") is False:
        raise HTTPException(
            status_code=400,
            detail=f"Plan '{plan_slug}' is not currently available for registration."
        )

    return {
        "registration_fee": float(row.get("registration_fee") or 0),
        "dependant_fee": float(row.get("dependant_fee") or 0),
    }

# ============================================================
# M-PESA HELPERS
# ============================================================

# Shared, connection-pooled async client for all Daraja calls (created in
# lifespan). A fresh client per request would open/close a TLS connection
# every time under load — this reuses connections instead.
mpesa_http_client: Optional["httpx.AsyncClient"] = None

# Simple in-process cache for the OAuth token. Daraja tokens are valid for
# ~3600s; requesting a new one on every STK push adds latency and can hit
# rate limits under load. Guarded by a lock so concurrent requests don't
# all fetch a fresh token at once.
_mpesa_token_cache: Dict[str, Any] = {"token": None, "expires_at": None}
_mpesa_token_lock = asyncio.Lock()


async def _mpesa_request_with_retry(method: str, url: str, **kwargs) -> Optional["httpx.Response"]:
    """POST/GET to Daraja with a couple of retries on transient failures
    (timeouts, connection errors, 5xx). Does NOT retry on 4xx — those are
    genuine request errors (bad auth, bad payload) and retrying won't help.
    """
    if not mpesa_http_client:
        return None
    last_exc = None
    for attempt in range(MPESA_MAX_RETRIES + 1):
        try:
            response = await mpesa_http_client.request(method, url, **kwargs)
            if response.status_code >= 500 and attempt < MPESA_MAX_RETRIES:
                logger.warning(f"M-Pesa {url} returned {response.status_code}, retrying (attempt {attempt + 1})")
                await asyncio.sleep(0.5 * (2 ** attempt))
                continue
            return response
        except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as e:
            last_exc = e
            if attempt < MPESA_MAX_RETRIES:
                logger.warning(f"M-Pesa {url} failed ({e}), retrying (attempt {attempt + 1})")
                await asyncio.sleep(0.5 * (2 ** attempt))
                continue
    if last_exc:
        logger.error(f"M-Pesa {url} failed after retries: {last_exc}")
    return None


async def get_mpesa_access_token() -> Optional[str]:
    """Return a cached OAuth token, refreshing it shortly before expiry."""
    if not httpx or not MPESA_CONSUMER_KEY or not MPESA_CONSUMER_SECRET:
        return None

    async with _mpesa_token_lock:
        cached = _mpesa_token_cache.get("token")
        expires_at = _mpesa_token_cache.get("expires_at")
        if cached and expires_at and datetime.now() < expires_at:
            return cached

        auth = base64.b64encode(f"{MPESA_CONSUMER_KEY}:{MPESA_CONSUMER_SECRET}".encode()).decode()
        response = await _mpesa_request_with_retry(
            "GET", MPESA_AUTH_URL, headers={"Authorization": f"Basic {auth}"}
        )
        if response is None or response.status_code != 200:
            logger.error(f"Failed to obtain M-Pesa access token: {response.status_code if response else 'no response'}")
            return None

        data = response.json()
        token = data.get("access_token")
        # Daraja returns expires_in (seconds, typically 3599). Refresh a
        # minute early to avoid using a token that expires mid-request.
        expires_in = int(data.get("expires_in", 3599))
        _mpesa_token_cache["token"] = token
        _mpesa_token_cache["expires_at"] = datetime.now() + timedelta(seconds=max(expires_in - 60, 30))
        return token


def generate_mpesa_password(shortcode: str, passkey: str, timestamp: str) -> str:
    return base64.b64encode(f"{shortcode}{passkey}{timestamp}".encode()).decode()

def generate_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S")

def format_phone_number(phone: str) -> str:
    phone = re.sub(r'\D', '', phone)
    if phone.startswith('0'):
        phone = '254' + phone[1:]
    elif phone.startswith('7') or phone.startswith('1'):
        phone = '254' + phone
    elif phone.startswith('254'):
        pass
    return phone


def is_ip_allowed(client_ip: Optional[str]) -> bool:
    """Check the callback source IP against MPESA_CALLBACK_IP_WHITELIST.
    If no whitelist is configured, allow everything (idempotency + the
    unguessable checkout_request_id are still enforced downstream)."""
    if not MPESA_CALLBACK_IP_WHITELIST:
        return True
    if not client_ip:
        return False
    try:
        addr = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    for entry in MPESA_CALLBACK_IP_WHITELIST:
        try:
            if "/" in entry:
                if addr in ipaddress.ip_network(entry, strict=False):
                    return True
            elif addr == ipaddress.ip_address(entry):
                return True
        except ValueError:
            continue
    return False

# ============================================================
# CREATE FASTAPI APP
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    global mpesa_http_client
    logger.info(f"Starting Masika Benevolent API... (M-Pesa environment: {MPESA_ENVIRONMENT})")
    if supabase:
        try:
            supabase.table("members").select("count", count="exact").limit(1).execute()
            logger.info("Database connection successful")
        except Exception as e:
            logger.error(f"Database connection failed: {e}")

    if httpx:
        mpesa_http_client = httpx.AsyncClient(timeout=MPESA_TIMEOUT_SECONDS)
        logger.info("M-Pesa HTTP client initialized")
        if MPESA_ENVIRONMENT == "production" and not MPESA_CALLBACK_IP_WHITELIST:
            logger.warning(
                "MPESA_CALLBACK_IP_WHITELIST is not set in production — the callback "
                "endpoint will accept requests from any source IP. Idempotency checks "
                "still protect the payment record, but consider setting this."
            )

    if not (TEXTSMS_API_KEY and TEXTSMS_PARTNER_ID and TEXTSMS_SHORTCODE):
        logger.warning(
            "TEXTSMS_API_KEY / TEXTSMS_PARTNER_ID / TEXTSMS_SHORTCODE are not fully "
            "set — registration and payment-confirmation SMS will be skipped."
        )

    yield

    if mpesa_http_client:
        await mpesa_http_client.aclose()
    logger.info("Shutting down Masika Benevolent API...")

app = FastAPI(
    title="Masika Benevolent API",
    description="Masika Benevolent Membership Management System with M-Pesa Integration",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan
)

# ============================================================
# CORS
# ============================================================

# Reads ALLOWED_ORIGINS from env (comma-separated). It MUST include every
# site that calls this API, e.g. on Render:
#   https://masika-murex.vercel.app,https://www.masikabbs.com,https://masikabbs.com
# Falls back to "*" only when unset (e.g. local dev), since "*" combined with
# allow_credentials=True means any site can make authenticated requests using
# a visitor's token.
_allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "").strip()
ALLOWED_ORIGINS = [o.strip() for o in _allowed_origins_env.split(",") if o.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# ROOT ENDPOINTS
# ============================================================

@app.get("/", tags=["Root"])
async def root():
    return {"service": "Masika Benevolent API", "version": "2.0.0", "status": "healthy", "docs": "/api/docs"}

@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "service": "masika-benevolent-api",
        "version": "2.0.0",
        "database": "connected" if supabase else "disconnected",
        "mpesa": "configured" if MPESA_CONSUMER_KEY else "not configured",
        "mpesa_environment": MPESA_ENVIRONMENT,
        "sms": "configured" if (TEXTSMS_API_KEY and TEXTSMS_PARTNER_ID and TEXTSMS_SHORTCODE) else "not configured"
    }

# ============================================================
# PUBLIC ROUTES
# ============================================================

public_router = APIRouter(prefix="/api/public", tags=["Public"])

# ------------------------------------------------------------
# 1. PUBLIC PLANS
# ------------------------------------------------------------

@public_router.get("/plans", response_model=List[PlanResponse])
async def get_public_plans():
    """
    Get available membership plans with their LIVE fees from Supabase —
    the same `plans` table admin-pricing.html writes to. Previously this
    returned a hardcoded list, so a price change in admin-pricing never
    reached anything that called this route.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        result = (
            supabase.table("plans")
            .select("plan_code, plan_name, description, registration_fee, monthly_premium, waiting_period_months, is_active")
            .eq("is_active", True)
            .execute()
        )
    except Exception as e:
        logger.error(f"Failed to load plans from Supabase: {e}")
        raise HTTPException(status_code=500, detail="Could not load current pricing")

    plans = []
    for p in (result.data or []):
        slug = (p.get("plan_code") or "").strip().lower()
        if not slug or slug == "chama":
            continue  # chama has its own registration flow/rate, not a member plan card
        plans.append({
            "slug": slug,
            "name": p.get("plan_name") or "",
            "description": p.get("description") or "",
            "registration_fee": float(p.get("registration_fee") or 0),
            "monthly_fee": float(p.get("monthly_premium") or 0),
            "waiting_period_months": int(p.get("waiting_period_months") or 0),
        })

    return plans

# ------------------------------------------------------------
# 2. PUBLIC AGENTS
# ------------------------------------------------------------

@public_router.get("/agents", response_model=List[AgentResponse])
async def get_public_agents(branch_id: Optional[str] = None):
    """Get available sales agents."""
    if not supabase:
        return []
    try:
        query = supabase.table("sales_agents").select("*").eq("status", "ACTIVE")
        if branch_id:
            query = query.eq("branch_id", branch_id)
        result = query.execute()
        return [
            {
                "id": a.get("id"),
                "agent_code": a.get("agent_code", ""),
                "full_name": a.get("full_name", ""),
                "email": a.get("email"),
                "phone": a.get("phone"),
                "branch": a.get("branch"),
                "status": a.get("status", "active"),
                "commission_rate": a.get("commission_rate", 5.0)
            }
            for a in (result.data or [])
        ]
    except Exception as e:
        logger.error(f"Error fetching agents: {e}")
        return []

# ------------------------------------------------------------
# 3. PUBLIC BRANCHES
# ------------------------------------------------------------

@public_router.get("/branches", response_model=List[BranchResponse])
async def get_public_branches():
    """Get available branches."""
    if not supabase:
        return [
            {
                "id": "1",
                "name": "Nairobi",
                "code": "NBO",
                "location": "Nairobi CBD",
                "phone": "0712345678",
                "email": "nairobi@masika.co.ke",
                "is_active": True
            }
        ]
    try:
        result = supabase.table("branches").select("*").eq("is_active", True).execute()
        return result.data or []
    except Exception as e:
        logger.error(f"Error fetching branches: {e}")
        return []

# ------------------------------------------------------------
# 4. PUBLIC REGISTER (INDIVIDUAL)
# ------------------------------------------------------------

@public_router.post("/register", response_model=PublicRegisterResponse)
async def public_register(payload: PublicRegistrationRequest):
    """
    Public registration endpoint for individual members.
    Creates a pending member record with a payment record.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    if not payload.first_name:
        raise HTTPException(status_code=400, detail="First name is required")
    if not payload.last_name:
        raise HTTPException(status_code=400, detail="Last name is required")
    if not payload.id_number:
        raise HTTPException(status_code=400, detail="ID number is required")
    if not payload.phone:
        raise HTTPException(status_code=400, detail="Phone number is required")

    if payload.email:
        existing = supabase.table("members").select("email").eq("email", payload.email).execute()
        if existing.data:
            raise HTTPException(status_code=400, detail="Email already registered")

    existing = supabase.table("members").select("id_number").eq("id_number", payload.id_number).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="ID number already registered")

    try:
        member_number = generate_member_number()

        plan = payload.plan.value if hasattr(payload.plan, 'value') else str(payload.plan)
        plan = plan.lower()
        waiting_period = 6 if plan == "dignity" else 4

        # Live pricing from Supabase — the SAME `plans` table
        # admin-pricing.html writes to. No hardcoded amounts here.
        pricing = get_live_plan_pricing(plan)
        registration_amount = pricing["registration_fee"]

        if plan == "wazazi" and pricing["dependant_fee"] > 0:
            parent_count = sum(1 for d in payload.dependants if d.get("relationship", "").upper() == "PARENT")
            registration_amount += parent_count * pricing["dependant_fee"]

        member_record = {
            "member_number": member_number,
            "username": member_number,
            "first_name": payload.first_name,
            "last_name": payload.last_name,
            "other_name": payload.other_name,
            "email": payload.email,
            "phone": payload.phone,
            "alternative_phone": payload.alternative_phone,
            "id_number": payload.id_number,
            "date_of_birth": payload.date_of_birth,
            "gender": payload.gender.value if hasattr(payload.gender, 'value') else payload.gender,
            "county": payload.county,
            "location": payload.location,
            "town": payload.town,
            "address": payload.address,
            "plan": plan,
            "benefit_option": payload.benefit_option.value if hasattr(payload.benefit_option, 'value') else payload.benefit_option,
            "sales_code": payload.sales_code,
            "password_hash": None,
            "temp_password": None,
            "member_status": "PENDING",
            "is_active": True,
            "registration_date": datetime.now().date().isoformat(),
            "waiting_period_months": waiting_period,
            "registration_fee_paid": False,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }

        result = supabase.table("members").insert(member_record).execute()
        if not result.data:
            raise HTTPException(status_code=400, detail="Failed to create member")

        new_member = result.data[0]
        member_id = new_member["id"]

        # FIX: "payments" has no member_number column — only member_id/membership_id.
        # The stray "member_number" key here was the cause of the PGRST204 error.
        # If you need the member_number visible on the payment row for reporting,
        # look it up via a join on member_id instead of duplicating it here.
        payment_record = {
            "member_id": member_id,
            "amount": registration_amount,
            "payment_type": "registration",
            "payment_method": "mpesa",
            "mpesa_receipt": None,
            "status": "pending",
            "payment_date": datetime.now().date().isoformat(),
            "phone": payload.phone,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        supabase.table("payments").insert(payment_record).execute()

        # FIX: `dependants` has no first_name/last_name/is_active columns —
        # it stores full_name and status instead. See build_dependant_row().
        for dep in payload.dependants:
            supabase.table("dependants").insert(
                build_dependant_row(
                    principal_member_id=member_id,
                    first_name=dep.get("first_name", ""),
                    last_name=dep.get("last_name", ""),
                    relationship=dep.get("relationship", ""),
                    date_of_birth=dep.get("date_of_birth"),
                    phone=dep.get("phone"),
                    email=dep.get("email"),
                )
            ).execute()

        # Best-effort welcome SMS. Never let an SMS failure fail registration —
        # send_registration_sms() already swallows and logs its own errors,
        # but wrap in try/except too in case of an unexpected exception.
        try:
            asyncio.create_task(
                send_registration_sms(payload.phone, member_number, payload.first_name)
            )
        except Exception as e:
            logger.error(f"Could not schedule registration SMS: {e}")

        return PublicRegisterResponse(
            success=True,
            member_id=member_id,
            member_number=member_number,
            registration_amount=registration_amount
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Public registration failed: {e}")
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

# ------------------------------------------------------------
# 5. PUBLIC REGISTER (CHAMA)
# ------------------------------------------------------------

@public_router.post("/register/chama")
async def public_register_chama(payload: ChamaRegistrationRequest):
    """
    Public registration endpoint for Chama/Group registrations.

    Member count rules:
      - No CSV uploaded  -> the count is number_of_members.
      - CSV uploaded     -> the CSV row count is used, and if number_of_members
                            was also sent it must match.
    The amount is always computed here: member_count x live chama rate.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    csv_count = len(payload.members)
    declared = payload.number_of_members

    if csv_count > 0:
        if declared is not None and declared != csv_count:
            raise HTTPException(
                status_code=400,
                detail=f"The number of members entered ({declared}) does not match the CSV ({csv_count})."
            )
        member_count = csv_count
    else:
        if declared is None:
            raise HTTPException(status_code=400, detail="Number of members is required.")
        member_count = declared

    if member_count < MIN_CHAMA_MEMBERS:
        raise HTTPException(
            status_code=400,
            detail=f"Minimum {MIN_CHAMA_MEMBERS} members required. Currently {member_count}."
        )

    if not payload.group_name:
        raise HTTPException(status_code=400, detail="Group name is required")
    if not payload.phone:
        raise HTTPException(status_code=400, detail="Contact phone is required")

    officials = [
        ("Chairperson", payload.chairperson),
        ("Treasurer", payload.treasurer),
        ("Secretary", payload.secretary)
    ]
    for label, official in officials:
        if not official.get("name"):
            raise HTTPException(status_code=400, detail=f"{label} name is required")
        if not official.get("phone"):
            raise HTTPException(status_code=400, detail=f"{label} phone is required")
        if not official.get("id_number"):
            raise HTTPException(status_code=400, detail=f"{label} ID is required")

    try:
        # Live per-member chama rate from Supabase's `plans` table
        # (plan_code = 'CHAMA'), instead of a hardcoded 100.00.
        chama_pricing = get_live_plan_pricing("chama")
        chama_rate = chama_pricing["registration_fee"]

        group_record = {
            "group_name": payload.group_name,
            "phone": payload.phone,
            "chairperson_name": payload.chairperson.get("name"),
            "chairperson_phone": payload.chairperson.get("phone"),
            "chairperson_id": payload.chairperson.get("id_number"),
            "treasurer_name": payload.treasurer.get("name"),
            "treasurer_phone": payload.treasurer.get("phone"),
            "treasurer_id": payload.treasurer.get("id_number"),
            "secretary_name": payload.secretary.get("name"),
            "secretary_phone": payload.secretary.get("phone"),
            "secretary_id": payload.secretary.get("id_number"),
            "member_count": member_count,
            "status": "PENDING",
            "registration_amount": member_count * chama_rate,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }

        result = supabase.table("chama_groups").insert(group_record).execute()
        if not result.data:
            raise HTTPException(status_code=400, detail="Failed to create chama group")

        group = result.data[0]
        group_id = group["id"]
        registration_amount = group["registration_amount"]

        # FIX: "payments" has no group_name column. Only chama_group_id identifies
        # the group on this table; look up the name via a join if you need it later.
        payment_record = {
            "chama_group_id": group_id,
            "amount": registration_amount,
            "payment_type": "chama_registration",
            "payment_method": "mpesa",
            "status": "pending",
            "phone": payload.phone,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        supabase.table("payments").insert(payment_record).execute()

        # Member rows are only created when a CSV member list was uploaded.
        for member in payload.members:
            supabase.table("chama_members").insert({
                "chama_group_id": group_id,
                "first_name": member.get("first_name"),
                "last_name": member.get("last_name"),
                "phone": member.get("phone"),
                "id_number": member.get("id_number"),
                "date_of_birth": member.get("date_of_birth"),
                "gender": member.get("gender", "").upper(),
                "is_active": True,
                "created_at": datetime.now().isoformat()
            }).execute()

        return {
            "success": True,
            "group_id": group_id,
            "group_name": payload.group_name,
            "member_count": member_count,
            "registration_amount": registration_amount,
            "message": "Chama registration created successfully. Please complete payment."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chama registration failed: {e}")
        raise HTTPException(status_code=400, detail=f"Chama registration failed: {str(e)}")

# ------------------------------------------------------------
# 6. M-PESA STK PUSH
# ------------------------------------------------------------

@public_router.post("/payment/stk-push", response_model=STKPushResponse)
async def initiate_stk_push(request: STKPushRequest):
    """
    Initiate M-Pesa STK push payment.
    Supports both individual member_id and chama group_id.

    SECURITY: the amount actually charged is computed SERVER-SIDE from
    the member's/group's live plan price below (`verified_amount`) —
    `request.amount` from the client is only used for a basic sanity
    check and is otherwise ignored. Previously this endpoint charged
    whatever amount the client sent, which meant a modified request
    could pay any figure it wanted.

    RELIABILITY: a payment row is NEVER left 'pending' unless M-Pesa
    actually returned a usable CheckoutRequestID. If STK initiation
    fails, or returns success with no CheckoutRequestID, the row is
    immediately marked 'failed' with a failure_reason and the client
    gets success=False.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    phone = format_phone_number(request.phone)
    if not phone or not re.match(r"^254[17]\d{8}$", phone):
        raise HTTPException(status_code=400, detail="Invalid phone number format")

    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    if not request.member_id and not request.group_id:
        raise HTTPException(status_code=400, detail="Either member_id or group_id is required")

    # ---- Recompute the amount server-side; never trust request.amount ----
    verified_amount: float

    if request.member_id:
        member_result = supabase.table("members").select("plan").eq("id", request.member_id).limit(1).execute()
        if not member_result.data:
            raise HTTPException(status_code=404, detail="Member not found")
        member_plan = (member_result.data[0].get("plan") or "").lower()

        pricing = get_live_plan_pricing(member_plan)
        verified_amount = pricing["registration_fee"]

        if member_plan == "wazazi" and pricing["dependant_fee"] > 0:
            parent_count_result = (
                supabase.table("dependants")
                .select("id", count="exact")
                .eq("principal_member_id", request.member_id)
                .ilike("relationship", "parent")
                .execute()
            )
            parent_count = parent_count_result.count or 0
            verified_amount += parent_count * pricing["dependant_fee"]

    else:  # request.group_id
        group_result = supabase.table("chama_groups").select("registration_amount").eq("id", request.group_id).limit(1).execute()
        if not group_result.data:
            raise HTTPException(status_code=404, detail="Chama group not found")
        # registration_amount was already computed correctly at chama
        # registration time (member_count * live rate) — trust that
        # stored value rather than recomputing it here.
        verified_amount = float(group_result.data[0].get("registration_amount") or 0)

    if verified_amount <= 0:
        raise HTTPException(status_code=400, detail="Could not determine a valid amount for this registration")

    try:
        # FIX: kept as a Python-side reference; no longer written to a
        # "transaction_id" column (doesn't exist — see payment_record below).
        transaction_ref = f"TXN-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(4).upper()}"

        payment_check = supabase.table("payments").select("*").eq("status", "pending")
        if request.member_id:
            payment_check = payment_check.eq("member_id", request.member_id)
        elif request.group_id:
            # FIX: the FK column on `payments` is "chama_group_id", not
            # "group_id" — the old filter here silently matched nothing.
            payment_check = payment_check.eq("chama_group_id", request.group_id)
        payment_check = payment_check.execute()

        if payment_check.data:
            existing = payment_check.data[0]
            if existing.get("checkout_request_id"):
                return STKPushResponse(
                    success=True,
                    message="Payment already in progress. Please check your phone.",
                    checkout_request_id=existing.get("checkout_request_id"),
                    merchant_request_id=existing.get("merchant_request_id")
                )

        # FIX: "transaction_id" isn't a payments column — the schema's equivalent
        # is "transaction_reference". Also "group_id" isn't a column either;
        # the correct FK is "chama_group_id" (matches the chama insert above).
        payment_record = {
            "transaction_reference": transaction_ref,
            "phone": phone,
            "amount": verified_amount,
            "payment_type": "registration" if request.member_id else "chama_registration",
            "status": "pending",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }

        if request.member_id:
            payment_record["member_id"] = request.member_id
        if request.group_id:
            payment_record["chama_group_id"] = request.group_id

        supabase.table("payments").insert(payment_record).execute()

        checkout_request_id = None
        merchant_request_id = None

        if MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET:
            try:
                stk_result = await initiate_mpesa_stk_push(
                    phone,
                    verified_amount,
                    transaction_ref,
                    request.transaction_desc
                )

                checkout_request_id = stk_result.get("checkout_request_id")
                merchant_request_id = stk_result.get("merchant_request_id")

                if stk_result.get("success") and checkout_request_id:
                    # Happy path: STK push accepted. Save IDs and leave the
                    # row pending — only the callback or a reconcile sweep
                    # may complete it.
                    supabase.table("payments").update({
                        "checkout_request_id": checkout_request_id,
                        "merchant_request_id": merchant_request_id,
                        "updated_at": datetime.now().isoformat()
                    }).eq("transaction_reference", transaction_ref).execute()
                else:
                    # No usable CheckoutRequestID — the customer will never
                    # get a prompt, so DON'T leave this row pending.
                    reason = stk_result.get("message") or "No CheckoutRequestID returned by M-Pesa"
                    logger.error(f"STK push did not produce a CheckoutRequestID: {reason}")
                    try:
                        supabase.table("payments").update({
                            "status": "failed",
                            "failure_reason": reason[:500],
                            "updated_at": datetime.now().isoformat()
                        }).eq("transaction_reference", transaction_ref).execute()
                    except Exception:
                        # Older schema may not have failure_reason yet.
                        supabase.table("payments").update({
                            "status": "failed"
                        }).eq("transaction_reference", transaction_ref).execute()

                    return STKPushResponse(
                        success=False,
                        message="Could not initiate M-Pesa payment. Please try again.",
                        checkout_request_id=None,
                        merchant_request_id=None
                    )
            except Exception as e:
                logger.error(f"STK push failed: {e}")
                try:
                    supabase.table("payments").update({
                        "status": "failed",
                        "failure_reason": str(e)[:500],
                        "updated_at": datetime.now().isoformat()
                    }).eq("transaction_reference", transaction_ref).execute()
                except Exception:
                    supabase.table("payments").update({
                        "status": "failed"
                    }).eq("transaction_reference", transaction_ref).execute()

                return STKPushResponse(
                    success=False,
                    message="M-Pesa payment could not be initiated. Please try again.",
                    checkout_request_id=None,
                    merchant_request_id=None
                )

        return STKPushResponse(
            success=True,
            message="Payment initiated. Please check your phone for the M-Pesa prompt.",
            checkout_request_id=checkout_request_id,
            merchant_request_id=merchant_request_id
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"STK push initiation failed: {e}")
        raise HTTPException(status_code=400, detail=f"Payment initiation failed: {str(e)}")

async def initiate_mpesa_stk_push(phone: str, amount: float, transaction_id: str, description: str = "Masika Benevolent Payment") -> dict:
    """Initiate M-Pesa STK push."""
    if not httpx or not mpesa_http_client:
        return {"success": False, "message": "HTTP client not available"}

    token = await get_mpesa_access_token()
    if not token:
        return {"success": False, "message": "Failed to get M-Pesa access token"}

    # Daraja rejects fractional amounts — round to the nearest whole shilling
    # rather than truncating, so a KES 199.60 charge doesn't silently become 199.
    whole_amount = round(amount)
    if whole_amount <= 0:
        return {"success": False, "message": "Amount must round to at least KES 1"}

    timestamp = generate_timestamp()
    password = generate_mpesa_password(MPESA_SHORTCODE, MPESA_PASSKEY, timestamp)

    payload = {
        "BusinessShortCode": MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": whole_amount,
        "PartyA": phone,
        "PartyB": MPESA_SHORTCODE,
        "PhoneNumber": phone,
        "CallBackURL": MPESA_CALLBACK_URL,
        "AccountReference": transaction_id[:12],
        "TransactionDesc": description[:20]
    }

    try:
        response = await _mpesa_request_with_retry(
            "POST", MPESA_STK_PUSH_URL,
            json=payload,
            headers={"Authorization": f"Bearer {token}"}
        )

        if response is None:
            return {"success": False, "message": "M-Pesa request failed after retries"}

        if response.status_code == 200:
            data = response.json()
            if data.get("ResponseCode") == "0":
                return {
                    "success": True,
                    "checkout_request_id": data.get("CheckoutRequestID"),
                    "merchant_request_id": data.get("MerchantRequestID")
                }
            else:
                logger.error(f"M-Pesa error: {data}")
                return {"success": False, "message": data.get("ResponseDescription", "STK push failed")}

        # 401 usually means the cached token was stale — clear it so the
        # next attempt fetches a fresh one instead of reusing a dead token.
        if response.status_code == 401:
            _mpesa_token_cache["token"] = None
            _mpesa_token_cache["expires_at"] = None

        logger.error(f"M-Pesa STK push HTTP {response.status_code}: {response.text[:500]}")
        return {"success": False, "message": f"HTTP {response.status_code}"}

    except Exception as e:
        logger.error(f"STK push error: {e}")
        return {"success": False, "message": str(e)}

# ------------------------------------------------------------
# 7. PAYMENT STATUS
# ------------------------------------------------------------

@public_router.get("/payment/status/{checkout_request_id}", response_model=PaymentStatusResponse)
async def get_payment_status(checkout_request_id: str):
    """
    Check the status of an M-Pesa payment.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        result = supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Payment not found")

        payment = result.data[0]

        if payment.get("status") == "pending" and payment.get("checkout_request_id"):
            try:
                status_result = await query_mpesa_transaction_status(payment.get("checkout_request_id"))
                if status_result.get("success"):
                    update_data = {
                        "status": "completed",
                        "mpesa_receipt": status_result.get("receipt"),
                        "updated_at": datetime.now().isoformat()
                    }
                    supabase.table("payments").update(update_data).eq("id", payment["id"]).execute()

                    await activate_registration(payment)

                    return PaymentStatusResponse(
                        status="completed",
                        amount=payment.get("amount"),
                        receipt=status_result.get("receipt"),
                        transaction_id=payment.get("transaction_reference")
                    )
                elif status_result.get("failed"):
                    supabase.table("payments").update({
                        "status": "failed",
                        "updated_at": datetime.now().isoformat()
                    }).eq("id", payment["id"]).execute()

                    return PaymentStatusResponse(
                        status="failed",
                        amount=payment.get("amount"),
                        transaction_id=payment.get("transaction_reference")
                    )
            except Exception as e:
                logger.error(f"Status query failed: {e}")

        # FIX: include the stored M-Pesa receipt so payments already
        # confirmed by the callback still show their receipt number.
        return PaymentStatusResponse(
            status=payment.get("status", "pending"),
            amount=payment.get("amount"),
            receipt=payment.get("mpesa_receipt"),
            transaction_id=payment.get("transaction_reference")
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Payment status check failed: {e}")
        raise HTTPException(status_code=400, detail=f"Status check failed: {str(e)}")

async def query_mpesa_transaction_status(checkout_request_id: str) -> dict:
    """Query M-Pesa transaction status (used both for on-demand polling from
    the status endpoint and for the reconciliation sweep below)."""
    if not httpx or not mpesa_http_client:
        return {"success": False}

    token = await get_mpesa_access_token()
    if not token:
        return {"success": False}

    timestamp = generate_timestamp()
    password = generate_mpesa_password(MPESA_SHORTCODE, MPESA_PASSKEY, timestamp)

    payload = {
        "BusinessShortCode": MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "CheckoutRequestID": checkout_request_id
    }

    try:
        response = await _mpesa_request_with_retry(
            "POST", MPESA_STK_QUERY_URL,
            json=payload,
            headers={"Authorization": f"Bearer {token}"}
        )

        if response is None:
            return {"success": False}

        if response.status_code == 200:
            data = response.json()
            # ResultCode comes back as a string on some Daraja responses and
            # an int on others — compare as string to handle both.
            result_code = str(data.get("ResultCode", ""))
            if result_code == "0":
                return {
                    "success": True,
                    "receipt": data.get("ReceiptNumber") or data.get("MpesaReceiptNumber")
                }
            elif result_code == "1037":
                # 1037 = "DS timeout user cannot be reached" — still pending,
                # not a hard failure; the user may retry the prompt.
                return {"success": False, "pending": True}
            elif result_code in KNOWN_MPESA_FAILURE_CODES:
                # Only these are genuinely terminal — cancelled by the user,
                # wrong PIN, insufficient balance, etc.
                return {"success": False, "failed": True, "reason": data.get("ResultDesc")}
            else:
                # FIX: any OTHER/unrecognized code used to fall through to
                # "failed" here. That's what was silently eating real
                # payments: Safaricom returns a variety of transient/unknown
                # codes (e.g. querying while still awaiting PIN entry), and
                # marking those "failed" set payments.status = "failed" —
                # which the callback handler's idempotency guard then treats
                # as terminal, so when the REAL success callback arrived
                # afterward it got ignored as a "duplicate". Money left the
                # customer's phone, Safaricom confirmed success, and the app
                # still showed "Payment failed". Unknown codes now stay
                # pending instead of being guessed as failures.
                logger.warning(f"Unrecognized M-Pesa ResultCode {result_code}: {data.get('ResultDesc')} — treating as still pending")
                return {"success": False, "pending": True}

        logger.error(f"M-Pesa status query HTTP {response.status_code}: {response.text[:500]}")
        return {"success": False}

    except Exception as e:
        logger.error(f"Status query error: {e}")
        return {"success": False}

# Known terminal M-Pesa failure ResultCodes (STK query). Anything not in
# this set is treated as "still pending" rather than guessed as a failure.
KNOWN_MPESA_FAILURE_CODES = {
    "1",      # Insufficient balance
    "1001",   # Unable to lock subscriber / another transaction in progress
    "1002",   # Wrong PIN
    "1019",   # Transaction expired
    "1025",   # System error
    "1032",   # Cancelled by user
    "1037",   # DS timeout (kept here for completeness; handled separately)
    "2001",   # Wrong PIN
    "2028",   # User cancel
}
