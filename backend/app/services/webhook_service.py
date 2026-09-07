from typing import Dict, Any, Optional
from datetime import datetime
from ..database import get_supabase_client
from ..utils.logger import logger
from .mpesa_service import mpesa_service
from ..core.constants import PaymentConstants

class WebhookService:
    """Handle external webhooks (M-PESA, etc.)"""
    
    def __init__(self):
        self.db = get_supabase_client()

    async def process_mpesa_callback(self, callback_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process M-PESA STK Push callback from Safaricom
        
        Sample callback structure:
        {
            "Body": {
                "stkCallback": {
                    "MerchantRequestID": "...",
                    "CheckoutRequestID": "...",
                    "ResultCode": 0,
                    "ResultDesc": "Success",
                    "CallbackMetadata": {
                        "Item": [
                            {"Name": "Amount", "Value": 300},
                            {"Name": "MpesaReceiptNumber", "Value": "..."},
                            {"Name": "TransactionDate", "Value": "..."},
                            {"Name": "PhoneNumber", "Value": "..."}
                        ]
                    }
                }
            }
        }
        """
        try:
            body = callback_data.get("Body", {})
            stk_callback = body.get("stkCallback", {})
            
            merchant_request_id = stk_callback.get("MerchantRequestID")
            checkout_request_id = stk_callback.get("CheckoutRequestID")
            result_code = stk_callback.get("ResultCode")
            result_desc = stk_callback.get("ResultDesc")
            
            logger.info(f"📩 Received M-PESA callback: {checkout_request_id}")
            
            # Find payment record
            payment = self.db.table("payments").select("*").eq(
                "mpesa_checkout_id", checkout_request_id
            ).execute()
            
            if not payment.data:
                logger.error(f"❌ Payment record not found: {checkout_request_id}")
                return {"ResultCode": 1, "ResultDesc": "Payment record not found"}
            
            payment_record = payment.data[0]
            
            # Determine payment status
            if result_code == 0:
                # Successful payment
                metadata = stk_callback.get("CallbackMetadata", {})
                items = {item["Name"]: item["Value"] for item in metadata.get("Item", [])}
                
                # Update payment record
                update_data = {
                    "status": "completed",
                    "mpesa_result_code": str(result_code),
                    "mpesa_result_desc": result_desc,
                    "mpesa_receipt_number": items.get("MpesaReceiptNumber"),
                    "amount_paid": items.get("Amount", payment_record["amount"]),
                    "mpesa_transaction_date": items.get("TransactionDate"),
                    "completed_at": datetime.utcnow().isoformat()
                }
                
                # Update in database
                result = self.db.table("payments").update(update_data).eq(
                    "id", payment_record["id"]
                ).execute()
                
                logger.info(f"✅ Payment completed: {checkout_request_id}")
                
                # Update member subscription status if monthly payment
                if payment_record["payment_type"] == "monthly":
                    await self._update_member_subscription(payment_record["membership_number"])
                
                # Send confirmation (email/SMS)
                await self._send_payment_confirmation(payment_record, items.get("MpesaReceiptNumber"))
                
            else:
                # Failed payment
                update_data = {
                    "status": "failed",
                    "mpesa_result_code": str(result_code),
                    "mpesa_result_desc": result_desc,
                    "completed_at": datetime.utcnow().isoformat()
                }
                
                result = self.db.table("payments").update(update_data).eq(
                    "id", payment_record["id"]
                ).execute()
                
                logger.warning(f"⚠️ Payment failed: {checkout_request_id} - {result_desc}")
            
            return {
                "ResultCode": 0,
                "ResultDesc": "Success",
                "PaymentStatus": "completed" if result_code == 0 else "failed"
            }
            
        except Exception as e:
            logger.error(f"❌ Webhook processing error: {str(e)}")
            # Return success to M-PESA to prevent retries
            return {"ResultCode": 0, "ResultDesc": "Accepted"}

    async def _update_member_subscription(self, membership_number: str):
        """Update member subscription status after successful monthly payment"""
        try:
            # Update member's last payment date
            result = self.db.table("members").update({
                "last_payment_date": datetime.utcnow().isoformat(),
                "subscription_status": "active"
            }).eq("membership_number", membership_number).execute()
            
            logger.info(f"✅ Member subscription updated: {membership_number}")
            return result
            
        except Exception as e:
            logger.error(f"❌ Failed to update subscription: {str(e)}")

    async def _send_payment_confirmation(self, payment: Dict, receipt: Optional[str] = None):
        """Send payment confirmation to member"""
        try:
            # Get member details
            member = self.db.table("members").select("email", "phone", "first_name").eq(
                "membership_number", payment["membership_number"]
            ).execute()
            
            if not member.data:
                logger.warning(f"⚠️ Member not found: {payment['membership_number']}")
                return
            
            member_data = member.data[0]
            
            # Email notification (async)
            await self._send_email(
                to=member_data["email"],
                subject="Payment Confirmation - Masika Benevolent",
                template="payment_confirmation",
                data={
                    "name": member_data["first_name"],
                    "amount": payment["amount"],
                    "receipt": receipt,
                    "type": payment["payment_type"]
                }
            )
            
            # SMS notification (async)
            await self._send_sms(
                phone=member_data["phone"],
                message=f"Masika: Payment of KES {payment['amount']} received. Receipt: {receipt or 'pending'}"
            )
            
            logger.info(f"📧 Payment confirmation sent to {member_data['email']}")
            
        except Exception as e:
            logger.error(f"❌ Failed to send confirmation: {str(e)}")

    async def _send_email(self, to: str, subject: str, template: str, data: Dict):
        """Send email (implement with SendGrid, SES, etc.)"""
        # Implement email sending logic
        pass

    async def _send_sms(self, phone: str, message: str):
        """Send SMS (implement with AfricasTalking, Twilio, etc.)"""
        # Implement SMS sending logic
        pass

webhook_service = WebhookService()
