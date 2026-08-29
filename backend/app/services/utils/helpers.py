"""
Utility Helper Functions
"""

import random
import string
import re
from datetime import datetime, date
from typing import Optional, Dict, Any

PLAN_FEES = {
    "COMFORT": 200,
    "DIGNITY": 500,
    "WAZAZI": 100
}

DEPENDANT_FEES = {
    "SPOUSE": 100,
    "CHILD": 50,
    "PARENT": 150,
    "SIBLING": 100,
    "OTHER": 100
}


# ============================================================
# PHONE NUMBER
# ============================================================

def normalize_phone(phone: str) -> str:
    """
    Convert common Kenyan phone formats to 254XXXXXXXXX.
    
    Examples:
        0712345678 -> 254712345678
        0123456789 -> 254123456789
        712345678 -> 254712345678
        +254712345678 -> 254712345678
        254712345678 -> 254712345678
    """
    phone = phone.strip().replace(" ", "").replace("-", "").replace("+", "")
    
    if phone.startswith("07") or phone.startswith("01"):
        phone = "254" + phone[1:]
    elif phone.startswith("7") or phone.startswith("1"):
        phone = "254" + phone
    elif not phone.startswith("254"):
        raise ValueError("Invalid Kenyan phone number format")
    
    if len(phone) != 12:
        raise ValueError("Phone number must be 12 digits (including 254)")
    
    return phone


def format_phone(phone: str) -> str:
    """Format phone number for display."""
    phone = normalize_phone(phone)
    if phone.startswith("254"):
        return "0" + phone[3:]
    return phone


# ============================================================
# MEMBER NUMBER
# ============================================================

def generate_member_number() -> str:
    """Generate a unique member number."""
    year = datetime.now().year
    seq = str(random.randint(1000, 9999))
    return f"MAS-{year}-{seq}"


def generate_sales_code(prefix: str = "MASIKA", agent_code: str = "AGT") -> str:
    """Generate a sales code."""
    random_str = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"{prefix[:6]}-{agent_code[:3].upper()}-{random_str}"


# ============================================================
# DATE & AGE
# ============================================================

def parse_date(date_str: str) -> Optional[date]:
    """Parse date string to date object."""
    if not date_str:
        return None
    
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return None


def calculate_age(birth_date: str) -> int:
    """Calculate age from birth date."""
    birth = parse_date(birth_date)
    if not birth:
        return 0
    
    today = date.today()
    age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
    return max(0, age)


def format_date(date_str: str, fmt: str = "%d %b %Y") -> str:
    """Format date string."""
    dt = parse_date(date_str)
    if not dt:
        return "N/A"
    return dt.strftime(fmt)


# ============================================================
# CALCULATIONS
# ============================================================

def calculate_registration_fee(plan: str, dependants: list) -> float:
    """Calculate registration fee based on plan and dependants."""
    plan_fee = PLAN_FEES.get(plan.upper(), 0)
    
    dependant_fee = 0
    for dep in dependants:
        relationship = dep.get("relationship", "OTHER").upper()
        dependant_fee += DEPENDANT_FEES.get(relationship, 50)
    
    return float(plan_fee + dependant_fee)


def calculate_commission(amount: float, rate: float = 10.0) -> float:
    """Calculate commission based on amount and rate."""
    return amount * (rate / 100)


# ============================================================
# VALIDATION
# ============================================================

def is_valid_email(email: str) -> bool:
    """Validate email format."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def is_valid_phone(phone: str) -> bool:
    """Validate phone number format."""
    try:
        normalize_phone(phone)
        return True
    except ValueError:
        return False


def is_valid_id_number(id_number: str) -> bool:
    """Validate ID number (basic check)."""
    # Kenyan ID: 8 digits
    # Passport: 8-9 characters
    return len(id_number) >= 5 and len(id_number) <= 30


def is_valid_date(date_str: str) -> bool:
    """Validate date format YYYY-MM-DD."""
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False


# ============================================================
# JSON HELPERS
# ============================================================

def snake_to_camel(snake_str: str) -> str:
    """Convert snake_case to camelCase."""
    components = snake_str.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])


def camel_to_snake(camel_str: str) -> str:
    """Convert camelCase to snake_case."""
    return re.sub(r'(?<!^)(?=[A-Z])', '_', camel_str).lower()


# ============================================================
# EXPORTS
# ============================================================

__all__ = [
    "normalize_phone",
    "format_phone",
    "generate_member_number",
    "generate_sales_code",
    "parse_date",
    "calculate_age",
    "format_date",
    "calculate_registration_fee",
    "calculate_commission",
    "is_valid_email",
    "is_valid_phone",
    "is_valid_id_number",
    "is_valid_date",
    "snake_to_camel",
    "camel_to_snake",
    "PLAN_FEES",
    "DEPENDANT_FEES",
]
