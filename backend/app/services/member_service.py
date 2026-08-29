"""
Member Service - Business Logic for Members
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from uuid import UUID

from app.database import get_supabase
from app.models import (
    MemberCreate, MemberUpdate, MemberResponse,
    DependantCreate, RegistrationRequest,
    PlanEnum, BenefitOptionEnum
)
from app.exceptions import NotFoundError, DuplicateError, ValidationError
from app.utils.helpers import normalize_phone, generate_member_number, calculate_age

logger = logging.getLogger(__name__)


class MemberService:
    """Service for member operations."""
    
    def __init__(self):
        self.supabase = get_supabase()
    
    # ============================================================
    # MEMBER CRUD
    # ============================================================
    
    async def create_member(self, data: RegistrationRequest) -> Dict[str, Any]:
        """Create a new member."""
        # Normalize phone
        phone = normalize_phone(data.phone)
        
        # Check for existing member
        existing = self.supabase.table("members").select("id, phone").eq("phone", phone).execute()
        if existing.data:
            raise DuplicateError("Member", "phone", phone)
        
        if data.email:
            existing = self.supabase.table("members").select("id, email").eq("email", str(data.email)).execute()
            if existing.data:
                raise DuplicateError("Member", "email", str(data.email))
        
        # Generate member number
        member_number = generate_member_number()
        
        # Calculate waiting period
        waiting_months = 4 if data.plan == PlanEnum.COMFORT else 6
        
        # Prepare member data
        member_data = {
            "first_name": data.first_name.strip(),
            "last_name": data.last_name.strip(),
            "other_name": data.other_name.strip() if data.other_name else None,
            "phone": phone,
            "email": str(data.email) if data.email else None,
            "id_number": data.id_number.strip(),
            "date_of_birth": data.date_of_birth,
            "gender": data.gender,
            "county": data.county.strip(),
            "location": data.location.strip() if data.location else None,
            "address": data.address.strip() if data.address else None,
            "plan": data.plan.value,
            "benefit_option": data.benefit_option.value,
            "member_number": member_number,
            "registration_fee_paid": False,
            "is_active": True,
            "waiting_period_months": waiting_months,
        }
        
        # Insert member
        result = self.supabase.table("members").insert(member_data).execute()
        
        if not result.data:
            raise ValidationError("Failed to create member")
        
        member = result.data[0]
        
        # Insert dependants
        for dep in data.dependants:
            try:
                dep_data = {
                    "member_id": member["id"],
                    "first_name": dep.first_name.strip(),
                    "last_name": dep.last_name.strip(),
                    "date_of_birth": dep.date_of_birth,
                    "relationship": dep.relationship.value,
                    "is_active": True
                }
                self.supabase.table("dependants").insert(dep_data).execute()
            except Exception as e:
                logger.warning(f"Failed to insert dependant: {e}")
        
        return member
    
    async def get_member(self, member_id: UUID) -> Dict[str, Any]:
        """Get member by ID."""
        result = self.supabase.table("members").select("*").eq("id", str(member_id)).execute()
        
        if not result.data:
            raise NotFoundError("Member", str(member_id))
        
        return result.data[0]
    
    async def get_member_by_phone(self, phone: str) -> Optional[Dict[str, Any]]:
        """Get member by phone number."""
        phone = normalize_phone(phone)
        result = self.supabase.table("members").select("*").eq("phone", phone).execute()
        
        return result.data[0] if result.data else None
    
    async def get_member_by_number(self, member_number: str) -> Optional[Dict[str, Any]]:
        """Get member by member number."""
        result = self.supabase.table("members").select("*").eq("member_number", member_number).execute()
        
        return result.data[0] if result.data else None
    
    async def update_member(self, member_id: UUID, updates: MemberUpdate) -> Dict[str, Any]:
        """Update member information."""
        # Check member exists
        await self.get_member(member_id)
        
        # Build update data
        update_data = {}
        if updates.first_name is not None:
            update_data["first_name"] = updates.first_name.strip()
        if updates.last_name is not None:
            update_data["last_name"] = updates.last_name.strip()
        if updates.other_name is not None:
            update_data["other_name"] = updates.other_name.strip() if updates.other_name else None
        if updates.phone is not None:
            update_data["phone"] = normalize_phone(updates.phone)
        if updates.email is not None:
            update_data["email"] = str(updates.email)
        if updates.address is not None:
            update_data["address"] = updates.address.strip()
        if updates.is_active is not None:
            update_data["is_active"] = updates
