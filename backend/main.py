"""
MASIKA F. BENEVOLENT
Backend API - FastAPI

Production: https://masika-c921.onrender.com
Frontend: https://www.masikabbs.com

API Documentation:
    Swagger UI: /api/docs
    ReDoc: /api/redoc
    OpenAPI: /api/openapi.json

Public Endpoints (No Auth Required):
    POST /api/public/register
    POST /api/public/agent/apply
    GET  /api/public/plans
    GET  /api/public/plans/{plan_code}
    POST /api/public/payment/stk-push
    GET  /api/public/payment/status/{checkout_request_id}
    POST /api/public/payment/confirm
    GET  /api/public/check-member/{phone}
    GET  /api/public/membership/card-status

Staff Endpoints (Auth Required):
    GET  /api/staff/dashboard
    GET  /api/staff/members
    GET  /api/staff/members/{member_id}
    PUT  /api/staff/members/{member_id}
    GET  /api/staff/agents
    GET  /api/staff/agents/applications
    PUT  /api/staff/agents/{agent_id}/approve
    PUT  /api/staff/agents/{agent_id}/reject
    PUT  /api/staff/agents/{agent_id}/status
    POST /api/staff/agents/sales-codes
    GET  /api/staff/agents/{agent_id}/sales-codes
    GET  /api/staff/payments
    PUT  /api/staff/payments/{payment_id}
    GET  /api/staff/notifications

Webhook Endpoints:
    POST /api/webhooks/mpesa
    POST /api/webhooks/general
    GET  /api/webhooks/health

IMPORTANT:
- Never expose the Supabase service-role key to the frontend.
- Public registration does NOT require staff login.
- All staff endpoints require valid JWT token.
"""

import os
import logging
import json
import base64
import time
import calendar
import traceback
from datetime import datetime, timezone, timedelta, date
from typing import Any, Dict, List, Optional
from enum import Enum

from fastapi import FastAPI, HTTPException, Request, Depends, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator
from supabase import create_client, Client
import httpx

# ============================================================
# CONFIGURATION
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("masika-api")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://www.masikabbs.com")
API_VERSION = "2.0.1"
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
DEBUG = os.getenv("DEBUG", "false").lower() == "true"

# M-Pesa Configuration
MPESA_CONSUMER_KEY = os.getenv("MPESA_CONSUMER_KEY")
MPESA_CONSUMER_SECRET = os.getenv("MPESA_CONSUMER_SECRET")
MPESA_PASSKEY = os.getenv("MPESA_PASSKEY")
MPESA_SHORTCODE = os.getenv("MPESA_SHORTCODE", "348127")
MPESA_ENVIRONMENT = os.getenv("MPESA_ENVIRONMENT", "sandbox")
MPESA_CALLBACK_URL = os.getenv("MPESA_CALLBACK_URL", "https://masika-c921.onrender.com/api/webhooks/mpesa")

logger.info(f"🌐 Environment: {ENVIRONMENT}")
logger.info(f"💰 M-Pesa Environment: {MPESA_ENVIRONMENT}")

# ============================================================
# SUPABASE CLIENT
# ============================================================

supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    logger.info("✅ Supabase client initialized")
else:
    logger.error(
        "❌ Supabase client NOT initialized — "
        "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from environment."
    )

def get_supabase() -> Client:
    if not supabase:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connection is not configured."
        )
    return supabase

# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="MASIKA F. Benevolent API",
    description="Backend API for MASIKA F. Benevolent membership, registration, agents, and payments.",
    version=API_VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "https://masika-murex.vercel.app",
        "https://masikabbs.com",
        "https://www.masikabbs.com",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:8000",
        "https://masika-c921.onrender.com",
        "*",  # Allow all during development
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# SECURITY
# ============================================================

security = HTTPBearer(auto_error=False)

async def verify_staff_token(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Verify staff JWT token from Supabase."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    database = get_supabase()

    try:
        response = database.auth.get_user(token)

        if not response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token"
            )

        staff_check = database.table("admin_profiles").select("id, role, is_active").eq("user_id", response.user.id).eq("is_active", True).execute()

        if not staff_check.data:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized as staff"
            )

        return {
            "user": response.user,
            "staff": staff_check.data[0]
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )

# ============================================================
# MODELS
# ============================================================

class PlanEnum(str, Enum):
    COMFORT = "COMFORT"
    DIGNITY = "DIGNITY"
    WAZAZI = "WAZAZI"

class BenefitOptionEnum(str, Enum):
    SERVICE = "service"
    CASH = "cash"

class PaymentTypeEnum(str, Enum):
    REGISTRATION = "registration"
    MONTHLY = "monthly"
    ANNUAL = "annual"
    TOPUP = "topup"

