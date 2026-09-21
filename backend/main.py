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
#
# NEW ENV VARS (Render -> Environment)
#   ALLOWED_ORIGINS         = https://masika-murex.vercel.app,https://www.masikabbs.com,https://masikabbs.com
#   PAYMENT_COLLECTOR_ROLES = SUPER_ADMIN        (comma-separated role_codes)
#   ADMIN_MAX_COLLECT_AMOUNT = 250000            (optional)
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
        "mpesa_environment": MPESA_ENVIRONMENT
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
                if stk_result.get("success"):
                    checkout_request_id = stk_result.get("checkout_request_id")
                    merchant_request_id = stk_result.get("merchant_request_id")
                    supabase.table("payments").update({
                        "checkout_request_id": checkout_request_id,
                        "merchant_request_id": merchant_request_id,
                        "updated_at": datetime.now().isoformat()
                    }).eq("transaction_reference", transaction_ref).execute()
            except Exception as e:
                logger.error(f"STK push failed: {e}")

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

# ------------------------------------------------------------
# 8. PAYMENT CALLBACK
# ------------------------------------------------------------

@public_router.post("/payment/callback")
async def payment_callback(request: Request):
    """
    M-Pesa payment callback webhook. Called by Safaricom when the STK
    transaction completes (success, user cancellation, or timeout).

    Registered at two paths (see the app.post alias right after this router
    is included below) — /api/public/payment/callback, which is what the
    outgoing STK payload's CallBackURL defaults to, and /api/webhooks/mpesa,
    which is what MPESA_CALLBACK_URL was set to on Render. Whichever one
    Safaricom actually calls, both land here.

    Always returns {"ResultCode": 0} to Safaricom once the payload is
    parsed — even if our own processing hits an error — because returning
    a non-zero code makes Daraja retry the callback, and retries won't fix
    a bug on our side, they'll just resend the same webhook repeatedly.
    """
    client_ip = request.client.host if request.client else None
    if not is_ip_allowed(client_ip):
        logger.warning(f"Rejected M-Pesa callback from disallowed IP: {client_ip}")
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        data = await request.json()
    except Exception as e:
        logger.error(f"Payment callback: could not parse JSON body: {e}")
        return {"ResultCode": 0, "ResultDesc": "Success"}

    logger.info(f"Payment callback received from {client_ip}: {data}")

    try:
        body = data.get("Body", {})
        stk_callback = body.get("stkCallback", {})

        result_code = stk_callback.get("ResultCode")
        result_desc = stk_callback.get("ResultDesc")
        checkout_request_id = stk_callback.get("CheckoutRequestID")
        callback_metadata = stk_callback.get("CallbackMetadata", {})

        if not checkout_request_id:
            logger.warning("Payment callback missing CheckoutRequestID — ignoring")
            return {"ResultCode": 0, "ResultDesc": "Success"}

        payment_result = supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
        if not payment_result.data:
            logger.warning(f"Payment not found for checkout_request_id: {checkout_request_id}")
            return {"ResultCode": 0, "ResultDesc": "Success"}

        payment = payment_result.data[0]

        # Idempotency: Safaricom can and does resend the same callback
        # (network retries on their end). If we've already resolved this
        # payment, don't reactivate the member or overwrite the receipt.
        if payment.get("status") in ("completed", "failed"):
            logger.info(f"Duplicate callback for already-{payment.get('status')} payment {checkout_request_id} — ignoring")
            return {"ResultCode": 0, "ResultDesc": "Success"}

        if result_code == 0:
            mpesa_receipt = None
            items = callback_metadata.get("Item", [])
            for item in items:
                if item.get("Name") == "MpesaReceiptNumber":
                    mpesa_receipt = item.get("Value")

            update_data = {
                "status": "completed",
                "mpesa_receipt": mpesa_receipt,
                "updated_at": datetime.now().isoformat()
            }
            try:
                supabase.table("payments").update(update_data).eq("id", payment["id"]).execute()
            except Exception:
                # Older schemas may not have every column below yet — retry
                # with just the fields we know exist rather than losing the
                # receipt entirely because of one unrecognized column.
                supabase.table("payments").update({
                    "status": "completed",
                    "mpesa_receipt": mpesa_receipt
                }).eq("id", payment["id"]).execute()

            await activate_registration(payment)
            logger.info(f"Payment completed: {checkout_request_id}, receipt: {mpesa_receipt}")
        else:
            logger.info(f"Payment not completed: {checkout_request_id} - {result_desc}")
            try:
                supabase.table("payments").update({
                    "status": "failed",
                    "failure_reason": result_desc,
                    "updated_at": datetime.now().isoformat()
                }).eq("id", payment["id"]).execute()
            except Exception:
                supabase.table("payments").update({"status": "failed"}).eq("id", payment["id"]).execute()

        return {"ResultCode": 0, "ResultDesc": "Success"}

    except Exception as e:
        logger.error(f"Payment callback processing error: {e}")
        # Still ack with ResultCode 0 — see docstring above.
        return {"ResultCode": 0, "ResultDesc": "Success"}

# ------------------------------------------------------------
# 8b. RECONCILIATION SWEEP (for STK pushes whose callback never arrives)
# ------------------------------------------------------------
# Safaricom's callback is a best-effort webhook — it can be delayed, dropped,
# or fail to reach us (deploy restart, transient network issue). Without a
# sweep, a member who paid but whose callback was lost stays stuck on
# "pending" forever. Call this on a schedule (e.g. a Render cron job hitting
# it every few minutes) with the shared secret in the X-Reconcile-Key header.

