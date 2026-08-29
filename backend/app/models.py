"""
Pydantic Models - Database Models
"""

from datetime import datetime
from typing import Optional, List
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, ConfigDict, EmailStr


# ============================================================
# ENUMS
# ============================================================

class PlanEnum(str, Enum):
    COMFORT = "comfort"
    DIGNITY = "dignity"
    WAZAZI = "wazazi"

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

class ClaimStatusEnum(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    PAID = "paid"
    IN_REVIEW = "in_review"

class AgentStatusEnum(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"

class RelationshipEnum(str, Enum):
    SPOUSE = "spouse"
    CHILD = "child"
    PARENT = "parent"
    IN_LAW = "in_law"
    SIBLING = "sibling"
    OTHER = "other"


# ============================================================
# BASE MODELS
# ============================================================

class BaseModelDB(BaseModel):
    """Base model with common fields."""
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    
    id: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ============================================================
# MEMBER MODELS
# ============================================================

class MemberBase(BaseModelDB):
    """Base Member model."""
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
    
    plan: PlanEnum = PlanEnum.COMFORT
    benefit_option: BenefitOptionEnum = BenefitOptionEnum.SERVICE
    member_number: Optional[str] = None
    
    registration_fee_paid: bool = False
    is_active: bool = True
    waiting_period_months: int = Field(default=4, ge=0, le=12)
    coverage_start_date: Optional[str] = None

class MemberCreate(MemberBase):
    """Model for creating a member."""
    pass

class MemberUpdate(BaseModel):
    """Model for updating a member."""
    first_name: Optional[str] = Field(None, min_length=2, max_length=100)
    last_name: Optional[str] = Field(None, min_length=2, max_length=100)
    other_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, min_length=9, max_length=20)
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    is_active: Optional[bool] = None
    plan: Optional[PlanEnum] = None
    benefit_option: Optional[BenefitOptionEnum] = None
    registration_fee_paid: Optional[bool] = None

class MemberResponse(MemberBase):
    """Member response model."""
    id: UUID
    member_number: str
    created_at: datetime
    updated_at: Optional[datetime] = None


# ============================================================
# DEPENDANT MODELS
# ============================================================

class DependantBase(BaseModelDB):
    """Base Dependant model."""
    member_id: UUID
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    date_of_birth: Optional[str] = None
    relationship: RelationshipEnum = RelationshipEnum.OTHER
    is_active: bool = True

class DependantCreate(DependantBase):
    """Model for creating a dependant."""
    pass

class DependantUpdate(BaseModel):
    """Model for updating a dependant."""
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    date_of_birth: Optional[str] = None
    relationship: Optional[RelationshipEnum] = None
    is_active: Optional[bool] = None

class DependantResponse(DependantBase):
    """Dependant response model."""
    id: UUID
    created_at: datetime


# ============================================================
# PAYMENT MODELS
# ============================================================

class PaymentBase(BaseModelDB):
    """Base Payment model."""
    member_id: UUID
    amount: float = Field(..., gt=0)
    payment_type: PaymentTypeEnum = PaymentTypeEnum.REGISTRATION
    mpesa_receipt: Optional[str] = Field(None, min_length=5, max_length=50)
    paybill_number: str = "348127"
    account_number: Optional[str] = None
    status: PaymentStatusEnum = PaymentStatusEnum.PENDING
    notes: Optional[str] = None
    confirmed_at: Optional[datetime] = None

class PaymentCreate(PaymentBase):
    """Model for creating a payment."""
    pass

class PaymentUpdate(BaseModel):
    """Model for updating a payment."""
    status: PaymentStatusEnum
    mpesa_receipt: Optional[str] = Field(None, min_length=5, max_length=50)
    notes: Optional[str] = None

class PaymentResponse(PaymentBase):
    """Payment response model."""
    id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None


# ============================================================
# AGENT MODELS
# ============================================================

class AgentApplicationBase(BaseModelDB):
    """Base Agent Application model."""
    full_name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone: str = Field(..., min_length=9, max_length=20)
    id_number: str = Field(..., min_length=5, max_length=30)
    county: str = Field(..., min_length=2, max_length=50)
    location: Optional[str] = Field(None, max_length=100)
    experience: Optional[str] = None
    reason: str = Field(..., min_length=10, max_length=1000)
    referral_code: Optional[str] = None
    status: AgentStatusEnum = AgentStatusEnum.PENDING
    rejection_reason: Optional[str] = None
    reviewed_at: Optional[datetime] = None

class AgentApplicationCreate(AgentApplicationBase):
    """Model for creating an agent application."""
    pass

class AgentApplicationResponse(AgentApplicationBase):
    """Agent application response model."""
    id: UUID
    created_at: datetime


class AgentProfileBase(BaseModelDB):
    """Base Agent Profile model."""
    full_name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone: str = Field(..., min_length=9, max_length=20)
    id_number: str = Field(..., min_length=5, max_length=30)
    county: Optional[str] = None
    location: Optional[str] = None
    status: AgentStatusEnum = AgentStatusEnum.APPROVED
    commission_rate: float = Field(default=10.0, ge=0, le=100)
    approved_at: Optional[datetime] = None

class AgentProfileCreate(AgentProfileBase):
    """Model for creating an agent profile."""
    pass

class AgentProfileUpdate(BaseModel):
    """Model for updating an agent profile."""
    status: Optional[AgentStatusEnum] = None
    commission_rate: Optional[float] = Field(None, ge=0, le=100)
    county: Optional[str] = None
    location: Optional[str] = None

class AgentProfileResponse(AgentProfileBase):
    """Agent profile response model."""
    id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None


# ============================================================
# SALES CODE MODELS
# ============================================================

class SalesCodeBase(BaseModelDB):
    """Base Sales Code model."""
    code: str = Field(..., min_length=5, max_length=50)
    agent_email: str
    agent_name: str
    agent_id: Optional[UUID] = None
    status: str = "active"
    used: bool = False
    used_by: Optional[str] = None
    used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None

class SalesCodeCreate(SalesCodeBase):
    """Model for creating a sales code."""
    pass

class SalesCodeResponse(SalesCodeBase):
    """Sales code response model."""
    id: UUID
    created_at: datetime


# ============================================================
# CLAIM MODELS
# ============================================================

class ClaimBase(BaseModelDB):
    """Base Claim model."""
    member_id: UUID
    dependant_id: Optional[UUID] = None
    claim_type: str = Field(..., pattern="^(service|cash)$")
    status: ClaimStatusEnum = ClaimStatusEnum.PENDING
    amount: Optional[float] = Field(None, gt=0)
    description: Optional[str] = None
    rejection_reason: Optional[str] = None
    resolved_at: Optional[datetime] = None

class ClaimCreate(ClaimBase):
    """Model for creating a claim."""
    pass

class ClaimUpdate(BaseModel):
    """Model for updating a claim."""
    status: ClaimStatusEnum
    amount: Optional[float] = Field(None, gt=0)
    rejection_reason: Optional[str] = None

class ClaimResponse(ClaimBase):
    """Claim response model."""
    id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None


# ============================================================
# NOTIFICATION MODELS
# ============================================================

class NotificationBase(BaseModelDB):
    """Base Notification model."""
    member_id: UUID
    title: str = Field(..., min_length=1, max_length=100)
    message: str = Field(..., min_length=1, max_length=500)
    type: str = Field(..., pattern="^(payment|claim|system|reminder|promotion)$")
    is_read: bool = False
    link: Optional[str] = None

class NotificationCreate(NotificationBase):
    """Model for creating a notification."""
    pass

class NotificationUpdate(BaseModel):
    """Model for updating a notification."""
    is_read: bool = True

class NotificationResponse(NotificationBase):
    """Notification response model."""
    id: UUID
    created_at: datetime


# ============================================================
# REGISTRATION REQUEST MODELS
# ============================================================

class RegistrationRequest(BaseModel):
    """Public registration request model."""
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
    plan: PlanEnum = PlanEnum.COMFORT
    benefit_option: BenefitOptionEnum = BenefitOptionEnum.SERVICE
    dependants: List[DependantCreate] = Field(default_factory=list)

class PaymentConfirmRequest(BaseModel):
    """Payment confirmation request model."""
    member_id: UUID
    amount: float = Field(..., gt=0)
    payment_type: PaymentTypeEnum = PaymentTypeEnum.REGISTRATION
    mpesa_receipt: str = Field(..., min_length=5, max_length=50)
    phone: str = Field(..., min_length=9, max_length=20)
    paybill_number: str = "348127"


# ============================================================
# RESPONSE MODELS
# ============================================================

class APIResponse(BaseModel):
    """Standard API response model."""
    success: bool
    message: str
    data: Optional[Any] = None
    error: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now())