class PaymentStatusEnum(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PAID = "paid"
    FAILED = "failed"
    REFUNDED = "refunded"

# ============================================================
# REQUEST MODELS
# ============================================================

class RegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    first_name: str = Field(..., min_length=2, max_length=100)
    last_name: str = Field(..., min_length=2, max_length=100)
    other_name: Optional[str] = Field(None, max_length=100)
    phone: str = Field(..., min_length=9, max_length=20)
    email: Optional[EmailStr] = None
    id_number: str = Field(..., min_length=5, max_length=30)
    date_of_birth: str = Field(..., description="YYYY-MM-DD")
    gender: str = Field(..., pattern="^(MALE|FEMALE|OTHER)$")
    county: str = Field(..., min_length=2, max_length=50)
    location: Optional[str] = Field(None, max_length=100)
    address: Optional[str] = Field(None, max_length=200)
    plan: PlanEnum
    benefit_option: BenefitOptionEnum = BenefitOptionEnum.SERVICE
    dependants: List[Dict[str, Any]] = Field(default_factory=list)
    sales_code: Optional[str] = Field(None, max_length=30, description="Agent sales/referral code, if the member was signed up by an agent")

    @field_validator('date_of_birth')
    @classmethod
    def validate_dob(cls, v):
        try:
            datetime.strptime(v, "%Y-%m-%d")
            return v
        except ValueError:
            raise ValueError("Date of birth must be in YYYY-MM-DD format")

class AgentApplicationRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    full_name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone: str = Field(..., min_length=9, max_length=20)
    id_number: str = Field(..., min_length=5, max_length=30)
    county: str = Field(..., min_length=2, max_length=50)
    location: Optional[str] = Field(None, max_length=100)
    experience: Optional[str] = None
    reason: str = Field(..., min_length=10, max_length=1000)
    referral_code: Optional[str] = None

class PaymentConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    member_id: str
    amount: float = Field(..., gt=0)
    payment_type: PaymentTypeEnum
    mpesa_receipt: str = Field(..., min_length=5, max_length=50)
    phone: str = Field(..., min_length=9, max_length=20)
    paybill_number: Optional[str] = "348127"

class STKPushRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    member_id: str
    phone: str = Field(..., min_length=9, max_length=20)
    amount: float = Field(..., gt=0, le=1000000)
    transaction_desc: str = Field(default="Membership Registration", max_length=36)

class SalesCodeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    agent_id: str
    code_prefix: Optional[str] = "MASIKA"
    count: int = Field(..., ge=1, le=100)
    expires_at: Optional[str] = None

class MemberUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    first_name: Optional[str] = Field(None, min_length=2, max_length=100)
    last_name: Optional[str] = Field(None, min_length=2, max_length=100)
    phone: Optional[str] = Field(None, min_length=9, max_length=20)
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    is_active: Optional[bool] = None
    plan: Optional[PlanEnum] = None
    benefit_option: Optional[BenefitOptionEnum] = None

class PaymentUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: PaymentStatusEnum
    notes: Optional[str] = None

class AgentUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: str = Field(..., pattern="^(approved|inactive|suspended)$")
    commission_rate: Optional[float] = Field(None, ge=0, le=100)

# ============================================================
# RESPONSE MODELS
# ============================================================

class APIResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class RegistrationResponse(BaseModel):
    success: bool
    message: str
    member_id: Optional[str] = None
    member_number: Optional[str] = None
    registration_amount: Optional[float] = None
    payment_required: bool = True

class AgentApplicationResponse(BaseModel):
    success: bool
    message: str
    application_id: Optional[str] = None
    status: Optional[str] = "pending"

# ============================================================
# HELPERS
# ============================================================

VALID_PLANS = {"COMFORT", "DIGNITY", "WAZAZI"}
PLAN_FEES = {
    "COMFORT": 200,
    "DIGNITY": 500,
    "WAZAZI": 100
}
DEPENDANT_FEES = {
    "SPOUSE": 100,
    "CHILD": 50,
    "PARENT": 150,
    "SIBLING": 100,
    "OTHER": 100
}

def normalize_phone(phone: str) -> str:
    """Convert common Kenyan phone formats to 254XXXXXXXXX."""
    phone = phone.strip().replace(" ", "").replace("-", "").replace("+", "")

    if phone.startswith("07") or phone.startswith("01"):
        phone = "254" + phone[1:]
    elif phone.startswith("7") or phone.startswith("1"):
        phone = "254" + phone
    elif not phone.startswith("254"):
        raise ValueError("Invalid Kenyan phone number format")

    if len(phone) != 12:
        raise ValueError("Phone number must be 12 digits (including 254)")

    return phone

def calculate_registration_fee(plan: str, dependants: List[Dict]) -> float:
    """Calculate registration fee based on plan and dependants."""
    fee = PLAN_FEES.get(plan.upper(), 0)

    for dep in dependants:
        relationship = dep.get("relationship", "").upper()
        fee += DEPENDANT_FEES.get(relationship, 50)

    return float(fee)

# ============================================================
# GENERATE MEMBER NUMBER - ATOMIC FROM SUPABASE, WITH FALLBACK
# ============================================================

def _extract_scalar_rpc_value(raw: Any, key_hint: str) -> Optional[str]:
    """Normalize whatever shape Supabase's RPC/query returns into a string."""
    value = raw

    if isinstance(value, list):
        if not value:
            return None
        value = value[0]

    if isinstance(value, dict):
        value = value.get(key_hint) or next(iter(value.values()), None)

    if value is None:
        return None

    return str(value).strip()


def _generate_member_number_via_rpc(database: Client) -> str:
    """
    Primary path: call the atomic Postgres function.

    Expected format: MSK00001, MSK00002, ...
    """
    result = database.rpc("generate_masika_member_number").execute()

    if result.data is None:
        raise RuntimeError("Supabase RPC 'generate_masika_member_number' returned no data")

    member_number = _extract_scalar_rpc_value(result.data, "generate_masika_member_number")

    if not member_number:
        raise RuntimeError(f"Invalid/empty member number returned by RPC: {result.data!r}")

    if not member_number.startswith("MSK"):
        raise RuntimeError(f"Unexpected member number format returned by RPC: {member_number}")

    return member_number


def _generate_member_number_via_fallback(database: Client) -> str:
    """
    Fallback path used ONLY if the RPC is unavailable or errors.

    This is NOT perfectly race-safe under heavy concurrent writes (unlike
    the DB-side atomic sequence), but keeps registration working if the
    Postgres function is missing/misconfigured, instead of hard-failing
    every signup. Looks at the highest existing MSK number and increments.
    """
    result = (
        database.table("members")
        .select("member_number")
        .like("member_number", "MSK%")
        .order("member_number", desc=True)
        .limit(1)
        .execute()
    )

    last_number = 0
    if result.data:
        existing = result.data[0].get("member_number", "")
        digits = "".join(ch for ch in existing if ch.isdigit())
        if digits:
            last_number = int(digits)

    next_number = last_number + 1
    return f"MSK{next_number:05d}"


def generate_member_number(database: Client) -> str:
    """
    Generate a unique MASIKA member number.

    Tries the atomic Supabase RPC first (the real source of truth).
    If that fails for any reason (function missing, permissions,
    Supabase hiccup), falls back to a best-effort incrementing scheme
    so registration doesn't hard-fail, and logs loudly so the RPC issue
    gets noticed and fixed.
    """
    try:
        member_number = _generate_member_number_via_rpc(database)
        logger.info(f"Generated MASIKA member number via RPC: {member_number}")
        return member_number

    except Exception as rpc_error:
        logger.error(
            "RPC 'generate_masika_member_number' failed — "
            f"falling back to incrementing scheme. Root cause: {rpc_error}\n"
            f"{traceback.format_exc()}"
        )

        try:
            member_number = _generate_member_number_via_fallback(database)
            logger.warning(
                f"Generated MASIKA member number via FALLBACK path: {member_number} "
                "— fix the 'generate_masika_member_number' Postgres function to "
                "restore atomic, race-safe numbering."
            )
            return member_number

        except Exception as fallback_error:
            logger.error(
                "Fallback member number generation ALSO failed: "
                f"{fallback_error}\n{traceback.format_exc()}"
            )
            raise RuntimeError(
                f"RPC error: {rpc_error}; Fallback error: {fallback_error}"
            ) from fallback_error

# ============================================================
# AGENT SALES CODE RESOLUTION
# ============================================================
#
# ASSUMPTION — adjust to match your actual Supabase schema:
#   Table: sales_codes
#     code        text (unique, e.g. "MASIKA-AB12")
#     agent_id    uuid, references agents/admin_profiles
#     is_active   boolean
#     expires_at  timestamptz, nullable
#     used_count  integer, default 0
#
# A code is treated as reusable (many members can register under the
# same agent code) rather than single-use, since that's the common
# case for agent referral codes. If your codes are meant to be
# single-use, add a `.eq("used_count", 0)` filter below and increment
# accordingly.
#
# An invalid/expired/unknown code is intentionally NON-BLOCKING: the
# member still gets registered, just without agent attribution, and
# the response tells the frontend so it can inform the user. Flip
# `sales_code_required` to True if you'd rather hard-fail registration
# on a bad code.

sales_code_required = False

def resolve_sales_code(database: Client, code: str) -> Dict[str, Any]:
    """
    Look up an agent sales code.

    Returns a dict:
      {"valid": True,  "agent_id": <uuid>, "code_id": <uuid>}
      {"valid": False, "reason": "<human readable reason>"}
    Never raises — a lookup failure is treated as an invalid code so a
    Supabase hiccup here can't take down registration entirely.
    """
    normalized = code.strip().upper()

    try:
        result = (
            database.table("sales_codes")
            .select("id, agent_id, is_active, expires_at")
            .eq("code", normalized)
            .execute()
        )

        if not result.data:
            return {"valid": False, "reason": "Sales code not found"}

        record = result.data[0]

        if not record.get("is_active", True):
            return {"valid": False, "reason": "Sales code is inactive"}

        expires_at = record.get("expires_at")
        if expires_at:
            try:
                expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if expiry < datetime.now(timezone.utc):
                    return {"valid": False, "reason": "Sales code has expired"}
            except ValueError:
                logger.warning(f"Could not parse sales_codes.expires_at value: {expires_at!r}")

        return {
            "valid": True,
            "agent_id": record.get("agent_id"),
            "code_id": record.get("id"),
        }

    except Exception as e:
        logger.warning(f"Sales code lookup failed for '{normalized}': {e}")
        return {"valid": False, "reason": "Unable to verify sales code"}


def record_sales_code_usage(database: Client, code_id: str, member_id: str) -> None:
    """
    Best-effort bump of usage stats on a sales code after a successful
    registration. Failure here must never block registration — it's
    logged and swallowed.
    """
    try:
        current = database.table("sales_codes").select("used_count").eq("id", code_id).execute()
        used_count = 0
        if current.data:
            used_count = current.data[0].get("used_count") or 0

        database.table("sales_codes").update({
            "used_count": used_count + 1,
            "last_used_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", code_id).execute()

    except Exception as e:
        logger.warning(f"Failed to record sales code usage for code_id={code_id}: {e}")


# ============================================================
# PAYMENT HELPERS
# ============================================================

_payment_access_token = None
_payment_token_expiry = None

async def get_mpesa_access_token() -> str:
    """Get M-Pesa access token."""
    global _payment_access_token, _payment_token_expiry

    if _payment_access_token and _payment_token_expiry and time.time() < _payment_token_expiry:
        return _payment_access_token

    if not MPESA_CONSUMER_KEY or not MPESA_CONSUMER_SECRET:
        logger.warning("M-Pesa credentials not configured")
        return "mock_token"

    try:
        credentials = base64.b64encode(
            f"{MPESA_CONSUMER_KEY}:{MPESA_CONSUMER_SECRET}".encode()
        ).decode("utf-8")

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                # FIX: Daraja's OAuth endpoint requires grant_type=client_credentials
                # as a query param. Without it, Safaricom returns 400.008.02
                # "Invalid grant type passed" regardless of whether the
                # consumer key/secret are valid — which was silently
                # collapsing into the "mock_token" sentinel below and then
                # surfacing to users as "Payment service unavailable".
                "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
                headers={"Authorization": f"Basic {credentials}"}
            )

            if response.status_code != 200:
                logger.error(f"Failed to get access token: {response.text}")
                return "mock_token"

            data = response.json()
            _payment_access_token = data.get("access_token")
            # FIX: Daraja returns expires_in as a STRING (e.g. "3599"), not
            # an int. `time.time() + expires_in` was raising
            # "unsupported operand type(s) for +: 'float' and 'str'" here,
            # which was caught by the except block below and silently
            # downgraded EVERY production token fetch to the "mock_token"
            # sentinel — even though the OAuth call itself succeeded and a
            # real access_token was already sitting in `data`.
            expires_in = int(data.get("expires_in", 3600))
            _payment_token_expiry = time.time() + expires_in - 60

            logger.info("M-Pesa access token obtained")
            return _payment_access_token

    except Exception as e:
        logger.error(f"Access token error: {e}")
        return "mock_token"

async def initiate_stk_push(phone: str, amount: float, account_reference: str, member_id: str, transaction_desc: str = "Membership Registration") -> Dict[str, Any]:
    """Initiate M-Pesa STK Push payment."""
    try:
        phone = normalize_phone(phone)
        if phone.startswith("0"):
            phone = "254" + phone[1:]
        elif phone.startswith("+"):
            phone = phone[1:]

        if len(phone) != 12 or not phone.startswith("254"):
            return {
                "success": False,
                "message": "Invalid phone number format",
                "status": "failed"
            }

        # In sandbox/mock mode
        if MPESA_ENVIRONMENT != "production" or not MPESA_CONSUMER_KEY:
            logger.info(f"MOCK STK Push: {phone} - KES {amount} - {account_reference}")
            checkout_id = f"ws_CO_{int(time.time())}_mock"

            database = get_supabase()
            payment_data = {
                # FIX: payments.member_id is NOT NULL in the DB schema, but
                # this used to insert `None` here and rely on a follow-up
                # UPDATE in public_stk_push() to backfill it — which never
                # ran because the insert itself was rejected first with
                # "null value in column 'member_id' violates not-null
                # constraint". member_id is now known at call time (it's
                # passed in from public_stk_push), so it's set correctly on
                # the initial insert instead.
                "member_id": member_id,
                "amount": amount,
                "payment_type": "registration",
                "status": "pending",
                "mpesa_receipt": checkout_id,
                "paybill_number": MPESA_SHORTCODE,
                "account_number": account_reference,
                "checkout_request_id": checkout_id,
                "notes": transaction_desc,
                "phone": phone
            }
            result = database.table("payments").insert(payment_data).execute()

            return {
                "success": True,
                "checkout_request_id": checkout_id,
                "message": "Payment initiated (Mock)",
                "status": "pending",
                "mock": True,
                "payment_id": result.data[0]["id"] if result.data else None
            }

        access_token = await get_mpesa_access_token()
        if access_token == "mock_token":
            return {
                "success": False,
                "message": "Payment service unavailable",
                "status": "failed"
            }

        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        password_str = f"{MPESA_SHORTCODE}{MPESA_PASSKEY}{timestamp}"
        password = base64.b64encode(password_str.encode()).decode("utf-8")

        payload = {
            "BusinessShortCode": MPESA_SHORTCODE,
            "Password": password,
            "Timestamp": timestamp,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": int(amount),
            "PartyA": phone,
            "PartyB": MPESA_SHORTCODE,
            "PhoneNumber": phone,
            "CallBackURL": MPESA_CALLBACK_URL,
            "AccountReference": account_reference[:12],
            "TransactionDesc": transaction_desc[:36],
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
                json=payload,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                }
            )

            if response.status_code != 200:
                logger.error(f"STK Push failed: {response.text}")
                return {
                    "success": False,
                    "message": "Payment initiation failed",
                    "status": "failed"
                }

            data = response.json()
            response_code = data.get("ResponseCode")

            if response_code != "0":
                return {
                    "success": False,
                    "message": data.get("ResponseDescription", "Payment initiation failed"),
                    "status": "failed",
                    "response_code": response_code
                }

            checkout_request_id = data.get("CheckoutRequestID")

            database = get_supabase()
            payment_data = {
                # FIX: see comment on the mock-mode branch above — same
                # NOT NULL constraint issue, same fix (member_id is now
                # passed into this function rather than backfilled later).
                "member_id": member_id,
                "amount": amount,
                "payment_type": "registration",
                "status": "pending",
                "mpesa_receipt": checkout_request_id,
                "paybill_number": MPESA_SHORTCODE,
                "account_number": account_reference,
                "checkout_request_id": checkout_request_id,
                "merchant_request_id": data.get("MerchantRequestID"),
                "notes": transaction_desc,
                "phone": phone
            }
            result = database.table("payments").insert(payment_data).execute()

            logger.info(f"STK Push initiated: {checkout_request_id}")

            return {
                "success": True,
                "checkout_request_id": checkout_request_id,
                "message": "Payment initiated. Please check your phone.",
                "status": "pending",
                "mock": False,
                "payment_id": result.data[0]["id"] if result.data else None
            }

    except Exception as e:
        logger.error(f"STK Push error: {e}")
        return {
            "success": False,
            "message": f"Payment initiation failed: {str(e)}",
            "status": "failed"
        }

