"""
Staff Routes - Authentication Required
"""

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.models import (
    APIResponse,
    PaginatedResponse,
    MemberUpdate,
    PaymentUpdate,
    AgentProfileUpdate,
    SalesCodeRequest,
    AgentApplicationResponse,
)
from app.auth import get_current_staff, get_admin_user
from app.services.member_service import member_service
from app.services.agent_service import agent_service
from app.services.payment_service import payment_service
from app.exceptions import NotFoundError, ValidationError, BusinessError

logger = logging.getLogger(__name__)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


# ============================================================
# DASHBOARD
# ============================================================

@router.get("/dashboard", response_model=APIResponse)
@limiter.limit("30/minute")
async def get_dashboard(request: Request, auth: dict = Depends(get_current_staff)):
    """
    Get staff dashboard statistics.
    Requires staff authentication.
    """
    try:
        # Get member stats
        member_stats = await member_service.get_dashboard_stats()
        
        # Get agent stats
        agents = await agent_service.get_agents(status="approved")
        pending_agents = await agent_service.get_applications(status="pending")
        
        # Get revenue summary
        revenue = await payment_service.get_revenue_summary()
        
        return {
            "success": True,
            "message": "Dashboard data retrieved",
            "data": {
                "stats": {
                    "total_members": member_stats.get("total_members", 0),
                    "active_members": member_stats.get("active_members", 0),
                    "pending_registrations": member_stats.get("pending_registrations", 0),
                    "total_agents": len(agents),
                    "pending_agent_applications": len(pending_agents),
                    "total_revenue": revenue.get("confirmed", 0),
                },
                "recent_members": member_stats.get("recent_members", []),
                "revenue_summary": revenue,
            }
        }
        
    except Exception as e:
        logger.error(f"Dashboard error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load dashboard data"
        )


# ============================================================
# MEMBERS
# ============================================================

@router.get("/members", response_model=APIResponse)
@limiter.limit("60/minute")
async def get_members(
    request: Request,
    auth: dict = Depends(get_current_staff),
    search: Optional[str] = None,
    plan: Optional[str] = None,
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    """
    Get paginated list of members with filters.
    Requires staff authentication.
    """
    try:
        result = await member_service.get_members(
            search=search,
            plan=plan,
            status=status,
            page=page,
            limit=limit
        )
        
        return {
            "success": True,
            "message": "Members retrieved",
            "data": {
                "members": result.get("members", []),
                "total": result.get("total", 0),
                "page": page,
                "limit": limit,
                "pages": result.get("pages", 1),
            }
        }
        
    except Exception as e:
        logger.error(f"Get members error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load members"
        )


@router.get("/members/{member_id}", response_model=APIResponse)
@limiter.limit("60/minute")
async def get_member_details(
    request: Request,
    member_id: UUID,
    auth: dict = Depends(get_current_staff),
):
    """
    Get detailed member information including dependants and payments.
    Requires staff authentication.
    """
    try:
        member = await member_service.get_member(member_id)
        dependants = await member_service.get_dependants(member_id)
        payments = await payment_service.get_payments(member_id=member_id)
        
        return {
            "success": True,
            "message": "Member details retrieved",
            "data": {
                "member": member,
                "dependants": dependants,
                "payments": payments.get("payments", []),
            }
        }
        
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Get member details error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load member details"
        )


@router.put("/members/{member_id}", response_model=APIResponse)
@limiter.limit("30/minute")
async def update_member(
    request: Request,
    member_id: UUID,
    updates: MemberUpdate,
    auth: dict = Depends(get_current_staff),
):
    """
    Update member information.
    Requires staff authentication.
    """
    try:
        member = await member_service.update_member(member_id, updates)
        
        return {
            "success": True,
            "message": "Member updated successfully",
            "data": member
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
        logger.error(f"Update member error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update member"
        )


# ============================================================
# AGENTS
# ============================================================

@router.get("/agents", response_model=APIResponse)
@limiter.limit("30/minute")
async def get_agents(
    request: Request,
    auth: dict = Depends(get_current_staff),
    status: Optional[str] = None,
    search: Optional[str] = None,
):
    """
    Get all agents with optional filters.
    Requires staff authentication.
    """
    try:
        agents = await agent_service.get_agents(status=status, search=search)
        
        return {
            "success": True,
            "message": "Agents retrieved",
            "data": agents
        }
        
    except Exception as e:
        logger.error(f"Get agents error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load agents"
        )


@router.get("/agents/applications", response_model=APIResponse)
@limiter.limit("30/minute")
async def get_agent_applications(
    request: Request,
    auth: dict = Depends(get_current_staff),
    status: Optional[str] = "pending",
):
    """
    Get agent applications with optional status filter.
    Requires staff authentication.
    """
    try:
        applications = await agent_service.get_applications(status=status)
        
        return {
            "success": True,
            "message": "Applications retrieved",
            "data": applications
        }
        
    except Exception as e:
        logger.error(f"Get applications error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load applications"
        )


@router.put("/agents/{agent_id}/approve", response_model=APIResponse)
@limiter.limit("10/minute")
async def approve_agent(
    request: Request,
    agent_id: UUID,
    auth: dict = Depends(get_current_staff),
):
    """
    Approve an agent application and create agent profile.
    Requires staff authentication.
    """
    try:
        agent = await agent_service.approve_application(agent_id)
        
        return {
            "success": True,
            "message": "Agent approved successfully",
            "data": {
                "agent": agent,
                "sales_codes_generated": 5,
            }
        }
        
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Approve agent error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to approve agent"
        )


