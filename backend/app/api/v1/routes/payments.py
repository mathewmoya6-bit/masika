from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from typing import List, Optional
from ....database import get_supabase_client
from ....services.mpesa_service import mpesa_service
from ....services.webhook_service import webhook_service
from ....schemas.payment import (
    PaymentRequest, PaymentResponse, PaymentStatusResponse,
    PaymentInitiateResponse, PaymentHistoryResponse,
    MpesaCallbackResponse
)
from ....core.dependencies import get_current_user, get_member_by_id
from ....core.constants import PaymentConstants, PlanConstants
from ....utils.logger import logger

router = APIRouter(prefix="/payments", tags=["payments"])

@router.post("/initiate", response_model=PaymentInitiateResponse)
async def initiate_payment(
    payment: PaymentRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """
    Initiate M-PESA STK Push payment
    
    Args:
        payment: Payment request with amount, phone, etc.
        current_user: Authenticated user
        
    Returns:
        PaymentInitiateResponse with checkout_id
    """
    try:
        db = get_supabase_client()
        
        # Get member details
        member = db.table("members").select("*").eq(
            "id", current_user["id"]
        ).execute()
        
        if not member.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found"
            )
        
        member_data = member.data[0]
        
        # Calculate amount based on payment type
        amount = await calculate_payment_amount(
            db, 
            member_data, 
            payment.payment_type,
            payment.amount
        )
        
        # Validate amount
        if amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid payment amount"
            )
        
        # Create payment record
        payment_data = {
            "membership_number": member_data["membership_number"],
            "amount": amount,
            "payment_type": payment.payment_type,
            "payment_method": "mpesa",
            "status": "pending",
            "phone_number": payment.phone_number
        }
        
        # Insert payment record
        payment_record = db.table("payments").insert(payment_data).execute()
        payment_id = payment_record.data[0]["id"]
        
        # Initiate STK Push
        mpesa_response = await mpesa_service.stk_push(
            phone_number=payment.phone_number,
            amount=amount,
            account_reference=member_data["membership_number"],
            transaction_desc=f"Masika {payment.payment_type}",
            transaction_type="CustomerPayBillOnline"
        )
        
        # Update payment with M-PESA response
        update_data = {
            "mpesa_checkout_id": mpesa_response.get("CheckoutRequestID"),
            "mpesa_merchant_request_id": mpesa_response.get("MerchantRequestID"),
            "mpesa_response_code": mpesa_response.get("ResponseCode"),
            "mpesa_response_desc": mpesa_response.get("ResponseDescription")
        }
        
        db.table("payments").update(update_data).eq("id", payment_id).execute()
        
        logger.info(f"✅ Payment initiated: {mpesa_response.get('CheckoutRequestID')}")
        
        # Schedule status query in background
        background_tasks.add_task(
            monitor_payment_status,
            mpesa_response.get("CheckoutRequestID"),
            payment_id
        )
        
        return PaymentInitiateResponse(
            checkout_request_id=mpesa_response.get("CheckoutRequestID"),
            merchant_request_id=mpesa_response.get("MerchantRequestID"),
            response_code=mpesa_response.get("ResponseCode"),
            response_description=mpesa_response.get("ResponseDescription"),
            amount=amount,
            payment_id=payment_id
        )
        
    except Exception as e:
        logger.error(f"❌ Payment initiation error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@router.post("/webhook/mpesa", response_model=MpesaCallbackResponse)
async def mpesa_callback(request: Dict[str, Any]):
    """
    M-PESA STK Push callback endpoint
    """
    try:
        # Process callback
        result = await webhook_service.process_mpesa_callback(request)
        
        # Always return success to M-PESA
        return MpesaCallbackResponse(
            ResultCode=0,
            ResultDesc="Success"
        )
        
    except Exception as e:
        logger.error(f"❌ Webhook error: {str(e)}")
        # Return success to prevent M-PESA retries
        return MpesaCallbackResponse(
            ResultCode=0,
            ResultDesc="Accepted"
        )

@router.get("/status/{checkout_request_id}", response_model=PaymentStatusResponse)
async def get_payment_status(
    checkout_request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get payment status from M-PESA
    """
    try:
        db = get_supabase_client()
        
        # Get payment record
        payment = db.table("payments").select("*").eq(
            "mpesa_checkout_id", checkout_request_id
        ).execute()
        
        if not payment.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment not found"
            )
        
        payment_data = payment.data[0]
        
        # Verify ownership
        if payment_data["membership_number"] != current_user.get("membership_number"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this payment"
            )
        
        # Query M-PESA status
        status_result = await mpesa_service.query_status(checkout_request_id)
        
        # Update if completed
        if status_result.get("ResultCode") == "0":
            db.table("payments").update({
                "status": "completed"
            }).eq("id", payment_data["id"]).execute()
        
        return PaymentStatusResponse(
            **payment_data,
            mpesa_status=status_result
        )
        
    except Exception as e:
        logger.error(f"❌ Status check error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@router.get("/history", response_model=List[PaymentHistoryResponse])
async def get_payment_history(
    current_user: dict = Depends(get_current_user),
    limit: int = 50,
    offset: int = 0,
    status: Optional[str] = None
):
    """
    Get member payment history
    """
    try:
        db = get_supabase_client()
        
        # Build query
        query = db.table("payments").select("*").eq(
            "membership_number", current_user["membership_number"]
        )
        
        if status:
            query = query.eq("status", status)
        
        result = query.order("created_at", desc=True).range(
            offset, offset + limit - 1
        ).execute()
        
        return [PaymentHistoryResponse(**p) for p in result.data]
        
    except Exception as e:
        logger.error(f"❌ History fetch error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@router.get("/upcoming", response_model=dict)
async def get_upcoming_payment(
    current_user: dict = Depends(get_current_user)
):
    """
    Get upcoming payment information
    """
    try:
        db = get_supabase_client()
        
        member = db.table("members").select("*").eq(
            "id", current_user["id"]
        ).execute()
        
        if not member.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found"
            )
        
        member_data = member.data[0]
        
        # Get plan details
        plan = PlanConstants.PLANS.get(member_data["plan_type"])
        
        if not plan:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Plan not found"
            )
        
        # Check if payment is due
        last_payment = db.table("payments").select("*").eq(
            "membership_number", member_data["membership_number"]
        ).eq("status", "completed").order("created_at", desc=True).limit(1).execute()
        
        due_date = "Immediate"
        if last_payment.data:
            from datetime import datetime, timedelta
            last_date = datetime.fromisoformat(last_payment.data[0]["created_at"])
            due_date = (last_date + timedelta(days=30)).strftime("%Y-%m-%d")
        
        return {
            "membership_number": member_data["membership_number"],
            "plan": plan["name"],
            "monthly_fee": plan["monthly_fee"],
            "due_date": due_date,
            "last_payment": last_payment.data[0] if last_payment.data else None
        }
        
    except Exception as e:
        logger.error(f"❌ Upcoming payment error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

# ============================================================
# Helper Functions
# ============================================================

async def calculate_payment_amount(db, member_data: dict, payment_type: str, amount: Optional[float] = None) -> float:
    """Calculate payment amount based on type"""
    
    if payment_type == "registration":
        return member_data.get("registration_fee", 200)
    
    elif payment_type == "monthly":
        plan = PlanConstants.PLANS.get(member_data["plan_type"])
        return plan["monthly_fee"] if plan else 300
    
    elif payment_type == "addon":
        # Add-on for parents (Wazazi plan)
        return 350 * len(member_data.get("parents", []))
    
    elif payment_type == "custom":
        if not amount or amount <= 0:
            raise ValueError("Custom amount required")
        return amount
    
    else:
        raise ValueError(f"Invalid payment type: {payment_type}")

async def monitor_payment_status(checkout_request_id: str, payment_id: str):
    """Background task to monitor payment status"""
    try:
        # Wait for 30 seconds before first check
        import asyncio
        await asyncio.sleep(30)
        
        # Query status up to 3 times
        for attempt in range(3):
            try:
                status = await mpesa_service.query_status(checkout_request_id)
                
                if status.get("ResultCode") == "0":
                    # Payment completed
                    logger.info(f"✅ Payment completed: {checkout_request_id}")
                    break
                elif status.get("ResultCode") == "1037":
                    # Still pending, wait and retry
                    await asyncio.sleep(20)
                else:
                    # Failed or other status
                    logger.warning(f"⚠️ Payment status: {status.get('ResultDesc')}")
                    break
                    
            except Exception as e:
                logger.error(f"❌ Status check attempt {attempt + 1} failed: {str(e)}")
                await asyncio.sleep(10)
                
    except Exception as e:
        logger.error(f"❌ Monitoring error: {str(e)}")