@public_router.post("/payment/reconcile")
async def reconcile_pending_payments(request: Request, older_than_minutes: int = 2, limit: int = 25):
    """
    Actively poll M-Pesa for any payment still 'pending' with a
    checkout_request_id older than `older_than_minutes`, and resolve it the
    same way the callback would. Protected by RECONCILE_SECRET since it
    triggers real calls against your M-Pesa credentials.
    """
    if not RECONCILE_SECRET:
        raise HTTPException(status_code=503, detail="Reconciliation is not configured (RECONCILE_SECRET unset)")
    if request.headers.get("X-Reconcile-Key") != RECONCILE_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    cutoff = (datetime.now() - timedelta(minutes=older_than_minutes)).isoformat()

    pending = (
        supabase.table("payments")
        .select("*")
        .eq("status", "pending")
        .not_.is_("checkout_request_id", "null")
        .lte("created_at", cutoff)
        .limit(limit)
        .execute()
    )

    resolved, still_pending, errors = [], [], []

    for payment in (pending.data or []):
        checkout_request_id = payment.get("checkout_request_id")
        try:
            result = await query_mpesa_transaction_status(checkout_request_id)
            if result.get("success"):
                supabase.table("payments").update({
                    "status": "completed",
                    "mpesa_receipt": result.get("receipt"),
                    "updated_at": datetime.now().isoformat()
                }).eq("id", payment["id"]).execute()
                await activate_registration(payment)
                resolved.append({"checkout_request_id": checkout_request_id, "outcome": "completed"})
            elif result.get("failed"):
                supabase.table("payments").update({
                    "status": "failed",
                    "updated_at": datetime.now().isoformat()
                }).eq("id", payment["id"]).execute()
                resolved.append({"checkout_request_id": checkout_request_id, "outcome": "failed"})
            else:
                still_pending.append(checkout_request_id)
        except Exception as e:
            logger.error(f"Reconciliation error for {checkout_request_id}: {e}")
            errors.append(checkout_request_id)

    return {
        "success": True,
        "checked": len(pending.data or []),
        "resolved": resolved,
        "still_pending": still_pending,
        "errors": errors
    }

# ------------------------------------------------------------
# 9. ACTIVATE REGISTRATION
# ------------------------------------------------------------

async def activate_registration(payment: dict):
    """
    Activate member or chama registration after a successful REGISTRATION payment.

    FIX: this used to run for EVERY completed member payment, so a monthly
    contribution also set registration_fee_paid = True and member_status =
    ACTIVE. It now only acts on registration payments; other payment types
    (monthly / topup / addon) are simply recorded.
    """
    try:
        payment_type = (payment.get("payment_type") or "").lower()

        if payment.get("member_id"):
            if payment_type != "registration":
                logger.info(
                    f"Payment {payment.get('id')} is '{payment_type}', not registration "
                    f"- member activation skipped"
                )
                return

            supabase.table("members").update({
                "registration_fee_paid": True,
                "member_status": "ACTIVE",
                "updated_at": datetime.now().isoformat()
            }).eq("id", payment["member_id"]).execute()

            logger.info(f"Member {payment['member_id']} activated")

        elif payment.get("chama_group_id"):
            supabase.table("chama_groups").update({
                "status": "ACTIVE",
                "payment_status": "paid",
                "updated_at": datetime.now().isoformat()
            }).eq("id", payment["chama_group_id"]).execute()

            supabase.table("chama_members").update({
                "is_active": True,
                "updated_at": datetime.now().isoformat()
            }).eq("chama_group_id", payment["chama_group_id"]).execute()

            logger.info(f"Chama group {payment['chama_group_id']} activated")

    except Exception as e:
        logger.error(f"Activation failed: {e}")


# ============================================================
# ADMIN PAYMENT COLLECTION  (NEW)
# ============================================================
# Staff-initiated STK push for an EXISTING member (monthly, top-up, add-on
# or registration), used by admin-collectpayments.html.
#
# Auth: the admin page sends the SUPABASE access token from its login. It is
# validated with Supabase, then the user must be an ACTIVE row in `staff`
# (linked by staff.auth_user_id) whose role (roles.role_code) is listed in
# PAYMENT_COLLECTOR_ROLES.

