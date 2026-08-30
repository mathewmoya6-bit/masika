"""
Public Payment Routes - M-Pesa STK Push
No authentication required — mirrors the pattern used in public.py.

Wires up the two endpoints payment.html already calls:
    POST /api/public/payment/stk-push
    GET  /api/public/payment/status/{checkout_request_id}
"""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, status, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.services.payment_service import payment_service
from app.exceptions import NotFoundError, ValidationError

logger = logging.getLogger(__name__)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


# ============================================================
# REQUEST MODELS
# ============================================================

class StkPushRequest(BaseModel):
    """Matches the body sent by payment.html's initiatePayment()."""
    member_id: UUID
    phone: str
    amount: float = Field(gt=0)
    transaction_desc: str = "Membership Registration"


# ============================================================
# INITIATE STK PUSH
# ============================================================

@router.post("/payment/stk-push")
@limiter.limit("10/minute")
async def stk_push(request: Request, payload: StkPushRequest):
    """
    PUBLIC - Initiate an M-Pesa STK Push for a member's registration payment.

    Delegates to payment_service.process_member_payment(), which:
      - looks up the member and checks they haven't already paid
      - calls initiate_stk_push() (auth + STK push to Safaricom)
      - stores a pending payment row tied to member_id
    """
    try:
        result = await payment_service.process_member_payment(
            member_id=payload.member_id,
            phone=payload.phone,
            amount=payload.amount,
            transaction_desc=payload.transaction_desc,
        )

        # process_member_payment() never raises on a failed STK push (Safaricom
        # errors, timeouts, etc.) — it returns status="failed" instead. Surface
        # that as success: False so the frontend's `if (!result.success)` throw
        # fires with the real reason, rather than looking like a network error.
        return {
            "success": result.get("status") != "failed",
            "message": result.get("message", "Payment initiated"),
            "data": {
                "checkout_request_id": result.get("checkout_request_id"),
                "merchant_request_id": result.get("merchant_request_id"),
                "status": result.get("status", "pending"),
                "payment_id": result.get("payment_id"),
                "member_id": str(payload.member_id),
            },
        }

    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except HTTPException:
        # Let HTTPExceptions raised inside payment_service (e.g. the 503 from
        # _get_access_token when M-Pesa credentials are missing/misconfigured,
        # or the 504 on OAuth timeout) pass through with their real status
        # code and detail, instead of being flattened into a generic 500.
        raise
    except Exception as e:
        logger.error(f"STK push error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Payment initiation failed. Please try again.",
        )


# ============================================================
# CHECK STK PUSH STATUS
# ============================================================

@router.get("/payment/status/{checkout_request_id}")
@limiter.limit("30/minute")
async def payment_status(request: Request, checkout_request_id: str):
    """
    PUBLIC - Poll the status of an M-Pesa STK Push transaction.

    Called by payment.html's checkPaymentStatus() every 3 seconds while a
    payment is pending.
    """
    try:
        result = await payment_service.query_stk_status(checkout_request_id)

        return {
            "success": True,
            "message": result.get("result_desc", "Status retrieved"),
            "data": {
                "checkout_request_id": checkout_request_id,
                "status": result.get("status"),
                # paymentFailed() in payment.html reads data.message for the
                # failure reason shown to the user (insufficient funds,
                # cancelled, timeout, etc.) — result_desc is Safaricom's field
                # name, so map it into "message" here rather than the frontend
                # silently falling back to its generic text.
                "message": result.get("result_desc"),
                "receipt": result.get("receipt"),
                "amount": result.get("amount"),
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Payment status check error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to check payment status.",
        )