class PaginatedResponse(BaseModel):
    """Paginated response model."""
    items: List[Any]
    total: int
    page: int
    limit: int
    pages: int

class RegistrationResponse(BaseModel):
    """Registration response model."""
    success: bool
    message: str
    member_id: Optional[UUID] = None
    member_number: Optional[str] = None
    registration_amount: Optional[float] = None
    payment_required: bool = True

class AgentApplicationResponse(BaseModel):
    """Agent application response model."""
    success: bool
    message: str
    application_id: Optional[UUID] = None
    status: str = "pending"


# ============================================================
# EXPORTS
# ============================================================

__all__ = [
    # Enums
    "PlanEnum", "BenefitOptionEnum", "PaymentTypeEnum", 
    "PaymentStatusEnum", "ClaimStatusEnum", "AgentStatusEnum",
    "RelationshipEnum",
    
    # Member Models
    "MemberBase", "MemberCreate", "MemberUpdate", "MemberResponse",
    
    # Dependant Models
    "DependantBase", "DependantCreate", "DependantUpdate", "DependantResponse",
    
    # Payment Models
    "PaymentBase", "PaymentCreate", "PaymentUpdate", "PaymentResponse",
    
    # Agent Models
    "AgentApplicationBase", "AgentApplicationCreate", "AgentApplicationResponse",
    "AgentProfileBase", "AgentProfileCreate", "AgentProfileUpdate", "AgentProfileResponse",
    
    # Sales Code Models
    "SalesCodeBase", "SalesCodeCreate", "SalesCodeResponse",
    
    # Claim Models
    "ClaimBase", "ClaimCreate", "ClaimUpdate", "ClaimResponse",
    
    # Notification Models
    "NotificationBase", "NotificationCreate", "NotificationUpdate", "NotificationResponse",
    
    # Request Models
    "RegistrationRequest", "PaymentConfirmRequest",
    
    # Response Models
    "APIResponse", "PaginatedResponse", "RegistrationResponse", "AgentApplicationResponse",
]
