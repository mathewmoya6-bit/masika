"""
Validation Utilities
"""

import re
from typing import Optional, Dict, Any
from datetime import datetime

from app.utils.helpers import normalize_phone, is_valid_email, is_valid_date


class Validator:
    """Validation utility class."""
    
    @staticmethod
    def validate_required(value: Any, field_name: str) -> None:
        """Validate required field."""
        if value is None or (isinstance(value, str) and not value.strip()):
            raise ValueError(f"{field_name} is required")
    
    @staticmethod
    def validate_string(value: str, field_name: str, min_length: int = 1, max_length: int = 255) -> str:
        """Validate string field."""
        if not value:
            return value
        
        value = str(value).strip()
        
        if len(value) < min_length:
            raise ValueError(f"{field_name} must be at least {min_length} characters")
        
        if len(value) > max_length:
            raise ValueError(f"{field_name} must not exceed {max_length} characters")
        
        return value
    
    @staticmethod
    def validate_phone(phone: str) -> str:
        """Validate phone number."""
        try:
            return normalize_phone(phone)
        except ValueError as e:
            raise ValueError(str(e))
    
    @staticmethod
    def validate_email(email: str) -> str:
        """Validate email address."""
        if not email:
            return email
        
        email = str(email).strip().lower()
        
        if not is_valid_email(email):
            raise ValueError("Invalid email address format")
        
        return email
    
    @staticmethod
    def validate_date(date_str: str, field_name: str) -> str:
        """Validate date format."""
        if not date_str:
            return date_str
        
        if not is_valid_date(date_str):
            raise ValueError(f"{field_name} must be in YYYY-MM-DD format")
        
        return date_str
    
    @staticmethod
    def validate_id_number(id_number: str) -> str:
        """Validate ID number."""
        if not id_number:
            return id_number
        
        id_number = str(id_number).strip()
        
        if len(id_number) < 5 or len(id_number) > 30:
            raise ValueError("ID number must be between 5 and 30 characters")
        
        return id_number
    
    @staticmethod
    def validate_county(county: str) -> str:
        """Validate county."""
        if not county:
            return county
        
        county = str(county).strip()
        
        if len(county) < 2:
            raise ValueError("County must be at least 2 characters")
        
        return county
    
    @staticmethod
    def validate_amount(amount: float) -> float:
        """Validate amount."""
        if amount is None:
            return amount
        
        amount = float(amount)
        
        if amount <= 0:
            raise ValueError("Amount must be greater than 0")
        
        if amount > 1000000:
            raise ValueError("Amount must not exceed 1,000,000")
        
        return amount
    
    @staticmethod
    def validate_plan(plan: str) -> str:
        """Validate membership plan."""
        plan = str(plan).upper().strip()
        
        valid_plans = ["COMFORT", "DIGNITY", "WAZAZI"]
        
        if plan not in valid_plans:
            raise ValueError(f"Plan must be one of: {', '.join(valid_plans)}")
        
        return plan


class RegistrationValidator(Validator):
    """Registration specific validation."""
    
    @classmethod
    def validate_registration(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate registration data."""
        errors = []
        
        # Required fields
        required = ["first_name", "last_name", "phone", "id_number", "date_of_birth", "gender", "county", "plan"]
        
        for field in required:
            if field not in data or not data[field]:
                errors.append(f"{field} is required")
        
        if errors:
            raise ValueError("; ".join(errors))
        
        # Validate each field
        data["first_name"] = cls.validate_string(data["first_name"], "First name", 2, 100)
        data["last_name"] = cls.validate_string(data["last_name"], "Last name", 2, 100)
        data["phone"] = cls.validate_phone(data["phone"])
        data["id_number"] = cls.validate_id_number(data["id_number"])
        data["date_of_birth"] = cls.validate_date(data["date_of_birth"], "Date of birth")
        data["county"] = cls.validate_county(data["county"])
        data["plan"] = cls.validate_plan(data["plan"])
        
        if data.get("email"):
            data["email"] = cls.validate_email(data["email"])
        
        if data.get("other_name"):
            data["other_name"] = cls.validate_string(data["other_name"], "Other name", 0, 100)
        
        if data.get("location"):
            data["location"] = cls.validate_string(data["location"], "Location", 0, 100)
        
        if data.get("address"):
            data["address"] = cls.validate_string(data["address"], "Address", 0, 200)
        
        # Validate gender
        if data["gender"].upper() not in ["MALE", "FEMALE", "OTHER"]:
            raise ValueError("Gender must be MALE, FEMALE, or OTHER")
        
        return data


class PaymentValidator(Validator):
    """Payment specific validation."""
    
    @classmethod
    def validate_payment(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate payment data."""
        # Required fields
        if "member_id" not in data:
            raise ValueError("member_id is required")
        
        if "amount" not in data:
            raise ValueError("amount is required")
        
        # Validate amount
        data["amount"] = cls.validate_amount(data["amount"])
        
        # Validate receipt
        if data.get("mpesa_receipt"):
            data["mpesa_receipt"] = cls.validate_string(data["mpesa_receipt"], "M-Pesa receipt", 5, 50)
        
        # Validate payment type
        valid_types = ["registration", "monthly", "annual", "topup"]
        if data.get("payment_type") and data["payment_type"] not in valid_types:
            raise ValueError(f"Payment type must be one of: {', '.join(valid_types)}")
        
        return data


__all__ = [
    "Validator",
    "RegistrationValidator",
    "PaymentValidator",
]