async def query_stk_status(checkout_request_id: str) -> Dict[str, Any]:
    """Query STK Push status."""
    database = get_supabase()

    existing = database.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
    if existing.data and existing.data[0].get("status") == "confirmed":
        return {
            "status": "confirmed",
            "payment": existing.data[0]
        }

    if MPESA_ENVIRONMENT != "production" or not MPESA_CONSUMER_KEY:
        return {
            "status": "pending",
            "mock": True
        }

    try:
        access_token = await get_mpesa_access_token()
        if access_token == "mock_token":
            return {"status": "pending"}

        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        password_str = f"{MPESA_SHORTCODE}{MPESA_PASSKEY}{timestamp}"
        password = base64.b64encode(password_str.encode()).decode("utf-8")

        payload = {
            "BusinessShortCode": MPESA_SHORTCODE,
            "Password": password,
            "Timestamp": timestamp,
            "CheckoutRequestID": checkout_request_id
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query",
                json=payload,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                }
            )

            if response.status_code != 200:
                logger.error(f"STK Query failed: {response.text}")
                return {"status": "failed"}

            data = response.json()
            result_code = data.get("ResultCode")

            if result_code == "0":
                metadata = data.get("CallbackMetadata", {})
                items = metadata.get("Item", [])
                receipt = None
                amount = None

                for item in items:
                    if item.get("Name") == "MpesaReceiptNumber":
                        receipt = item.get("Value")
                    elif item.get("Name") == "Amount":
                        amount = item.get("Value")

                update_data = {
                    "status": "confirmed",
                    "confirmed_at": datetime.now(timezone.utc).isoformat(),
                    "mpesa_receipt": receipt or checkout_request_id,
                    "amount": amount or None
                }
                database.table("payments").update(update_data).eq("checkout_request_id", checkout_request_id).execute()

                payment = database.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
                if payment.data and payment.data[0].get("member_id"):
                    database.table("members").update({
                        "registration_fee_paid": True,
                        "coverage_start_date": datetime.now(timezone.utc).isoformat()
                    }).eq("id", payment.data[0]["member_id"]).execute()

                return {
                    "status": "confirmed",
                    "receipt": receipt,
                    "amount": amount
                }
            elif result_code in ["1037", "1032"]:
                return {"status": "pending"}
            else:
                database.table("payments").update({
                    "status": "failed",
                    "notes": f"STK Query: {data.get('ResultDesc', 'Failed')}"
                }).eq("checkout_request_id", checkout_request_id).execute()

                return {
                    "status": "failed",
                    "message": data.get("ResultDesc", "Payment failed")
                }

    except Exception as e:
        logger.error(f"STK Query error: {e}")
        return {"status": "pending"}