def _resolve_payment_collector_sync(token: str) -> dict:
    """Validate a Supabase access token and confirm the staff member may collect payments."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        auth_response = supabase.auth.get_user(token)
        auth_user = getattr(auth_response, "user", None)
    except Exception as e:
        logger.warning(f"Supabase token validation failed: {e}")
        auth_user = None

    if not auth_user:
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please log in again.")

    staff_result = (
        supabase.table("staff")
        .select("id, full_name, status, role_id")
        .eq("auth_user_id", str(auth_user.id))
        .limit(1)
        .execute()
    )

    if not staff_result.data:
        raise HTTPException(status_code=403, detail="This account is not a staff account.")

    staff = staff_result.data[0]

    if str(staff.get("status") or "").upper() != "ACTIVE":
        raise HTTPException(status_code=403, detail="Staff account is not active.")

    role_code = ""
    if staff.get("role_id"):
        role_result = (
            supabase.table("roles")
            .select("role_code")
            .eq("id", staff["role_id"])
            .limit(1)
            .execute()
        )
        if role_result.data:
            role_code = str(role_result.data[0].get("role_code") or "").upper()

    if role_code not in PAYMENT_COLLECTOR_ROLES:
        raise HTTPException(status_code=403, detail="Your role is not allowed to collect payments.")

    return {
        "staff_id": staff["id"],
        "full_name": staff.get("full_name"),
        "role_code": role_code,
    }


async def get_payment_collector(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    # supabase-py is synchronous, so keep it off the event loop
    return await asyncio.to_thread(_resolve_payment_collector_sync, credentials.credentials)


class AdminCollectPaymentRequest(BaseModel):
    member_id: Optional[str] = None
    membership_number: Optional[str] = None
    phone_number: str
    amount: float
    payment_type: PaymentTypeEnum = PaymentTypeEnum.MONTHLY


admin_payments_router = APIRouter(prefix="/api/admin/payments", tags=["Admin Payments"])


@admin_payments_router.post("/collect")
async def admin_collect_payment(
    payload: AdminCollectPaymentRequest,
    collector: dict = Depends(get_payment_collector),
):
    """
    Send an STK push on behalf of a member. Requires a valid Supabase login
    token belonging to an active staff member with an allowed role.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    if not (MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET):
        raise HTTPException(status_code=503, detail="M-Pesa is not configured on the server.")

    phone = format_phone_number(payload.phone_number)
    if not re.match(r"^254[17]\d{8}$", phone):
        raise HTTPException(status_code=400, detail="Invalid phone number format")

    amount = float(round(payload.amount))
    if amount != payload.amount:
        raise HTTPException(status_code=400, detail="Amount must be a whole number of shillings")
    if amount < 1 or amount > ADMIN_MAX_COLLECT_AMOUNT:
        raise HTTPException(
            status_code=400,
            detail=f"Amount must be between 1 and {int(ADMIN_MAX_COLLECT_AMOUNT)}",
        )

    # ---- find the member ----
    member_query = supabase.table("members").select("id, member_number, first_name, last_name")

    if payload.member_id:
        member_query = member_query.eq("id", payload.member_id)
    elif payload.membership_number:
        member_query = member_query.eq("member_number", payload.membership_number)
    else:
        raise HTTPException(status_code=400, detail="member_id or membership_number is required")

    member_result = member_query.limit(1).execute()
    if not member_result.data:
        raise HTTPException(status_code=404, detail="Member not found")

    member = member_result.data[0]
    payment_type = payload.payment_type.value
    transaction_ref = f"TXN-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(4).upper()}"

    # ---- create the pending payment row ----
    try:
        inserted = supabase.table("payments").insert({
            "member_id": member["id"],
            "amount": amount,
            "payment_type": payment_type,
            "payment_method": "mpesa",
            "status": "pending",
            "payment_date": datetime.now().date().isoformat(),
            "phone": phone,
            "transaction_reference": transaction_ref,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }).execute()
    except Exception as e:
        logger.error(f"Admin collect: could not create payment row: {e}")
        raise HTTPException(status_code=400, detail=f"Could not create payment record: {str(e)}")

    payment_id = inserted.data[0]["id"] if inserted.data else None

    # ---- send the STK push (member number shows as the account reference) ----
    stk_result = await initiate_mpesa_stk_push(
        phone,
        amount,
        member.get("member_number") or transaction_ref,
        f"Masika {payment_type}",
    )

    if not stk_result.get("success"):
        supabase.table("payments").update({
            "status": "failed",
            "updated_at": datetime.now().isoformat(),
        }).eq("transaction_reference", transaction_ref).execute()

        raise HTTPException(
            status_code=502,
            detail=stk_result.get("message") or "M-Pesa STK push failed",
        )

    checkout_request_id = stk_result.get("checkout_request_id")
    merchant_request_id = stk_result.get("merchant_request_id")

    supabase.table("payments").update({
        "checkout_request_id": checkout_request_id,
        "merchant_request_id": merchant_request_id,
        "updated_at": datetime.now().isoformat(),
    }).eq("transaction_reference", transaction_ref).execute()

    logger.info(
        f"Admin STK push: staff={collector['staff_id']} ({collector.get('full_name')}) "
        f"member={member.get('member_number')} amount={amount} type={payment_type} "
        f"checkout={checkout_request_id}"
    )

    return {
        "success": True,
        "message": "STK push sent. Waiting for the member to enter their M-Pesa PIN.",
        "payment_id": payment_id,
        "checkout_request_id": checkout_request_id,
        "merchant_request_id": merchant_request_id,
        "amount": amount,
        "phone_number": phone,
        "payment_type": payment_type,
    }


@admin_payments_router.get("/status/{checkout_request_id}", response_model=PaymentStatusResponse)
async def admin_payment_status(
    checkout_request_id: str,
    collector: dict = Depends(get_payment_collector),
):
    # Reuses the public status logic (polls M-Pesa and resolves the payment)
    return await get_payment_status(checkout_request_id)


app.include_router(admin_payments_router)


# ============================================================
# PAYMENT VALIDATION / MEMBERSHIP RECONCILIATION
# ============================================================
# Reconciles a member's registration + monthly contributions using the
# payments ledger. The registration payment is never counted as a monthly
# contribution. Legacy status fields (legacy_status, legacy_missing_months)
# are returned for reference only and never influence the computed status.

def _parse_date(value):
    """Safely convert a Supabase date/datetime value to a date."""
    if not value:
        return None

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except Exception:
        try:
            return date.fromisoformat(str(value)[:10])
        except Exception:
            return None


def _months_between(start_date: date, end_date: date) -> int:
    """
    Number of monthly contribution periods between two dates.

    Monthly contributions begin in the month after registration.
    The current month is included only if it has already started as
    a required contribution period.
    """
    if not start_date or not end_date:
        return 0

    start_month = start_date.year * 12 + start_date.month
    end_month = end_date.year * 12 + end_date.month

    # Monthly contribution starts the month after registration.
    months = end_month - start_month

    return max(0, months)


