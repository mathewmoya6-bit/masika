# ============================================================
# MAIN ENTRY POINT - backend/main.py
# Complete Production-Ready FastAPI Application
# Render runs: uvicorn main:app
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
    print("❌ Supabase not installed. Run: pip install supabase")
    Client = None
    create_client = None

try:
    import requests
except ImportError:
    print("⚠️ requests not installed. M-Pesa features will be disabled.")
    requests = None

try:
    import jwt
except ImportError:
    print("⚠️ PyJWT not installed. JWT features will be disabled.")
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
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndweHpsY2RyaXJsY3l2ZmlxdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Mjc4MDcsImV4cCI6MjEwMzUwMzgwN30.OUP9pmPbrML_egpHflZtDfLv1_UDM37_BYjtb842xjg")

SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

# M-Pesa Configuration
MPESA_CONSUMER_KEY = os.getenv("MPESA_CONSUMER_KEY", "")
MPESA_CONSUMER_SECRET = os.getenv("MPESA_CONSUMER_SECRET", "")
MPESA_PASSKEY = os.getenv("MPESA_PASSKEY", "")
MPESA_SHORTCODE = os.getenv("MPESA_SHORTCODE", "174379")
MPESA_ENVIRONMENT = os.getenv("MPESA_ENVIRONMENT", "sandbox")
BASE_URL = os.getenv("BASE_URL", "https://masika-c921.onrender.com")

# M-Pesa URLs
if MPESA_ENVIRONMENT == "production":
    MPESA_BASE_URL = "https://api.safaricom.co.ke"
else:
    MPESA_BASE_URL = "https://sandbox.safaricom.co.ke"

MPESA_AUTH_URL = f"{MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials"
MPESA_STK_PUSH_URL = f"{MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest"
MPESA_STK_QUERY_URL = f"{MPESA_BASE_URL}/mpesa/stkpushquery/v1/query"

# ============================================================
# SUPABASE CLIENT
# ============================================================

supabase = None
if create_client:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("✅ Supabase client initialized successfully")
    except Exception as e:
        logger.error(f"❌ Failed to initialize Supabase client: {e}")

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

class STKPushRequest(BaseModel):
    phone: str
    amount: float
    account_reference: str
    transaction_desc: str = "Payment to Masika Benevolent"
    member_id: str
    payment_type: PaymentTypeEnum = PaymentTypeEnum.REGISTRATION

class STKPushResponse(BaseModel):
    success: bool
    message: str
    checkout_request_id: Optional[str] = None
    merchant_request_id: Optional[str] = None
    response_code: Optional[str] = None

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
# NEW: PUBLIC REGISTRATION MODELS
# ============================================================

class PublicMemberCreate(BaseModel):
    first_name: str
    last_name: str
    other_name: Optional[str] = None
    phone: str
    alternative_phone: Optional[str] = None
    email: Optional[EmailStr] = None
    id_number: str
    date_of_birth: str
    gender: str  # "MALE" or "FEMALE"
    county: str
    location: Optional[str] = None
    town: Optional[str] = None
    address: Optional[str] = None
    sales_code: Optional[str] = None
    plan: str  # "comfort", "dignity", "wazazi"
    benefit_option: str  # "service" or "cash"
    dependants: List[Dict[str, Any]] = []

class PublicRegisterResponse(BaseModel):
    success: bool
    member_id: str
    member_number: str
    registration_amount: float
    message: str

class ChamaMemberCreate(BaseModel):
    first_name: str
    last_name: str
    phone: str
    id_number: str
    date_of_birth: str
    gender: str

class ChamaRegistrationRequest(BaseModel):
    group_name: str
    phone: str
    chairperson: Dict[str, str]
    treasurer: Dict[str, str]
    secretary: Dict[str, str]
    members: List[Dict[str, Any]]

class PaymentInitRequest(BaseModel):
    member_id: Optional[str] = None
    group_id: Optional[str] = None
    phone: str
    amount: float
    payment_type: str = "registration"

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

# ============================================================
# M-PESA HELPERS
# ============================================================

def get_mpesa_access_token() -> Optional[str]:
    if not requests or not MPESA_CONSUMER_KEY or not MPESA_CONSUMER_SECRET:
        return None
    try:
        auth = base64.b64encode(f"{MPESA_CONSUMER_KEY}:{MPESA_CONSUMER_SECRET}".encode()).decode()
        response = requests.get(MPESA_AUTH_URL, headers={"Authorization": f"Basic {auth}"}, timeout=30)
        if response.status_code == 200:
            return response.json().get("access_token")
        return None
    except:
        return None