@router.put("/agents/{agent_id}/reject", response_model=APIResponse)
@limiter.limit("10/minute")
async def reject_agent(
    request: Request,
    agent_id: UUID,
    auth: dict = Depends(get_current_staff),
):
    """
    Reject an agent application.
    Requires staff authentication.
    """
    try:
        body = await request.json()
        reason = body.get("reason", "No reason provided")
        
        result = await agent_service.reject_application(agent_id, reason)
        
        return {
            "success": True,
            "message": "Application rejected",
            "data": {"application_id": str(agent_id), "reason": reason}
        }
        
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Reject agent error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reject application"
        )


@router.put("/agents/{agent_id}/status", response_model=APIResponse)
@limiter.limit("20/minute")
async def update_agent_status(
    request: Request,
    agent_id: UUID,
    update: AgentProfileUpdate,
    auth: dict = Depends(get_current_staff),
):
    """
    Update agent status (activate/deactivate/suspend).
    Requires staff authentication.
    """
    try:
        agent = await agent_service.update_agent_status(
            agent_id,
            update.status.value if update.status else "active",
            update.commission_rate
        )
        
        return {
            "success": True,
            "message": f"Agent status updated to {update.status or 'active'}",
            "data": agent
        }
        
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Update agent status error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update agent status"
        )


# ============================================================
# SALES CODES
# ============================================================

@router.post("/agents/sales-codes", response_model=APIResponse)
@limiter.limit("20/minute")
async def generate_sales_codes(
    request: Request,
    data: SalesCodeRequest,
    auth: dict = Depends(get_current_staff),
):
    """
    Generate sales codes for an agent.
    Requires staff authentication.
    """
    try:
        codes = await agent_service.generate_sales_codes(
            agent_id=data.agent_id,
            count=data.count,
            prefix=data.code_prefix,
            expires_at=data.expires_at
        )
        
        return {
            "success": True,
            "message": f"{len(codes)} sales codes generated",
            "data": {
                "codes": codes,
                "count": len(codes),
            }
        }
        
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Generate sales codes error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate sales codes"
        )


@router.get("/agents/{agent_id}/sales-codes", response_model=APIResponse)
@limiter.limit("30/minute")
async def get_agent_sales_codes(
    request: Request,
    agent_id: UUID,
    auth: dict = Depends(get_current_staff),
):
    """
    Get all sales codes for an agent.
    Requires staff authentication.
    """
    try:
        codes = await agent_service.get_sales_codes(agent_id=agent_id)
        
        return {
            "success": True,
            "message": "Sales codes retrieved",
            "data": codes
        }
        
    except Exception as e:
        logger.error(f"Get sales codes error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load sales codes"
        )


# ============================================================
# PAYMENTS
# ============================================================

@router.get("/payments", response_model=APIResponse)
@limiter.limit("30/minute")
async def get_payments(
    request: Request,
    auth: dict = Depends(get_current_staff),
    status: Optional[str] = None,
    member_id: Optional[UUID] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    """
    Get paginated list of payments with filters.
    Requires staff authentication.
    """
    try:
        result = await payment_service.get_payments(
            member_id=member_id,
            status=status,
            page=page,
            limit=limit
        )
        
        return {
            "success": True,
            "message": "Payments retrieved",
            "data": {
                "payments": result.get("payments", []),
                "total": result.get("total", 0),
                "page": page,
                "limit": limit,
                "pages": result.get("pages", 1),
            }
        }
        
    except Exception as e:
        logger.error(f"Get payments error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load payments"
        )


@router.put("/payments/{payment_id}", response_model=APIResponse)
@limiter.limit("20/minute")
async def update_payment(
    request: Request,
    payment_id: UUID,
    update: PaymentUpdate,
    auth: dict = Depends(get_current_staff),
):
    """
    Update payment status.
    Requires staff authentication.
    """
    try:
        payment = await payment_service.update_payment(payment_id, update)
        
        return {
            "success": True,
            "message": f"Payment status updated to {update.status.value}",
            "data": payment
        }
        
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Update payment error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update payment"
        )
