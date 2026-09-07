from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from ..database import get_supabase_client
from ..core.constants import PlanConstants, MemberConstants
from ..core.exceptions import MemberException, NotFoundException, ValidationException
from ..utils.logger import logger

class MemberService:
    """Member management service"""
    
    def __init__(self):
        self.db = get_supabase_client()

    async def create_member(self, member_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new member"""
        try:
            # Generate membership number
            membership_number = await self._generate_membership_number()
            
            # Calculate waiting period end
            plan = PlanConstants.PLANS.get(member_data["plan_type"])
            if not plan:
                raise ValidationException(f"Invalid plan type: {member_data['plan_type']}")
            
            waiting_period_end = datetime.utcnow() + timedelta(
                days=plan["waiting_period_months"] * 30
            )
            
            # Prepare member data
            member_data.update({
                "membership_number": membership_number,
                "waiting_period_end": waiting_period_end.isoformat(),
                "is_active": True,
                "subscription_status": "active",
                "registration_date": datetime.utcnow().isoformat(),
                "created_at": datetime.utcnow().isoformat()
            })
            
            # Insert into database
            result = self.db.table("members").insert(member_data).execute()
            
            if not result.data:
                raise MemberException("Failed to create member")
            
            logger.info(f"✅ Member created: {membership_number}")
            return result.data[0]
            
        except Exception as e:
            logger.error(f"❌ Member creation error: {str(e)}")
            raise

    async def get_member_by_id(self, member_id: str) -> Dict[str, Any]:
        """Get member by ID"""
        try:
            result = self.db.table("members").select("*").eq("id", member_id).execute()
            
            if not result.data:
                raise NotFoundException("Member")
            
            return result.data[0]
            
        except Exception as e:
            logger.error(f"❌ Get member error: {str(e)}")
            raise

    async def get_member_by_membership(self, membership_number: str) -> Dict[str, Any]:
        """Get member by membership number"""
        try:
            result = self.db.table("members").select("*").eq(
                "membership_number", membership_number
            ).execute()
            
            if not result.data:
                raise NotFoundException("Member")
            
            return result.data[0]
            
        except Exception as e:
            logger.error(f"❌ Get member by membership error: {str(e)}")
            raise

    async def update_member(self, member_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update member details"""
        try:
            # Remove None values
            update_data = {k: v for k, v in update_data.items() if v is not None}
            
            if not update_data:
                raise ValidationException("No data to update")
            
            update_data["updated_at"] = datetime.utcnow().isoformat()
            
            result = self.db.table("members").update(update_data).eq("id", member_id).execute()
            
            if not result.data:
                raise MemberException("Failed to update member")
            
            logger.info(f"✅ Member updated: {member_id}")
            return result.data[0]
            
        except Exception as e:
            logger.error(f"❌ Member update error: {str(e)}")
            raise

    async def search_members(self, search_params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Search members with filters"""
        try:
            query = self.db.table("members").select("*")
            
            # Apply filters
            for key, value in search_params.items():
                if value and key not in ["page", "limit"]:
                    query = query.eq(key, value)
            
            # Pagination
            page = search_params.get("page", 1)
            limit = search_params.get("limit", 20)
            offset = (page - 1) * limit
            
            result = query.range(offset, offset + limit - 1).execute()
            
            return result.data if result.data else []
            
        except Exception as e:
            logger.error(f"❌ Member search error: {str(e)}")
            raise

    async def get_member_dashboard(self, member_id: str) -> Dict[str, Any]:
        """Get member dashboard data"""
        try:
            member = await self.get_member_by_id(member_id)
            
            # Get recent payments
            payments = self.db.table("payments").select("*").eq(
                "membership_number", member["membership_number"]
            ).order("created_at", desc=True).limit(5).execute()
            
            # Get plan details
            plan = PlanConstants.PLANS.get(member["plan_type"])
            
            # Calculate next payment due
            last_payment = None
            if payments.data:
                last_payment = payments.data[0]
                due_date = datetime.fromisoformat(last_payment["created_at"]) + timedelta(days=30)
            else:
                due_date = datetime.fromisoformat(member["registration_date"]) + timedelta(days=30)
            
            return {
                "member": member,
                "plan": plan,
                "recent_payments": payments.data if payments.data else [],
                "next_payment_due": due_date.isoformat(),
                "is_waiting_period_active": datetime.fromisoformat(member["waiting_period_end"]) > datetime.utcnow(),
                "waiting_period_end": member["waiting_period_end"]
            }
            
        except Exception as e:
            logger.error(f"❌ Dashboard error: {str(e)}")
            raise

    async def _generate_membership_number(self) -> str:
        """Generate unique membership number"""
        try:
            # Get last membership number
            result = self.db.table("members").select("membership_number").order(
                "created_at", desc=True
            ).limit(1).execute()
            
            if result.data:
                last_number = int(result.data[0]["membership_number"][2:])
                new_number = last_number + 1
            else:
                new_number = 10000
            
            return f"{MemberConstants.MEMBERSHIP_PREFIX}{new_number:06d}"
            
        except Exception as e:
            logger.error(f"❌ Generate membership number error: {str(e)}")
            # Fallback to timestamp-based
            import time
            return f"{MemberConstants.MEMBERSHIP_PREFIX}{int(time.time())}"

member_service = MemberService()
