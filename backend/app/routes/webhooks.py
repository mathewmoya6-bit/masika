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
    M-Pesa STK Push callback.
    Called by Safaricom when a payment attempt completes (success or failure).

    IMPORTANT: this must delegate to payment_service.handle_mpesa_webhook(),
    which knows the real Safaricom STK callback shape:

        {
          "Body": {
            "stkCallback": {
              "MerchantRequestID": "...",
              "CheckoutRequestID": "ws_CO_...",
              "ResultCode": 0,
              "ResultDesc": "...",
              "CallbackMetadata": { "Item": [...] }
            }
          }
        }

    A previous version of this route parsed the body into a flat
    MpesaWebhookData model (transaction_type/transaction_id/amount/phone/
    receipt/date/status) that Safaricom never actually sends. Every real
    callback failed Pydantic validation, was swallowed by the broad
    except-block below, and silently returned success=False with no
    payment ever confirmed -- even though the money had already been
    deducted from the customer. Fixed 2026-09-07.

    We also always ACK with HTTP 200 + ResultCode 0 regardless of the
    underlying payment's outcome (success or failure) -- that field
    only tells Safaricom "callback received", not "payment succeeded".
    Returning anything else causes Safaricom to retry delivery.
    """
    try:
        body = await request.json()
        logger.info(f"M-Pesa webhook received: {body}")

        result = await payment_service.handle_mpesa_webhook(body)

        return result

    except Exception as e:
        logger.error(f"M-Pesa webhook error: {e}")
        # Still ACK with 200/ResultCode 0 so Safaricom doesn't retry-storm
        # us; the real failure is already logged above for investigation.
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