# ============================================================
# ROOT ENDPOINT
# ============================================================

@app.get("/")
async def root():
    """Root endpoint - API information."""
    return {
        "success": True,
        "message": "MASIKA F. Benevolent API",
        "data": {
            "service": "MASIKA F. Benevolent API",
            "version": API_VERSION,
            "status": "online",
            "frontend": FRONTEND_URL,
            "environment": ENVIRONMENT,
            "docs": "/api/docs",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    }

# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/api/health")
async def health():
    """Health check endpoint. Also used by the frontend to 'wake up'
    the Render instance before a real request is made."""
    database_status = "not_configured"

    try:
        if supabase:
            supabase.table("members").select("id").limit(1).execute()
            database_status = "connected"
    except Exception as exc:
        logger.error(f"Database health check failed: {exc}")
        database_status = "error"

    return {
        "success": True,
        "message": "API is healthy",
        "data": {
            "api": "healthy",
            "database": database_status,
            "environment": ENVIRONMENT,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    }

# ============================================================
# PUBLIC ENDPOINTS
# ============================================================

@app.get("/api/public/sales-codes")
async def get_public_sales_codes():
    """
    Public list of active agent sales codes, for populating a
    'register through an agent' dropdown on the registration form.

    ASSUMPTION — adjust to match your actual schema: this expects a
    `sales_codes` table (code, agent_id, is_active) and, optionally,
    an `agents` table (id, full_name) to attach a readable name to
    each code. If the `agents` table/join doesn't match your schema,
    this still returns the bare codes — it just won't have names.
    Never raises: if the table isn't set up yet, returns an empty list
    so the dropdown just shows "No agent".
    """
    database = get_supabase()

    try:
        result = (
            database.table("sales_codes")
            .select("id, code, agent_id")
            .eq("is_active", True)
            .order("code")
            .execute()
        )
        codes = result.data or []
    except Exception as e:
        logger.warning(f"Failed to fetch public sales codes: {e}")
        return {"success": True, "message": "No sales codes available", "data": []}

    agent_names: Dict[str, str] = {}
    agent_ids = [c["agent_id"] for c in codes if c.get("agent_id")]

    if agent_ids:
        try:
            agents_result = (
                database.table("agents")
                .select("id, full_name")
                .in_("id", agent_ids)
                .execute()
            )
            agent_names = {
                a["id"]: a.get("full_name")
                for a in (agents_result.data or [])
                if a.get("full_name")
            }
        except Exception as e:
            logger.warning(f"Could not enrich sales codes with agent names: {e}")

    data = [
        {
            "code": c["code"],
            "agent_id": c.get("agent_id"),
            "agent_name": agent_names.get(c.get("agent_id")),
        }
        for c in codes
        if c.get("code")
    ]

    return {
        "success": True,
        "message": "Sales codes retrieved",
        "data": data,
    }

@app.get("/api/public/plans")
async def get_public_plans():
    """Get all available membership plans."""
    return {
        "success": True,
        "message": "Plans retrieved successfully",
        "data": [
            {
                "code": "COMFORT",
                "name": "Comfort Plan",
                "monthly_fee": 300,
                "registration_fee": PLAN_FEES["COMFORT"],
                "waiting_period": 4,
            },
            {
                "code": "DIGNITY",
                "name": "Dignity Plan",
                "monthly_fee": 1000,
                "registration_fee": PLAN_FEES["DIGNITY"],
                "waiting_period": 6,
            },
            {
                "code": "WAZAZI",
                "name": "Wazazi Plan",
                "monthly_fee": 350,
                "registration_fee": PLAN_FEES["WAZAZI"],
                "waiting_period": 6,
            }
        ]
    }

@app.get("/api/public/plans/{plan_code}")
async def get_plan_details(plan_code: str):
    """Get details for a specific plan."""
    plan_code = plan_code.upper()
    if plan_code not in VALID_PLANS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan not found"
        )

    plans = {
        "COMFORT": {
            "code": "COMFORT",
            "name": "Comfort Plan",
            "monthly_fee": 300,
            "registration_fee": PLAN_FEES["COMFORT"],
            "waiting_period": 4
        },
        "DIGNITY": {
            "code": "DIGNITY",
            "name": "Dignity Plan",
            "monthly_fee": 1000,
            "registration_fee": PLAN_FEES["DIGNITY"],
            "waiting_period": 6
        },
        "WAZAZI": {
            "code": "WAZAZI",
            "name": "Wazazi Plan",
            "monthly_fee": 350,
            "registration_fee": PLAN_FEES["WAZAZI"],
            "waiting_period": 6
        }
    }

    return {
        "success": True,
        "message": "Plan details retrieved",
        "data": plans[plan_code]
    }

# ============================================================
# REGISTER - ATOMIC MEMBER NUMBER WITH FALLBACK + BETTER ERRORS
# ============================================================

@app.post("/api/public/register")
async def public_register(registration: RegistrationRequest):
    """
    PUBLIC MEMBER REGISTRATION - No Login Required.

    Flow:
        register.html
            ↓
        API
            ↓
        Supabase generates MSK member number atomically (RPC),
        falling back to a best-effort increment if the RPC fails
            ↓
        member created
            ↓
        payment record created
            ↓
        payment.html
    """
    database = get_supabase()

    # --------------------------------------------------------
    # NORMALIZE PHONE
    # --------------------------------------------------------

    try:
        phone = normalize_phone(registration.phone)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        )

    # --------------------------------------------------------
    # CHECK DUPLICATE PHONE
    # --------------------------------------------------------

    try:
        existing = (
            database
            .table("members")
            .select("id, phone, member_number")
            .eq("phone", phone)
            .execute()
        )

        if existing.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A member with phone {phone} already exists"
            )

    except HTTPException:
        raise

    except Exception as e:
        logger.warning(f"Duplicate phone check failed: {e}")

    # --------------------------------------------------------
    # CALCULATE REGISTRATION FEE
    # --------------------------------------------------------

    fee = calculate_registration_fee(
        registration.plan.value,
        registration.dependants
    )

    # --------------------------------------------------------
    # RESOLVE AGENT SALES CODE (optional, non-blocking by default)
    # --------------------------------------------------------

    sales_code_result = None
    if registration.sales_code:
        sales_code_result = resolve_sales_code(database, registration.sales_code)

        if not sales_code_result["valid"] and sales_code_required:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=sales_code_result.get("reason", "Invalid sales code")
            )

    # --------------------------------------------------------
    # GENERATE MEMBER NUMBER (RPC, with fallback)
    # --------------------------------------------------------

    try:
        member_number = generate_member_number(database)

    except Exception as e:
        # generate_member_number() already logs the full root cause
        # (RPC error + fallback error) with a traceback above.
        detail = "Unable to generate member number. Please try again."
        if DEBUG:
            detail += f" (debug: {e})"

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=detail
        )

    # --------------------------------------------------------
    # MEMBER DATA
    # --------------------------------------------------------

    member_data = {
        "first_name": registration.first_name.strip(),
        "last_name": registration.last_name.strip(),
        "phone": phone,
        "id_number": registration.id_number.strip(),
        "date_of_birth": registration.date_of_birth,
        "gender": registration.gender,
        "county": registration.county.strip(),
        "plan": registration.plan.value.lower(),
        "benefit_option": registration.benefit_option.value,

        # Example:
        # MSK00001
        # MSK00002
        # MSK00003
        "member_number": member_number,

        "registration_fee_paid": False,
        "is_active": True,
    }

    # ASSUMPTION: members table has an `agent_id` (nullable uuid) column
    # to attribute a signup to the referring agent. Adjust the key name
    # here if your schema calls it something else (e.g. referred_by).
    if sales_code_result and sales_code_result["valid"]:
        member_data["agent_id"] = sales_code_result["agent_id"]

    # --------------------------------------------------------
    # CREATE MEMBER
    # --------------------------------------------------------

    try:
        result = (
            database
            .table("members")
            .insert(member_data)
            .execute()
        )

        member = result.data[0] if result.data else None

        if not member:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create member"
            )

        member_id = member.get("id")

        # ----------------------------------------------------
        # CREATE REGISTRATION PAYMENT
        # ----------------------------------------------------

        payment_data = {
            "member_id": member_id,
            "amount": fee,
            "payment_type": "registration",
            "status": "pending",
            "paybill_number": MPESA_SHORTCODE,
            "account_number": member_number,
        }

        database.table("payments").insert(
            payment_data
        ).execute()

        # ----------------------------------------------------
        # RECORD SALES CODE USAGE (best-effort, non-blocking)
        # ----------------------------------------------------

        if sales_code_result and sales_code_result["valid"]:
            record_sales_code_usage(
                database,
                sales_code_result["code_id"],
                str(member_id)
            )

        # ----------------------------------------------------
        # RESPONSE
        # ----------------------------------------------------

        response_message = (
            "Registration submitted successfully. "
            "Please proceed to payment."
        )
        if registration.sales_code and sales_code_result and not sales_code_result["valid"]:
            response_message += f" Note: {sales_code_result.get('reason', 'the sales code could not be applied')}."

        return {
            "success": True,
            "message": response_message,
            "member_id": str(member_id),
            "member_number": member_number,
            "registration_amount": fee,
            "payment_required": True,
            "sales_code_applied": bool(sales_code_result and sales_code_result["valid"]),
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.error(f"Registration error: {e}\n{traceback.format_exc()}")

        detail = "Failed to register member"
        if DEBUG:
            detail += f" (debug: {e})"

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=detail
        )


