from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from ..database import get_supabase_client
from ..core.constants import PlanConstants, PaymentConstants
from ..core.exceptions import PaymentException, ValidationException
from ..utils.logger import logger

class PaymentService:
    """Payment business logic service"""
    
    def __init__(self):
        self.db = get_supabase_client()

    async def calculate_amount(
        self,
        db,
        member: Dict[str, Any],
        payment_type: str,
        amount: Optional[float] = None
    ) -> float:
        """Calculate payment amount based on type"""
        
        if payment_type == "registration":
            return member.get("registration_fee", 200)
        
        elif payment_type == "monthly":
            plan = PlanConstants.PLANS.get(member["plan_type"])
            return plan["monthly_fee"] if plan else 300
        
        elif payment_type == "addon":
            # Add-on for parents (Wazazi plan)
            return 350  # Per parent
        
        elif payment_type == "custom":
            if not amount or amount <= 0:
                raise ValidationException("Custom amount required")
            return amount
        
        else:
            raise ValidationException(f"Invalid payment type: {payment_type}")

    async def create_payment(
        self,
        db,
        membership_number: str,
        amount: float,
        payment_type: str,
        phone_number: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a payment record"""
        
        payment_data = {
            "membership_number": membership_number,
            "amount": amount,
            "payment_type": payment_type,
            "payment_method": "mpesa",
            "status": "pending",
            "created_at": datetime.utcnow().isoformat()
        }
        
        if phone_number:
            payment_data["phone_number"] = phone_number
        
        result = db.table("payments").insert(payment_data).execute()
        
        if not result.data:
            raise PaymentException("Failed to create payment record")
        
        logger.info(f"✅ Payment record created: {result.data[0]['id']}")
        return result.data[0]

    async def update_payment_with_mpesa(
        self,
        db,
        payment_id: str,
        checkout_id: str,
        merchant_request_id: str,
        response_code: str,
        response_desc: str
    ) -> Dict[str, Any]:
        """Update payment with M-PESA response"""
        
        update_data = {
            "mpesa_checkout_id": checkout_id,
            "mpesa_merchant_request_id": merchant_request_id,
            "mpesa_response_code": response_code,
            "mpesa_response_desc": response_desc,
            "updated_at": datetime.utcnow().isoformat()
        }
        
        result = db.table("payments").update(update_data).eq(
            "id", payment_id
        ).execute()
        
        if not result.data:
            raise PaymentException("Failed to update payment with M-PESA data")
        
        return result.data[0]

    async def update_payment_status(
        self,
        db,
        payment_id: str,
        status: str,
        result_code: Optional[str] = None,
        result_desc: Optional[str] = None,
        receipt_number: Optional[str] = None,
        amount_paid: Optional[float] = None
    ) -> Dict[str, Any]:
        """Update payment status"""
        
        update_data = {
            "status": status,
            "updated_at": datetime.utcnow().isoformat()
        }
        
        if status == "completed":
            update_data["completed_at"] = datetime.utcnow().isoformat()
        
        if result_code is not None:
            update_data["mpesa_result_code"] = result_code
        
        if result_desc is not None:
            update_data["mpesa_result_desc"] = result_desc
        
        if receipt_number is not None:
            update_data["mpesa_receipt_number"] = receipt_number
        
        if amount_paid is not None:
            update_data["amount_paid"] = amount_paid
        
        result = db.table("payments").update(update_data).eq(
            "id", payment_id
        ).execute()
        
        if not result.data:
            raise PaymentException("Failed to update payment status")
        
        logger.info(f"✅ Payment status updated: {payment_id} → {status}")
        return result.data[0]

    async def get_payment_by_checkout_id(
        self,
        db,
        checkout_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get payment by M-PESA checkout ID"""
        
        result = db.table("payments").select("*").eq(
            "mpesa_checkout_id", checkout_id
        ).execute()
        
        return result.data[0] if result.data else None

    async def get_member_payments(
        self,
        db,
        membership_number: str,
        limit: int = 50,
        offset: int = 0,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get member's payment history"""
        
        query = db.table("payments").select("*").eq(
            "membership_number", membership_number
        )
        
        if status:
            query = query.eq("status", status)
        
        result = query.order("created_at", desc=True).range(
            offset, offset + limit - 1
        ).execute()
        
        return result.data if result.data else []

    async def get_payment_summary(
        self,
        db,
        membership_number: str,
        plan_type: str
    ) -> Dict[str, Any]:
        """Get payment summary for member"""
        
        # Get all completed payments
        payments = db.table("payments").select("*").eq(
            "membership_number", membership_number
        ).eq("status", "completed").execute()
        
        completed = payments.data if payments.data else []
        
        total_paid = sum(p["amount"] for p in completed)
        total_count = len(completed)
        
        # Get last payment
        last_payment = completed[-1] if completed else None
        
        # Calculate upcoming due
        plan = PlanConstants.PLANS.get(plan_type)
        upcoming_due = {
            "amount": plan["monthly_fee"] if plan else 300,
            "due_date": "Immediate",
            "days_overdue": 0
        }
        
        if last_payment:
            last_date = datetime.fromisoformat(last_payment["created_at"])
            due_date = last_date + timedelta(days=30)
            upcoming_due["due_date"] = due_date.strftime("%Y-%m-%d")
            
            days_overdue = (datetime.utcnow() - due_date).days
            upcoming_due["days_overdue"] = max(0, days_overdue)
        
        return {
            "total_paid": total_paid,
            "total_count": total_count,
            "last_payment": last_payment,
            "upcoming_due": upcoming_due
        }

    async def monitor_payment_status(
        self,
        checkout_request_id: str,
        payment_id: str
    ):
        """Background task to monitor payment status"""
        import asyncio
        
        try:
            # Wait for 30 seconds before first check
            await asyncio.sleep(30)
            
            # Query status up to 3 times
            for attempt in range(3):
                try:
                    from .mpesa_service import mpesa_service
                    status = await mpesa_service.query_status(checkout_request_id)
                    
                    if status.get("ResultCode") == "0":
                        # Payment completed - update status
                        await self.update_payment_status(
                            self.db,
                            payment_id,
                            status="completed",
                            result_code=status.get("ResultCode"),
                            result_desc=status.get("ResultDesc")
                        )
                        logger.info(f"✅ Payment completed: {checkout_request_id}")
                        break
                    elif status.get("ResultCode") == "1037":
                        # Still pending, wait and retry
                        await asyncio.sleep(20)
                    else:
                        # Failed or other status
                        await self.update_payment_status(
                            self.db,
                            payment_id,
                            status="failed",
                            result_code=status.get("ResultCode"),
                            result_desc=status.get("ResultDesc")
                        )
                        logger.warning(f"⚠️ Payment failed: {checkout_request_id}")
                        break
                        
                except Exception as e:
                    logger.error(f"❌ Status check attempt {attempt + 1} failed: {str(e)}")
                    await asyncio.sleep(10)
                    
        except Exception as e:
            logger.error(f"❌ Monitoring error: {str(e)}")

# Singleton instance
payment_service = PaymentService()
