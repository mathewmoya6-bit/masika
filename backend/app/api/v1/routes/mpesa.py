from fastapi import APIRouter, Depends, HTTPException, status
from typing import Dict, Any
from ....services.mpesa_service import mpesa_service
from ....services.webhook_service import webhook_service
from ....services.payment_service import payment_service
from ....core.dependencies import get_current_user, get_admin_user
from ....schemas.payment import MpesaCallbackRequest, MpesaCallbackResponse
from ....utils.logger import logger

router = APIRouter(prefix="/mpesa", tags=["mpesa"])

@router.post("/webhook")
async def mpesa_webhook(request: Dict[str, Any]):
    """
    M-PESA STK Push callback webhook endpoint
    
    This is called by Safaricom when:
    1. Customer completes payment on their phone
    2. Payment times out
    3. Payment fails
    """
    try:
        logger.info("📩 M-PESA webhook received")
        
        # Process callback
        result = await webhook_service.process_mpesa_callback(request)
        
        # Always return success to M-PESA to prevent retries
        return {"ResultCode": 0, "ResultDesc": "Success"}
        
    except Exception as e:
        logger.error(f"❌ M-PESA webhook error: {str(e)}")
        # Always return success to M-PESA
        return {"ResultCode": 0, "ResultDesc": "Accepted"}

@router.get("/balance")
async def get_mpesa_balance(
    admin_user: dict = Depends(get_admin_user)
):
    """
    Get M-PESA account balance (Admin only)
    """
    try:
        # This would require M-PESA balance API
        # Not implemented in STK Push flow
        return {
            "status": "success",
            "message": "Balance check not available in this version"
        }
    except Exception as e:
        logger.error(f"❌ M-PESA balance error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@router.post("/reversal")
async def reverse_mpesa_transaction(
    transaction_id: str,
    amount: float,
    admin_user: dict = Depends(get_admin_user)
):
    """
    Reverse/Refund an M-PESA transaction (Admin only)
    """
    try:
        result = await mpesa_service.reverse_transaction(
            transaction_id=transaction_id,
            amount=amount,
            receiver_party=str(mpesa_service.shortcode)
        )
        
        return {
            "status": "success",
            "data": result
        }
        
    except Exception as e:
        logger.error(f"❌ M-PESA reversal error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@router.get("/transaction/{checkout_request_id}")
async def get_mpesa_transaction(
    checkout_request_id: str,
    admin_user: dict = Depends(get_admin_user)
):
    """
    Get M-PESA transaction details (Admin only)
    """
    try:
        result = await mpesa_service.query_status(checkout_request_id)
        return {
            "status": "success",
            "data": result
        }
        
    except Exception as e:
        logger.error(f"❌ M-PESA transaction query error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