# ============================================================
# PAYMENT ENDPOINTS
# ============================================================

@app.post("/api/public/payment/stk-push")
async def public_stk_push(request: STKPushRequest):
    """
    Initiate M-Pesa STK Push payment.
    """
    database = get_supabase()

    try:
        member = database.table("members").select("*").eq("id", request.member_id).execute()
        if not member.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found"
            )
        member_data = member.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Member verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify member"
        )

    if member_data.get("registration_fee_paid"):
        return {
            "success": True,
            "message": "Registration fee already paid",
            "data": {
                "already_paid": True,
                "member_id": request.member_id
            }
        }

    try:
        phone = normalize_phone(request.phone)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    account_reference = member_data.get("member_number", f"MEM-{request.member_id[:8]}")

    # FIX: member_id is now passed straight into initiate_stk_push() and
    # used on the initial insert, instead of being inserted as NULL and
    # backfilled with a follow-up UPDATE afterward. That two-step pattern
    # never actually worked: payments.member_id is NOT NULL in the DB, so
    # the initial insert was rejected before the code ever reached the
    # update below — the row was never created and the update had nothing
    # to patch. There is nothing left for a post-insert update to do
    # (phone is also set correctly on the same insert), so it's removed.
    result = await initiate_stk_push(
        phone=phone,
        amount=request.amount,
        account_reference=account_reference,
        member_id=request.member_id,
        transaction_desc=request.transaction_desc
    )

    return {
        "success": result.get("success", False),
        "message": result.get("message", "Payment initiated"),
        "data": {
            "checkout_request_id": result.get("checkout_request_id"),
            "status": result.get("status", "pending"),
            "mock": result.get("mock", False),
            "member_id": request.member_id,
        }
    }

