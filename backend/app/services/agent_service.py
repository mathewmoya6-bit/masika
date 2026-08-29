"""
Agent Service - Business Logic for Agents
"""

import logging
import random
import string
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID

from app.database import get_supabase
from app.models import AgentApplicationCreate, AgentProfileUpdate
from app.exceptions import NotFoundError, DuplicateError, ValidationError
from app.utils.helpers import normalize_phone

logger = logging.getLogger(__name__)


class AgentService:
    """Service for agent operations."""
    
    def __init__(self):
        self.supabase = get_supabase()
    
    # ============================================================
    # AGENT APPLICATIONS
    # ============================================================
    
    async def create_application(self, data: AgentApplicationCreate) -> Dict[str, Any]:
        """Create a new agent application."""
        phone = normalize_phone(data.phone)
        
        # Check for existing application
        existing = self.supabase.table("agent_applications").select("id").or_(
            f"email.eq.{data.email},phone.eq.{phone}"
        ).execute()
        
        if existing.data:
            raise DuplicateError("Agent application", "email/phone", data.email)
        
        app_data = {
            "full_name": data.full_name.strip(),
            "email": str(data.email),
            "phone": phone,
            "id_number": data.id_number.strip(),
            "county": data.county.strip(),
            "location": data.location.strip() if data.location else None,
            "experience": data.experience.strip() if data.experience else None,
            "reason": data.reason.strip(),
            "referral_code": data.referral_code.strip() if data.referral_code else None,
            "status": "pending"
        }
        
        result = self.supabase.table("agent_applications").insert(app_data).execute()
        
        if not result.data:
            raise ValidationError("Failed to submit application")
        
        return result.data[0]
    
    async def get_applications(self, status: Optional[str] = "pending") -> List[Dict[str, Any]]:
        """Get agent applications."""
        query = self.supabase.table("agent_applications").select("*")
        if status:
            query = query.eq("status", status)
        
        result = query.order("created_at", desc=True).execute()
        return result.data or []
    
    async def approve_application(self, application_id: UUID) -> Dict[str, Any]:
        """Approve an agent application."""
        # Get application
        app = self.supabase.table("agent_applications").select("*").eq("id", str(application_id)).eq("status", "pending").execute()
        
        if not app.data:
            raise NotFoundError("Application", str(application_id))
        
        app_data = app.data[0]
        
        # Create agent profile
        agent_data = {
            "full_name": app_data["full_name"],
            "email": app_data["email"],
            "phone": app_data["phone"],
            "id_number": app_data["id_number"],
            "county": app_data["county"],
            "location": app_data.get("location"),
            "status": "approved",
            "commission_rate": 10.0,
            "approved_at": datetime.now().isoformat()
        }
        
        agent_result = self.supabase.table("agent_profiles").insert(agent_data).execute()
        
        if not agent_result.data:
            raise ValidationError("Failed to create agent profile")
        
        agent = agent_result.data[0]
        
        # Update application
        self.supabase.table("agent_applications").update({
            "status": "approved",
            "reviewed_at": datetime.now().isoformat()
        }).eq("id", str(application_id)).execute()
        
        # Generate initial sales codes
        await self.generate_sales_codes(agent["id"], 5)
        
        return agent
    
    async def reject_application(self, application_id: UUID, reason: str) -> Dict[str, Any]:
        """Reject an agent application."""
        app = self.supabase.table("agent_applications").select("*").eq("id", str(application_id)).eq("status", "pending").execute()
        
        if not app.data:
            raise NotFoundError("Application", str(application_id))
        
        result = self.supabase.table("agent_applications").update({
            "status": "rejected",
            "rejection_reason": reason,
            "reviewed_at": datetime.now().isoformat()
        }).eq("id", str(application_id)).execute()
        
        return result.data[0] if result.data else None
    
    # ============================================================
    # AGENT PROFILES
    # ============================================================
    
    async def get_agents(self, status: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all agents."""
        query = self.supabase.table("agent_profiles").select("*")
        
        if status:
            query = query.eq("status", status)
        if search:
            query = query.or_(f"full_name.ilike.%{search}%,email.ilike.%{search}%")
        
        result = query.order("created_at", desc=True).execute()
        return result.data or []
    
    async def update_agent_status(self, agent_id: UUID, status: str, commission_rate: Optional[float] = None) -> Dict[str, Any]:
        """Update agent status."""
        agent = self.supabase.table("agent_profiles").select("*").eq("id", str(agent_id)).execute()
        
        if not agent.data:
            raise NotFoundError("Agent", str(agent_id))
        
        update_data = {"status": status}
        if commission_rate is not None:
            update_data["commission_rate"] = commission_rate
        
        result = self.supabase.table("agent_profiles").update(update_data).eq("id", str(agent_id)).execute()
        
        return result.data[0] if result.data else None
    
    # ============================================================
    # SALES CODES
    # ============================================================
    
    async def generate_sales_codes(
        self, 
        agent_id: UUID, 
        count: int = 5,
        prefix: str = "MASIKA",
        expires_at: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Generate sales codes for an agent."""
        agent = self.supabase.table("agent_profiles").select("*").eq("id", str(agent_id)).execute()
        
        if not agent.data:
            raise NotFoundError("Agent", str(agent_id))
        
        agent_data = agent.data[0]
        
        codes = []
        agent_code = agent_data["email"].split("@")[0][:3].upper()
        
        for _ in range(count):
            random_str = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
            code = f"{prefix[:6]}-{agent_code}-{random_str}"
            codes.append({
                "code": code,
                "agent_email": agent_data["email"],
                "agent_name": agent_data["full_name"],
                "agent_id": str(agent_id),
                "status": "active",
                "used": False,
                "expires_at": expires_at
            })
        
        result = self.supabase.table("sales_codes").insert(codes).execute()
        
        return result.data or []
    
    async def get_sales_codes(self, agent_id: Optional[UUID] = None) -> List[Dict[str, Any]]:
        """Get sales codes."""
        query = self.supabase.table("sales_codes").select("*")
        
        if agent_id:
            query = query.eq("agent_id", str(agent_id))
        
        result = query.order("created_at", desc=True).execute()
        return result.data or []


# ============================================================
# SINGLETON
# ============================================================

agent_service = AgentService()
