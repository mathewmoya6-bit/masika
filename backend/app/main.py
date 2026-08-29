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
    POST /api/public/payment/confirm
    GET  /api/public/check-member/{phone}

Staff Endpoints (Auth Required):
    GET  /api/staff/dashboard
    GET  /api/staff/members
    GET  /api/staff/members/{member_id}
    PUT  /api/staff/members/{member_id}
    GET  /api/staff/agents
    PUT  /api/staff/agents/{agent_id}/approve
    PUT  /api/staff/agents/{agent_id}/reject
    POST /api/staff/agents/{agent_id}/sales-codes
    GET  /api/staff/payments
    PUT  /api/staff/payments/{payment_id}
    GET  /api/staff/reports/members
    GET  /api/staff/reports/payments
    GET  /api/staff/reports/agents

IMPORTANT:
- Never expose the Supabase service-role key to the frontend.
- Public registration does NOT require staff login.
- All staff endpoints require valid JWT token.
"""

import os
import re
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from enum import Enum

from fastapi import FastAPI, HTTPException, Request, Depends, Header, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
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

if not SUPABASE_URL:
    logger.warning("⚠️ SUPABASE_URL is not configured.")

if not SUPABASE_SERVICE_ROLE_KEY:
    logger.warning("⚠️ SUPABASE_SERVICE_ROLE_KEY is not configured.")

# ============================================================
# SUPABASE CLIENT
# ============================================================

supabase: Optional[Client] = None

if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    logger.info("✅ Supabase client initialized")

# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="MASIKA F. Benevolent API",
    description="Backend API for MASIKA F. Benevolent membership, registration, agents, and payments.",
    version=API_VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
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
    
    try:
        # Verify token with Supabase
        response = await supabase.auth.get_user(token)
        
        if not response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token"
            )
        
        # Check if user is a staff member
        staff_check = supabase.table("admin_profiles").select("id, role, is_active").eq("user_id", response.user.id).eq("is_active", True).execute()
        
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
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

def get_supabase() -> Client:
    if not supabase:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connection is not configured."
        )
    return supabase

def calculate_registration_fee(plan: str, dependants: List[Dict]) -> float:
    """Calculate registration fee based on plan and dependants."""
    fee = PLAN_FEES.get(plan.upper(), 0)
    
    for dep in dependants:
        relationship = dep.get("relationship", "").upper()
        fee += DEPENDANT_FEES.get(relationship, 50)
    
    return float(fee)

def generate_member_number() -> str:
    """Generate a unique member number."""
    year = datetime.now().year
    import random
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
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    }

# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/api/health", response_model=APIResponse)
async def health():
    database_status = "not_configured"
    
    if supabase:
        try:
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
            "coverage_start_date": (datetime.now() + timedelta(days=120)).isoformat()
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
        # Total members
        total_members = database.table("members").select("id", count="exact").execute()
        
        # Active members
        active_members = database.table("members").select("id", count="exact").eq("is_active", True).execute()
        
        # Pending registrations (not paid)
        pending_registrations = database.table("members").select("id", count="exact").eq("registration_fee_paid", False).execute()
        
        # Total agents
        total_agents = database.table("agent_profiles").select("id", count="exact").eq("status", "approved").execute()
        
        # Pending agent applications
        pending_agents = database.table("agent_applications").select("id", count="exact").eq("status", "pending").execute()
        
        # Total revenue (confirmed payments)
        payments = database.table("payments").select("amount").in_("status", ["confirmed", "paid"]).execute()
        total_revenue = sum(float(p.get("amount", 0)) for p in payments.data) if payments.data else 0
        
        # Recent members
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
        
        # Apply filters
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
        
        # Pagination
        offset = (page - 1) * limit
        result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        
        # Get total count
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
        # Get member
        member = database.table("members").select("*").eq("id", member_id).execute()
        if not member.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        
        member_data = member.data[0]
        
        # Get dependants
        dependants = database.table("dependants").select("*").eq("member_id", member_id).order("created_at", desc=True).execute()
        
        # Get payments
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
        # Check if member exists
        existing = database.table("members").select("id").eq("id", member_id).execute()
        if not existing.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        
        # Build update