@app.get("/api/public/payment/status/{checkout_request_id}")
async def public_payment_status(checkout_request_id: str):
    """Check payment status."""
    try:
        result = await query_stk_status(checkout_request_id)

        return {
            "success": True,
            "message": "Payment status retrieved",
            "data": {
                "checkout_request_id": checkout_request_id,
                "status": result.get("status"),
                "receipt": result.get("receipt"),
                "amount": result.get("amount"),
                "mock": result.get("mock", False),
            }
        }

    except Exception as e:
        logger.error(f"Payment status error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get payment status"
        )

@app.post("/api/public/payment/confirm")
async def public_confirm_payment(payment: PaymentConfirmRequest):
    """Confirm payment manually."""
    database = get_supabase()

    try:
        member = database.table("members").select("*").eq("id", payment.member_id).execute()
        if not member.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found"
            )
        member_data = member.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Member verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify member"
        )

    if member_data.get("registration_fee_paid"):
        return {
            "success": True,
            "message": "Registration fee already paid",
            "data": {"member_id": payment.member_id, "already_paid": True}
        }

    try:
        payment_update = {
            "status": "confirmed",
            "mpesa_receipt": payment.mpesa_receipt,
            "confirmed_at": datetime.now(timezone.utc).isoformat()
        }

        result = database.table("payments").update(payment_update).eq("member_id", payment.member_id).eq("payment_type", "registration").execute()

        if not result.data:
            payment_data = {
                "member_id": payment.member_id,
                "amount": payment.amount,
                "payment_type": "registration",
                "status": "confirmed",
                "mpesa_receipt": payment.mpesa_receipt,
                "paybill_number": payment.paybill_number,
                "account_number": member_data.get("member_number"),
                "confirmed_at": datetime.now(timezone.utc).isoformat()
            }
            database.table("payments").insert(payment_data).execute()

        database.table("members").update({
            "registration_fee_paid": True,
            "coverage_start_date": datetime.now(timezone.utc).isoformat()
        }).eq("id", payment.member_id).execute()

        return {
            "success": True,
            "message": "Payment confirmed successfully",
            "data": {
                "member_id": payment.member_id,
                "member_number": member_data.get("member_number"),
                "amount": payment.amount,
                "receipt": payment.mpesa_receipt
            }
        }

    except Exception as e:
        logger.error(f"Payment confirmation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to confirm payment"
        )

