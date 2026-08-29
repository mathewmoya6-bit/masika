"""
MASIKA F. BENEVOLENT
Backend API - FastAPI

Production: https://masika-c921.onrender.com
Frontend: https://www.masikabbs.com

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

# M-Pesa Configuration
MPESA_CONSUMER_KEY = os.getenv("MPESA_CONSUMER_KEY")
MPESA_CONSUMER_SECRET = os.getenv("MPESA_CONSUMER_SECRET")
MPESA_PASSKEY = os.getenv("MPESA_PASSKEY")
MPESA_SHORTCODE = os.getenv("MPESA_SHORTCODE", "348127")
MPESA_ENVIRONMENT = os.getenv("MPESA_ENVIRONMENT", "sandbox")
MPESA_CALLBACK_URL = os.getenv("MPESA_CALLBACK_URL", "https://masika-c921.onrender.com/api/webhooks/mpesa")

if not SUPABASE_URL:
    logger.warning("⚠️ SUPABASE_URL is not configured.")
if not SUPABASE_SERVICE_ROLE_KEY:
    logger.warning("⚠️ SUPABASE_SERVICE_ROLE_KEY is not configured.")
if not MPESA_CONSUMER_KEY:
    logger.warning("⚠️ MPESA_CONSUMER_KEY is not configured.")
if not MPESA_PASSKEY:
    logger.warning("⚠️ MPESA_PASSKEY is not configured.")

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
    docs_url="/api/docs" if os.getenv("ENVIRONMENT") != "production" else None,
    redoc_url="/api/redoc" if os.getenv("ENVIRONMENT") != "production" else None,
    openapi_url="/api/openapi.json" if os.getenv("ENVIRONMENT") != "production" else None,
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
            
            # Save payment record
            database = get_supabase()
            payment_data = {
                "member_id": None,
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
    
    # Check database first
    existing = database.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
    if existing.data and existing.data[0].get("status") == "confirmed":
        return {
            "status": "confirmed",
            "payment": existing.data[0]
        }
    
    # Mock mode
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
                # Payment successful
                metadata = data.get("CallbackMetadata", {})
                items = metadata.get("Item", [])
                receipt = None
                amount = None
                
                for item in items:
                    if item.get("Name") == "MpesaReceiptNumber":
                        receipt = item.get("Value")
                    elif item.get("Name") == "Amount":
                        amount = item.get("Value")
                
                # Update payment
                update_data = {
                    "status": "confirmed",
                    "confirmed_at": datetime.now(timezone.utc).isoformat(),
                    "mpesa_receipt": receipt or checkout_request_id,
                    "amount": amount or None
                }
                database.table("payments").update(update_data).eq("checkout_request_id", checkout_request_id).execute()
                
                # Update member if linked
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
                # Update as failed
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

@app.get("/", response_model=APIResponse)
async def root():
    return {
        "success": True,
        "message": "MASIKA F. Benevolent API",
        "data": {
            "service": "MASIKA F. Benevolent API",
            "version": API_VERSION,
            "status": "online",
            "frontend": FRONTEND_URL,
            "environment": os.getenv("ENVIRONMENT", "development"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    }

# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/api/health", response_model=APIResponse)
async def health():
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
            "environment": os.getenv("ENVIRONMENT", "development"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    }

# ============================================================
# PUBLIC ENDPOINTS (No Auth Required)
# ============================================================

@app.get("/api/public/plans", response_model=APIResponse)
async def get_public_plans():
    """Get all available membership plans."""
    return {
        "success": True,
        "message": "Plans retrieved successfully",
        "data": [
            {
                "code": "COMFORT",
                "name": "Comfort Plan",
                "description": "Basic membership protection for individuals and families",
                "monthly_fee": 300,
                "registration_fee": PLAN_FEES["COMFORT"],
                "waiting_period": 4,
                "age_range": "1-69",
                "features": [
                    "Main member + spouse + up to 4 children",
                    "Hearse transportation",
                    "Mortuary storage up to 14 days",
                    "Tents & chairs for 200 people",
                    "Gazebo & lowering gear",
                    "Flowers (Heart, Round, Cross)",
                    "PA system",
                    "Memorial portrait",
                    "Coffin/casket"
                ]
            },
            {
                "code": "DIGNITY",
                "name": "Dignity Plan",
                "description": "Enhanced family protection for seniors",
                "monthly_fee": 1000,
                "registration_fee": PLAN_FEES["DIGNITY"],
                "waiting_period": 6,
                "age_range": "70-80",
                "features": [
                    "Spouse + children under 18",
                    "Gazebo",
                    "Hearse transportation",
                    "Mortuary storage up to 14 days",
                    "Tents & chairs for 200 people",
                    "Lowering gear",
                    "Flowers (Heart, Round, Cross)",
                    "PA system",
                    "Memorial portrait",
                    "Coffin/casket"
                ]
            },
            {
                "code": "WAZAZI",
                "name": "Wazazi Plan",
                "description": "Comprehensive parent and family protection (Add-on)",
                "monthly_fee": 350,
                "registration_fee": PLAN_FEES["WAZAZI"],
                "waiting_period": 6,
                "age_range": "40-70",
                "features": [
                    "Parents / in-laws (max 4)",
                    "Gazebo",
                    "Hearse transportation",
                    "Mortuary storage up to 14 days",
                    "Tents & chairs for 200 people",
                    "Lowering gear",
                    "Flowers (Heart, Round, Cross)",
                    "PA system",
                    "Memorial portrait",
                    "Coffin/casket"
                ]
            }
        ]
    }

@app.get("/api/public/plans/{plan_code}", response_model=APIResponse)
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

@app.post("/api/public/register", response_model=RegistrationResponse)
async def public_register(registration: RegistrationRequest):
    """
    PUBLIC MEMBER REGISTRATION - No Login Required.
    
    Flow: register.html → API → member created → payment.html
    """
    database = get_supabase()
    
    # Normalize phone
    try:
        phone = normalize_phone(registration.phone)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    
    # Check for existing member
    try:
        existing = database.table("members").select("id, phone, is_active").eq("phone", phone).execute()
        if existing.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "A member with this phone number already exists",
                    "member_id": existing.data[0].get("id")
                }
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Duplicate check failed: {e}")
    
    # Check email
    if registration.email:
        try:
            existing = database.table("members").select("id, email").eq("email", str(registration.email)).execute()
            if existing.data:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A member with this email already exists"
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Email duplicate check failed: {e}")
    
    # Calculate registration fee
    fee = calculate_registration_fee(registration.plan.value, registration.dependants)
    
    # Generate member number
    member_number = generate_member_number()
    
    # Prepare member data
    member_data = {
        "first_name": registration.first_name.strip(),
        "last_name": registration.last_name.strip(),
        "other_name": registration.other_name.strip() if registration.other_name else None,
        "phone": phone,
        "email": str(registration.email) if registration.email else None,
        "id_number": registration.id_number.strip(),
        "date_of_birth": registration.date_of_birth,
        "gender": registration.gender,
        "county": registration.county.strip(),
        "location": registration.location.strip() if registration.location else None,
        "address": registration.address.strip() if registration.address else None,
        "plan": registration.plan.value.lower(),
        "benefit_option": registration.benefit_option.value,
        "member_number": member_number,
        "registration_fee_paid": False,
        "is_active": True,
        "waiting_period_months": 4 if registration.plan == PlanEnum.COMFORT else 6,
    }
    
    # Insert member
    try:
        result = database.table("members").insert(member_data).execute()
        member = result.data[0] if result.data else None
        
        if not member:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create member"
            )
        
        member_id = member.get("id")
        
    except Exception as e:
        logger.error(f"Member insertion failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to create membership registration"
        )
    
    # Insert dependants
    if registration.dependants and member_id:
        for dep in registration.dependants:
            try:
                dep_data = {
                    "member_id": member_id,
                    "first_name": dep.get("first_name", "").strip(),
                    "last_name": dep.get("last_name", "").strip(),
                    "date_of_birth": dep.get("date_of_birth"),
                    "relationship": dep.get("relationship", "OTHER").lower(),
                    "is_active": True
                }
                database.table("dependants").insert(dep_data).execute()
            except Exception as e:
                logger.warning(f"Failed to insert dependant: {e}")
    
    # Create payment record
    try:
        payment_data = {
            "member_id": member_id,
            "amount": fee,
            "payment_type": "registration",
            "status": "pending",
            "paybill_number": "348127",
            "account_number": member_number,
            "notes": f"Registration payment - {registration.first_name} {registration.last_name}"
        }
        database.table("payments").insert(payment_data).execute()
    except Exception as e:
        logger.warning(f"Failed to create payment record: {e}")
    
    return RegistrationResponse(
        success=True,
        message="Registration submitted successfully. Please proceed to payment.",
        member_id=str(member_id),
        member_number=member_number,
        registration_amount=fee,
        payment_required=True,
    )

@app.post("/api/public/payment/stk-push", response_model=APIResponse)
async def public_stk_push(request: STKPushRequest):
    """
    PUBLIC STK PUSH PAYMENT - No Login Required.
    
    Initiate M-Pesa STK Push payment.
    """
    database = get_supabase()
    
    # Verify member exists
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
    
    # Check if already paid
    if member_data.get("registration_fee_paid"):
        return {
            "success": True,
            "message": "Registration fee already paid",
            "data": {
                "already_paid": True,
                "member_id": request.member_id
            }
        }
    
    # Normalize phone
    try:
        phone = normalize_phone(request.phone)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    
    # Account reference
    account_reference = member_data.get("member_number", f"MEM-{request.member_id[:8]}")
    
    # Initiate STK Push
    result = await initiate_stk_push(
        phone=phone,
        amount=request.amount,
        account_reference=account_reference,
        transaction_desc=request.transaction_desc
    )
    
    # Update payment with member_id
    if result.get("success") and result.get("payment_id"):
        database.table("payments").update({
            "member_id": request.member_id,
            "phone": phone
        }).eq("id", result["payment_id"]).execute()
    
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

@app.get("/api/public/payment/status/{checkout_request_id}", response_model=APIResponse)
async def public_payment_status(checkout_request_id: str):
    """
    PUBLIC PAYMENT STATUS - No Login Required.
    
    Check the status of an STK Push payment.
    """
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

@app.post("/api/public/payment/confirm", response_model=APIResponse)
async def public_confirm_payment(payment: PaymentConfirmRequest):
    """
    PUBLIC PAYMENT CONFIRMATION - No Login Required.
    
    Confirm M-Pesa payment after member has paid.
    """
    database = get_supabase()
    
    try:
        phone = normalize_phone(payment.phone)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    
    # Verify member exists
    try:
        member = database.table("members").select("id, member_number, first_name, last_name, registration_fee_paid").eq("id", payment.member_id).execute()
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
    
    # Check if already paid
    if member_data.get("registration_fee_paid"):
        return {
            "success": True,
            "message": "Registration fee already paid",
            "data": {"member_id": payment.member_id, "already_paid": True}
        }
    
    # Update payment record
    try:
        payment_update = {
            "status": "confirmed",
            "mpesa_receipt": payment.mpesa_receipt,
            "confirmed_at": datetime.now(timezone.utc).isoformat()
        }
        
        result = database.table("payments").update(payment_update).eq("member_id", payment.member_id).eq("payment_type", "registration").execute()
        
        # If no payment record exists, create one
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
        
        # Update member as paid
        database.table("members").update({
            "registration_fee_paid": True,
            "coverage_start_date": (datetime.now(timezone.utc) + timedelta(days=120)).isoformat()
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

@app.post("/api/public/agent/apply", response_model=AgentApplicationResponse)
async def public_agent_apply(application: AgentApplicationRequest):
    """
    PUBLIC AGENT APPLICATION - No Login Required.
    
    Anyone can apply to become a sales agent.
    """
    database = get_supabase()
    
    try:
        phone = normalize_phone(application.phone)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    
    # Check for existing application
    try:
        existing = database.table("agent_applications").select("id, email, phone").or_(f"email.eq.{application.email},phone.eq.{phone}").execute()
        if existing.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An application with this email or phone already exists"
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Duplicate check failed: {e}")
    
    # Insert application
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
        
        return AgentApplicationResponse(
            success=True,
            message="Application submitted successfully. Our team will review it.",
            application_id=str(app.get("id")),
            status="pending"
        )
        
    except Exception as e:
        logger.error(f"Agent application failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to submit application. Please try again."
        )

@app.get("/api/public/check-member/{phone}", response_model=APIResponse)
async def check_member(phone: str):
    """
    PUBLIC - Check if a phone number is already registered.
    """
    try:
        phone = normalize_phone(phone)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    
    database = get_supabase()
    
    try:
        result = database.table("members").select("id, first_name, last_name, is_active, registration_fee_paid").eq("phone", phone).execute()
        
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

@app.get("/api/staff/dashboard", response_model=APIResponse)
async def staff_dashboard(auth: Dict = Depends(verify_staff_token)):
    """Get staff dashboard statistics."""
    database = get_supabase()
    
    try:
        total_members = database.table("members").select("id", count="exact").execute()
        active_members = database.table("members").select("id", count="exact").eq("is_active", True).execute()
        pending_registrations = database.table("members").select("id", count="exact").eq("registration_fee_paid", False).execute()
        
        total_agents = database.table("agent_profiles").select("id", count="exact").eq("status", "approved").execute()
        pending_agents = database.table("agent_applications").select("id", count="exact").eq("status", "pending").execute()
        
        payments = database.table("payments").select("amount").in_("status", ["confirmed", "paid"]).execute()
        total_revenue = sum(float(p.get("amount", 0)) for p in payments.data) if payments.data else 0
        
        recent = database.table("members").select("id, first_name, last_name, phone, member_number, created_at").order("created_at", desc=True).limit(10).execute()
        
        return {
            "success": True,
            "message": "Dashboard data retrieved",
            "data": {
                "stats": {
                    "total_members": total_members.count or 0,
                    "active_members": active_members.count or 0,
                    "pending_registrations": pending_registrations.count or 0,
                    "total_agents": total_agents.count or 0,
                    "pending_agent_applications": pending_agents.count or 0,
                    "total_revenue": total_revenue
                },
                "recent_members": recent.data or []
            }
        }
        
    except Exception as e:
        logger.error(f"Dashboard error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load dashboard data"
        )

@app.get("/api/staff/members", response_model=APIResponse)
async def get_members(
    auth: Dict = Depends(verify_staff_token),
    search: Optional[str] = None,
    plan: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    """Get paginated list of members with filters."""
    database = get_supabase()
    
    try:
        query = database.table("members").select("*")
        
        if search:
            query = query.or_(
                f"first_name.ilike.%{search}%,last_name.ilike.%{search}%,phone.ilike.%{search}%,member_number.ilike.%{search}%"
            )
        if plan:
            query = query.eq("plan", plan.lower())
        if status == "active":
            query = query.eq("is_active", True)
        elif status == "inactive":
            query = query.eq("is_active", False)
        
        offset = (page - 1) * limit
        result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        
        count_result = database.table("members").select("id", count="exact").execute()
        
        return {
            "success": True,
            "message": "Members retrieved",
            "data": {
                "members": result.data or [],
                "total": count_result.count or 0,
                "page": page,
                "limit": limit,
                "pages": (count_result.count or 0 + limit - 1) // limit if count_result.count else 1
            }
        }
        
    except Exception as e:
        logger.error(f"Get members error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load members"
        )

@app.get("/api/staff/members/{member_id}", response_model=APIResponse)
async def get_member_details(member_id: str, auth: Dict = Depends(verify_staff_token)):
    """Get detailed member information including dependants and payments."""
    database = get_supabase()
    
    try:
        member = database.table("members").select("*").eq("id", member_id).execute()
        if not member.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        
        member_data = member.data[0]
        
        dependants = database.table("dependants").select("*").eq("member_id", member_id).order("created_at", desc=True).execute()
        payments = database.table("payments").select("*").eq("member_id", member_id).order("payment_date", desc=True).execute()
        
        return {
            "success": True,
            "message": "Member details retrieved",
            "data": {
                "member": member_data,
                "dependants": dependants.data or [],
                "payments": payments.data or []
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get member details error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load member details"
        )

@app.put("/api/staff/members/{member_id}", response_model=APIResponse)
async def update_member(member_id: str, updates: MemberUpdateRequest, auth: Dict = Depends(verify_staff_token)):
    """Update member information."""
    database = get_supabase()
    
    try:
        existing = database.table("members").select("id").eq("id", member_id).execute()
        if not existing.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        
        update_data = {}
        if updates.first_name is not None:
            update_data["first_name"] = updates.first_name.strip()
        if updates.last_name is not None:
            update_data["last_name"] = updates.last_name.strip()
        if updates.phone is not None:
            update_data["phone"] = normalize_phone(updates.phone)
        if updates.email is not None:
            update_data["email"] = str(updates.email)
        if updates.address is not None:
            update_data["address"] = updates.address.strip()
        if updates.is_active is not None:
            update_data["is_active"] = updates.is_active
        if updates.plan is not None:
            update_data["plan"] = updates.plan.value.lower()
        if updates.benefit_option is not None:
            update_data["benefit_option"] = updates.benefit_option.value
        
        if not update_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No fields to update"
            )
        
        result = database.table("members").update(update_data).eq("id", member_id).execute()
        
        return {
            "success": True,
            "message": "Member updated successfully",
            "data": result.data[0] if result.data else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update member error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update member"
        )

@app.get("/api/staff/agents", response_model=APIResponse)
async def get_agents(
    auth: Dict = Depends(verify_staff_token),
    status_filter: Optional[str] = None,
    search: Optional[str] = None
):
    """Get all agents with optional filters."""
    database = get_supabase()
    
    try:
        query = database.table("agent_profiles").select("*")
        if status_filter:
            query = query.eq("status", status_filter)
        if search:
            query = query.or_(f"full_name.ilike.%{search}%,email.ilike.%{search}%,phone.ilike.%{search}%")
        
        result = query.order("created_at", desc=True).execute()
        
        return {
            "success": True,
            "message": "Agents retrieved",
            "data": result.data or []
        }
        
    except Exception as e:
        logger.error(f"Get agents error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load agents"
        )

@app.get("/api/staff/agents/applications", response_model=APIResponse)
async def get_agent_applications(
    auth: Dict = Depends(verify_staff_token),
    status_filter: Optional[str] = "pending"
):
    """Get agent applications with optional status filter."""
    database = get_supabase()
    
    try:
        query = database.table("agent_applications").select("*")
        if status_filter:
            query = query.eq("status", status_filter)
        
        result = query.order("created_at", desc=True).execute()
        
        return {
            "success": True,
            "message": "Applications retrieved",
            "data": result.data or []
        }
        
    except Exception as e:
        logger.error(f"Get applications error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load applications"
        )

@app.put("/api/staff/agents/{agent_id}/approve", response_model=APIResponse)
async def approve_agent(agent_id: str, auth: Dict = Depends(verify_staff_token)):
    """Approve an agent application and create agent profile."""
    database = get_supabase()
    
    try:
        application = database.table("agent_applications").select("*").eq("id", agent_id).eq("status", "pending").execute()
        if not application.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found or already processed"
            )
        
        app_data = application.data[0]
        
        agent_data = {
            "full_name": app_data["full_name"],
            "email": app_data["email"],
            "phone": app_data["phone"],
            "id_number": app_data["id_number"],
            "county": app_data["county"],
            "location": app_data.get("location"),
            "status": "approved",
            "commission_rate": 10.0,
            "approved_at": datetime.now(timezone.utc).isoformat()
        }
        
        agent_result = database.table("agent_profiles").insert(agent_data).execute()
        agent = agent_result.data[0] if agent_result.data else None
        
        if not agent:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create agent profile"
            )
        
        database.table("agent_applications").update({
            "status": "approved",
            "reviewed_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", agent_id).execute()
        
        # Generate initial sales codes (5 codes)
        import random
        codes = []
        prefix = "MAS"
        agent_code = app_data["email"].split("@")[0][:3].upper()
        
        for i in range(5):
            random_str = ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', k=4))
            code = f"{prefix}-{agent_code}-{random_str}"
            codes.append({
                "code": code,
                "agent_email": app_data["email"],
                "agent_name": app_data["full_name"],
                "agent_id": agent["id"],
                "status": "active",
                "used": False
            })
        
        database.table("sales_codes").insert(codes).execute()
        
        return {
            "success": True,
            "message": f"Agent {app_data['full_name']} approved successfully",
            "data": {
                "agent": agent,
                "sales_codes_generated": len(codes)
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Approve agent error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to approve agent"
        )

@app.put("/api/staff/agents/{agent_id}/reject", response_model=APIResponse)
async def reject_agent(agent_id: str, request: Request, auth: Dict = Depends(verify_staff_token)):
    """Reject an agent application."""
    database = get_supabase()
    
    try:
        body = await request.json()
        reason = body.get("reason", "No reason provided")
        
        application = database.table("agent_applications").select("*").eq("id", agent_id).eq("status", "pending").execute()
        if not application.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found or already processed"
            )
        
        database.table("agent_applications").update({
            "status": "rejected",
            "rejection_reason": reason,
            "reviewed_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", agent_id).execute()
        
        return {
            "success": True,
            "message": "Application rejected",
            "data": {"application_id": agent_id, "reason": reason}
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Reject agent error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reject application"
        )

@app.put("/api/staff/agents/{agent_id}/status", response_model=APIResponse)
async def update_agent_status(
    agent_id: str,
    update: AgentUpdateRequest,
    auth: Dict = Depends(verify_staff_token)
):
    """Update agent status (activate/deactivate/suspend)."""
    database = get_supabase()
    
    try:
        existing = database.table("agent_profiles").select("id").eq("id", agent_id).execute()
        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Agent not found"
            )
        
        update_data = {"status": update.status}
        if update.commission_rate is not None:
            update_data["commission_rate"] = update.commission_rate
        
        result = database.table("agent_profiles").update(update_data).eq("id", agent_id).execute()
        
        return {
            "success": True,
            "message": f"Agent status updated to {update.status}",
            "data": result.data[0] if result.data else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update agent status error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update agent status"
        )

@app.post("/api/staff/agents/sales-codes", response_model=APIResponse)
async def generate_sales_codes(request: SalesCodeRequest, auth: Dict = Depends(verify_staff_token)):
    """Generate sales codes for an agent."""
    database = get_supabase()
    
    try:
        agent = database.table("agent_profiles").select("*").eq("id", request.agent_id).eq("status", "approved").execute()
        if not agent.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Agent not found or not approved"
            )
        
        agent_data = agent.data[0]
        
        import random
        codes = []
        prefix = request.code_prefix.upper()[:6]
        agent_code = agent_data["email"].split("@")[0][:3].upper()
        
        for i in range(request.count):
            random_str = ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', k=4))
            code = f"{prefix}-{agent_code}-{random_str}"
            codes.append({
                "code": code,
                "agent_email": agent_data["email"],
                "agent_name": agent_data["full_name"],
                "agent_id": request.agent_id,
                "status": "active",
                "used": False,
                "expires_at": request.expires_at if request.expires_at else None
            })
        
        result = database.table("sales_codes").insert(codes).execute()
        
        return {
            "success": True,
            "message": f"{len(codes)} sales codes generated",
            "data": {
                "codes": result.data or [],
                "count": len(codes),
                "agent": agent_data["full_name"]
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Generate sales codes error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate sales codes"
        )

@app.get("/api/staff/agents/{agent_id}/sales-codes", response_model=APIResponse)
async def get_agent_sales_codes(agent_id: str, auth: Dict = Depends(verify_staff_token)):
    """Get all sales codes for an agent."""
    database = get_supabase()
    
    try:
        result = database.table("sales_codes").select("*").eq("agent_id", agent_id).order("created_at", desc=True).execute()
        
        return {
            "success": True,
            "message": "Sales codes retrieved",
            "data": result.data or []
        }
        
    except Exception as e:
        logger.error(f"Get sales codes error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load sales codes"
        )

@app.get("/api/staff/payments", response_model=APIResponse)
async def get_payments(
    auth: Dict = Depends(verify_staff_token),
    status: Optional[str] = None,
    member_id: Optional[str] = None,
    page: int = 1,
    limit: int = 20
):
    """Get paginated list of payments with filters."""
    database = get_supabase()
    
    try:
        query = database.table("payments").select("*")
        if status:
            query = query.eq("status", status)
        if member_id:
            query = query.eq("member_id", member_id)
        
        offset = (page - 1) * limit
        result = query.order("payment_date", desc=True).range(offset, offset + limit - 1).execute()
        
        count_result = database.table("payments").select("id", count="exact").execute()
        
        return {
            "success": True,
            "message": "Payments retrieved",
            "data": {
                "payments": result.data or [],
                "total": count_result.count or 0,
                "page": page,
                "limit": limit,
                "pages": (count_result.count or 0 + limit - 1) // limit if count_result.count else 1
            }
        }
        
    except Exception as e:
        logger.error(f"Get payments error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load payments"
        )

@app.put("/api/staff/payments/{payment_id}", response_model=APIResponse)
async def update_payment(
    payment_id: str,
    update: PaymentUpdateRequest,
    auth: Dict = Depends(verify_staff_token)
):
    """Update payment status."""
    database = get_supabase()
    
    try:
        payment = database.table("payments").select("*").eq("id", payment_id).execute()
        if not payment.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment not found"
            )
        
        update_data = {"status": update.status.value}
        if update.notes:
            update_data["notes"] = update.notes
        
        if update.status == PaymentStatusEnum.CONFIRMED:
            update_data["confirmed_at"] = datetime.now(timezone.utc).isoformat()
        
        result = database.table("payments").update(update_data).eq("id", payment_id).execute()
        
        return {
            "success": True,
            "message": f"Payment status updated to {update.status.value}",
            "data": result.data[0] if result.data else None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update payment error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update payment"
        )

# ============================================================
# WEBHOOK ENDPOINTS
# ============================================================

@app.post("/api/webhooks/mpesa")
async def mpesa_webhook(request: Request):
    """
    M-Pesa webhook endpoint.
    Called by Safaricom when payment is completed.
    """
    try:
        body = await request.json()
        logger.info(f"M-Pesa webhook received: {json.dumps(body)}")
        
        # Extract body
        stk_callback = body.get("Body", {}).get("stkCallback", {})
        checkout_request_id = stk_callback.get("CheckoutRequestID")
        result_code = stk_callback.get("ResultCode")
        result_desc = stk_callback.get("ResultDesc")
        metadata = stk_callback.get("CallbackMetadata", {})
        
        if not checkout_request_id:
            logger.warning("No CheckoutRequestID in webhook")
            return {"ResultCode": 1, "ResultDesc": "No CheckoutRequestID"}
        
        database = get_supabase()
        
        # Find payment
        payment = database.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
        if not payment.data:
            logger.warning(f"Payment not found: {checkout_request_id}")
            return {"ResultCode": 1, "ResultDesc": "Payment not found"}
        
        if result_code == "0":
            # Payment successful
            items = metadata.get("Item", [])
            receipt = None
            amount = None
            
            for item in items:
                if item.get("Name") == "MpesaReceiptNumber":
                    receipt = item.get("Value")
                elif item.get("Name") == "Amount":
                    amount = item.get("Value")
            
            # Update payment
            update_data = {
                "status": "confirmed",
                "confirmed_at": datetime.now(timezone.utc).isoformat(),
                "mpesa_receipt": receipt or checkout_request_id,
                "amount": amount or payment.data[0].get("amount"),
                "webhook_response": json.dumps(body)
            }
            database.table("payments").update(update_data).eq("id", payment.data[0]["id"]).execute()
            
            # Update member if linked
            if payment.data[0].get("member_id"):
                database.table("members").update({
                    "registration_fee_paid": True,
                    "coverage_start_date": datetime.now(timezone.utc).isoformat()
                }).eq("id", payment.data[0]["member_id"]).execute()
            
            logger.info(f"Payment confirmed via webhook: {checkout_request_id}")
            return {"ResultCode": 0, "ResultDesc": "Success"}
        else:
            # Payment failed
            database.table("payments").update({
                "status": "failed",
                "notes": f"Webhook: {result_desc}",
                "webhook_response": json.dumps(body)
            }).eq("id", payment.data[0]["id"]).execute()
            
            logger.warning(f"Payment failed via webhook: {checkout_request_id} - {result_desc}")
            return {"ResultCode": 0, "ResultDesc": "Payment failed recorded"}
            
    except Exception as e:
        logger.error(f"Webhook processing error: {e}")
        return {"ResultCode": 1, "ResultDesc": f"Processing failed: {str(e)}"}

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
            "error": str(exc) if os.getenv("DEBUG") == "true" else None,
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
