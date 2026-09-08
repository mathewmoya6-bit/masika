# ============================================================
# MAIN ENTRY POINT - backend/main.py
# Render runs: uvicorn main:app
# ============================================================

import sys
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from typing import Optional, List
from datetime import datetime, date, timedelta
import logging
import hashlib
import secrets
import re
from enum import Enum

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

# ============================================================
# PYDANTIC MODELS
# ============================================================

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
    identifier: str
    password: str

class LoginResponse(BaseModel):
    success: bool
    user: dict
    message: str
    credentials: Optional[dict] = None

class PaymentCreate(BaseModel):
    amount: float
    payment_type: str
    mpesa_receipt: str
    payment_method: str = "mpesa"

class PaymentUpdate(BaseModel):
    status: str
    mpesa_receipt: Optional[str] = None

# ============================================================
# HELPER FUNCTIONS
# ============================================================

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

# ============================================================
# CREATE FASTAPI APP
# ============================================================

app = FastAPI(
    title="Masika Benevolent API",
    description="Masika Benevolent Membership Management System",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

# ============================================================
# CORS CONFIGURATION
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
    return {
        "service": "Masika Benevolent API",
        "version": "2.0.0",
        "status": "healthy",
        "docs": "/api/docs"
    }

@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "service": "masika-benevolent-api",
        "version": "2.0.0",
        "database": "connected" if supabase else "disconnected"
    }

# ============================================================
# AUTH ROUTES
# ============================================================

from fastapi import APIRouter

auth_router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@auth_router.post("/login")
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
        
        supabase.table("members").update({
            "last_login": datetime.now().isoformat()
        }).eq("id", member["id"]).execute()
        
        safe_member = {k: v for k, v in member.items() 
                      if k not in ["password_hash", "temp_password"]}
        
        return {
            "success": True,
            "user": safe_member,
            "message": "Login successful"
        }
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
            "waiting_period_months": 6 if member_data.plan == PlanEnum.DIGNITY else 4,
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
            "message": "Registration successful"
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
                "last_name": member.get("last_name")
            }
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

@members_router.get("/{member_id}")
async def get_member(member_id: str):
    """Get member by ID"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("members").select("*").eq("id", member_id).execute()
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        member = result.data[0]
        safe_member = {k: v for k, v in member.items() 
                      if k not in ["password_hash", "temp_password"]}
        return safe_member
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@members_router.get("/by-number/{member_number}")
async def get_member_by_number(member_number: str):
    """Get member by member number"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        result = supabase.table("members").select("*").eq("member_number", member_number).execute()
        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        member = result.data[0]
        safe_member = {k: v for k, v in member.items() 
                      if k not in ["password_hash", "temp_password"]}
        return safe_member
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@members_router.get("/{member_id}/stats")
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
        payments = supabase.table("payments").select("*").eq("member_number", member_number).eq("status", "completed").execute()
        total_payments = sum(float(p.get("amount", 0)) for p in (payments.data or []))
        
        waiting_months = member.get("waiting_period_months", 4)
        reg_date = member.get("registration_date")
        coverage_status = "Pending"
        if reg_date:
            reg_date = datetime.fromisoformat(reg_date) if isinstance(reg_date, str) else reg_date
            wait_end = reg_date + timedelta(days=waiting_months * 30)
            coverage_status = "Active" if datetime.now() >= wait_end else "Waiting"
        
        return {
            "member_id": member.get("id"),
            "member_number": member.get("member_number"),
            "plan": member.get("plan"),
            "benefit_option": member.get("benefit_option"),
            "dependants_count": dependants.count or 0,
            "payments_count": len(payments.data or []),
            "total_payments": total_payments,
            "last_payment_date": payments.data[0].get("payment_date") if payments.data and len(payments.data) > 0 else None,
            "coverage_status": coverage_status,
            "registration_date": member.get("registration_date"),
            "waiting_period_months": member.get("waiting_period_months")
        }
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
        result = supabase.table("dependants").select("*").eq("principal_member_id", member_id).execute()
        return {
            "success": True,
            "data": result.data or [],
            "count": len(result.data or [])
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@dependants_router.post("/")
async def create_dependant(member_id: str, dependant: DependantBase):
    """Add a dependant to a member"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        member = supabase.table("members").select("id").eq("id", member_id).execute()
        if not member.data or len(member.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        dep_record = {
            "principal_member_id": member_id,
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

@payments_router.get("/member/{member_id}")
async def get_member_payments(member_id: str, limit: int = 10, offset: int = 0):
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
        
        return {
            "success": True,
            "data": result.data or [],
            "count": len(result.data or []),
            "limit": limit,
            "offset": offset
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@payments_router.post("/")
async def create_payment(member_id: str, payment: PaymentCreate):
    """Create a new payment for a member"""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    
    try:
        member = supabase.table("members").select("member_number").eq("id", member_id).execute()
        if not member.data or len(member.data) == 0:
            raise HTTPException(status_code=404, detail="Member not found")
        
        member_number = member.data[0]["member_number"]
        
        payment_record = {
            "member_number": member_number,
            "amount": payment.amount,
            "payment_type": payment.payment_type,
            "payment_method": payment.payment_method,
            "mpesa_receipt": payment.mpesa_receipt,
            "status": "completed",
            "payment_date": datetime.now().date().isoformat(),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        result = supabase.table("payments").insert(payment_record).execute()
        
        if payment.payment_type == "registration":
            supabase.table("members").update({
                "registration_fee_paid": True,
                "updated_at": datetime.now().isoformat()
            }).eq("id", member_id).execute()
        
        return {
            "success": True,
            "data": result.data[0] if result.data else None,
            "message": "Payment recorded successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

app.include_router(payments_router)

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
        
        safe_member = {k: v for k, v in member.items() 
                      if k not in ["password_hash", "temp_password"]}
        
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

app.include_router(dashboard_router)

# ============================================================
# THIS IS WHAT UVICORN WILL IMPORT AS "main:app"
# ============================================================