def get_plan_monthly_fee(plan_slug: str) -> float:
    """
    Get the current monthly contribution from the live plans table.
    Never hardcode the monthly fee.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    plan_slug = (plan_slug or "").strip().lower()

    result = (
        supabase.table("plans")
        .select("plan_code, monthly_premium, is_active")
        .ilike("plan_code", plan_slug)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=400,
            detail=f"Plan '{plan_slug}' was not found in pricing."
        )

    plan = result.data[0]

    return float(plan.get("monthly_premium") or 0)


def calculate_member_payment_validation(member_id: str) -> dict:
    """
    Reconcile a member using the NEW SYSTEM payment ledger.

    IMPORTANT:
    legacy_status / legacy_missing_months are historical only.
    They are NEVER used to determine the new status.
    """

    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    member_result = (
        supabase.table("members")
        .select("*")
        .eq("id", member_id)
        .limit(1)
        .execute()
    )

    if not member_result.data:
        raise HTTPException(status_code=404, detail="Member not found")

    member = member_result.data[0]

    plan = (member.get("plan") or "").strip().lower()

    if plan == "chama":
        return {
            "success": False,
            "validation_status": "NOT_APPLICABLE",
            "message": "Chama members use group payment validation."
        }

    registration_date = _parse_date(member.get("registration_date"))

    if not registration_date:
        return {
            "success": False,
            "validation_status": "REQUIRES_RECONCILIATION",
            "message": "Member has no valid registration date."
        }

    monthly_fee = get_plan_monthly_fee(plan)

    if monthly_fee <= 0:
        return {
            "success": False,
            "validation_status": "REQUIRES_RECONCILIATION",
            "message": f"No monthly contribution is configured for plan '{plan}'."
        }

    # --------------------------------------------------------
    # Load ALL completed payments in the new system.
    # Do NOT use only the last 10 payments.
    # --------------------------------------------------------

    payment_result = (
        supabase.table("payments")
        .select("*")
        .eq("member_id", member_id)
        .eq("status", "completed")
        .order("payment_date", desc=False)
        .execute()
    )

    payments = payment_result.data or []

    registration_paid = 0.0
    monthly_paid = 0.0
    monthly_payments = []

    for payment in payments:
        payment_type = (payment.get("payment_type") or "").lower()
        amount = float(payment.get("amount") or 0)

        if payment_type == "registration":
            registration_paid += amount

        elif payment_type in ("monthly", "topup", "addon"):
            monthly_paid += amount
            monthly_payments.append(payment)

    # --------------------------------------------------------
    # Registration payment is NOT counted as monthly payment.
    # --------------------------------------------------------

    expected_months = _months_between(
        registration_date,
        date.today()
    )

    expected_monthly_amount = expected_months * monthly_fee

    # --------------------------------------------------------
    # Match monthly payments chronologically against required
    # monthly contributions.
    #
    # Example:
    # monthly fee = 50
    # payment = 100
    #
    # This satisfies two months.
    # --------------------------------------------------------

    remaining_credit = monthly_paid
    months_paid = 0
    months_short = 0
    months_missing = 0

    for _ in range(expected_months):
        if remaining_credit >= monthly_fee:
            remaining_credit -= monthly_fee
            months_paid += 1

        elif remaining_credit > 0:
            months_short += 1
            remaining_credit = 0

        else:
            months_missing += 1

    # --------------------------------------------------------
    # Determine status.
    #
    # No historical payment evidence:
    # don't falsely declare DORMANT.
    # --------------------------------------------------------

    has_new_system_monthly_evidence = len(monthly_payments) > 0

    if expected_months == 0:
        current_status = "ACTIVE"
        validation_status = "VALIDATED"
        note = "No monthly contribution period is currently due."

    elif months_missing == 0 and months_short == 0:
        current_status = "ACTIVE"
        validation_status = "VALIDATED"
        note = "All required monthly contributions are satisfied."

    elif not has_new_system_monthly_evidence:
        current_status = "PENDING"
        validation_status = "REQUIRES_RECONCILIATION"
        note = (
            "No completed monthly payments exist in the new system. "
            "Historical payments must be imported or verified before "
            "determining current arrears."
        )

    else:
        current_status = "DORMANT"
        validation_status = "VALIDATED"
        note = (
            f"{months_missing} month(s) missing and "
            f"{months_short} month(s) short."
        )

    # --------------------------------------------------------
    # Update BOTH status fields.
    #
    # member_status is the existing field used throughout the
    # application.
    #
    # status is the new normalized field.
    # --------------------------------------------------------

    update_data = {
        "status": current_status,
        "member_status": current_status,
        "payment_validation_status": validation_status,
        "months_paid": months_paid,
        "months_missing": months_missing,
        "months_short": months_short,
        "amount_expected": expected_monthly_amount,
        "amount_paid": monthly_paid,
        "payment_validated_at": datetime.now().isoformat(),
        "payment_validation_note": note,
        "updated_at": datetime.now().isoformat()
    }

    try:
        update_result = (
            supabase.table("members")
            .update(update_data)
            .eq("id", member_id)
            .execute()
        )
    except Exception as e:
        logger.error(
            f"Could not save payment validation for {member_id}: {e}"
        )
        raise HTTPException(
            status_code=400,
            detail=f"Could not save payment validation: {str(e)}"
        )

    return {
        "success": True,
        "member_id": member_id,
        "member_number": member.get("member_number"),
        "plan": plan,

        "registration_date": registration_date.isoformat(),

        "monthly_fee": monthly_fee,

        "expected_months": expected_months,
        "months_paid": months_paid,
        "months_missing": months_missing,
        "months_short": months_short,

        "amount_expected": round(expected_monthly_amount, 2),
        "amount_paid": round(monthly_paid, 2),

        "registration_paid": round(registration_paid, 2),

        "status": current_status,
        "payment_validation_status": validation_status,

        "legacy_status": member.get("legacy_status"),
        "legacy_missing_months": member.get("legacy_missing_months"),

        "note": note
    }


# ------------------------------------------------------------
# 9b. PAYMENT VALIDATION ENDPOINTS
# ------------------------------------------------------------
# Wraps calculate_member_payment_validation() so the admin panel
# (admin-members.html "Validate Payments" button) and any cron /
# reporting job can trigger the reconciliation on demand.

class BulkValidateRequest(BaseModel):
    """Optionally restrict the sweep to a specific list of member ids."""
    member_ids: Optional[List[str]] = None
    # Safety cap so a misconfigured call can't try to reconcile
    # tens of thousands of members in one request.
    limit: int = 200


@public_router.post("/payment/validate/{member_id}")
async def validate_member_payment(member_id: str):
    """
    Reconcile ONE member's payment history against their plan's
    current monthly contribution and update their status.

    Returns the full audit dict from calculate_member_payment_validation(),
    including months_paid / months_missing / months_short and amounts.
    """
    try:
        result = calculate_member_payment_validation(member_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Payment validation failed for {member_id}: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"Payment validation failed: {str(e)}"
        )


@public_router.post("/payment/validate-bulk")
async def validate_members_bulk(payload: BulkValidateRequest):
    """
    Reconcile many members at once.

    - If `member_ids` is provided, only those are validated.
    - Otherwise the newest `limit` members with a known plan are swept.

    Returns per-member results plus a summary count so a cron job or
    an admin "Refresh all" button can see what changed.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    if payload.member_ids:
        ids = payload.member_ids[: payload.limit]
    else:
        try:
            rows = (
                supabase.table("members")
                .select("id")
                .not_.is_("plan", "null")
                .order("created_at", desc=True)
                .limit(payload.limit)
                .execute()
                .data or []
            )
        except Exception as e:
            logger.error(f"Bulk validation: could not list members: {e}")
            raise HTTPException(status_code=400, detail="Could not list members")

        ids = [r["id"] for r in rows if r.get("id")]

    results = []
    summary = {
        "checked": 0,
        "active": 0,
        "dormant": 0,
        "pending": 0,
        "requires_reconciliation": 0,
        "not_applicable": 0,
        "errors": 0,
    }

    for member_id in ids:
        try:
            result = calculate_member_payment_validation(member_id)
        except HTTPException as http_err:
            results.append({
                "member_id": member_id,
                "success": False,
                "error": http_err.detail,
            })
            summary["errors"] += 1
            continue
        except Exception as e:
            logger.error(f"Bulk validation error for {member_id}: {e}")
            results.append({
                "member_id": member_id,
                "success": False,
                "error": str(e),
            })
            summary["errors"] += 1
            continue

        results.append(result)
        summary["checked"] += 1

        if result.get("validation_status") == "NOT_APPLICABLE":
            summary["not_applicable"] += 1
            continue

        if result.get("validation_status") == "REQUIRES_RECONCILIATION":
            summary["requires_reconciliation"] += 1
            continue

        status = result.get("status")
        if status == "ACTIVE":
            summary["active"] += 1
        elif status == "DORMANT":
            summary["dormant"] += 1
        elif status == "PENDING":
            summary["pending"] += 1

    return {
        "success": True,
        "summary": summary,
        "results": results,
    }