@app.post("/api/public/agent/apply")
async def public_agent_apply(application: AgentApplicationRequest):
    """Apply to become a sales agent."""
    database = get_supabase()

    try:
        phone = normalize_phone(application.phone)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    try:
        existing = database.table("agent_applications").select("id").or_(f"email.eq.{application.email},phone.eq.{phone}").execute()
        if existing.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Application with this email or phone already exists"
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Duplicate check failed: {e}")

    try:
        app_data = {
            "full_name": application.full_name.strip(),
            "email": str(application.email),
            "phone": phone,
            "id_number": application.id_number.strip(),
            "county": application.county.strip(),
            "location": application.location.strip() if application.location else None,
            "experience": application.experience.strip() if application.experience else None,
            "reason": application.reason.strip(),
            "referral_code": application.referral_code.strip() if application.referral_code else None,
            "status": "pending"
        }

        result = database.table("agent_applications").insert(app_data).execute()
        app = result.data[0] if result.data else None

        if not app:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to submit application"
            )

        return {
            "success": True,
            "message": "Application submitted successfully. Our team will review it.",
            "application_id": str(app.get("id")),
            "status": "pending"
        }

    except Exception as e:
        logger.error(f"Agent application failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to submit application. Please try again."
        )

@app.get("/api/public/check-member/{phone}")
async def check_member(phone: str):
    """Check if a member exists."""
    try:
        phone = normalize_phone(phone)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    database = get_supabase()

    try:
        result = database.table("members").select("id, first_name, last_name, is_active, registration_fee_paid, member_number").eq("phone", phone).execute()

        if result.data:
            return {
                "success": True,
                "message": "Member found",
                "data": {
                    "exists": True,
                    "member": result.data[0]
                }
            }
        else:
            return {
                "success": True,
                "message": "No member found",
                "data": {"exists": False}
            }

    except Exception as e:
        logger.error(f"Member check failed: {e}")
        return {
            "success": False,
            "message": "Failed to check member",
            "data": {"exists": False}
        }

