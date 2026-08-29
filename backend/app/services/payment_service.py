"""
Payment Service - Business Logic for Payments
"""

import logging
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID

from app.database import get_supabase
from app.models import PaymentCreate, PaymentUpdate, PaymentStatusEnum
from app.exceptions import NotFoundError, ValidationError

logger = logging.getLogger(__name__)


class PaymentService:
    """Service for payment operations."""
    
    def __init__(self):
        self.supabase = get_supabase()
    
    # ============================================================
    # PAYMENT CRUD
    # ============================================================
    
    async def create_payment(self, data: PaymentCreate) -> Dict[str, Any]:
        """Create a new payment record."""
        payment_data = {
            "member_id": str(data.member_id),
            "amount": data.amount,
            "payment_type": data.payment_type.value,
            "mpesa_receipt": data.mpesa_receipt,
            "paybill_number": data.paybill_number,
            "account_number": data.account_number,
            "status": data.status.value,
            "notes": data.notes,
        }
        
        if data.status == PaymentStatusEnum.CONFIRMED:
            payment_data["confirmed_at"] = datetime.now().isoformat()
        
        result = self.supabase.table("payments").insert(payment_data).execute()
        
        if not result.data:
            raise ValidationError("Failed to create payment")
        
        # Update member registration fee status if registration payment
        if data.payment_type.value == "registration" and data.status == PaymentStatusEnum.CONFIRMED:
            self.supabase.table("members").update({
                "registration_fee_paid": True,
                "coverage_start_date": datetime.now().isoformat()
            }).eq("id", str(data.member_id)).execute()
        
        return result.data[0]
    
    async def confirm_payment(
        self, 
        member_id: UUID, 
        amount: float, 
        receipt: str,
        payment_type: str = "registration"
    ) -> Dict[str, Any]:
        """Confirm a payment."""
        # Check if payment already exists
        existing = self.supabase.table("payments").select("*").eq("member_id", str(member_id)).eq("payment_type", payment_type).eq("status", "confirmed").execute()
        
        if existing.data:
            return {
                "already_confirmed": True,
                "payment": existing.data[0]
            }
        
        # Create payment
        payment_data = {
            "member_id": str(member_id),
            "amount": amount,
            "payment_type": payment_type,
            "mpesa_receipt": receipt,
            "paybill_number": "348127",
            "status": "confirmed",
            "confirmed_at": datetime.now().isoformat()
        }
        
        result = self.supabase.table("payments").insert(payment_data).execute()
        
        if not result.data:
            raise ValidationError("Failed to confirm payment")
        
        # Update member
        self.supabase.table("members").update({
            "registration_fee_paid": True,
            "coverage_start_date": (datetime.now().isoformat())
        }).eq("id", str(member_id)).execute()
        
        return result.data[0]
    
    async def get_payments(
        self,
        member_id: Optional[UUID] = None,
        status: Optional[str] = None,
        page: int = 1,
        limit: int = 20
    ) -> Dict[str, Any]:
        """Get paginated list of payments."""
        query = self.supabase.table("payments").select("*")
        
        if member_id:
            query = query.eq("member_id", str(member_id))
        if status:
            query = query.eq("status", status)
        
        # Get total count
        count_result = self.supabase.table("payments").select("id", count="exact").execute()
        total = count_result.count or 0
        
        # Paginate
        offset = (page - 1) * limit
        result = query.order("payment_date", desc=True).range(offset, offset + limit - 1).execute()
        
        return {
            "payments": result.data or [],
            "total": total,
            "page": page,
            "limit": limit,
            "pages": (total + limit - 1) // limit if total else 1
        }
    
    async def update_payment(self, payment_id: UUID, update: PaymentUpdate) -> Dict[str, Any]:
        """Update payment status."""
        payment = self.supabase.table("payments").select("*").eq("id", str(payment_id)).execute()
        
        if not payment.data:
            raise NotFoundError("Payment", str(payment_id))
        
        update_data = {"status": update.status.value}
        
        if update.mpesa_receipt:
            update_data["mpesa_receipt"] = update.mpesa_receipt
        if update.notes:
            update_data["notes"] = update.notes
        
        if update.status == PaymentStatusEnum.CONFIRMED:
            update_data["confirmed_at"] = datetime.now().isoformat()
        
        result = self.supabase.table("payments").update(update_data).eq("id", str(payment_id)).execute()
        
        return result.data[0] if result.data else None
    
    async def get_revenue_summary(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> Dict[str, Any]:
        """Get revenue summary."""
        query = self.supabase.table("payments").select("amount, status, payment_type, payment_date")
        
        if start_date:
            query = query.gte("payment_date", start_date)
        if end_date:
            query = query.lte("payment_date", end_date)
        
        result = query.execute()
        payments = result.data or []
        
        # Calculate totals
        total = 0
        confirmed = 0
        pending = 0
        failed = 0
        by_type = {}
        
        for p in payments:
            amount = float(p.get("amount", 0))
            status = p.get("status", "")
            
            total += amount
            
            if status == "confirmed":
                confirmed += amount
            elif status == "pending":
                pending += amount
            elif status == "failed":
                failed += amount
            
            ptype = p.get("payment_type", "unknown")
            if ptype not in by_type:
                by_type[ptype] = 0
            by_type[ptype] += amount
        
        return {
            "total": total,
            "confirmed": confirmed,
            "pending": pending,
            "failed": failed,
            "by_type": by_type,
            "count": len(payments)
        }


# ============================================================
# SINGLETON
# ============================================================

payment_service = PaymentService()