def generate_mpesa_password(shortcode: str, passkey: str, timestamp: str) -> str:
    return base64.b64encode(f"{shortcode}{passkey}{timestamp}".encode()).decode()

def generate_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S")

def format_phone_number(phone: str) -> str:
    phone = re.sub(r'\D', '', phone)
    if phone.startswith('0'):
        phone = '254' + phone[1:]
    elif phone.startswith('7'):
        phone = '254' + phone
    elif phone.startswith('+254'):
        phone = phone[1:]
    return phone

# ============================================================
# CREATE FASTAPI APP
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Starting Masika Benevolent API...")
    if supabase:
        try:
            supabase.table("members").select("count", count="exact").limit(1).execute()
            logger.info("✅ Database connection successful")
        except Exception as e:
            logger.error(f"❌ Database connection failed: {e}")
    yield
    logger.info("🛑 Shutting down Masika Benevolent API...")

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
        "mpesa": "configured" if MPESA_CONSUMER_KEY else "not configured"
    }

# ============================================================
# PUBLIC ROUTES
# ============================================================

public_router = APIRouter(prefix="/api/public", tags=["Public"])

@public_router.get("/plans", response_model=List[PlanResponse])
async def get_public_plans():
    return [
        {"slug": "comfort", "name": "Comfort Plan", "description": "Affordable individual membership protection.", "registration_fee": 200.00, "monthly_fee": 300.00, "waiting_period_months": 4},
        {"slug": "dignity", "name": "Dignity Plan", "description": "Enhanced membership protection with premium benefits.", "registration_fee": 300.00, "monthly_fee": 1000.00, "waiting_period_months": 6},
        {"slug": "wazazi", "name": "Wazazi Plan", "description": "Membership protection designed for parents and elders.", "registration_fee": 250.00, "monthly_fee": 350.00, "waiting_period_months": 6}
    ]

@public_router.get("/agents", response_model=List[AgentResponse])
async def get_public_agents(branch_id: Optional[str] = None):
    if not supabase:
        return []
    try:
        query = supabase.table("sales_agents").select("*").eq("status", "active")
        if branch_id:
            query = query.eq("branch_id", branch_id)
        result = query.execute()
        return [{"id": a.get("id"), "agent_code": a.get("agent_code", ""), "full_name": a.get("full_name", ""), "email": a.get("email"), "phone": a.get("phone"), "branch": a.get("branch"), "status": a.get("status", "active"), "commission_rate": a.get("commission_rate", 5.0)} for a in (result.data or [])]
    except:
        return []

@public_router.get("/branches", response_model=List[BranchResponse])
async def get_public_branches():
    if not supabase:
        return [{"id": "1", "name": "Nairobi", "code": "NBO", "location": "Nairobi CBD", "phone": "0712345678", "email": "nairobi@masika.co.ke", "is_active": True}]
    try:
        result = supabase.table("branches").select("*").eq("is_active", True).execute()
        return result.data or []
    except:
        return []

# ============================================================
# NEW: PUBLIC REGISTRATION ENDPOINTS
# ============================================================

