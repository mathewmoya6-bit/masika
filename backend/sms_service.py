update main py import os
import httpx

TEXTSMS_URL = "https://sms.textsms.co.ke/api/services/sendsms/"


def _normalize(phone: str) -> str:
    """Convert phone to 254XXXXXXXXX format (no plus) for TextSMS."""
    phone = phone.strip().replace(" ", "")
    if phone.startswith("+254"):
        return phone[1:]
    if phone.startswith("0"):
        return "254" + phone[1:]
    if phone.startswith("254"):
        return phone
    return "254" + phone


async def send_registration_sms(phone: str, member_number: str, name: str = "") -> bool:
    """Send a welcome SMS with the member's membership number after registration."""
    mobile = _normalize(phone)
    message = (
        f"Welcome to Masika{', ' + name if name else ''}! "
        f"Your membership number is {member_number}. "
        f"Keep it safe for payments and claims."
    )

    payload = {
        "apikey": os.getenv("TEXTSMS_API_KEY"),
        "partnerID": os.getenv("TEXTSMS_PARTNER_ID"),
        "shortcode": os.getenv("TEXTSMS_SHORTCODE"),
        "mobile": mobile,
        "message": message,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(TEXTSMS_URL, json=payload)
            data = resp.json()
            code = data.get("responses", [{}])[0].get("response-code")
            if code != 200:
                print(f"TextSMS failed for {mobile}: {data}")
            return code == 200
    except Exception as e:
        print(f"TextSMS error for {mobile}: {e}")
        return False


async def send_payment_confirmation_sms(phone: str, amount: str, member_number: str) -> bool:
    """Send a confirmation SMS after a successful M-Pesa payment."""
    mobile = _normalize(phone)
    message = (
        f"Payment of KES {amount} received for membership {member_number}. "
        f"Thank you for staying current with Masika."
    )

    payload = {
        "apikey": os.getenv("TEXTSMS_API_KEY"),
        "partnerID": os.getenv("TEXTSMS_PARTNER_ID"),
        "shortcode": os.getenv("TEXTSMS_SHORTCODE"),
        "mobile": mobile,
        "message": message,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(TEXTSMS_URL, json=payload)
            data = resp.json()
            code = data.get("responses", [{}])[0].get("response-code")
            if code != 200:
                print(f"TextSMS failed for {mobile}: {data}")
            return code == 200
    except Exception as e:
        print(f"TextSMS error for {mobile}: {e}")
        return False
