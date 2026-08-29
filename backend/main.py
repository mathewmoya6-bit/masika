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
import re
import logging
import json
import base64
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from enum import Enum
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request, Depends, Header, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field, ConfigDict, validator
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
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://www.masikabbs.com")
API_VERSION = "2.0.0"
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

# M-Pesa Configuration
MPESA_CONSUMER_KEY = os.getenv("MPESA_CONSUMER_KEY")
MPESA_CONSUMER_SECRET = os.getenv("MPESA_CONSUMER_SECRET")
MPESA_PASSKEY = os.getenv("MPESA_PASSKEY")
MPESA_SHORTCODE = os.getenv("MPESA_SHORTCODE", "348127")
MPESA_ENVIRONMENT = os.getenv("MPESA_ENVIRONMENT", "sandbox")
MPESA_CALLBACK_URL = os.getenv("MPESA_CALLBACK_URL", "https://masika-c921.onrender.com/api/webhooks/mpesa")

# Enable docs on Render (always enabled in production)
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "true").lower() == "true"

if not SUPABASE_URL:
    logger.warning("⚠️ SUPABASE_URL is not configured.")
if not SUPABASE_SERVICE_ROLE_KEY:
    logger.warning("⚠️ SUPABASE_SERVICE_ROLE_KEY is not configured.")
if not MPESA_CONSUMER_KEY:
    logger.warning("⚠️ MPESA_CONSUMER_KEY is not configured.")
if not MPESA_PASSKEY:
    logger.warning("⚠️ MPESA_PASSKEY is not configured.")

logger.info(f"🌐 Environment: {ENVIRONMENT}")
logger.info(f"📚 API Docs Enabled: {ENABLE_DOCS}")
logger.info(f"💰 M-Pesa Environment: {MPESA_ENVIRONMENT}")

# ============================================================
# SUPABASE CLIENT
# ============================================================

supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    logger.info("✅ Supabase client initialized")

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
    docs_url="/api/docs" if ENABLE_DOCS else None,
    redoc_url="/api/redoc" if ENABLE_DOCS else None,
    openapi_url="/api/openapi.json" if ENABLE_DOCS else None,
)

# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "https://masikabbs.com",
        "https://www.masikabbs.com",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:8000",
        "https://masika-c921.onrender.com",
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
        # Verify token with Supabase
        response = database.auth.get_user(token)
        
        if not response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token"
            )
        
        # Check if user is a staff member
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
    
    @validator('date_of_birth')
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

class StaffLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)

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

def generate_member_number() -> str:
    """Generate a unique member number."""
    import random
    year = datetime.now().year
    seq = str(random.randint(1000, 9999))
    return f"MAS-{year}-{seq}"

def parse_date(date_str: str) -> Optional[datetime]:
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None

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
                "https://api.safaricom.co.ke/oauth/v1/generate",
                headers={"Authorization": f"Basic {credentials}"}
            )
            
            if response.status_code != 200:
                logger.error(f"Failed to get access token: {response.text}")
                return "mock_token"
            
            data = response.json()
            _payment_access_token = data.get("access_token")
            expires_in = data.get("expires_in", 3600)
            _payment_token_expiry = time.time() + expires_in - 60
            
            logger.info("M-Pesa access token obtained")
            return _payment_access_token
            
    except Exception as e:
        logger.error(f"Access token error: {e}")
        return "mock_token"

async def initiate_stk_push(phone: str, amount: float, account_reference: str, transaction_desc: str = "Membership Registration") -> Dict[str, Any]:
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
            
            # Save payment record
            database = get_supabase()
            payment_data = {
                "member_id": None,
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
        
        # Get access token
        access_token = await get_mpesa_access_token()
        if access_token == "mock_token":
            return {
                "success": False,
                "message": "Payment service unavailable",
                "status": "failed"
            }
        
        # Generate timestamp and password
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        password_str = f"{MPESA_SHORTCODE}{MPESA_PASSKEY}{timestamp}"
        password = base64.b64encode(password_str.encode()).decode("utf-8")
        
        # Prepare payload
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
