# ============================================================
# APP MAIN - backend/app/main.py
# Complete FastAPI application with all routes and documentation
# ============================================================

from fastapi import FastAPI, HTTPException, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional, List
from datetime import datetime, date, timedelta
import logging
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ============================================================
# CONFIGURATION
# ============================================================

# Supabase Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://wpxzlcdrirlcyvfiquld.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndweHpsY2RyaXJsY3l2ZmlxdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Mjc4MDcsImV4cCI6MjEwMzUwMzgwN30.OUP9pmPbrML_egpHflZtDfLv1_UDM37_BYjtb842xjg")

# Import Supabase
try:
    from supabase import create_client, Client
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ Supabase client initialized successfully")
except Exception as e:
    print(f"❌ Failed to initialize Supabase client: {e}")
    supabase = None

# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================================
# PYDANTIC MODELS
# ============================================================

from pydantic import BaseModel, EmailStr, Field, validator
from enum import Enum

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

# === Request/Response Models ===

class DependantBase(BaseModel):
    first_name: str = Field(..., min_length=2, max_length=50)
    last_name: str = Field(..., min_length=2, max_length=50)
    relationship: RelationshipEnum
    date_of_birth: str
    phone: Optional[str] = None
    email: Optional[EmailStr] = None

class MemberBase(BaseModel):
    first_name: str = Field(..., min_length=2, max_length=50)
    last_name: str = Field(..., min_length=2, max_length=50)
    other_name: Optional[str] = Field(None, max_length=50)
    email: EmailStr
    phone: str
    alternative_phone: Optional[str] = None
    id_number: str = Field(..., min_length=5, max_length=20)
    date_of_birth: str
    gender: GenderEnum
    county: str = Field(..., min_length=2, max_length=50)
    location: Optional[str] = None
    town: Optional[str] = None
    address: Optional[str] = None
    plan: PlanEnum
    benefit_option: BenefitOptionEnum
    sales_code: Optional[str] = None

class MemberCreate(MemberBase):
    password: str = Field(..., min_length=8, max_length=50)
    dependants: List[DependantBase] = []

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

class LoginRequest(BaseModel):
    identifier: str = Field(..., description="Member number (MSK-XXXXXX), username, or email")
    password: str = Field(..., min_length=1)

class LoginResponse(BaseModel):
    success: bool
    user: dict
    message: str
    credentials: Optional[dict] = None

class PaymentCreate(BaseModel):
    amount: float = Field(..., gt=0)
    payment_type: str = Field(..., pattern="^(registration|monthly|topup|addon)$")
    mpesa_receipt: str = Field(..., min_length=1)
    payment_method: str = Field(default="mpesa", pattern="^(mpesa|bank|cash)$")

class PaymentUpdate(BaseModel):
    status: str = Field(..., pattern="^(pending|completed|failed|refunded)$")
    mpesa_receipt: Optional[str] = None

# ============================================================
# SECURITY
# ============================================================

import hashlib
import secrets
import re
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

def hash_password(password: str) -> str:
    """Hash a password using bcrypt"""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)

def generate_member_number() -> str:
    """Generate member number in format MSK-XXXXXX"""
    try:
        # Get the latest member number
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

def find_member_by_identifier(identifier: str) -> Optional[dict]:
    """Find member by member_number, username, or email"""
    if not supabase:
        return None
    
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

# ============================================================
# CREATE FASTAPI APP
# ============================================================

app = FastAPI(
    title="Masika Benevolent API",
    description="""
    ## Masika Benevolent Membership Management API
    
    This API provides comprehensive management for the Masika Benevolent 
    membership system including:
    
    - **Authentication**: Member login, registration, and verification
    - **Members**: Profile management, member lookup
    - **Dependants**: Add, view, and manage family members  
    - **Payments**: Process and track member payments
    - **Dashboard**: Member statistics and summary data
    
    ### Authentication
    Most endpoints require authentication via Bearer token.
    
    ### Rate Limiting
    - 100 requests per minute for authenticated endpoints
    - 20 requests per minute for registration endpoint
    
    ### Error Handling
    All endpoints return consistent error responses:
    ```json
    {
        "detail": "Error message here"
    }
