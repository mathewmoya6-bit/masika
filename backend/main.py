# ============================================================
# MAIN ENTRY POINT - backend/main.py
# Complete Production-Ready FastAPI Application
# Render runs: uvicorn main:app
# ============================================================

import sys
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, status, Query, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional, List, Dict, Any
from datetime import datetime, date, timedelta
import logging
import hashlib
import secrets
import re
import json
import base64
import hmac
from enum import Enum
from contextlib import asynccontextmanager

# ============================================================
# THIRD PARTY IMPORTS
# ============================================================

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
# PYDANTIC IMPORTS
# ============================================================

try:
    from pydantic import BaseModel, EmailStr, Field, validator
except ImportError:
    from pydantic import BaseModel, EmailStr, Field

# ============================================================
# SUPABASE IMPORTS
# ============================================================

try:
    from supabase import create_client, Client
except ImportError:
    print("❌ Supabase not installed. Run: pip install supabase")
    Client = None
    create_client = None

# ============================================================
# LOGGING SETUP
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

# JWT Configuration
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

# === Auth Models ===
class LoginRequest(BaseModel):
    identifier: str = Field(..., description="Member number, username, or email")
    password: str = Field(..., min_length=1)

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
    new_password: str = Field(..., min_length=8, max_length=50)

# === Member Models ===
class MemberBase(BaseModel):
    first_name: str = Field(..., min_length=2, max_length=50)
    last_name: str = Field(..., min_length=2, max_length=50)
    other_name: Optional[str] = Field(None, max_length=50)
    email: EmailStr
    phone: str = Field(..., pattern=r"^(\+254|0)[0-9]{9,10}$")
    alternative_phone: Optional[str] = Field(None, pattern=r"^(\+254|0)[0-9]{9,10}$")
    id_number: str = Field(..., min_length=5, max_length=20)
    date_of_birth: str
    gender: GenderEnum
    county: str = Field(..., min_length=2, max_length=50)
    location: Optional[str] = Field(None, max_length=100)
    town: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None
    plan: PlanEnum
    benefit_option: BenefitOptionEnum
    sales_code: Optional[str] = Field(None, max_length=20)

class MemberCreate(MemberBase):
    password: str = Field(..., min_length=8, max_length=50)
    dependants: List[DependantBase] = []
    accept_terms: bool = Field(True, description="Accept terms and conditions")

class MemberUpdate(BaseModel):
    first_name: Optional[str] = Field(None, min_length=2, max_length=50)
    last_name: Optional[str] = Field(None, min_length=2, max_length=50)
    other_name: Optional[str] = Field(None, max_length=50)
    phone: Optional[str] = Field(None, pattern=r"^(\+254|0)[0-9]{9,10}$")
    alternative_phone: Optional[str] = Field(None, pattern=r"^(\+254|0)[0-9]{9,10}$")
    address: Optional[str] = None
    location: Optional[str] = Field(None, max_length=100)
    town: Optional[str] = Field(None, max_length=50)
    plan: Optional[PlanEnum] = None
    benefit_option: Optional[BenefitOptionEnum] = None

# === Dependant Models ===
class DependantBase(BaseModel):
    first_name: str = Field(..., min_length=2, max_length=50)
    last_name: str = Field(..., min_length=2, max_length=50)
    relationship: RelationshipEnum
    date_of_birth: str
    phone: Optional[str] = Field(None, pattern=r"^(\+254|0)[0-9]{9,10}$")
    email: Optional[EmailStr] = None

class DependantCreate(DependantBase):
    member_id: str

class DependantUpdate(BaseModel):
    first_name: Optional[str] = Field(None, min_length=2, max_length=50)
    last_name: Optional[str] = Field(None, min_length=2, max_length=50)
    relationship: Optional[RelationshipEnum] = None
    date_of_birth: Optional[str] = None
    phone: Optional[str] = Field(None, pattern=r"^(\+254|0)[0-9]{9,10}$")
    email: Optional[EmailStr] = None
    is_active: Optional[bool] = None

# === Payment Models ===
class PaymentCreate(BaseModel):
    amount: float = Field(..., gt=0, description="Amount to pay in KES")
    payment_type: PaymentTypeEnum
    phone: str = Field(..., description="M-Pesa phone number")
    member_id: str = Field(..., description="Member ID")
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

# === STK Push Models ===
class STKPushRequest(BaseModel):
    phone: str = Field(..., description="M-Pesa phone number (2547XXXXXXXX)")
    amount: float = Field(..., gt=0, description="Amount to pay in KES")
    account_reference: str = Field(..., description="Account reference (member number)")
    transaction_desc: str = Field("Payment to Masika Benevolent", description="Transaction description")
    member_id: str = Field(..., description="Member ID")
    payment_type: PaymentTypeEnum = PaymentTypeEnum.REGISTRATION

class STKPushResponse(BaseModel):
    success: bool
    message: str
    checkout_request_id: Optional[str] = None
    merchant_request_id: Optional[str] = None
    response_code: Optional[str] = None

# === Plan Models ===
class PlanResponse(BaseModel):
    slug: str
    name: str
    description: str
    registration_fee: float
    monthly_fee: float
    waiting_period_months: int