# ------------------------------------------------------------
# 10. PUBLIC MEMBER LOOKUP (plain record)
# ------------------------------------------------------------

@public_router.get("/member/{member_id}")
async def get_public_member(member_id: str):
    """
    Fetch a member's public-safe record (used by receipt/ID-card/confirmation
    pages that only have the member_id from the registration response).
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    result = supabase.table("members").select("*").eq("id", member_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Member not found")

    return {"success": True, "data": get_member_safe(result.data[0])}

# ------------------------------------------------------------
# 11. MEMBER STATUS
# ------------------------------------------------------------

@public_router.get("/member/{member_id}/status", response_model=MemberStatusResponse)
async def get_member_status(member_id: str):
    """
    Get member status including coverage information.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        member_result = supabase.table("members").select("*").eq("id", member_id).execute()
        if not member_result.data:
            raise HTTPException(status_code=404, detail="Member not found")

        member = member_result.data[0]

        dependants_result = supabase.table("dependants").select("count", count="exact").eq("principal_member_id", member_id).execute()
        dependants_count = dependants_result.count or 0

        waiting_months = member.get("waiting_period_months", 4)
        reg_date = member.get("registration_date")
        coverage_status = "Pending"

        if reg_date:
            reg_date = datetime.fromisoformat(reg_date) if isinstance(reg_date, str) else reg_date
            wait_end = reg_date + timedelta(days=waiting_months * 30)
            coverage_status = "Active" if datetime.now() >= wait_end else "Waiting"

        return MemberStatusResponse(
            member_id=member_id,
            member_number=member.get("member_number"),
            status=member.get("member_status", "PENDING"),
            registration_fee_paid=member.get("registration_fee_paid", False),
            waiting_period_months=waiting_months,
            coverage_status=coverage_status,
            registration_date=member.get("registration_date"),
            dependants_count=dependants_count
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Member status check failed: {e}")
        raise HTTPException(status_code=400, detail=f"Status check failed: {str(e)}")

# ------------------------------------------------------------
# 12. RECEIPT GENERATION
# ------------------------------------------------------------

@public_router.get("/receipt/{payment_id}", response_model=ReceiptResponse)
async def get_receipt(payment_id: str):
    """
    Generate/download receipt for a completed payment.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        payment_result = supabase.table("payments").select("*").eq("id", payment_id).execute()
        if not payment_result.data:
            raise HTTPException(status_code=404, detail="Payment not found")

        payment = payment_result.data[0]

        if payment.get("status") != "completed":
            raise HTTPException(status_code=400, detail="Payment not completed")

        member_name = "Unknown"
        member_number = "N/A"
        plan = "N/A"
        if payment.get("member_id"):
            member_result = supabase.table("members").select("first_name, last_name, member_number, plan").eq("id", payment["member_id"]).execute()
            if member_result.data:
                member = member_result.data[0]
                member_name = f"{member.get('first_name', '')} {member.get('last_name', '')}".strip()
                member_number = member.get("member_number", "N/A")
                plan = member.get("plan", "N/A")

        return ReceiptResponse(
            payment_id=payment_id,
            member_number=member_number,
            amount=payment.get("amount", 0),
            payment_date=payment.get("payment_date", datetime.now().date().isoformat()),
            receipt_number=payment.get("mpesa_receipt") or f"REC-{payment_id[:8]}",
            member_name=member_name,
            plan=plan
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Receipt generation failed: {e}")
        raise HTTPException(status_code=400, detail=f"Receipt generation failed: {str(e)}")

# ------------------------------------------------------------
# 13. ID CARD GENERATION
# ------------------------------------------------------------

@public_router.get("/id-card/{member_id}", response_model=IDCardResponse)
async def get_id_card(member_id: str):
    """
    Generate ID card data for a member.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        member_result = supabase.table("members").select("*").eq("id", member_id).execute()
        if not member_result.data:
            raise HTTPException(status_code=404, detail="Member not found")

        member = member_result.data[0]

        full_name = f"{member.get('first_name', '')} {member.get('last_name', '')}".strip()

        return IDCardResponse(
            member_id=member_id,
            member_number=member.get("member_number", "N/A"),
            full_name=full_name,
            plan=member.get("plan", "N/A"),
            status=member.get("member_status", "PENDING"),
            registration_date=member.get("registration_date", ""),
            qr_code=None
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ID card generation failed: {e}")
        raise HTTPException(status_code=400, detail=f"ID card generation failed: {str(e)}")

# This is the piece that was missing: without this line, every
# /api/public/* route defined above never gets mounted on the app,
# so FastAPI returns 404 for all of them.
app.include_router(public_router)

# Alias so the callback also works at whatever path MPESA_CALLBACK_URL is set
# to on Render (currently /api/webhooks/mpesa) — same handler, same
# idempotency/IP-allowlist logic, just reachable at both URLs so a mismatch
# between "what the STK payload says" and "what's configured in the env var"
# can't silently 404 a real payment callback.
app.post("/api/webhooks/mpesa", tags=["Public"])(payment_callback)

# ============================================================
# AUTH ROUTES
# ============================================================

auth_router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@auth_router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = find_member_by_identifier(request.identifier)
    if not member:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    password_hash = member.get("password_hash")
    temp_password = member.get("temp_password")
    if not (password_hash and verify_password(request.password, password_hash) or temp_password and request.password == temp_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    supabase.table("members").update({"last_login": datetime.now().isoformat()}).eq("id", member["id"]).execute()
    token = generate_jwt_token(member["id"], member["email"])
    refresh_token = secrets.token_urlsafe(32)
    return LoginResponse(success=True, user=get_member_safe(member), message="Login successful", token=token, refresh_token=refresh_token)

@auth_router.post("/register")
async def register(member_data: MemberCreate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    if supabase.table("members").select("email").eq("email", member_data.email).execute().data:
        raise HTTPException(status_code=400, detail="Email already registered")
    if supabase.table("members").select("id_number").eq("id_number", member_data.id_number).execute().data:
        raise HTTPException(status_code=400, detail="ID number already registered")
    member_number = generate_member_number()
    password = generate_password()
    password_hash = hash_password(password)
    username = member_number
    waiting_period = 6 if member_data.plan == PlanEnum.DIGNITY else 4
    member_record = {
        "member_number": member_number, "username": username,
        "first_name": member_data.first_name, "last_name": member_data.last_name,
        "other_name": member_data.other_name, "email": member_data.email,
        "phone": member_data.phone, "alternative_phone": member_data.alternative_phone,
        "id_number": member_data.id_number, "date_of_birth": member_data.date_of_birth,
        "gender": member_data.gender.value, "county": member_data.county,
        "location": member_data.location, "town": member_data.town,
        "address": member_data.address, "plan": member_data.plan.value,
        "benefit_option": member_data.benefit_option.value, "sales_code": member_data.sales_code,
        "password_hash": password_hash, "temp_password": password,
        "member_status": "PENDING", "is_active": True,
        "registration_date": datetime.now().date().isoformat(),
        "waiting_period_months": waiting_period, "registration_fee_paid": False,
        "created_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()
    }
    result = supabase.table("members").insert(member_record).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create member")
    new_member = result.data[0]
    # FIX: `dependants` has no first_name/last_name/is_active columns —
    # it stores full_name and status instead. See build_dependant_row().
    for dep in member_data.dependants:
        supabase.table("dependants").insert(
            build_dependant_row(
                principal_member_id=new_member["id"],
                first_name=dep.first_name,
                last_name=dep.last_name,
                relationship=dep.relationship.value,
                date_of_birth=dep.date_of_birth,
                phone=dep.phone,
                email=dep.email,
            )
        ).execute()
    return {
        "success": True,
        "member": {
            "id": new_member["id"], "member_number": member_number,
            "username": username, "first_name": new_member["first_name"],
            "last_name": new_member["last_name"], "email": new_member["email"],
            "phone": new_member["phone"], "plan": new_member["plan"],
            "member_status": new_member["member_status"]
        },
        "credentials": {"member_number": member_number, "username": username, "password": password},
        "message": "Registration successful. Please save your credentials."
    }

@auth_router.post("/verify")
async def verify_member(identifier: str):
    member = find_member_by_identifier(identifier)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return {
        "success": True,
        "member": {
            "id": member.get("id"), "member_number": member.get("member_number"),
            "username": member.get("username"), "email": member.get("email"),
            "first_name": member.get("first_name"), "last_name": member.get("last_name"),
            "plan": member.get("plan"), "member_status": member.get("member_status")
        }
    }

@auth_router.post("/refresh")
async def refresh_token(request: RefreshTokenRequest):
    return {"success": True, "token": secrets.token_urlsafe(32), "message": "Token refreshed successfully"}

@auth_router.post("/logout")
async def logout():
    return {"success": True, "message": "Logged out successfully. Please clear your local token."}

@auth_router.get("/me")
async def get_current_user_endpoint(user_id: str = Depends(get_current_user)):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("members").select("*").eq("id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    return get_member_safe(result.data[0])

app.include_router(auth_router)

# ============================================================
# MEMBERS ROUTES
# ============================================================

members_router = APIRouter(prefix="/api/members", tags=["Members"])

@members_router.get("/", response_model=List[MemberResponse])
async def list_members(page: int = 1, limit: int = 20, status: Optional[str] = None, plan: Optional[str] = None, search: Optional[str] = None, user_id: str = Depends(get_current_user)):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    query = supabase.table("members").select("*", count="exact")
    if status: query = query.eq("member_status", status)
    if plan: query = query.eq("plan", plan)
    if search: query = query.or_(f"first_name.ilike.%{search}%,last_name.ilike.%{search}%,email.ilike.%{search}%,member_number.ilike.%{search}%")
    offset = (page - 1) * limit
    result = query.range(offset, offset + limit - 1).order("created_at", desc=True).execute()
    return [get_member_safe(m) for m in (result.data or [])]

@members_router.get("/{member_id}", response_model=MemberResponse)
async def get_member(member_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("members").select("*").eq("id", member_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Member not found")
    return get_member_safe(result.data[0])

@members_router.get("/by-number/{member_number}", response_model=MemberResponse)
async def get_member_by_number(member_number: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("members").select("*").eq("member_number", member_number).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Member not found")
    return get_member_safe(result.data[0])

@members_router.put("/{member_id}", response_model=MemberResponse)
async def update_member(member_id: str, member_update: MemberUpdate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    existing = supabase.table("members").select("id").eq("id", member_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Member not found")
    update_data = member_update.dict(exclude_unset=True)
    if update_data:
        update_data["updated_at"] = datetime.now().isoformat()
        if "plan" in update_data and update_data["plan"]:
            update_data["plan"] = update_data["plan"].value
        if "benefit_option" in update_data and update_data["benefit_option"]:
            update_data["benefit_option"] = update_data["benefit_option"].value
    result = supabase.table("members").update(update_data).eq("id", member_id).execute()
    return get_member_safe(result.data[0])

@members_router.get("/{member_id}/stats", response_model=DashboardStats)
async def get_member_stats(member_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("*").eq("id", member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    member = member.data[0]
    member_number = member.get("member_number")
    dependants = supabase.table("dependants").select("count", count="exact").eq("principal_member_id", member_id).execute()
    active_dependants = supabase.table("dependants").select("count", count="exact").eq("principal_member_id", member_id).eq("status", "ACTIVE").execute()
    payments = supabase.table("payments").select("*").eq("member_id", member_id).eq("status", "completed").execute()
    total_payments = sum(float(p.get("amount", 0)) for p in (payments.data or []))
    waiting_months = member.get("waiting_period_months", 4)
    reg_date = member.get("registration_date")
    coverage_status = "Pending"
    if reg_date:
        reg_date = datetime.fromisoformat(reg_date) if isinstance(reg_date, str) else reg_date
        wait_end = reg_date + timedelta(days=waiting_months * 30)
        coverage_status = "Active" if datetime.now() >= wait_end else "Waiting"
    return DashboardStats(
        member_id=member.get("id"), member_number=member.get("member_number"),
        plan=member.get("plan"), benefit_option=member.get("benefit_option"),
        dependants_count=dependants.count or 0, payments_count=len(payments.data or []),
        total_payments=total_payments, last_payment_date=None,
        coverage_status=coverage_status, registration_date=member.get("registration_date"),
        waiting_period_months=member.get("waiting_period_months"), active_dependants=active_dependants.count or 0
    )

app.include_router(members_router)

# ============================================================
# DEPENDANTS ROUTES
# ============================================================

dependants_router = APIRouter(prefix="/api/dependants", tags=["Dependants"])

@dependants_router.get("/member/{member_id}")
async def get_dependants(member_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("dependants").select("*").eq("principal_member_id", member_id).order("created_at", desc=True).execute()
    return {"success": True, "data": result.data or [], "count": len(result.data or [])}

@dependants_router.post("/")
async def create_dependant(dependant: DependantCreate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("id").eq("id", dependant.member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    # FIX: `dependants` has no first_name/last_name/is_active columns —
    # it stores full_name and status instead. See build_dependant_row().
    result = supabase.table("dependants").insert(
        build_dependant_row(
            principal_member_id=dependant.member_id,
            first_name=dependant.first_name,
            last_name=dependant.last_name,
            relationship=dependant.relationship.value,
            date_of_birth=dependant.date_of_birth,
            phone=dependant.phone,
            email=dependant.email,
        )
    ).execute()
    return {"success": True, "data": result.data[0] if result.data else None, "message": "Dependant added successfully"}

@dependants_router.put("/{dependant_id}")
async def update_dependant(dependant_id: str, dependant_update: DependantUpdate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    existing_result = supabase.table("dependants").select("*").eq("id", dependant_id).execute()
    if not existing_result.data:
        raise HTTPException(status_code=404, detail="Dependant not found")
    existing = existing_result.data[0]

    update_fields = dependant_update.dict(exclude_unset=True)
    update_data: Dict[str, Any] = {}

    # FIX: map the incoming first_name/last_name/is_active fields onto the
    # real columns (full_name, status). If only one of first/last name is
    # given, fall back to splitting the existing full_name so we don't
    # clobber the other half.
    if "first_name" in update_fields or "last_name" in update_fields:
        current_first, _, current_last = (existing.get("full_name") or "").partition(" ")
        first_name = update_fields.get("first_name", current_first)
        last_name = update_fields.get("last_name", current_last)
        update_data["full_name"] = f"{first_name} {last_name}".strip()

    if "relationship" in update_fields and update_fields["relationship"]:
        update_data["relationship"] = update_fields["relationship"].value

    if "date_of_birth" in update_fields:
        update_data["date_of_birth"] = update_fields["date_of_birth"]

    if "phone" in update_fields:
        update_data["phone"] = update_fields["phone"]

    if "email" in update_fields:
        update_data["email"] = update_fields["email"]

    if "is_active" in update_fields:
        update_data["status"] = "ACTIVE" if update_fields["is_active"] else "INACTIVE"

    if not update_data:
        return {"success": True, "data": existing, "message": "Nothing to update"}

    update_data["updated_at"] = datetime.now().isoformat()
    result = supabase.table("dependants").update(update_data).eq("id", dependant_id).execute()
    return {"success": True, "data": result.data[0] if result.data else None, "message": "Dependant updated successfully"}

@dependants_router.delete("/{dependant_id}")
async def delete_dependant(dependant_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    # FIX: `dependants` has no is_active column — use status instead.
    # (deleted_at isn't part of the confirmed schema either; drop it unless
    # you've added that column separately.)
    result = supabase.table("dependants").update({"status": "INACTIVE", "updated_at": datetime.now().isoformat()}).eq("id", dependant_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Dependant not found")
    return {"success": True, "message": "Dependant removed successfully"}

app.include_router(dependants_router)

# ============================================================
# PAYMENTS ROUTES
# ============================================================

payments_router = APIRouter(prefix="/api/payments", tags=["Payments"])

@payments_router.get("/member/{member_id}", response_model=List[PaymentResponse])
async def get_member_payments(member_id: str, limit: int = 10, offset: int = 0):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("member_number").eq("id", member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    result = supabase.table("payments").select("*").eq("member_id", member_id).order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return result.data or []

@payments_router.post("/", response_model=PaymentResponse)
async def create_payment(payment: PaymentCreate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("id").eq("id", payment.member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    result = supabase.table("payments").insert({
        "member_id": payment.member_id, "amount": payment.amount,
        "payment_type": payment.payment_type.value, "payment_method": "mpesa",
        "mpesa_receipt": None, "status": "pending",
        "payment_date": datetime.now().date().isoformat(), "phone": payment.phone,
        "created_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()
    }).execute()
    return result.data[0] if result.data else None

@payments_router.put("/{payment_id}")
async def update_payment(payment_id: str, payment_update: PaymentUpdate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("payments").update(payment_update.dict(exclude_unset=True)).eq("id", payment_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Payment not found")
    return {"success": True, "data": result.data[0], "message": "Payment updated successfully"}

app.include_router(payments_router)

# ============================================================
# DASHBOARD ROUTES
# ============================================================

dashboard_router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

@dashboard_router.get("/summary/{member_id}")
async def get_dashboard_summary(member_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("*").eq("id", member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    member = member.data[0]
    dependants = supabase.table("dependants").select("*").eq("principal_member_id", member_id).execute()
    payments = supabase.table("payments").select("*").eq("member_id", member_id).order("created_at", desc=True).limit(5).execute()
    all_payments = supabase.table("payments").select("*").eq("member_id", member_id).eq("status", "completed").execute()
    total_payments = sum(float(p.get("amount", 0)) for p in (all_payments.data or []))
    waiting_months = member.get("waiting_period_months", 4)
    reg_date = member.get("registration_date")
    coverage_status = "Pending"
    if reg_date:
        reg_date = datetime.fromisoformat(reg_date) if isinstance(reg_date, str) else reg_date
        wait_end = reg_date + timedelta(days=waiting_months * 30)
        coverage_status = "Active" if datetime.now() >= wait_end else "Waiting"
    return {
        "success": True,
        "member": get_member_safe(member),
        "dependants": dependants.data or [],
        "dependants_count": len(dependants.data or []),
        "recent_payments": payments.data or [],
        "total_payments": total_payments,
        "coverage_status": coverage_status
    }

@dashboard_router.get("/recent/{member_id}")
async def get_recent_activity(member_id: str, limit: int = 5):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("member_number").eq("id", member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    payments = supabase.table("payments").select("*").eq("member_id", member_id).order("created_at", desc=True).limit(limit).execute()
    dependants = supabase.table("dependants").select("*").eq("principal_member_id", member_id).order("created_at", desc=True).limit(limit).execute()
    return {
        "success": True,
        "recent_payments": payments.data or [],
        "recent_dependants": dependants.data or []
    }

app.include_router(dashboard_router)

# ============================================================
# THIS IS WHAT UVICORN WILL IMPORT AS "main:app"
# ============================================================
