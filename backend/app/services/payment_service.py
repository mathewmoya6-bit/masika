"""
Payment Service - Production M-Pesa Integration
"""

import os
import json
import base64
import calendar
import logging
import time
from datetime import date, datetime
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

        # See query_stk_status() rate-limit guard: tracks last time we
        # actually hit Safaricom's stkpushquery endpoint per
        # checkout_request_id, so rapid frontend polling doesn't trip
        # Safaricom's spike-arrest burst limit.
        self._last_stk_query_at: Dict[str, float] = {}
        self.MIN_QUERY_INTERVAL_SECONDS = 5.0
        
        # M-Pesa API Configuration (Production)
        self.CONSUMER_KEY = os.getenv("MPESA_CONSUMER_KEY")
        self.CONSUMER_SECRET = os.getenv("MPESA_CONSUMER_SECRET")
        self.PASSKEY = os.getenv("MPESA_PASSKEY")
        self.SHORTCODE = os.getenv("MPESA_SHORTCODE", "348127")
        self.CALLBACK_URL = os.getenv("MPESA_CALLBACK_URL", "https://masika-c921.onrender.com/api/webhooks/mpesa")
        self.ENVIRONMENT = os.getenv("MPESA_ENVIRONMENT", "sandbox")
        
        # Production URLs
        self.BASE_URL = "https://api.safaricom.co.ke"
        # FIX: Daraja's OAuth endpoint requires grant_type=client_credentials
        # as a query param. Without it, Safaricom returns 400.008.02
        # "Invalid grant type passed" before even checking the credentials —
        # which was surfacing to users as the generic 503
        # "Payment service unavailable" below.
        self.OAUTH_URL = f"{self.BASE_URL}/oauth/v1/generate?grant_type=client_credentials"
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

        # Also short-circuit on an already-recorded failure. Without this,
        # once the real webhook records a genuine failure, every
        # subsequent frontend poll (every few seconds) would keep hitting
        # Safaricom's query API for a result that's already known --
        # needlessly burning into the rate limit below.
        if existing.data and existing.data[0].get("status") == "failed":
            return {
                "result_code": "FAILED",
                "result_desc": existing.data[0].get("notes") or "Payment failed",
                "status": "failed",
                "payment": existing.data[0]
            }

        # ------------------------------------------------------------
        # RATE LIMIT GUARD
        #
        # Safaricom's stkpushquery endpoint enforces a very tight "spike
        # arrest" burst limit (maxBurstMessageCount=2.5). The frontend
        # polls this status endpoint every few seconds while a payment
        # is pending, and previously EVERY poll triggered a fresh call
        # to Safaricom -- a handful of polls in quick succession (plus
        # any concurrent users) is enough to trip
        # "policies.ratelimit.SpikeArrestViolation" and get back a 429.
        #
        # When that happened, the code below returned status="failed"
        # to the frontend purely because OUR OWN polling got throttled --
        # not because the payment actually failed. The real webhook may
        # still be about to arrive with the true result.
        #
        # Fix: only actually call Safaricom at most once every
        # MIN_QUERY_INTERVAL_SECONDS per checkout_request_id. Polls that
        # land inside that window just return the current DB status
        # (usually "pending") instead of re-querying Safaricom.
        # ------------------------------------------------------------
        now = time.time()
        last_queried = self._last_stk_query_at.get(checkout_request_id)
        if last_queried is not None and (now - last_queried) < self.MIN_QUERY_INTERVAL_SECONDS:
            current_status = existing.data[0].get("status") if existing.data else "pending"
            return {
                "result_code": None,
                "result_desc": "Awaiting confirmation",
                "status": current_status
            }
        self._last_stk_query_at[checkout_request_id] = now
        
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
                
                if response.status_code == 429:
                    # Safaricom's spike-arrest limit — this tells us
                    # nothing about the payment itself. Report "pending"
                    # (not "failed") so the frontend keeps waiting for
                    # the real webhook instead of showing a false
                    # decline to the user.
                    logger.warning(f"STK Query rate-limited (429): {response.text}")
                    current_status = existing.data[0].get("status") if existing.data else "pending"
                    return {
                        "result_code": None,
                        "result_desc": "Awaiting confirmation",
                        "status": current_status if current_status != "failed" else "pending"
                    }

                if response.status_code != 200:
                    logger.error(f"STK Query Failed: {response.text}")
                    return {
                        "result_code": "FAILED",
                        "result_desc": "Query failed",
                        "status": "failed"
                    }
                
                data = response.json()
                logger.info(f"STK Query Response: {json.dumps(data)}")
                
                # Safaricom's stkpushquery endpoint sends ResultCode as a
                # STRING ("0"). Normalize with str() anyway so this keeps
                # working even if that ever changes -- see the note on
                # handle_mpesa_webhook() below for why this matters.
                result_code = data.get("ResultCode")
                result_code_str = str(result_code).strip() if result_code is not None else None
                result_desc = data.get("ResultDesc", "Unknown")
                
                if result_code_str == "0":
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
                    
                    # Update member registration status.
                    # See _mark_member_paid() for why coverage_start_date
                    # is set to the end of the waiting period, not "now".
                    payment = self.supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
                    if payment.data and payment.data[0].get("member_id"):
                        self._mark_member_paid(payment.data[0]["member_id"])
                    
                    return {
                        "result_code": result_code_str,
                        "result_desc": result_desc,
                        "status": "confirmed",
                        "amount": amount,
                        "receipt": receipt
                    }
                    
                elif result_code_str in ("1037", "1032"):
                    # Pending / not yet actioned by the user. IMPORTANT:
                    # this branch deliberately does NOT write "failed" to
                    # the payments row -- these codes commonly show up
                    # when this query is run seconds after the STK push,
                    # before the user has entered their PIN. Writing
                    # "failed" here would poison the row before the real
                    # async webhook (handle_mpesa_webhook) has a chance
                    # to record the actual outcome.
                    return {
                        "result_code": result_code_str,
                        "result_desc": result_desc,
                        "status": "pending"
                    }
                else:
                    # Failed
                    return {
                        "result_code": result_code_str,
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
    # MEMBER ACTIVATION HELPERS
    # ============================================================

    @staticmethod
    def _add_months(d: date, months: int) -> date:
        """Calendar-correct month addition, mirroring
        membership_service.MembershipService._add_months() so the date
        payment_service writes as coverage_start_date is computed the
        exact same way membership_service later reads it back for
        eligibility checks. Clamps the day if the target month is
        shorter (e.g. Jan 31 + 1 month -> Feb 28/29)."""
        month_index = d.month - 1 + int(months)
        year = d.year + month_index // 12
        month = month_index % 12 + 1
        day = min(d.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)

    def _get_waiting_period_months(self, member_id: str) -> int:
        """waiting_period_months lives on `memberships`, not `members` --
        it's set at signup time in member_service.create_member() from
        the chosen plan. Falls back to 1 month (matching
        membership_service.DEFAULT_WAITING_PERIOD_MONTHS) if no
        membership row is found or the column is unset."""
        try:
            result = (
                self.supabase.table("memberships")
                .select("waiting_period_months")
                .eq("member_id", member_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if result.data:
                months = result.data[0].get("waiting_period_months")
                if months is not None:
                    return int(months)
        except Exception as e:
            logger.warning(f"Could not fetch waiting_period_months for member {member_id}: {e}")
        return 1

    def _mark_member_paid(self, member_id: str) -> None:
        """
        Marks a member's registration fee as paid AND sets when their
        coverage actually starts.

        IMPORTANT: coverage_start_date is the END of the waiting period
        (registration_date + waiting_period_months), not the moment of
        payment. Setting it to "now" would let a member access benefits
        immediately after paying, bypassing the waiting period that
        membership_service.get_card_status() is supposed to enforce.

        registration_date is still recorded as today -- that's the
        payment/registration event date, and is what get_card_status()
        adds the waiting period on top of.
        """
        registration_date = date.today()
        waiting_months = self._get_waiting_period_months(member_id)
        activation_date = self._add_months(registration_date, waiting_months)

        self.supabase.table("members").update({
            "registration_fee_paid": True,
            "registration_date": registration_date.isoformat(),
            "coverage_start_date": activation_date.isoformat()
        }).eq("id", member_id).execute()

        logger.info(
            f"Member {member_id} marked paid: registration_date={registration_date.isoformat()}, "
            f"waiting_period_months={waiting_months}, coverage_start_date={activation_date.isoformat()}"
        )

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

            # ------------------------------------------------------
            # FIX (2026-09-07): Safaricom's ASYNC STK callback sends
            # ResultCode as a JSON NUMBER (0), not a string ("0") --
            # unlike the synchronous stkpushquery endpoint used in
            # query_stk_status() above, which does send it as a string.
            # Comparing `result_code == "0"` here was ALWAYS False, so
            # every genuinely successful payment fell into the "else"
            # branch below and got written to the DB as status="failed".
            # Confirmed by production logs on 2026-09-07: three separate
            # STK pushes (ws_CO_07092026144824172703738707,
            # ws_CO_07092026145109114703738707,
            # ws_CO_07092026145150165703738342) each logged
            # "Payment failed via webhook" immediately on receiving the
            # webhook, with no other explanation for a 100% failure rate.
            #
            # Normalizing both sides to str() makes this correct
            # regardless of whether Safaricom sends an int, a string, or
            # (per some Daraja sandbox responses) a float.
            #
            # NOTE: this fix only takes effect once webhooks.py's /mpesa
            # route actually calls this method -- previously that route
            # parsed the callback into an unrelated flat model
            # (MpesaWebhookData) that never matched Safaricom's real
            # payload shape, so this function was never invoked at all
            # on production traffic. Fixed the same day by rewriting
            # webhooks.py to delegate here directly.
            # ------------------------------------------------------
            result_code = stk_callback.get("ResultCode")
            result_code_str = str(result_code).strip() if result_code is not None else None

            result_desc = stk_callback.get("ResultDesc")
            metadata = stk_callback.get("CallbackMetadata", {})
            
            if not checkout_request_id:
                logger.warning("No CheckoutRequestID in webhook")
                return {"ResultCode": 1, "ResultDesc": "No CheckoutRequestID"}
            
            logger.info(
                f"Processing webhook: CheckoutID={checkout_request_id}, "
                f"ResultCode={result_code!r} (normalized={result_code_str!r})"
            )
            
            # Find payment record
            payment = self.supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
            
            if not payment.data:
                logger.warning(f"Payment not found: {checkout_request_id}")
                return {"ResultCode": 1, "ResultDesc": "Payment not found"}
            
            payment_data = payment.data[0]

            # Idempotency guard: Safaricom can retry the same webhook
            # delivery. If we've already recorded this checkout request
            # as confirmed, don't reprocess (and don't let a later
            # duplicate/failed retry overwrite a real success).
            if payment_data.get("status") == "confirmed":
                logger.info(f"Webhook for already-confirmed payment ignored: {checkout_request_id}")
                return {"ResultCode": 0, "ResultDesc": "Already confirmed"}
            
            if result_code_str == "0":
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
                
                # Update member registration status.
                # See _mark_member_paid() for why coverage_start_date
                # is set to the end of the waiting period, not "now".
                if payment_data.get("member_id"):
                    self._mark_member_paid(payment_data["member_id"])
                    logger.info(f"Payment confirmed for member: {payment_data['member_id']}")
                
                logger.info(f"Payment confirmed: {checkout_request_id}, Receipt: {receipt}")
                
                return {"ResultCode": 0, "ResultDesc": "Success"}
            else:
                # Payment genuinely failed (user cancelled, insufficient
                # funds, wrong PIN, etc -- result_code_str is a real,
                # non-zero Daraja result code here, not a type mismatch).
                update_data = {
                    "status": "failed",
                    "notes": f"Webhook: {result_desc}",
                    "webhook_response": json.dumps(payload)
                }
                
                self.supabase.table("payments").update(update_data).eq("id", payment_data["id"]).execute()
                
                logger.warning(
                    f"Payment failed: {checkout_request_id} - "
                    f"ResultCode={result_code_str} {result_desc}"
                )
                
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
        
        self._mark_member_paid(str(member_id))
        
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
