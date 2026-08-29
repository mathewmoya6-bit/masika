"""
Request/Response Schemas - Simplified version
(Re-exports from models for API documentation)
"""

from app.models import *

# This file re-exports all models for cleaner imports
# All schemas are defined in models.py

__all__ = [
    # Enums
    "PlanEnum", "BenefitOptionEnum", "PaymentTypeEnum",
    "PaymentStatusEnum", "ClaimStatusEnum", "AgentStatusEnum",
    "RelationshipEnum",
    
    # Request Schemas
    "RegistrationRequest", "PaymentConfirmRequest",
    "MemberUpdate", "DependantCreate", "DependantUpdate",
    "AgentApplicationCreate", "AgentProfileUpdate",
    "PaymentUpdate", "ClaimCreate", "ClaimUpdate",
    
    # Response Schemas
    "APIResponse", "PaginatedResponse",
    "RegistrationResponse", "AgentApplicationResponse",
    "MemberResponse", "DependantResponse",
    "PaymentResponse", "AgentApplicationResponse",
    "AgentProfileResponse", "SalesCodeResponse",
    "ClaimResponse", "NotificationResponse",
]
