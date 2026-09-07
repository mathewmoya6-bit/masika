"""
Webhook Routes - For external integrations
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Request

from app.services.payment_service import payment_service
from app.services.member_service import member_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# M-PESA WEBHOOK
# ============================================================

@router.post("/mpesa")
async def mpesa_webhook(request: Request):
    """
    M-Pesa STK Push callback -- NOT USED AS THE SOURCE OF TRUTH.

    Safaricom requires every STK push request to include a CallBackURL,
    so this endpoint has to exist and return a well-formed ACK, or
    Safaricom will retry delivery repeatedly. But this app deliberately
    does NOT act on what arrives here.

    The single source of truth for payment status is
    payment_service.query_stk_status(), called from the polling route
    GET /api/public/payment/status/{checkout_request_id}. That function
    independently queries Safaricom's stkpushquery API, updates the
    payment row, and marks the member paid -- so nothing in this app's
    actual payment-confirmation flow depends on this webhook firing,
    firing on time, or being parsed correctly.

    Rationale: this callback's payload shape and field types have
    caused repeated production bugs (a flat-schema mismatch that failed
    validation on every real call, then a ResultCode int-vs-string
    comparison bug once the shape was fixed). Rather than keep chasing
    edge cases in a fire-and-forget callback we don't strictly need,
    we just log it for visibility/debugging and always ACK.

    If you want to reinstate the webhook as an active confirmation path
    later (e.g. to avoid polling delay), route this to
    payment_service.handle_mpesa_webhook(body) instead -- that method
    still exists and is fully correct.
    """
    try:
        body = await request.json()
        logger.info(f"M-Pesa webhook received (logged only, not processed): {body}")
    except Exception as e:
        logger.error(f"M-Pesa webhook error reading body: {e}")

    # Always ACK with 200 + ResultCode 0 regardless of payload content --
    # this only tells Safaricom "callback received", not "payment
    # succeeded". Anything else causes Safaricom to retry delivery.
    return {"ResultCode": 0, "ResultDesc": "Received"}


# ============================================================
# GENERAL WEBHOOK
# ============================================================

@router.post("/general")
async def general_webhook(request: Request):
    """
    General webhook endpoint for external integrations.
    """
    try:
        body = await request.json()
        logger.info(f"General webhook received: {body}")

        # Process based on event type
        event_type = body.get("event", "unknown")

        if event_type == "payment.confirmed":
            # Process payment confirmation
            payment_data = body.get("data", {})
            member_id = payment_data.get("member_id")
            amount = payment_data.get("amount")
            receipt = payment_data.get("receipt")

            if member_id and amount and receipt:
                await payment_service.confirm_payment(
                    member_id=member_id,
                    amount=amount,
                    receipt=receipt
                )

        return {
            "success": True,
            "message": "Webhook processed",
            "event": event_type
        }

    except Exception as e:
        logger.error(f"General webhook error: {e}")
        return {
            "success": False,
            "message": "Webhook processing failed",
            "error": str(e)
        }


# ============================================================
# HEALTH CHECK
# ============================================================

@router.get("/health")
async def webhook_health():
    """Webhook health check."""
    return {
        "success": True,
        "status": "healthy",
        "service": "webhook",
        "timestamp": datetime.now().isoformat()
    }
