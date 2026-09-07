from typing import Dict, Any, Optional
from ..config import settings
from ..utils.logger import logger

class NotificationService:
    """Notification service for emails, SMS, and push notifications"""
    
    def __init__(self):
        # Initialize email client (SendGrid, SES, etc.)
        # Initialize SMS client (AfricasTalking, Twilio, etc.)
        pass

    async def send_email(
        self,
        to: str,
        subject: str,
        template: str,
        data: Dict[str, Any],
        cc: Optional[str] = None
    ) -> bool:
        """
        Send email notification
        
        Args:
            to: Recipient email
            subject: Email subject
            template: Template name
            data: Template data
            cc: CC recipient
        """
        try:
            # Implement email sending logic here
            # Example with SendGrid:
            # message = Mail(
            #     from_email=settings.smtp_from,
            #     to_emails=to,
            #     subject=subject,
            #     html_content=self._render_template(template, data)
            # )
            # sg = SendGridAPIClient(settings.sendgrid_api_key)
            # response = sg.send(message)
            
            logger.info(f"📧 Email sent to {to}: {subject}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Email error: {str(e)}")
            return False

    async def send_sms(self, phone: str, message: str) -> bool:
        """
        Send SMS notification
        
        Args:
            phone: Phone number
            message: SMS message
        """
        try:
            # Implement SMS sending logic here
            # Example with AfricasTalking:
            # sms = AfricasTalking.SMS(username, api_key)
            # response = sms.send(message, [phone])
            
            logger.info(f"📱 SMS sent to {phone}: {message[:50]}...")
            return True
            
        except Exception as e:
            logger.error(f"❌ SMS error: {str(e)}")
            return False

    async def send_payment_confirmation(
        self,
        member: Dict[str, Any],
        payment: Dict[str, Any],
        receipt: Optional[str] = None
    ) -> None:
        """Send payment confirmation notification"""
        # Send email
        await self.send_email(
            to=member["email"],
            subject="Payment Confirmation - Masika Benevolent",
            template="payment_confirmation",
            data={
                "name": member["first_name"],
                "membership_number": member["membership_number"],
                "amount": payment["amount"],
                "payment_type": payment["payment_type"],
                "receipt": receipt or "Pending",
                "date": payment["created_at"]
            }
        )
        
        # Send SMS
        await self.send_sms(
            phone=member["phone"],
            message=f"Masika: Payment of KES {payment['amount']} received. Receipt: {receipt or 'pending'}"
        )

    async def send_welcome_message(self, member: Dict[str, Any]) -> None:
        """Send welcome message to new member"""
        await self.send_email(
            to=member["email"],
            subject="Welcome to Masika Benevolent!",
            template="welcome",
            data={
                "name": member["first_name"],
                "membership_number": member["membership_number"],
                "plan": member["plan_type"],
                "waiting_period": "4 months"
            }
        )

    def _render_template(self, template: str, data: Dict[str, Any]) -> str:
        """Render email template"""
        # Implement template rendering with Jinja2 or similar
        return f"Template: {template}, Data: {data}"

notification_service = NotificationService()
