"""
Payment Service - Production M-Pesa Integration
"""

import os
import json
import base64
import logging
import time
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID

import httpx
from fastapi import HTTPException, status

from app.database import get_supabase
from app.models import PaymentCreate, PaymentUpdate, PaymentStatusEnum
from app.exceptions import NotFoundError, ValidationError
from app.config import settings
from app.utils.helpers import normalize_phone

logger = logging.getLogger(__name__)


class PaymentService:
    """Service for payment operations with M-Pesa integration."""
    
    def __init__(self):
        self.supabase = get_supabase()
        self._access_token = None
        self._token_expiry = None
        
        # M-Pesa API Configuration (Production)
        self.CONSUMER_KEY = os.getenv("MPESA_CONSUMER_KEY")
        self.CONSUMER_SECRET = os.getenv("MPESA_CONSUMER_SECRET")
        self.PASSKEY = os.getenv("MPESA_PASSKEY")
        self.SHORTCODE = os.getenv("MPESA_SHORTCODE", "348127")
        self.CALLBACK_URL = os.getenv("MPESA_CALLBACK_URL", "https://masika-c921.onrender.com/api/webhooks/mpesa")
        self.ENVIRONMENT = os.getenv("MPESA_ENVIRONMENT", "sandbox")
        
        # Production URLs
        self.BASE_URL = "https://api.safaricom.co.ke"
        self.OAUTH_URL = f"{self.BASE_URL}/oauth/v1/generate"
        self.STK_PUSH_URL = f"{self.BASE_URL}/mpesa/stkpush/v1/processrequest"
        self.STK_QUERY_URL = f"{self.BASE_URL}/mpesa/stkpushquery/v1/query"
        
        # Log configuration (mask sensitive data)
        logger.info(f"M-Pesa Environment: {self.ENVIRONMENT}")
        logger.info(f"M-Pesa Shortcode: {self.SHORTCODE}")
        logger.info(f"M-Pesa Callback URL: {self.CALLBACK_URL}")
        logger.info(f"Consumer Key configured: {'Yes' if self.CONSUMER_KEY else 'No'}")
    
    # ============================================================
    # AUTHENTICATION - M-PESA
    # ============================================================
    
    async def _get_access_token(self) -> str:
        """Get M-Pesa access token."""
        # Return cached token if valid
        if self._access_token and self._token_expiry and time.time() < self._token_expiry:
            return self._access_token
        
        if not self.CONSUMER_KEY or not self.CONSUMER_SECRET:
            logger.error("M-Pesa credentials not configured")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Payment service not configured"
            )
        
        try:
            # Encode credentials
            credentials = base64.b64encode(
                f"{self.CONSUMER_KEY}:{self.CONSUMER_SECRET}".encode()
            ).decode("utf-8")
            
            logger.info("Requesting M-Pesa access token...")
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    self.OAUTH_URL,
                    headers={"Authorization": f"Basic {credentials}"}
                )
                
                if response.status_code != 200:
                    logger.error(f"Failed to get access token: {response.text}")
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Payment service unavailable. Please try again later."
                    )
                
                data = response.json()
                self._access_token = data.get("access_token")
                expires_in = data.get("expires_in", 3600)
                self._token_expiry = time.time() + expires_in - 60  # Buffer 60 seconds
                
                logger.info("M-Pesa access token obtained successfully")
                return self._access_token
                
        except httpx.TimeoutException:
            logger.error("M-Pesa API timeout")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Payment service timeout. Please try again."
            )
        except Exception as e:
            logger.error(f"Access token error: {e}")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Payment service unavailable. Please try again later."
            )
    
    # ============================================================
    # STK PUSH - LIPA NA M-PESA ONLINE
    # ============================================================
    
    async def initiate_stk_push(
        self,
        phone: str,
        amount: float,
        account_reference: str,
        transaction_desc: str = "Membership Registration"
    ) -> Dict[str, Any]:
        """
        Initiate M-Pesa STK Push payment.
        
        Args:
            phone: Phone number (format: 254XXXXXXXXX)
            amount: Amount to charge
            account_reference: Member number or invoice number
            transaction_desc: Description of transaction
        
        Returns:
            Checkout request ID and status
        """
        # Normalize phone
        phone = normalize_phone(phone)
        
        # Ensure phone is in correct format (254XXXXXXXXX)
        if phone.startswith("0"):
            phone = "254" + phone[1:]
        elif phone.startswith("+"):
            phone = phone[1:]
        
        # Validate phone length
        if len(phone) != 12 or not phone.startswith("254"):
            raise ValidationError("Invalid phone number format. Please use a valid Safaricom number.")
        
        logger.info(f"STK Push Initiated: Phone={phone}, Amount={amount}, Ref={account_reference}")
        
        # Get access token
        access_token = await self._get_access_token()
        
        # Generate timestamp
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        
        # Generate password
        password_str = f"{self.SHORTCODE}{self.PASSKEY}{timestamp}"
        password = base64.b64encode(password_str.encode()).decode("utf-8")
        
        # Prepare request payload
        payload = {
            "BusinessShortCode": self.SHORTCODE,
            "Password": password,
            "Timestamp": timestamp,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": int(amount),
            "PartyA": phone,
            "PartyB": self.SHORTCODE,
            "PhoneNumber": phone,
            "CallBackURL": self.CALLBACK_URL,
            "AccountReference": account_reference[:12],
            "TransactionDesc": transaction_desc[:36],
        }
        
        logger.info(f"STK Push Payload: {json.dumps({**payload, 'Password': '***'})}")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    self.STK_PUSH_URL,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json"
                    }
                )
                
                logger.info(f"STK Push Response Status: {response.status_code}")
                
                if response.status_code != 200:
                    logger.error(f"STK Push Failed: {response.text}")
                    return {
                        "checkout_request_id": None,
                        "merchant_request_id": None,
                        "response_code": str(response.status_code),
                        "response_description": "Payment initiation failed. Please try again.",
                        "status": "failed",
                        "error": response.text
                    }
                
                data = response.json()
                logger.info(f"STK Push Response: {json.dumps(data)}")
                
                response_code = data.get("ResponseCode")
                response_desc = data.get("ResponseDescription", "Payment initiation failed")
                
                if response_code != "0":
                    # Payment initiation failed
                    return {
                        "checkout_request_id": data.get("CheckoutRequestID"),
                        "merchant_request_id": data.get("MerchantRequestID"),
                        "response_code": response_code,
                        "response_description": response_desc,
                        "status": "failed"
                    }
                
                checkout_request_id = data.get("CheckoutRequestID")
                merchant_request_id = data.get("MerchantRequestID")
                
                # Create payment record
                payment_data = {
                    "member_id": None,  # Will be updated when member confirms
                    "amount": amount,
                    "payment_type": "registration",
                    "status": "pending",
                    "mpesa_receipt": checkout_request_id,  # Store checkout ID as receipt
                    "paybill_number": self.SHORTCODE,
                    "account_number": account_reference,
                    "checkout_request_id": checkout_request_id,
                    "merchant_request_id": merchant_request_id,
                    "notes": transaction_desc,
                    "phone": phone
                }
                
                result = self.supabase.table("payments").insert(payment_data).execute()
                payment_id = result.data[0]["id"] if result.data else None
                
                logger.info(f"STK Push Successful: CheckoutID={checkout_request_id}")
                
                return {
                    "checkout_request_id": checkout_request_id,
                    "merchant_request_id": merchant_request_id,
                    "response_code": response_code,
                    "response_description": response_desc,
                    "status": "pending",
                    "payment_id": payment_id
                }
                
        except httpx.TimeoutException:
            logger.error("M-Pesa STK Push Timeout")
            return {
                "checkout_request_id": None,
                "merchant_request_id": None,
                "response_code": "TIMEOUT",
                "response_description": "Payment request timed out. Please try again.",
                "status": "failed"
            }
        except Exception as e:
            logger.error(f"STK Push Error: {e}")
            return {
                "checkout_request_id": None,
                "merchant_request_id": None,
                "response_code": "ERROR",
                "response_description": f"Payment initiation failed: {str(e)}",
                "status": "failed"
            }
    
    # ============================================================
    # STK PUSH QUERY
    # ============================================================
    
    async def query_stk_status(self, checkout_request_id: str) -> Dict[str, Any]:
        """
        Query the status of an STK Push transaction.
        
        Args:
            checkout_request_id: The checkout request ID from STK Push
            
        Returns:
            Transaction status
        """
        # Check if already confirmed in database
        existing = self.supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
        
        if existing.data and existing.data[0].get("status") == "confirmed":
            return {
                "result_code": "0",
                "result_desc": "Success",
                "status": "confirmed",
                "payment": existing.data[0]
            }
        
        # Get access token
        access_token = await self._get_access_token()
        
        # Generate timestamp
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        
        # Generate password
        password_str = f"{self.SHORTCODE}{self.PASSKEY}{timestamp}"
        password = base64.b64encode(password_str.encode()).decode("utf-8")
        
        payload = {
            "BusinessShortCode": self.SHORTCODE,
            "Password": password,
            "Timestamp": timestamp,
            "CheckoutRequestID": checkout_request_id
        }
        
        logger.info(f"STK Query: {checkout_request_id}")
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    self.STK_QUERY_URL,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json"
                    }
                )
                
                if response.status_code != 200:
                    logger.error(f"STK Query Failed: {response.text}")
                    return {
                        "result_code": "FAILED",
                        "result_desc": "Query failed",
                        "status": "failed"
                    }
                
                data = response.json()
                logger.info(f"STK Query Response: {json.dumps(data)}")
                
                result_code = data.get("ResultCode")
                result_desc = data.get("ResultDesc", "Unknown")
                
                if result_code == "0":
                    # Payment successful - extract details
                    metadata = data.get("CallbackMetadata", {})
                    items = metadata.get("Item", [])
                    
                    amount = None
                    receipt = None
                    
                    for item in items:
                        if item.get("Name") == "Amount":
                            amount = item.get("Value")
                        elif item.get("Name") == "MpesaReceiptNumber":
                            receipt = item.get("Value")
                    
                    # Update payment record
                    update_data = {
                        "status": "confirmed",
                        "confirmed_at": datetime.now().isoformat(),
                        "mpesa_receipt": receipt or checkout_request_id,
                        "amount": amount or None
                    }
                    
                    self.supabase.table("payments").update(update_data).eq("checkout_request_id", checkout_request_id).execute()
                    
                    # Update member registration status
                    payment = self.supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
                    if payment.data and payment.data[0].get("member_id"):
                        self.supabase.table("members").update({
                            "registration_fee_paid": True,
                            "coverage_start_date": datetime.now().isoformat()
                        }).eq("id", payment.data[0]["member_id"]).execute()
                    
                    return {
                        "result_code": result_code,
                        "result_desc": result_desc,
                        "status": "confirmed",
                        "amount": amount,
                        "receipt": receipt
                    }
                    
                elif result_code in ["1037", "1032"]:
                    # Pending
                    return {
                        "result_code": result_code,
                        "result_desc": result_desc,
                        "status": "pending"
                    }
                else:
                    # Failed
                    return {
                        "result_code": result_code,
                        "result_desc": result_desc,
                        "status": "failed"
                    }
                    
        except Exception as e:
            logger.error(f"STK Query Error: {e}")
            return {
                "result_code": "ERROR",
                "result_desc": f"Query failed: {str(e)}",
                "status": "failed"
            }
    
    # ============================================================
    # WEBHOOK HANDLING
    # ============================================================
    
    async def handle_mpesa_webhook(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handle M-Pesa webhook callback.
        
        This is called by Safaricom when payment is completed.
        """
        logger.info(f"M-Pesa Webhook Received: {json.dumps(payload)}")
        
        try:
            # Extract body
            body = payload.get("Body", {})
            stk_callback = body.get("stkCallback", {})
            
            checkout_request_id = stk_callback.get("CheckoutRequestID")
            result_code = stk_callback.get("ResultCode")
            result_desc = stk_callback.get("ResultDesc")
            metadata = stk_callback.get("CallbackMetadata", {})
            
            if not checkout_request_id:
                logger.warning("No CheckoutRequestID in webhook")
                return {"ResultCode": 1, "ResultDesc": "No CheckoutRequestID"}
            
            logger.info(f"Processing webhook: CheckoutID={checkout_request_id}, ResultCode={result_code}")
            
            # Find payment record
            payment = self.supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
            
            if not payment.data:
                logger.warning(f"Payment not found: {checkout_request_id}")
                return {"ResultCode": 1, "ResultDesc": "Payment not found"}
            
            payment_data = payment.data[0]
            
            if result_code == "0":
                # Payment successful
                items = metadata.get("Item", [])
                amount = None
                receipt = None
                phone = None
                
                for item in items:
                    if item.get("Name") == "Amount":
                        amount = item.get("Value")
                    elif item.get("Name") == "MpesaReceiptNumber":
                        receipt = item.get("Value")
                    elif item.get("Name") == "PhoneNumber":
                        phone = item.get("Value")
                
                # Update payment
                update_data = {
                    "status": "confirmed",
                    "confirmed_at": datetime.now().isoformat(),
                    "mpesa_receipt": receipt or payment_data.get("mpesa_receipt"),
                    "amount": amount or payment_data.get("amount"),
                    "webhook_response": json.dumps(payload)
                }
                
                result = self.supabase.table("payments").update(update_data).eq("id", payment_data["id"]).execute()
                
                # Update member registration status
                if payment_data.get("member_id"):
                    self.supabase.table("members").update({
                        "registration_fee_paid": True,
                        "coverage_start_date": datetime.now().isoformat()
                    }).eq("id", payment_data["member_id"]).execute()
                    
                    logger.info(f"Payment confirmed for member: {payment_data['member_id']}")
                
                logger.info(f"Payment confirmed: {checkout_request_id}, Receipt: {receipt}")
                
                return {"ResultCode": 0, "ResultDesc": "Success"}
            else:
                # Payment failed
                update_data = {
                    "status": "failed",
                    "notes": f"Webhook: {result_desc}",
                    "webhook_response": json.dumps(payload)
                }
                
                self.supabase.table("payments").update(update_data).eq("id", payment_data["id"]).execute()
                
                logger.warning(f"Payment failed: {checkout_request_id} - {result_desc}")
                
                return {"ResultCode": 0, "ResultDesc": "Payment failed recorded"}
                
        except Exception as e:
            logger.error(f"Webhook processing error: {e}")
            return {"ResultCode": 1, "ResultDesc": f"Processing failed: {str(e)}"}
    
    # ============================================================
    # PROCESS MEMBER PAYMENT
    # ============================================================
    
    async def process_member_payment(
        self,
        member_id: UUID,
        phone: str,
        amount: float,
        transaction_desc: str = "Membership Registration"
    ) -> Dict[str, Any]:
        """
        Process a member payment with STK Push.
        
        Args:
            member_id: Member ID
            phone: Phone number
            amount: Amount to charge
            transaction_desc: Description
            
        Returns:
            STK Push result
        """
        # Get member
        member = self.supabase.table("members").select("*").eq("id", str(member_id)).execute()
        
        if not member.data:
            raise NotFoundError("Member", str(member_id))
        
        member_data = member.data[0]
        
        # Check if already paid
        if member_data.get("registration_fee_paid"):
            raise ValidationError("Member has already paid registration fee")
        
        # Normalize phone
        phone = normalize_phone(phone)
        
        # Account reference
        account_reference = member_data.get("member_number", f"MEM-{str(member_id)[:8]}")
        
        # Initiate STK Push
        result = await self.initiate_stk_push(
            phone=phone,
            amount=amount,
            account_reference=account_reference,
            transaction_desc=transaction_desc
        )
        
        # Update payment record with member_id
        if result.get("payment_id") and result.get("status") != "failed":
            self.supabase.table("payments").update({
                "member_id": str(member_id),
                "phone": phone
            }).eq("id", result["payment_id"]).execute()
        
        return {
            "success": result.get("response_code") == "0",
            "checkout_request_id": result.get("checkout_request_id"),
            "merchant_request_id": result.get("merchant_request_id"),
            "message": result.get("response_description", "Payment initiated"),
            "status": result.get("status", "pending"),
            "payment_id": result.get("payment_id")
        }
    
    # ============================================================
    # EXISTING PAYMENT METHODS
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
        
        return result.data[0]
    
    async def confirm_payment(
        self, 
        member_id: UUID, 
        amount: float, 
        receipt: str,
        payment_type: str = "registration"
    ) -> Dict[str, Any]:
        """Confirm a payment."""
        existing = self.supabase.table("payments").select("*").eq("member_id", str(member_id)).eq("payment_type", payment_type).eq("status", "confirmed").execute()
        
        if existing.data:
            return {
                "already_confirmed": True,
                "payment": existing.data[0]
            }
        
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
        
        self.supabase.table("members").update({
            "registration_fee_paid": True,
            "coverage_start_date": datetime.now().isoformat()
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
        
        count_result = self.supabase.table("payments").select("id", count="exact").execute()
        total = count_result.count or 0
        
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
