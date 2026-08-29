"""
Admin Routes - Super Admin Only
"""

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.models import APIResponse
from app.auth import get_admin_user
from app.services.member_service import member_service
from app.services.agent_service import agent_service
from app.services.payment_service import payment_service
from app.exceptions import NotFoundError

logger = logging.getLogger(__name__)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


# ============================================================
# SYSTEM STATS
# ============================================================

@router.get("/system/stats", response_model=APIResponse)
@limiter.limit("10/minute")
async def get_system_stats(request: Request, auth: dict = Depends(get_admin_user)):
    """
    Get comprehensive system statistics.
    Super admin only.
    """
    try:
        # Member stats
        member_stats = await member_service.get_dashboard_stats()
        
        # Agent stats
        all_agents = await agent_service.get_agents()
        pending_agents = await agent_service.get_applications(status="pending")
        approved_agents = await agent_service.get_agents(status="approved")
        
        # Payment stats
        revenue = await payment_service.get_revenue_summary()
        
        return {
            "success": True,
            "message": "System stats retrieved",
            "data": {
                "members": {
                    "total": member_stats.get("total_members", 0),
                    "active": member_stats.get("active_members", 0),
                    "pending": member_stats.get("pending_registrations", 0),
                },
                "agents": {
                    "total": len(all_agents),
                    "pending": len(pending_agents),
                    "approved": len(approved_agents),
                },
                "payments": {
                    "total_revenue": revenue.get("total", 0),
                    "confirmed": revenue.get("confirmed", 0),
                    "pending": revenue.get("pending", 0),
                    "failed": revenue.get("failed", 0),
                },
                "timestamp": datetime.now().isoformat(),
            }
        }
        
    except Exception as e:
        logger.error(f"System stats error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load system stats"
        )


# ============================================================
# EXPORT DATA
# ============================================================

@router.get("/export/members", response_model=APIResponse)
@limiter.limit("5/minute")
async def export_members(
    request: Request,
    auth: dict = Depends(get_admin_user),
    format: str = Query("json", regex="^(json|csv)$"),
):
    """
    Export all members data.
    Super admin only.
    """
    try:
        # Get all members
        members = []
        page = 1
        limit = 100
        
        while True:
            result = await member_service.get_members(page=page, limit=limit)
            members.extend(result.get("members", []))
            
            if len(members) >= result.get("total", 0):
                break
            page += 1
        
        if format == "csv":
            # Convert to CSV
            import csv
            from io import StringIO
            
            output = StringIO()
            writer = csv.DictWriter(output, fieldnames=members[0].keys() if members else [])
            writer.writeheader()
            writer.writerows(members)
            
            return {
                "success": True,
                "message": "Members exported successfully",
                "data": {
                    "format": "csv",
                    "content": output.getvalue(),
                    "count": len(members),
                }
            }
        else:
            return {
                "success": True,
                "message": "Members exported successfully",
                "data": {
                    "format": "json",
                    "members": members,
                    "count": len(members),
                }
            }
        
    except Exception as e:
        logger.error(f"Export members error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to export members"
        )


@router.get("/export/payments", response_model=APIResponse)
@limiter.limit("5/minute")
async def export_payments(
    request: Request,
    auth: dict = Depends(get_admin_user),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    format: str = Query("json", regex="^(json|csv)$"),
):
    """
    Export payments data.
    Super admin only.
    """
    try:
        # Get payments
        result = await payment_service.get_payments(page=1, limit=1000)
        payments = result.get("payments", [])
        
        if start_date:
            payments = [p for p in payments if p.get("payment_date", "") >= start_date]
        if end_date:
            payments = [p for p in payments if p.get("payment_date", "") <= end_date]
        
        if format == "csv":
            import csv
            from io import StringIO
            
            output = StringIO()
            writer = csv.DictWriter(output, fieldnames=payments[0].keys() if payments else [])
            writer.writeheader()
            writer.writerows(payments)
            
            return {
                "success": True,
                "message": "Payments exported successfully",
                "data": {
                    "format": "csv",
                    "content": output.getvalue(),
                    "count": len(payments),
                }
            }
        else:
            return {
                "success": True,
                "message": "Payments exported successfully",
                "data": {
                    "format": "json",
                    "payments": payments,
                    "count": len(payments),
                }
            }
        
    except Exception as e:
        logger.error(f"Export payments error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to export payments"
        )


# ============================================================
# DELETE MEMBER (Admin Only)
# ============================================================

@router.delete("/members/{member_id}", response_model=APIResponse)
@limiter.limit("5/minute")
async def delete_member(
    request: Request,
    member_id: UUID,
    auth: dict = Depends(get_admin_user),
):
    """
    Delete a member (soft delete by deactivating).
    Super admin only.
    """
    try:
        # Soft delete - deactivate member
        from app.models import MemberUpdate
        update = MemberUpdate(is_active=False)
        member = await member_service.update_member(member_id, update)
        
        return {
            "success": True,
            "message": "Member deactivated successfully",
            "data": {"member_id": str(member_id)}
        }
        
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Delete member error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to deactivate member"
        )