# ============================================================
# STAFF ENDPOINTS (Auth Required)
# ============================================================

@app.get("/api/staff/dashboard")
async def staff_dashboard(auth: Dict = Depends(verify_staff_token)):
    """Get staff dashboard statistics."""
    database = get_supabase()

    try:
        total_members = database.table("members").select("id", count="exact").execute()
        active_members = database.table("members").select("id", count="exact").eq("is_active", True).execute()
        pending_registrations = database.table("members").select("id", count="exact").eq("registration_fee_paid", False).execute()

        return {
            "success": True,
            "message": "Dashboard data retrieved",
            "data": {
                "stats": {
                    "total_members": total_members.count or 0,
                    "active_members": active_members.count or 0,
                    "pending_registrations": pending_registrations.count or 0,
                }
            }
        }

    except Exception as e:
        logger.error(f"Dashboard error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load dashboard data"
        )

# ============================================================
# WEBHOOKS
# ============================================================

@app.post("/api/webhooks/mpesa")
async def mpesa_webhook(request: Request):
    """M-Pesa webhook endpoint."""
    try:
        body = await request.json()
        logger.info(f"M-Pesa webhook received")

        stk_callback = body.get("Body", {}).get("stkCallback", {})
        checkout_request_id = stk_callback.get("CheckoutRequestID")
        result_code = stk_callback.get("ResultCode")
        result_desc = stk_callback.get("ResultDesc")

        if not checkout_request_id:
            return {"ResultCode": 1, "ResultDesc": "No CheckoutRequestID"}

        database = get_supabase()

        if result_code == "0":
            database.table("payments").update({
                "status": "confirmed",
                "confirmed_at": datetime.now(timezone.utc).isoformat()
            }).eq("checkout_request_id", checkout_request_id).execute()

            logger.info(f"Payment confirmed via webhook: {checkout_request_id}")
            return {"ResultCode": 0, "ResultDesc": "Success"}
        else:
            database.table("payments").update({
                "status": "failed",
                "notes": f"Webhook: {result_desc}"
            }).eq("checkout_request_id", checkout_request_id).execute()

            logger.warning(f"Payment failed via webhook: {checkout_request_id}")
            return {"ResultCode": 0, "ResultDesc": "Payment failed recorded"}

    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"ResultCode": 1, "ResultDesc": f"Error: {str(e)}"}

@app.get("/api/webhooks/health")
async def webhook_health():
    """Webhook health check."""
    return {
        "success": True,
        "status": "healthy",
        "service": "webhook",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

# ============================================================
# ERROR HANDLER
# ============================================================

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "message": "Internal server error",
            "error": str(exc) if DEBUG else None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

# ============================================================
# MAIN ENTRYPOINT
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=os.getenv("DEBUG") == "true",
    )
