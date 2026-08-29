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
            update_data["is_active"] = updates.is_active
        if updates.plan is not None:
            update_data["plan"] = updates.plan.value
        if updates.benefit_option is not None:
            update_data["benefit_option"] = updates.benefit_option.value
        
        if not update_data:
            raise ValidationError("No fields to update")
        
        result = self.supabase.table("members").update(update_data).eq("id", str(member_id)).execute()
        
        if not result.data:
            raise ValidationError("Failed to update member")
        
        return result.data[0]
    
    async def get_members(
        self,
        search: Optional[str] = None,
        plan: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        limit: int = 20
    ) -> Dict[str, Any]:
        """Get paginated list of members."""
        query = self.supabase.table("members").select("*")
        
        if search:
            query = query.or_(
                f"first_name.ilike.%{search}%,last_name.ilike.%{search}%,phone.ilike.%{search}%,member_number.ilike.%{search}%"
            )
        if plan:
            query = query.eq("plan", plan.lower())
        if status == "active":
            query = query.eq("is_active", True)
        elif status == "inactive":
            query = query.eq("is_active", False)
        
        # Get total count
        count_result = self.supabase.table("members").select("id", count="exact").execute()
        total = count_result.count or 0
        
        # Paginate
        offset = (page - 1) * limit
        result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        
        return {
            "members": result.data or [],
            "total": total,
            "page": page,
            "limit": limit,
            "pages": (total + limit - 1) // limit if total else 1
        }
    
    # ============================================================
    # DEPENDANTS
    # ============================================================
    
    async def get_dependants(self, member_id: UUID) -> List[Dict[str, Any]]:
        """Get all dependants for a member."""
        result = self.supabase.table("dependants").select("*").eq("member_id", str(member_id)).order("created_at", desc=True).execute()
        return result.data or []
    
    async def add_dependant(self, member_id: UUID, dependant: DependantCreate) -> Dict[str, Any]:
        """Add a dependant to a member."""
        # Check member exists
        await self.get_member(member_id)
        
        dep_data = {
            "member_id": str(member_id),
            "first_name": dependant.first_name.strip(),
            "last_name": dependant.last_name.strip(),
            "date_of_birth": dependant.date_of_birth,
            "relationship": dependant.relationship.value,
            "is_active": True
        }
        
        result = self.supabase.table("dependants").insert(dep_data).execute()
        
        if not result.data:
            raise ValidationError("Failed to add dependant")
        
        return result.data[0]
    
    # ============================================================
    # DASHBOARD
    # ============================================================
    
    async def get_dashboard_stats(self) -> Dict[str, Any]:
        """Get dashboard statistics."""
        # Total members
        total = self.supabase.table("members").select("id", count="exact").execute()
        
        # Active members
        active = self.supabase.table("members").select("id", count="exact").eq("is_active", True).execute()
        
        # Pending registrations
        pending = self.supabase.table("members").select("id", count="exact").eq("registration_fee_paid", False).execute()
        
        # Recent members
        recent = self.supabase.table("members").select(
            "id, first_name, last_name, phone, member_number, created_at"
        ).order("created_at", desc=True).limit(10).execute()
        
        return {
            "total_members": total.count or 0,
            "active_members": active.count or 0,
            "pending_registrations": pending.count or 0,
            "recent_members": recent.data or []
        }


# ============================================================
# SINGLETON
# ============================================================

member_service = MemberService()
