import base64
import json
import hashlib
import hmac
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception
from ..config import settings
from ..utils.logger import logger
from ..core.constants import PaymentConstants

class MpesaService:
    """Production M-PESA Integration Service"""
    
    def __init__(self):
        self.consumer_key = settings.mpesa_consumer_key
        self.consumer_secret = settings.mpesa_consumer_secret
        self.passkey = settings.mpesa_passkey
        self.shortcode = settings.mpesa_shortcode
        self.environment = settings.mpesa_environment
        self.callback_url = settings.mpesa_callback_url
        
        # Production endpoints
        self.base_url = "https://api.safaricom.co.ke"
        self.sandbox_url = "https://sandbox.safaricom.co.ke"
        
        self._access_token = None
        self._token_expiry = None
        
        logger.info(f"M-PESA Service initialized in {self.environment.upper()} mode")
        logger.info(f"Shortcode: {self.shortcode}")
        logger.info(f"Callback URL: {self.callback_url}")

    @property
    def api_url(self) -> str:
        """Get the appropriate API URL based on environment"""
        return self.base_url if self.environment == "production" else self.sandbox_url

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception(lambda e: "401" in str(e) or "403" in str(e))
    )
    async def get_access_token(self) -> str:
        """Get M-PESA OAuth access token with production credentials"""
        try:
            # Check if token is still valid
            if self._access_token and self._token_expiry and datetime.utcnow() < self._token_expiry:
                logger.debug("Using cached access token")
                return self._access_token

            auth = base64.b64encode(
                f"{self.consumer_key}:{self.consumer_secret}".encode()
            ).decode()
            
            headers = {
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/json"
            }
            
            logger.info("Requesting M-PESA access token...")
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.api_url}/oauth/v1/generate?grant_type=client_credentials",
                    headers=headers
                )
                
                if response.status_code != 200:
                    logger.error(f"Token request failed: {response.status_code} - {response.text}")
                    raise Exception(f"Failed to get access token: {response.text}")
                
                data = response.json()
                self._access_token = data.get("access_token")
                
                # Token expires in 3600 seconds (1 hour)
                self._token_expiry = datetime.utcnow() + timedelta(seconds=3500)
                
                logger.info("✅ M-PESA access token acquired successfully")
                return self._access_token
                
        except Exception as e:
            logger.error(f"❌ Failed to get M-PESA access token: {str(e)}")
            raise

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, min=1, max=5))
    async def stk_push(
        self,
        phone_number: str,
        amount: float,
        account_reference: str,
        transaction_desc: str = "Masika Benevolent Payment",
        transaction_type: str = "CustomerPayBillOnline"
    ) -> Dict[str, Any]:
        """
        Initiate STK Push payment (Lipa na M-PESA Online)
        
        Args:
            phone_number: Customer phone number (format: 254XXXXXXXXX)
            amount: Payment amount (KES)
            account_reference: Membership number or reference
            transaction_desc: Transaction description
            transaction_type: Transaction type (default: CustomerPayBillOnline)
        """
        try:
            # Validate and format phone number
            phone_number = self._format_phone_number(phone_number)
            
            # Validate amount
            if amount <= 0:
                raise ValueError("Amount must be greater than 0")
            
            # Validate account reference
            if not account_reference or len(account_reference) > 12:
                raise ValueError("Account reference must be between 1-12 characters")
            
            # Get access token
            access_token = await self.get_access_token()
            
            # Generate timestamp and password
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            
            # Generate password: Base64(Shortcode + Passkey + Timestamp)
            password_str = f"{self.shortcode}{self.passkey}{timestamp}"
            password = base64.b64encode(password_str.encode()).decode()
            
            # Prepare STK Push payload
            payload = {
                "BusinessShortCode": self.shortcode,
                "Password": password,
                "Timestamp": timestamp,
                "TransactionType": transaction_type,
                "Amount": int(amount),
                "PartyA": phone_number,
                "PartyB": self.shortcode,
                "PhoneNumber": phone_number,
                "CallBackURL": self.callback_url,
                "AccountReference": account_reference[:12],
                "TransactionDesc": transaction_desc[:20]
            }
            
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            logger.info(f"🚀 Initiating STK Push for {phone_number}, Amount: KES {amount}")
            logger.debug(f"Payload: {json.dumps(payload, default=str)}")
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.api_url}/mpesa/stkpush/v1/processrequest",
                    json=payload,
                    headers=headers
                )
                
                if response.status_code != 200:
                    logger.error(f"STK Push failed: {response.status_code} - {response.text}")
                    raise Exception(f"STK Push failed: {response.text}")
                
                result = response.json()
                
                # Log the result
                if result.get("ResponseCode") == "0":
                    logger.info(f"✅ STK Push initiated: {result.get('CheckoutRequestID')}")
                else:
                    logger.warning(f"⚠️ STK Push response: {result.get('ResponseDescription')}")
                
                return result
                
        except httpx.TimeoutException:
            logger.error("⏰ M-PESA request timeout")
            raise Exception("M-PESA request timed out. Please try again.")
        except Exception as e:
            logger.error(f"❌ STK Push error: {str(e)}")
            raise

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, min=1, max=3))
    async def query_status(self, checkout_request_id: str) -> Dict[str, Any]:
        """
        Query STK Push transaction status
        
        Args:
            checkout_request_id: The CheckoutRequestID from STK Push
        """
        try:
            if not checkout_request_id:
                raise ValueError("CheckoutRequestID is required")
            
            access_token = await self.get_access_token()
            
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            password_str = f"{self.shortcode}{self.passkey}{timestamp}"
            password = base64.b64encode(password_str.encode()).decode()
            
            payload = {
                "BusinessShortCode": self.shortcode,
                "Password": password,
                "Timestamp": timestamp,
                "CheckoutRequestID": checkout_request_id
            }
            
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            logger.info(f"🔍 Querying payment status: {checkout_request_id}")
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.api_url}/mpesa/stkpushquery/v1/query",
                    json=payload,
                    headers=headers
                )
                
                if response.status_code != 200:
                    logger.error(f"Status query failed: {response.text}")
                    raise Exception(f"Status query failed: {response.text}")
                
                result = response.json()
                
                # Log status
                result_code = result.get("ResultCode")
                if result_code == "0":
                    logger.info(f"✅ Payment completed: {checkout_request_id}")
                elif result_code == "1037":
                    logger.warning(f"⏳ Payment pending: {checkout_request_id}")
                else:
                    logger.warning(f"⚠️ Payment status: {result.get('ResultDesc')}")
                
                return result
                
        except Exception as e:
            logger.error(f"❌ Status query error: {str(e)}")
            raise

    async def reverse_transaction(
        self,
        transaction_id: str,
        amount: float,
        receiver_party: str,
        receiver_identifier_type: str = "11"
    ) -> Dict[str, Any]:
        """
        Reverse a transaction (Refund)
        
        Args:
            transaction_id: The transaction ID to reverse
            amount: Amount to reverse
            receiver_party: Shortcode of the receiver
            receiver_identifier_type: Identifier type (11 = Shortcode)
        """
        try:
            access_token = await self.get_access_token()
            
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            password_str = f"{self.shortcode}{self.passkey}{timestamp}"
            password = base64.b64encode(password_str.encode()).decode()
            
            payload = {
                "CommandID": "TransactionReversal",
                "ReceiverParty": receiver_party,
                "RecieverIdentifierType": receiver_identifier_type,  # Note: API uses "Reciever" typo
                "TransactionID": transaction_id,
                "Amount": int(amount),
                "Remarks": "Refund - Masika Benevolent",
                "Occasion": "Refund"
            }
            
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            logger.info(f"🔄 Reversing transaction: {transaction_id}")
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.api_url}/mpesa/reversal/v1/request",
                    json=payload,
                    headers=headers
                )
                
                if response.status_code != 200:
                    logger.error(f"Reversal failed: {response.text}")
                    raise Exception(f"Reversal failed: {response.text}")
                
                result = response.json()
                logger.info(f"✅ Reversal initiated: {result}")
                return result
                
        except Exception as e:
            logger.error(f"❌ Reversal error: {str(e)}")
            raise

    def _format_phone_number(self, phone: str) -> str:
        """
        Format phone number for M-PESA
        - Remove all non-numeric characters
        - Ensure 254 prefix
        """
        # Remove all non-numeric characters
        phone = ''.join(filter(str.isdigit, phone))
        
        # Remove leading zeros
        phone = phone.lstrip('0')
        
        # If number starts with 7 or 1, add 254 prefix
        if phone.startswith('7') or phone.startswith('1'):
            phone = '254' + phone
        # If starts with 254, keep as is
        elif not phone.startswith('254'):
            phone = '254' + phone
        
        # Validate length (should be exactly 12 digits for 254XXXXXXXXX)
        if len(phone) != 12:
            logger.warning(f"Phone number {phone} may be invalid (length: {len(phone)})")
        
        return phone

    def verify_callback_signature(self, data: Dict[str, Any]) -> bool:
        """
        Verify M-PESA callback signature for security
        """
        # Implementation depends on your security requirements
        # M-PESA doesn't provide a signature by default
        # You can implement IP whitelisting or other verification
        return True


# Singleton instance
mpesa_service = MpesaService()
