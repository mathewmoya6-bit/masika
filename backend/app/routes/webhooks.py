"""
Webhook Routes - For external integrations
"""

import logging
import hmac
import hashlib
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, status, Request, Header
from pydantic import BaseModel

from app.services.payment_service import payment_service
from app.services.member_service import member_service
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# WEBHOOK MODELS
# ============================================================

class MpesaWebhookData(BaseModel):
    """M-Pesa webhook payload."""
    transaction_type: str
    transaction_id: str
    amount: float
    phone: str
    receipt: str
    date: str
    status: str


# ============================================================
# M-PESA WEBHOOK
# ============================================================

@router.post("/mpesa")
async def mpesa_webhook(
    request: Request,
    x_signature: Optional[str] = Header(None),
):
    """
    M-Pesa payment webhook.
    Called by Safaricom when payment is completed.
    """
    try:
        body = await request.json()
        logger.info(f"M-Pesa webhook received: {body}")
        
        # Verify signature (if configured)
        if x_signature and settings.SUPABASE_JWT_SECRET:
            expected = hmac.new(
                settings.SUPABASE_JWT_SECRET.encode(),
                str(body).encode(),
                hashlib.sha256
            ).hexdigest()
            
            if not hmac.compare_digest(x_signature, expected):
                logger.warning("Invalid webhook signature")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid signature"
                )
        
        # Process webhook data
        data = MpesaWebhookData(**body)
        
        # Find member by phone
        member = await member_service.get_member_by_phone(data.phone)
        
        if not member:
            logger.warning(f"Member not found for phone: {data.phone}")
            return {
                "success":