@public_router.post("/register", response_model=PublicRegisterResponse)
async def public_register_member(member_data: PublicMemberCreate):
    """
    Public registration endpoint for new members.
    Creates a pending member record with a payment record.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    # Check if email already exists
    if member_data.email:
        existing = supabase.table("members").select("email").eq("email", member_data.email).execute()
        if existing.data:
            raise HTTPException(status_code=400, detail="Email already registered")
    
    # Check if ID number already exists
    existing = supabase.table("members").select("id_number").eq("id_number", member_data.id_number).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="ID number already registered")
    
    try:
        # Generate member number
        member_number = generate_member_number()
        
        # Determine waiting period based on plan
        plan = member_data.plan.lower()
        waiting_period = 6 if plan == "dignity" else 4
        
        # Calculate registration amount
        plan_amounts = {
            "comfort": 200.00,
            "dignity": 500.00,
            "wazazi": 200.00
        }
        registration_amount = plan_amounts.get(plan, 200.00)
        
        # Add dependant fees if Wazazi plan
        if plan == "wazazi":
            parent_count = sum(1 for d in member_data.dependants if d.get("relationship", "").upper() == "PARENT")
            registration_amount += parent_count * 100.00
        
        # Create member record
        member_record = {
            "member_number": member_number,
            "username": member_number,
            "first_name": member_data.first_name,
            "last_name": member_data.last_name,
            "other_name": member_data.other_name,
            "email": member_data.email,
            "phone": member_data.phone,
            "alternative_phone": member_data.alternative_phone,
            "id_number": member_data.id_number,
            "date_of_birth": member_data.date_of_birth,
            "gender": member_data.gender.upper(),
            "county": member_data.county,
            "location": member_data.location,
            "town": member_data.town,
            "address": member_data.address,
            "plan": plan,
            "benefit_option": member_data.benefit_option.lower(),
            "sales_code": member_data.sales_code,
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
        
        # Insert member
        result = supabase.table("members").insert(member_record).execute()
        if not result.data:
            raise HTTPException(status_code=400, detail="Failed to create member")
        
        new_member = result.data[0]
        member_id = new_member["id"]
        
        # Create payment record
        payment_record = {
            "member_number": member_number,
            "member_id": member_id,
            "amount": registration_amount,
            "payment_type": "registration",
            "payment_method": "mpesa",
            "mpesa_receipt": None,
            "status": "pending",
            "payment_date": datetime.now().date().isoformat(),
            "phone": member_data.phone,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        supabase.table("payments").insert(payment_record).execute()
        
        # Insert dependants
        for dep in member_data.dependants:
            supabase.table("dependants").insert({
                "principal_member_id": member_id,
                "first_name": dep.get("first_name"),
                "last_name": dep.get("last_name"),
                "relationship": dep.get("relationship", "").upper(),
                "date_of_birth": dep.get("date_of_birth"),
                "phone": dep.get("phone"),
                "email": dep.get("email"),
                "is_active": True,
                "created_at": datetime.now().isoformat()
            }).execute()
        
        return PublicRegisterResponse(
            success=True,
            member_id=member_id,
            member_number=member_number,
            registration_amount=registration_amount,
            message="Registration created successfully. Please complete payment."
        )
        
    except Exception as e:
        logger.error(f"Public registration failed: {e}")
        raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

@public_router.post("/register/chama")
async def public_register_chama(chama_data: ChamaRegistrationRequest):
    """
    Public registration endpoint for Chama/Group registrations.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    # Validate minimum members
    if len(chama_data.members) < 30:
        raise HTTPException(
            status_code=400, 
            detail=f"Minimum 30 members required. Currently {len(chama_data.members)}."
        )
    
    try:
        # Create chama group record
        group_record = {
            "group_name": chama_data.group_name,
            "phone": chama_data.phone,
            "chairperson_name": chama_data.chairperson.get("name"),
            "chairperson_phone": chama_data.chairperson.get("phone"),
            "chairperson_id": chama_data.chairperson.get("id_number"),
            "treasurer_name": chama_data.treasurer.get("name"),
            "treasurer_phone": chama_data.treasurer.get("phone"),
            "treasurer_id": chama_data.treasurer.get("id_number"),
            "secretary_name": chama_data.secretary.get("name"),
            "secretary_phone": chama_data.secretary.get("phone"),
            "secretary_id": chama_data.secretary.get("id_number"),
            "member_count": len(chama_data.members),
            "status": "PENDING",
            "registration_amount": len(chama_data.members) * 100.00,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        result = supabase.table("chama_groups").insert(group_record).execute()
        if not result.data:
            raise HTTPException(status_code=400, detail="Failed to create chama group")
        
        group = result.data[0]
        group_id = group["id"]
        registration_amount = group["registration_amount"]
        
        # Create payment record for chama
        payment_record = {
            "group_id": group_id,
            "group_name": chama_data.group_name,
            "amount": registration_amount,
            "payment_type": "chama_registration",
            "payment_method": "mpesa",
            "status": "pending",
            "phone": chama_data.phone,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        supabase.table("payments").insert(payment_record).execute()
        
        # Insert individual members
        for member in chama_data.members:
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
            "group_name": chama_data.group_name,
            "member_count": len(chama_data.members),
            "registration_amount": registration_amount,
            "message": "Chama registration created successfully. Please complete payment."
        }
        
    except Exception as e:
        logger.error(f"Chama registration failed: {e}")
        raise HTTPException(status_code=400, detail=f"Chama registration failed: {str(e)}")

@public_router.post("/initiate-payment")
async def initiate_payment(request: PaymentInitRequest):
    """
    Initiate M-Pesa STK push payment.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    # Validate phone
    phone = format_phone_number(request.phone)
    if not phone or not re.match(r"^254[17]\d{8}$", phone):
        raise HTTPException(status_code=400, detail="Invalid phone number format")
    
    # Generate transaction ID
    transaction_id = f"TXN-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(4).upper()}"
    
    # Store payment record
    payment_record = {
        "transaction_id": transaction_id,
        "phone": phone,
        "amount": request.amount,
        "payment_type": request.payment_type,
        "status": "pending",
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat()
    }
    
    if request.member_id:
        payment_record["member_id"] = request.member_id
    if request.group_id:
        payment_record["group_id"] = request.group_id
    
    supabase.table("payments").insert(payment_record).execute()
    
    # Try to initiate STK push if M-Pesa is configured
    checkout_request_id = None
    if MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET:
        try:
            stk_result = await initiate_mpesa_stk_push(phone, request.amount, transaction_id)
            if stk_result.get("success"):
                checkout_request_id = stk_result.get("checkout_request_id")
                # Update payment with checkout request ID
                supabase.table("payments").update({
                    "checkout_request_id": checkout_request_id,
                    "updated_at": datetime.now().isoformat()
                }).eq("transaction_id", transaction_id).execute()
        except Exception as e:
            logger.error(f"STK push failed: {e}")
    
    return {
        "success": True,
        "transaction_id": transaction_id,
        "checkout_request_id": checkout_request_id,
        "message": "Payment initiated. Please check your phone for the M-Pesa prompt."
    }

async def initiate_mpesa_stk_push(phone: str, amount: float, transaction_id: str) -> dict:
    """Initiate M-Pesa STK push."""
    if not requests:
        return {"success": False, "message": "Requests library not available"}
    
    # Get access token
    token = get_mpesa_access_token()
    if not token:
        return {"success": False, "message": "Failed to get M-Pesa access token"}
    
    timestamp = generate_timestamp()
    password = generate_mpesa_password(MPESA_SHORTCODE, MPESA_PASSKEY, timestamp)
    
    payload = {
        "BusinessShortCode": MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": int(amount),
        "PartyA": phone,
        "PartyB": MPESA_SHORTCODE,
        "PhoneNumber": phone,
        "CallBackURL": f"{BASE_URL}/api/public/payment-callback",
        "AccountReference": transaction_id,
        "TransactionDesc": "Masika Benevolent Payment"
    }
    
    try:
        response = requests.post(
            MPESA_STK_PUSH_URL,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get("ResponseCode") == "0":
                return {
                    "success": True,
                    "checkout_request_id": data.get("CheckoutRequestID"),
                    "merchant_request_id": data.get("MerchantRequestID")
                }
        
        return {"success": False, "message": "STK push failed"}
        
    except Exception as e:
        logger.error(f"STK push error: {e}")
        return {"success": False, "message": str(e)}

@public_router.get("/check-payment/{transaction_id}")
async def check_payment_status(transaction_id: str):
    """
    Check the status of a payment.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    result = supabase.table("payments").select("*").eq("transaction_id", transaction_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Payment not found")
    
    payment = result.data[0]
    
    # If still pending and we have a checkout_request_id, query M-Pesa
    if payment.get("status") == "pending" and payment.get("checkout_request_id"):
        try:
            status_result = await query_mpesa_status(payment.get("checkout_request_id"))
            if status_result.get("success"):
                # Update payment status
                supabase.table("payments").update({
                    "status": "completed",
                    "mpesa_receipt": status_result.get("receipt"),
                    "updated_at": datetime.now().isoformat()
                }).eq("transaction_id", transaction_id).execute()
                
                # If payment completed, update member status
                if payment.get("member_id"):
                    supabase.table("members").update({
                        "registration_fee_paid": True,
                        "member_status": "ACTIVE",
                        "updated_at": datetime.now().isoformat()
                    }).eq("id", payment["member_id"]).execute()
                
                return {
                    "status": "completed",
                    "receipt": status_result.get("receipt"),
                    "amount": payment.get("amount")
                }
        except Exception as e:
            logger.error(f"Status query failed: {e}")
    
    return {
        "status": payment.get("status", "pending"),
        "amount": payment.get("amount"),
        "transaction_id": transaction_id
    }

async def query_mpesa_status(checkout_request_id: str) -> dict:
    """Query M-Pesa transaction status."""
    if not requests:
        return {"success": False}
    
    token = get_mpesa_access_token()
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
        response = requests.post(
            MPESA_STK_QUERY_URL,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get("ResultCode") == "0":
                return {
                    "success": True,
                    "receipt": data.get("ReceiptNumber")
                }
        
        return {"success": False}
        
    except Exception as e:
        logger.error(f"Status query error: {e}")
        return {"success": False}

@public_router.post("/payment-callback")
async def payment_callback(request: Request):
    """
    M-Pesa payment callback endpoint.
    """
    try:
        data = await request.json()
        logger.info(f"Payment callback received: {data}")
        
        # Extract transaction details
        body = data.get("Body", {})
        stk_callback = body.get("stkCallback", {})
        
        result_code = stk_callback.get("ResultCode")
        result_desc = stk_callback.get("ResultDesc")
        checkout_request_id = stk_callback.get("CheckoutRequestID")
        callback_metadata = stk_callback.get("CallbackMetadata", {})
        
        if result_code == 0:
            # Payment successful
            mpesa_receipt = None
            amount = None
            
            # Extract from metadata
            items = callback_metadata.get("Item", [])
            for item in items:
                if item.get("Name") == "MpesaReceiptNumber":
                    mpesa_receipt = item.get("Value")
                elif item.get("Name") == "Amount":
                    amount = item.get("Value")
            
            # Update payment record
            update_data = {
                "status": "completed",
                "mpesa_receipt": mpesa_receipt,
                "updated_at": datetime.now().isoformat()
            }
            
            # Find payment by checkout_request_id
            payment_result = supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
            if payment_result.data:
                payment = payment_result.data[0]
                supabase.table("payments").update(update_data).eq("id", payment["id"]).execute()
                
                # Update member if this was a registration
                if payment.get("member_id"):
                    supabase.table("members").update({
                        "registration_fee_paid": True,
                        "member_status": "ACTIVE",
                        "updated_at": datetime.now().isoformat()
                    }).eq("id", payment["member_id"]).execute()
        
        return {"ResultCode": 0, "ResultDesc": "Success"}
        
    except Exception as e:
        logger.error(f"Payment callback error: {e}")
        return {"ResultCode": 1, "ResultDesc": "Failed"}

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
    for dep in member_data.dependants:
        supabase.table("dependants").insert({
            "principal_member_id": new_member["id"],
            "first_name": dep.first_name, "last_name": dep.last_name,
            "relationship": dep.relationship.value, "date_of_birth": dep.date_of_birth,
            "phone": dep.phone, "email": dep.email, "is_active": True,
            "created_at": datetime.now().isoformat()
        }).execute()
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
    active_dependants = supabase.table("dependants").select("count", count="exact").eq("principal_member_id", member_id).eq("is_active", True).execute()
    payments = supabase.table("payments").select("*").eq("member_number", member_number).eq("status", "completed").execute()
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
    result = supabase.table("dependants").insert({
        "principal_member_id": dependant.member_id,
        "first_name": dependant.first_name, "last_name": dependant.last_name,
        "relationship": dependant.relationship.value, "date_of_birth": dependant.date_of_birth,
        "phone": dependant.phone, "email": dependant.email, "is_active": True,
        "created_at": datetime.now().isoformat()
    }).execute()
    return {"success": True, "data": result.data[0] if result.data else None, "message": "Dependant added successfully"}

@dependants_router.put("/{dependant_id}")
async def update_dependant(dependant_id: str, dependant_update: DependantUpdate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    existing = supabase.table("dependants").select("id").eq("id", dependant_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Dependant not found")
    update_data = dependant_update.dict(exclude_unset=True)
    if update_data:
        update_data["updated_at"] = datetime.now().isoformat()
        if "relationship" in update_data and update_data["relationship"]:
            update_data["relationship"] = update_data["relationship"].value
    result = supabase.table("dependants").update(update_data).eq("id", dependant_id).execute()
    return {"success": True, "data": result.data[0] if result.data else None, "message": "Dependant updated successfully"}

@dependants_router.delete("/{dependant_id}")
async def delete_dependant(dependant_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("dependants").update({"deleted_at": datetime.now().isoformat(), "is_active": False}).eq("id", dependant_id).execute()
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
    member_number = member.data[0]["member_number"]
    result = supabase.table("payments").select("*").eq("member_number", member_number).order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return result.data or []

@payments_router.post("/", response_model=PaymentResponse)
async def create_payment(payment: PaymentCreate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("member_number").eq("id", payment.member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    member_number = member.data[0]["member_number"]
    result = supabase.table("payments").insert({
        "member_number": member_number, "amount": payment.amount,
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
    member_number = member.get("member_number")
    dependants = supabase.table("dependants").select("*").eq("principal_member_id", member_id).execute()
    payments = supabase.table("payments").select("*").eq("member_number", member_number).order("created_at", desc=True).limit(5).execute()
    all_payments = supabase.table("payments").select("*").eq("member_number", member_number).eq("status", "completed").execute()
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
    member_number = member.data[0]["member_number"]
    payments = supabase.table("payments").select("*").eq("member_number", member_number).order("created_at", desc=True).limit(limit).execute()
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
