"""
Membership Routes - Public card eligibility lookup
"""

import logging

from fastapi import APIRouter, Query, HTTPException, status

from app.services.membership_service import membership_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/public/membership", tags=["membership"])


@router.get("/card-status")
async def card_status(
    member_number: str = Query(..., min_length=1, max_length=50),
    phone: str = Query(..., min_length=9, max_length=15),
):
    """
    Used by membership-card.html. Requires BOTH member_number and phone
    to match the same record -- see MembershipService.get_card_status for
    why this deliberately isn't a lookup-by-number-alone endpoint.
    """
    try:
        data = await membership_service.get_card_status(member_number, phone)
        return {"success": True, "data": data}

    except Exception as e:
        logger.error(f"Membership card status error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not check membership card status right now.",
        )
