"""
Public Routes - No Authentication Required
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, status, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.models import (
    APIResponse,
    RegistrationResponse,
    AgentApplicationResponse,
    RegistrationRequest,
    AgentApplicationCreate,
    PaymentConfirmRequest,
    PlanEnum,
)
from app.services.member_service import member_service
from app.services.agent_service import agent_service
from app.services.payment_service import payment_service
from app.exceptions import BusinessError, DuplicateError, NotFoundError, ValidationError
from app.utils.helpers import calculate_registration_fee, normalize_phone

logger = logging.getLogger(__name__)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


# ============================================================
# PLANS
# ============================================================

@router.get("/plans", response_model=APIResponse)
@limiter.limit("100/minute")
async def get_plans(request: Request):
    """
    Get all available membership plans.
    
    No authentication required.
    """
    plans = [
        {
            "code": "COMFORT",
            "name": "Comfort Plan",
            "description": "Basic membership protection for individuals and families",
            "monthly_fee": 300,
            "registration_fee": 200,
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
            "registration_fee": 500,
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
            "registration_fee": 100,
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
    
    return {
        "success": True,
        "message": "Plans retrieved successfully",
        "data": plans
    }


@router.get("/plans/{plan_code}", response_model=APIResponse)
@limiter.limit("100/minute")
async def get_plan_details(request: Request, plan_code: str):
    """
    Get details for a specific plan.
    """
    plan_code = plan_code.upper()
    
    plans_map = {
        "COMFORT": {
            "code": "COMFORT",
            "name": "Comfort Plan",
            "monthly_fee": 300,
            "registration_fee": 200,
            "waiting_period": 4
        },
        "DIGNITY": {
            "code": "DIGNITY",
            "name": "Dignity Plan",
            "monthly_fee": 1000,
            "registration_fee": 500,
            "waiting_period": 6
        },
        "WAZAZI": {
            "code": "WAZAZI",
            "name": "Wazazi Plan",
            "monthly_fee": 350,
            "registration_fee": 100,
            "waiting_period": 6
        }
    }
    
    if plan_code not in plans_map:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan not found"
        )
    
    return {
        "success": True,
        "message": "Plan details retrieved",
        "data": plans_map[plan_code]
    }


# ============================================================
# MEMBER REGISTRATION
# ============================================================

@router.post("/register", response_model=RegistrationResponse)
@limiter.limit("20/minute")
async def register_member(request: Request, registration: RegistrationRequest):
    """
    PUBLIC MEMBER REGISTRATION - No Login Required.
    
    Anyone can register to become a member.
    Registration fee is calculated based on plan and dependants.
    """
    try:
        # Create member
        member = await member_service.create_member(registration)
        
        # Calculate fee
        fee = calculate_registration_fee(
            registration.plan.value,
            [dep.model_dump() for dep in registration.dependants]
        )
        
        return RegistrationResponse(
            success=True,
            message="Registration submitted successfully. Please proceed to payment.",
            member_id=member.get("id"),
            member_number=member.get("member_number"),
            registration_amount=fee,
            payment_required=True,
        )
        
    except DuplicateError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed. Please try again."
        )


@router.get("/check-member/{phone}", response_model=APIResponse)
@limiter.limit("60/minute")
async def check_member(request: Request, phone: str):
    """
    Check if a phone number is already registered.
    """
    try:
        phone = normalize_phone(phone)
        member = await member_service.get_member_by_phone(phone)
        
        if member:
            return {
                "success": True,
                "message": "Member found",
                "data": {
                    "exists": True,
                    "member_id": member.get("id"),
                    "member_number": member.get("member_number"),
                    "first_name": member.get("first_name"),
                    "last_name": member.get("last_name"),
                    "is_active": member.get("is_active"),
                    "registration_fee_paid": member.get("registration_fee_paid"),
                }
            }
        else:
            return {
                "success": True,
                "message": "No member found",
                "data": {"exists": False}
            }
            
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Member check error: {e}")
        return {
            "success": False,
            "message": "Failed to check member",
            "data": {"exists": False}
        }


# ============================================================
# AGENT APPLICATION
# ============================================================

@router.post("/agent/apply", response_model=AgentApplicationResponse)
@limiter.limit("10/minute")
async def apply_agent(request: Request, application: AgentApplicationCreate):
    """
    PUBLIC AGENT APPLICATION - No Login Required.
    
    Anyone can apply to become a sales agent.
    """
    try:
        app = await agent_service.create_application(application)
        
        return AgentApplicationResponse(
            success=True,
            message="Application submitted successfully. Our team will review it.",
            application_id=app.get("id"),
            status="pending"
        )
        
    except DuplicateError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Agent application error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Application failed. Please try again."
        )


# ============================================================
# PAYMENT CONFIRMATION
# ============================================================

@router.post("/payment/confirm", response_model=APIResponse)
@limiter.limit("20/minute")
async def confirm_payment(request: Request, payment: PaymentConfirmRequest):
    """
    PUBLIC PAYMENT CONFIRMATION - No Login Required.
    
    Confirm M-Pesa payment after member has paid.
    """
    try:
        result = await payment_service.confirm_payment(
            member_id=payment.member_id,
            amount=payment.amount,
            receipt=payment.mpesa_receipt,
            payment_type=payment.payment_type.value
        )
        
        return {
            "success": True,
            "message": "Payment confirmed successfully",
            "data": {
                "member_id": str(payment.member_id),
                "amount": payment.amount,
                "receipt": payment.mpesa_receipt,
                "already_confirmed": result.get("already_confirmed", False),
            }
        }
        
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except ValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Payment confirmation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Payment confirmation failed. Please try again."
        )


# ============================================================
# MEMBER NUMBER LOOKUP
# ============================================================

@router.get("/member/{member_number}", response_model=APIResponse)
@limiter.limit("30/minute")
async def get_member_by_number(request: Request, member_number: str):
    """
    Look up a member by their member number.
    """
    try:
        member = await member_service.get_member_by_number(member_number)
        
        if not member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found"
            )
        
        return {
            "success": True,
            "message": "Member found",
            "data": {
                "member_number": member.get("member_number"),
                "first_name": member.get("first_name"),
                "last_name": member.get("last_name"),
                "phone": member.get("phone"),
                "plan": member.get("plan"),
                "is_active": member.get("is_active"),
                "registration_fee_paid": member.get("registration_fee_paid"),
            }
        }
        
    except Exception as e:
        logger.error(f"Member lookup error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to lookup member"
        )