# === Agent Models ===
class AgentResponse(BaseModel):
    id: str
    agent_code: str
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    branch: Optional[str] = None
    status: str
    commission_rate: Optional[float] = None

class AgentCreate(BaseModel):
    agent_code: str
    full_name: str
    email: EmailStr
    phone: str
    branch_id: Optional[str] = None
    commission_rate: float = 5.0

# === Branch Models ===
class BranchResponse(BaseModel):
    id: str
    name: str
    code: str
    location: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: bool

# === Dashboard Models ===
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
# SECURITY HELPERS
# ============================================================

security = HTTPBearer()

def hash_password(password: str) -> str:
    """Hash a password using SHA256"""
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return hash_password(plain_password) == hashed_password

def generate_member_number() -> str:
    """Generate member number in format MSK-XXXXXX"""
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
    except Exception as e:
        logger.warning(f"Could not get latest member number: {e}")
    
    return "MSK-000001"

def generate_password() -> str:
    """Generate a secure random password"""
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*"
    return ''.join(secrets.choice(chars) for _ in range(12))

def generate_jwt_token(user_id: str, email: str) -> str:
    """Generate JWT token"""
    if not jwt:
        return secrets.token_urlsafe(32)
    
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_jwt_token(token: str) -> Optional[dict]:
    """Verify JWT token"""
    if not jwt:
        return None
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get current user from JWT token"""
    token = credentials.credentials
    payload = verify_jwt_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return user_id

# ============================================================
# DATABASE HELPER FUNCTIONS
# ============================================================

def find_member_by_identifier(identifier: str) -> Optional[dict]:
    """Find member by member_number, username, or email"""
    if not supabase:
        return None
    
    try:
        # Try by member_number
        result = supabase.table("members").select("*").eq("member_number", identifier).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        
        # Try by username
        result = supabase.table("members").select("*").eq("username", identifier).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        
        # Try by email
        result = supabase.table("members").select("*").ilike("email", identifier).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        
        return None
    except Exception as e:
        logger.error(f"Error finding member: {e}")
        return None

def find_member_by_id(member_id: str) -> Optional[dict]:
    """Find member by ID"""
    if not supabase:
        return None
    
    try:
        result = supabase.table("members").select("*").eq("id", member_id).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        logger.error(f"Error finding member by ID: {e}")
        return None

def get_member_safe(member: dict) -> dict:
    """Remove sensitive fields from member dict"""
    return {k: v for k, v in member.items() 
            if k not in ["password_hash", "temp_password"]}

# ============================================================
# M-PESA HELPER FUNCTIONS
# ============================================================

def get_mpesa_access_token() -> Optional[str]:
    """Get M-Pesa access token"""
    if not requests:
        logger.error("requests module not available. M-Pesa features disabled.")
        return None
    
    if not MPESA_CONSUMER_KEY or not MPESA_CONSUMER_SECRET:
        logger.error("M-Pesa credentials not configured")
        return None
    
    try:
        auth = base64.b64encode(
            f"{MPESA_CONSUMER_KEY}:{MPESA_CONSUMER_SECRET}".encode()
        ).decode()
        
        headers = {
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/json"
        }
        
        response = requests.get(MPESA_AUTH_URL, headers=headers, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            return data.get("access_token")
        else:
            logger.error(f"Failed to get access token: {response.text}")
            return None
    except Exception as e:
        logger.error(f"Error getting access token: {e}")
        return None

def generate_mpesa_password(shortcode: str, passkey: str, timestamp: str) -> str:
    """Generate M-Pesa password"""
    data = f"{shortcode}{passkey}{timestamp}"
    return base64.b64encode(data.encode()).decode()

def generate_timestamp() -> str:
    """Generate M-Pesa timestamp"""
    return datetime.now().strftime("%Y%m%d%H%M%S")

def format_phone_number(phone: str) -> str:
    """Format phone number for M-Pesa (2547XXXXXXXX)"""
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
    """Lifespan context manager for startup/shutdown events"""
    logger.info("🚀 Starting Masika Benevolent API...")
    if supabase:
        try:
            result = supabase.table("members").select("count", count="exact").limit(1).execute()
            logger.info("✅ Database connection successful")
        except Exception as e:
            logger.error(f"❌ Database connection failed: {e}")
    yield
    logger.info("🛑 Shutting down Masika Benevolent API...")

app = FastAPI(
    title="Masika Benevolent API",
    description="""
    ## Masika Benevolent Membership Management System
    
    ### Features
    - Member Registration & Management
    - Dependant Management
    - Payment Processing with M-Pesa
    - Dashboard Analytics
    - Agent & Branch Management
    
    ### Authentication
    Most endpoints require Bearer token authentication.
    
    ### M-Pesa Integration
    - STK Push for payments
    - Callback handling for payment confirmation
    - Payment status query
    """,
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan
)

# ============================================================
# CORS CONFIGURATION
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:8000",
        "https://masika.co.ke",
        "https://*.masika.co.ke",
        "https://masika-c921.onrender.com",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-Page", "X-Limit"],
)

# ============================================================
# ROOT ENDPOINTS
# ============================================================

@app.get("/", tags=["Root"])
async def root():
    return {
        "service": "Masika Benevolent API",
        "version": "2.0.0",
        "status": "healthy",
        "docs": "/api/docs",
        "redoc": "/api/redoc",
        "openapi": "/api/openapi.json"
    }

@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "service": "masika-benevolent-api",
        "version": "2.0.0",
        "database": "connected" if supabase else "disconnected",
        "mpesa": "configured" if MPESA_CONSUMER_KEY else "not configured",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/api", tags=["Root"])
async def api_info():
    return {
        "name": "Masika Benevolent API",
        "version": "2.0.0",
        "description": "Complete membership management system with M-Pesa",
        "endpoints": {
            "auth": {
                "login": "POST /api/auth/login",
                "register": "POST /api/auth/register",
                "verify": "POST /api/auth/verify",
                "refresh": "POST /api/auth/refresh",
                "logout": "POST /api/auth/logout",
                "me": "GET /api/auth/me",
                "forgot-password": "POST /api/auth/forgot-password",
                "reset-password": "POST /api/auth/reset-password"
            },
            "public": {
                "plans": "GET /api/public/plans",
                "agents": "GET /api/public/agents",
                "branches": "GET /api/public/branches"
            },
            "members": {
                "list": "GET /api/members",
                "get": "GET /api/members/{member_id}",
                "by_number": "GET /api/members/by-number/{member_number}",
                "update": "PUT /api/members/{member_id}",
                "stats": "GET /api/members/{member_id}/stats"
            },
            "dependants": {
                "list": "GET /api/dependants/member/{member_id}",
                "create": "POST /api/dependants",
                "get": "GET /api/dependants/{dependant_id}",
                "update": "PUT /api/dependants/{dependant_id}",
                "delete": "DELETE /api/dependants/{dependant_id}"
            },
            "payments": {
                "list": "GET /api/payments/member/{member_id}",
                "create": "POST /api/payments",
                "update": "PUT /api/payments/{payment_id}"
            },
            "mpesa": {
                "stk_push": "POST /api/mpesa/stk-push",
                "stk_query": "GET /api/mpesa/stk-query/{checkout_request_id}",
                "callback": "POST /api/mpesa/callback"
            },
            "dashboard": {
                "summary": "GET /api/dashboard/summary/{member_id}",
                "recent": "GET /api/dashboard/recent/{member_id}"
            }
        }
    }

# ============================================================
# PUBLIC ROUTES
# ============================================================

public_router = APIRouter(prefix="/api/public", tags=["Public"])

@public_router.get("/plans", response_model=List[PlanResponse])
async def get_public_plans():
    """Get all available membership plans for registration"""
    plans = [
        {
            "slug": "comfort",
            "name": "Comfort Plan",
            "description": "Affordable individual membership protection for you and your family.",
            "registration_fee": 200.00,
            "monthly_fee": 300.00,
            "waiting_period_months": 4
        },
        {
            "slug": "dignity",
            "name": "Dignity Plan",
            "description": "Enhanced membership protection with premium benefits for your entire family.",
            "registration_fee": 300.00,
            "monthly_fee": 1000.00,
            "waiting_period_months": 6
        },
        {
            "slug": "wazazi",
            "name": "Wazazi Plan",
            "description": "Membership protection specifically designed for parents and elders.",
            "registration_fee": 250.00,
            "monthly_fee": 350.00,
            "waiting_period_months": 6
        }
    ]
    return plans

@public_router.get("/agents", response_model=List[AgentResponse])
async def get_public_agents(
    branch_id: Optional[str] = Query(None, description="Filter agents by branch")
):
    """Get all active sales agents"""
    if not supabase:
        return []
    
    try:
        query = supabase.table("sales_agents").select("*").eq("status", "active")
        if branch_id:
            query = query.eq("branch_id", branch_id)
        
        result = query.execute()
        
        agents = []
        if result.data:
            for agent in result.data:
                agents.append({
                    "id": agent.get("id"),
                    "agent_code": agent.get("agent_code", ""),
                    "full_name": agent.get("full_name", ""),
                    "email": agent.get("email"),
                    "phone": agent.get("phone"),
                    "branch": agent.get("branch"),
                    "status": agent.get("status", "active"),
                    "commission_rate": agent.get("commission_rate", 5.0)
                })
        
        return agents
    except Exception as e:
        logger.error(f"Error fetching agents: {e}")
        return []

@public_router.get("/branches", response_model=List[BranchResponse])
async def get_public_branches():
    """Get all branches"""
    if not supabase:
        return [
            {"id": "1", "name": "Nairobi", "code": "NBO", "location": "Nairobi CBD", "phone": "0712345678", "email": "nairobi@masika.co.ke", "is_active": True},
            {"id": "2", "name": "Mombasa", "code": "MBS", "location": "Mombasa CBD", "phone": "0712345679", "email": "mombasa@masika.co.ke", "is_active": True},
            {"id": "3", "name": "Kisumu", "code": "KSM", "location": "Kisumu CBD", "phone": "0712345680", "email": "kisumu@masika.co.ke", "is_active": True},
            {"id": "4", "name": "Nakuru", "code": "NKR", "location": "Nakuru CBD", "phone": "0712345681", "email": "nakuru@masika.co.ke", "is_active": True},
            {"id": "5", "name": "Eldoret", "code": "ELD", "location": "Eldoret CBD", "phone": "0712345682", "email": "eldoret@masika.co.ke", "is_active": True}
        ]
    
    try:
        result = supabase.table("branches").select("*").eq("is_active", True).execute()
        if result.data:
            return result.data
        return []
    except Exception as e:
        logger.error(f"Error fetching branches: {e}")
        return []

app.include_router(public_router)

# ============================================================
# AUTHENTICATION ROUTES
# ============================================================

auth_router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@auth_router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """Login with member number, username, or email"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        member = find_member_by_identifier(request.identifier)
        if not member:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        password_hash = member.get("password_hash")
        temp_password = member.get("temp_password")
        
        if password_hash and verify_password(request.password, password_hash):
            pass
        elif temp_password and request.password == temp_password:
            pass
        else:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        # Update last login
        supabase.table("members").update({
            "last_login": datetime.now().isoformat()
        }).eq("id", member["id"]).execute()
        
        # Generate token
        token = generate_jwt_token(member["id"], member["email"])
        refresh_token = secrets.token_urlsafe(32)
        
        safe_member = get_member_safe(member)
        
        return LoginResponse(
            success=True,
            user=safe_member,
            message="Login successful",
            token=token,
            refresh_token=refresh_token
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@auth_router.post("/register")
async def register(member_data: MemberCreate):
    """Register a new member with auto-generated credentials"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        # Check if email exists
        existing = supabase.table("members").select("email").eq("email", member_data.email).execute()
        if existing.data and len(existing.data) > 0:
            raise ValueError("Email already registered")
        
        # Check if ID exists
        existing = supabase.table("members").select("id_number").eq("id_number", member_data.id_number).execute()
        if existing.data and len(existing.data) > 0:
            raise ValueError("ID number already registered")
        
        # Generate credentials
        member_number = generate_member_number()
        password = generate_password()
        password_hash = hash_password(password)
        username = member_number
        
        # Get waiting period based on plan
        waiting_periods = {
            "comfort": 4,
            "dignity": 6,
            "wazazi": 6
        }
        waiting_period = waiting_periods.get(member_data.plan.value, 4)
        
        member_record = {
            "member_number": member_number,
            "username": username,
            "first_name": member_data.first_name,
            "last_name": member_data.last_name,
            "other_name": member_data.other_name,
            "email": member_data.email,
            "phone": member_data.phone,
            "alternative_phone": member_data.alternative_phone,
            "id_number": member_data.id_number,
            "date_of_birth": member_data.date_of_birth,
            "gender": member_data.gender.value,
            "county": member_data.county,
            "location": member_data.location,
            "town": member_data.town,
            "address": member_data.address,
            "plan": member_data.plan.value,
            "benefit_option": member_data.benefit_option.value,
            "sales_code": member_data.sales_code,
            "password_hash": password_hash,
            "temp_password": password,
            "member_status": "PENDING",
            "is_active": True,
            "registration_date": datetime.now().date().isoformat(),
            "waiting_period_months": waiting_period,
            "registration_fee_paid": False,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        result = supabase.table("members").insert(member_record).execute()
        if not result.data or len(result.data) == 0:
            raise ValueError("Failed to create member")
        
        new_member = result.data[0]
        
        # Insert dependants
        for dep in member_data.dependants:
            dep_record = {
                "principal_member_id": new_member["id"],
                "first_name": dep.first_name,
                "last_name": dep.last_name,
                "relationship": dep.relationship.value,
                "date_of_birth": dep.date_of_birth,
                "phone": dep.phone,
                "email": dep.email,
                "is_active": True,
                "created_at": datetime.now().isoformat()
            }
            supabase.table("dependants").insert(dep_record).execute()
        
        return {
            "success": True,
            "member": {
                "id": new_member["id"],
                "member_number": new_member["member_number"],
                "username": new_member["username"],
                "first_name": new_member["first_name"],
                "last_name": new_member["last_name"],
                "email": new_member["email"],
                "phone": new_member["phone"],
                "plan": new_member["plan"],
                "member_status": new_member["member_status"]
            },
            "credentials": {
                "member_number": member_number,
                "username": username,
                "password": password
            },
            "message": "Registration successful. Please save your credentials."
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Registration error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@auth_router.post("/verify")
async def verify_member(identifier: str):
    """Verify if a member exists"""
    try:
        member = find_member_by_identifier(identifier)
        if not member:
            raise HTTPException(status_code=404, detail="Member not found")
        
        return {
            "success": True,
            "member": {
                "id": member.get("id"),
                "member_number": member.get("member_number"),
                "username": member.get("username"),
                "email": member.get("email"),
                "first_name": member.get("first_name"),
                "last_name": member.get("last_name"),
                "plan": member.get("plan"),
                "member_status": member.get("member_status")
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@auth_router.post("/refresh")
async def refresh_token(request: RefreshTokenRequest):
    """Refresh access token"""
    try:
        new_token = secrets.token_urlsafe(32)
        return {
            "success": True,
            "token": new_token,
            "message": "Token refreshed successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@auth_router.post("/logout")
async def logout():
    """Logout endpoint (client-side cleanup required)"""
    return {
        "success": True,
        "message": "Logged out successfully. Please clear your local token."
    }

@auth_router.get("/me")
async def get_current_user(user_id: str = Depends(get_current_user)):
    """Get current authenticated user"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("members").select("*").eq("id", user_id).execute()
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail="User not found")
        
        member = result.data[0]
        return get_member_safe(member)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@auth_router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    """Send password reset email"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("members").select("id", "email").eq("email", request.email).execute()
        if not result.data or len(result.data) == 0:
            return {"success": True, "message": "If your email is registered, you will receive a reset link"}
        
        reset_token = secrets.token_urlsafe(32)
        logger.info(f"Password reset requested for {request.email}. Token: {reset_token}")
        
        return {
            "success": True,
            "message": "Password reset instructions sent to your email",
            "reset_token": reset_token
        }
    except Exception as e:
        logger.error(f"Forgot password error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@auth_router.post("/reset-password")
async def reset_password(request: ResetPasswordRequest):
    """Reset password using token"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("members").select("id").eq("reset_token", request.token).execute()
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=400, detail="Invalid or expired reset token")
        
        member = result.data[0]
        
        password_hash = hash_password(request.new_password)
        supabase.table("members").update({
            "password_hash": password_hash,
            "temp_password": None,
            "updated_at": datetime.now().isoformat()
        }).eq("id", member["id"]).execute()
        
        return {
            "success": True,
            "message": "Password reset successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

app.include_router(auth_router)

# ============================================================
# MEMBERS ROUTES
# ============================================================

members_router = APIRouter(prefix="/api/members", tags=["Members"])

@members_router.get("/", response_model=List[MemberResponse])
async def list_members(
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    status: Optional[str] = Query(None, description="Filter by status"),
    plan: Optional[str] = Query(None, description="Filter by plan"),
    search: Optional[str] = Query(None, description="Search by name, email, or member number"),
    user_id: str = Depends(get_current_user)
):
    """List all members (admin only)"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        query = supabase.table("members").select("*", count="exact")
        
        if status:
            query = query.eq("member_status", status)
        if plan:
            query = query.eq("plan", plan)
        if search:
            query = query.or_(f"first_name.ilike.%{search}%,last_name.ilike.%{search}%,email.ilike.%{search}%,member_number.ilike.%{search}%")
        
        offset = (page - 1) * limit
        query = query.range(offset, offset + limit - 1).order("created_at", desc=True)
        
        result = query.execute()
        
        members = []
        if result.data:
            for member in result.data:
                members.append(get_member_safe(member))
        
        return members
    except Exception as e:
        logger.error(f"List members error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

@members_router.get("/{member_id}", response_model=MemberResponse)
async def get_member(member_id: str):
    """Get member by ID"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("members").select("*").eq("id", member_id).execute()
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        return get_member_safe(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@members_router.get("/by-number/{member_number}", response_model=MemberResponse)
async def get_member_by_number(member_number: str):
    """Get member by member number"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("members").select("*").eq("member_number", member_number).execute()
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        return get_member_safe(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@members_router.put("/{member_id}", response_model=MemberResponse)
async def update_member(member_id: str, member_update: MemberUpdate):
    """Update member details"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        existing = supabase.table("members").select("id").eq("id", member_id).execute()
        if not existing.data or len(existing.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        update_data = member_update.dict(exclude_unset=True)
        if update_data:
            update_data["updated_at"] = datetime.now().isoformat()
            
            if "plan" in update_data and update_data["plan"]:
                update_data["plan"] = update_data["plan"].value
            if "benefit_option" in update_data and update_data["benefit_option"]:
                update_data["benefit_option"] = update_data["benefit_option"].value
        
        result = supabase.table("members").update(update_data).eq("id", member_id).execute()
        
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        return get_member_safe(result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@members_router.get("/{member_id}/stats", response_model=DashboardStats)
async def get_member_stats(member_id: str):
    """Get member statistics"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        member = supabase.table("members").select("*").eq("id", member_id).execute()
        if not member.data or len(member.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        member = member.data[0]
        member_number = member.get("member_number")
        
        dependants = supabase.table("dependants").select("count", count="exact").eq("principal_member_id", member_id).execute()
        active_dependants = supabase.table("dependants").select("count", count="exact").eq("principal_member_id", member_id).eq("is_active", True).execute()
        
        payments = supabase.table("payments").select("*").eq("member_number", member_number).eq("status", "completed").execute()
        total_payments = sum(float(p.get("amount", 0)) for p in (payments.data or []))
        
        last_payment = supabase.table("payments").select("payment_date").eq("member_number", member_number).eq("status", "completed").order("payment_date", desc=True).limit(1).execute()
        last_payment_date = last_payment.data[0].get("payment_date") if last_payment.data and len(last_payment.data) > 0 else None
        
        waiting_months = member.get("waiting_period_months", 4)
        reg_date = member.get("registration_date")
        coverage_status = "Pending"
        if reg_date:
            reg_date = datetime.fromisoformat(reg_date) if isinstance(reg_date, str) else reg_date
            wait_end = reg_date + timedelta(days=waiting_months * 30)
            coverage_status = "Active" if datetime.now() >= wait_end else "Waiting"
        
        return DashboardStats(
            member_id=member.get("id"),
            member_number=member.get("member_number"),
            plan=member.get("plan"),
            benefit_option=member.get("benefit_option"),
            dependants_count=dependants.count or 0,
            payments_count=len(payments.data or []),
            total_payments=total_payments,
            last_payment_date=last_payment_date,
            coverage_status=coverage_status,
            registration_date=member.get("registration_date"),
            waiting_period_months=member.get("waiting_period_months"),
            active_dependants=active_dependants.count or 0
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

app.include_router(members_router)

# ============================================================
# DEPENDANTS ROUTES
# ============================================================

dependants_router = APIRouter(prefix="/api/dependants", tags=["Dependants"])

@dependants_router.get("/member/{member_id}")
async def get_dependants(member_id: str):
    """Get all dependants for a member"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("dependants").select("*").eq("principal_member_id", member_id).order("created_at", desc=True).execute()
        return {
            "success": True,
            "data": result.data or [],
            "count": len(result.data or [])
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@dependants_router.get("/{dependant_id}")
async def get_dependant(dependant_id: str):
    """Get a specific dependant"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("dependants").select("*").eq("id", dependant_id).execute()
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail="Dependant not found")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@dependants_router.post("/")
async def create_dependant(dependant: DependantCreate):
    """Add a dependant to a member"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        member = supabase.table("members").select("id").eq("id", dependant.member_id).execute()
        if not member.data or len(member.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        dep_record = {
            "principal_member_id": dependant.member_id,
            "first_name": dependant.first_name,
            "last_name": dependant.last_name,
            "relationship": dependant.relationship.value,
            "date_of_birth": dependant.date_of_birth,
            "phone": dependant.phone,
            "email": dependant.email,
            "is_active": True,
            "created_at": datetime.now().isoformat()
        }
        
        result = supabase.table("dependants").insert(dep_record).execute()
        return {
            "success": True,
            "data": result.data[0] if result.data else None,
            "message": "Dependant added successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@dependants_router.put("/{dependant_id}")
async def update_dependant(dependant_id: str, dependant_update: DependantUpdate):
    """Update a dependant"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        existing = supabase.table("dependants").select("id").eq("id", dependant_id).execute()
        if not existing.data or len(existing.data) == 0:
            raise HTTPException(status_code=404, detail="Dependant not found")
        
        update_data = dependant_update.dict(exclude_unset=True)
        if update_data:
            update_data["updated_at"] = datetime.now().isoformat()
            if "relationship" in update_data and update_data["relationship"]:
                update_data["relationship"] = update_data["relationship"].value
        
        result = supabase.table("dependants").update(update_data).eq("id", dependant_id).execute()
        
        return {
            "success": True,
            "data": result.data[0] if result.data else None,
            "message": "Dependant updated successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@dependants_router.delete("/{dependant_id}")
async def delete_dependant(dependant_id: str):
    """Delete a dependant (soft delete)"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("dependants").update({
            "deleted_at": datetime.now().isoformat(),
            "is_active": False
        }).eq("id", dependant_id).execute()
        
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail="Dependant not found")
        
        return {
            "success": True,
            "message": "Dependant removed successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

app.include_router(dependants_router)

# ============================================================
# PAYMENTS ROUTES
# ============================================================

payments_router = APIRouter(prefix="/api/payments", tags=["Payments"])

@payments_router.get("/member/{member_id}", response_model=List[PaymentResponse])
async def get_member_payments(
    member_id: str,
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0)
):
    """Get all payments for a member"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        member = supabase.table("members").select("member_number").eq("id", member_id).execute()
        if not member.data or len(member.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        member_number = member.data[0]["member_number"]
        
        result = supabase.table("payments").select("*")\
            .eq("member_number", member_number)\
            .order("created_at", desc=True)\
            .range(offset, offset + limit - 1)\
            .execute()
        
        return result.data or []
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@payments_router.get("/{payment_id}")
async def get_payment(payment_id: str):
    """Get a specific payment"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("payments").select("*").eq("id", payment_id).execute()
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail="Payment not found")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@payments_router.post("/", response_model=PaymentResponse)
async def create_payment(payment: PaymentCreate):
    """Create a new payment for a member"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        member = supabase.table("members").select("member_number").eq("id", payment.member_id).execute()
        if not member.data or len(member.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        member_number = member.data[0]["member_number"]
        
        payment_record = {
            "member_number": member_number,
            "amount": payment.amount,
            "payment_type": payment.payment_type.value,
            "payment_method": "mpesa",
            "mpesa_receipt": None,
            "status": "pending",
            "payment_date": datetime.now().date().isoformat(),
            "phone": payment.phone,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        result = supabase.table("payments").insert(payment_record).execute()
        
        return result.data[0] if result.data else None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@payments_router.put("/{payment_id}")
async def update_payment(payment_id: str, payment_update: PaymentUpdate):
    """Update payment status"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        update_data = payment_update.dict(exclude_unset=True)
        update_data["updated_at"] = datetime.now().isoformat()
        
        result = supabase.table("payments").update(update_data).eq("id", payment_id).execute()
        
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail="Payment not found")
        
        if payment_update.status == PaymentStatusEnum.COMPLETED:
            payment = result.data[0]
            member_number = payment.get("member_number")
            if member_number:
                member = supabase.table("members").select("*").eq("member_number", member_number).execute()
                if member.data and len(member.data) > 0:
                    supabase.table("members").update({
                        "registration_fee_paid": True,
                        "member_status": "ACTIVE",
                        "updated_at": datetime.now().isoformat()
                    }).eq("id", member.data[0]["id"]).execute()
        
        return {
            "success": True,
            "data": result.data[0],
            "message": "Payment updated successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

app.include_router(payments_router)

# ============================================================
# M-PESA ROUTES
# ============================================================

mpesa_router = APIRouter(prefix="/api/mpesa", tags=["M-Pesa"])

@mpesa_router.post("/stk-push", response_model=STKPushResponse)
async def initiate_stk_push(request: STKPushRequest):
    """Initiate M-Pesa STK Push payment"""
    if not MPESA_CONSUMER_KEY or not MPESA_CONSUMER_SECRET:
        raise HTTPException(
            status_code=500,
            detail="M-Pesa is not configured. Please check your environment variables."
        )
    
    access_token = get_mpesa_access_token()
    if not access_token:
        raise HTTPException(
            status_code=500,
            detail="Failed to get M-Pesa access token. Please try again later."
        )
    
    phone = format_phone_number(request.phone)
    if len(phone) != 12 or not phone.startswith('254'):
        raise HTTPException(
            status_code=400,
            detail="Invalid phone number. Please use format 2547XXXXXXXX"
        )
    
    timestamp = generate_timestamp()
    password = generate_mpesa_password(MPESA_SHORTCODE, MPESA_PASSKEY, timestamp)
    
    payload = {
        "BusinessShortCode": MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": int(request.amount),
        "PartyA": phone,
        "PartyB": MPESA_SHORTCODE,
        "PhoneNumber": phone,
        "CallBackURL": f"{BASE_URL}/api/mpesa/callback",
        "AccountReference": request.account_reference[:12],
        "TransactionDesc": request.transaction_desc[:36]
    }
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    try:
        if not requests:
            raise HTTPException(
                status_code=500,
                detail="requests module not available for M-Pesa integration."
            )
        
        response = requests.post(MPESA_STK_PUSH_URL, json=payload, headers=headers, timeout=30)
        response_data = response.json()
        
        logger.info(f"STK Push response: {response_data}")
        
        if response_data.get("ResponseCode") == "0":
            checkout_request_id = response_data.get("CheckoutRequestID")
            merchant_request_id = response_data.get("MerchantRequestID")
            
            if supabase:
                try:
                    member = find_member_by_id(request.member_id)
                    if member:
                        payment_record = {
                            "member_number": member.get("member_number"),
                            "amount": request.amount,
                            "payment_type": request.payment_type.value,
                            "payment_method": "mpesa",
                            "status": "pending",
                            "checkout_request_id": checkout_request_id,
                            "merchant_request_id": merchant_request_id,
                            "phone": phone,
                            "payment_date": datetime.now().date().isoformat(),
                            "created_at": datetime.now().isoformat(),
                            "updated_at": datetime.now().isoformat()
                        }
                        supabase.table("payments").insert(payment_record).execute()
                        logger.info(f"Payment record created with CheckoutRequestID: {checkout_request_id}")
                except Exception as e:
                    logger.error(f"Failed to store payment record: {e}")
            
            return STKPushResponse(
                success=True,
                message="STK Push initiated successfully. Please check your phone for the M-Pesa prompt.",
                checkout_request_id=checkout_request_id,
                merchant_request_id=merchant_request_id,
                response_code="0"
            )
        else:
            return STKPushResponse(
                success=False,
                message=response_data.get("ResponseDescription", "STK Push failed"),
                response_code=response_data.get("ResponseCode")
            )
            
    except requests.exceptions.RequestException as e:
        logger.error(f"STK Push request error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to initiate STK Push. Please try again later."
        )
    except Exception as e:
        logger.error(f"STK Push error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"STK Push error: {str(e)}"
        )

@mpesa_router.get("/stk-query/{checkout_request_id}")
async def query_stk_status(checkout_request_id: str):
    """Query the status of an STK Push transaction"""
    if not MPESA_CONSUMER_KEY or not MPESA_CONSUMER_SECRET:
        raise HTTPException(
            status_code=500,
            detail="M-Pesa is not configured."
        )
    
    access_token = get_mpesa_access_token()
    if not access_token:
        raise HTTPException(
            status_code=500,
            detail="Failed to get M-Pesa access token."
        )
    
    timestamp = generate_timestamp()
    password = generate_mpesa_password(MPESA_SHORTCODE, MPESA_PASSKEY, timestamp)
    
    payload = {
        "BusinessShortCode": MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "CheckoutRequestID": checkout_request_id
    }
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    try:
        if not requests:
            raise HTTPException(
                status_code=500,
                detail="requests module not available for M-Pesa integration."
            )
        
        response = requests.post(MPESA_STK_QUERY_URL, json=payload, headers=headers, timeout=30)
        response_data = response.json()
        
        logger.info(f"STK Query response: {response_data}")
        
        if supabase:
            try:
                result = supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
                if result.data and len(result.data) > 0:
                    payment = result.data[0]
                    status = "pending"
                    if response_data.get("ResultCode") == "0":
                        status = "completed"
                    elif response_data.get("ResultCode") == "1032":
                        status = "failed"
                    
                    supabase.table("payments").update({
                        "status": status,
                        "result_code": response_data.get("ResultCode"),
                        "result_desc": response_data.get("ResultDesc"),
                        "updated_at": datetime.now().isoformat()
                    }).eq("id", payment["id"]).execute()
                    
                    if status == "completed":
                        member_number = payment.get("member_number")
                        if member_number:
                            member = supabase.table("members").select("*").eq("member_number", member_number).execute()
                            if member.data and len(member.data) > 0:
                                supabase.table("members").update({
                                    "registration_fee_paid": True,
                                    "updated_at": datetime.now().isoformat()
                                }).eq("id", member.data[0]["id"]).execute()
            except Exception as e:
                logger.error(f"Failed to update payment status: {e}")
        
        return {
            "success": True,
            "data": response_data,
            "checkout_request_id": checkout_request_id
        }
        
    except requests.exceptions.RequestException as e:
        logger.error(f"STK Query request error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to query STK status."
        )
    except Exception as e:
        logger.error(f"STK Query error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"STK Query error: {str(e)}"
        )

@mpesa_router.post("/callback")
async def mpesa_callback(request: Request):
    """M-Pesa callback endpoint"""
    try:
        callback_data = await request.json()
        logger.info(f"M-Pesa Callback received")
        
        body = callback_data.get("Body", {})
        stk_callback = body.get("stkCallback", {})
        
        result_code = stk_callback.get("ResultCode")
        result_desc = stk_callback.get("ResultDesc")
        checkout_request_id = stk_callback.get("CheckoutRequestID")
        
        callback_metadata = stk_callback.get("CallbackMetadata", {})
        items = callback_metadata.get("Item", [])
        
        amount = None
        mpesa_receipt = None
        
        for item in items:
            name = item.get("Name")
            value = item.get("Value")
            
            if name == "Amount":
                amount = value
            elif name == "MpesaReceiptNumber":
                mpesa_receipt = value
        
        if supabase and checkout_request_id:
            try:
                result = supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
                
                if result.data and len(result.data) > 0:
                    payment = result.data[0]
                    status = "completed" if result_code == "0" else "failed"
                    
                    update_data = {
                        "status": status,
                        "result_code": result_code,
                        "result_desc": result_desc,
                        "updated_at": datetime.now().isoformat()
                    }
                    
                    if mpesa_receipt:
                        update_data["mpesa_receipt"] = mpesa_receipt
                    if amount:
                        update_data["amount"] = amount
                    
                    supabase.table("payments").update(update_data).eq("id", payment["id"]).execute()
                    
                    if status == "completed":
                        member_number = payment.get("member_number")
                        if member_number:
                            member_result = supabase.table("members").select("*").eq("member_number", member_number).execute()
                            if member_result.data and len(member_result.data) > 0:
                                member = member_result.data[0]
                                supabase.table("members").update({
                                    "registration_fee_paid": True,
                                    "member_status": "ACTIVE",
                                    "updated_at": datetime.now().isoformat()
                                }).eq("id", member["id"]).execute()
                                
                                logger.info(f"Member {member_number} activated after successful payment")
                    
                    logger.info(f"Payment updated: {checkout_request_id} -> {status}")
            except Exception as e:
                logger.error(f"Failed to update payment from callback: {e}")
        
        return {"ResultCode": 0, "ResultDesc": "Success"}
        
    except Exception as e:
        logger.error(f"Callback processing error: {e}")
        return {"ResultCode": 0, "ResultDesc": "Success"}

app.include_router(mpesa_router)

# ============================================================
# DASHBOARD ROUTES
# ============================================================

dashboard_router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

@dashboard_router.get("/summary/{member_id}")
async def get_dashboard_summary(member_id: str):
    """Get complete dashboard summary for a member"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        member = supabase.table("members").select("*").eq("id", member_id).execute()
        if not member.data or len(member.data) == 0:
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
        
        safe_member = get_member_safe(member)
        
        return {
            "success": True,
            "member": safe_member,
            "dependants": dependants.data or [],
            "dependants_count": len(dependants.data or []),
            "recent_payments": payments.data or [],
            "total_payments": total_payments,
            "coverage_status": coverage_status
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@dashboard_router.get("/recent/{member_id}")
async def get_recent_activity(member_id: str, limit: int = 5):
    """Get recent activity for a member"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        member = supabase.table("members").select("member_number").eq("id", member_id).execute()
        if not member.data or len(member.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        member_number = member.data[0]["member_number"]
        
        payments = supabase.table("payments").select("*").eq("member_number", member_number).order("created_at", desc=True).limit(limit).execute()
        dependants = supabase.table("dependants").select("*").eq("principal_member_id", member_id).order("created_at", desc=True).limit(limit).execute()
        
        return {
            "success": True,
            "recent_payments": payments.data or [],
            "recent_dependants": dependants.data or []
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

app.include_router(dashboard_router)

# ============================================================
# THIS IS WHAT UVICORN WILL IMPORT AS "main:app"
# ============================================================
