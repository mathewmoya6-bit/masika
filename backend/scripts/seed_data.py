#!/usr/bin/env python
"""
Seed Data Script
Insert test data for development
"""

import os
import sys
import logging
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import get_supabase
from app.config import settings
from app.utils.helpers import generate_member_number

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def seed_members():
    """Seed test members."""
    supabase = get_supabase()
    
    members = [
        {
            "first_name": "John",
            "last_name": "Doe",
            "phone": "254712345678",
            "id_number": "12345678",
            "date_of_birth": "1980-01-15",
            "gender": "MALE",
            "county": "Nairobi",
            "plan": "comfort",
            "member_number": generate_member_number(),
            "is_active": True,
            "registration_fee_paid": True,
        },
        {
            "first_name": "Jane",
            "last_name": "Smith",
            "phone": "254723456789",
            "id_number": "87654321",
            "date_of_birth": "1975-05-20",
            "gender": "FEMALE",
            "county": "Kisumu",
            "plan": "dignity",
            "member_number": generate_member_number(),
            "is_active": True,
            "registration_fee_paid": False,
        },
        {
            "first_name": "Peter",
            "last_name": "Mwangi",
            "phone": "254734567890",
            "id_number": "11223344",
            "date_of_birth": "1990-10-10",
            "gender": "MALE",
            "county": "Nakuru",
            "plan": "comfort",
            "member_number": generate_member_number(),
            "is_active": True,
            "registration_fee_paid": True,
        }
    ]
    
    for member in members:
        try:
            result = supabase.table("members").insert(member).execute()
            logger.info(f"✅ Created member: {member['first_name']} {member['last_name']}")
        except Exception as e:
            logger.warning(f"⚠️ Could not create member {member['first_name']}: {e}")


def seed_agents():
    """Seed test agents."""
    supabase = get_supabase()
    
    agents = [
        {
            "full_name": "Alice Wanjiru",
            "email": "alice@agent.com",
            "phone": "254745678901",
            "id_number": "99887766",
            "county": "Nairobi",
            "status": "approved",
            "commission_rate": 10.0,
        },
        {
            "full_name": "Bob Ochieng",
            "email": "bob@agent.com",
            "phone": "254756789012",
            "id_number": "55443322",
            "county": "Kisumu",
            "status": "approved",
            "commission_rate": 12.0,
        }
    ]
    
    for agent in agents:
        try:
            result = supabase.table("agent_profiles").insert(agent).execute()
            logger.info(f"✅ Created agent: {agent['full_name']}")
        except Exception as e:
            logger.warning(f"⚠️ Could not create agent {agent['full_name']}: {e}")


def seed_payments():
    """Seed test payments."""
    supabase = get_supabase()
    
    # Get member IDs
    members = supabase.table("members").select("id").limit(2).execute()
    
    if not members.data:
        logger.warning("⚠️ No members found for seeding payments")
        return
    
    payments = [
        {
            "member_id": members.data[0]["id"],
            "amount": 200.00,
            "payment_type": "registration",
            "status": "confirmed",
            "paybill_number": "348127",
            "confirmed_at": datetime.now().isoformat(),
        },
        {
            "member_id": members.data[1]["id"] if len(members.data) > 1 else members.data[0]["id"],
            "amount": 300.00,
            "payment_type": "monthly",
            "status": "pending",
            "paybill_number": "348127",
        }
    ]
    
    for payment in payments:
        try:
            result = supabase.table("payments").insert(payment).execute()
            logger.info(f"✅ Created payment: KES {payment['amount']}")
        except Exception as e:
            logger.warning(f"⚠️ Could not create payment: {e}")


def seed_admin():
    """Seed admin user."""
    supabase = get_supabase()
    
    # This requires a user to exist in auth.users
    # You'll need to create a user first via Supabase Auth
    
    admin = {
        "full_name": "System Admin",
        "email": "admin@masikabbs.com",
        "role": "super_admin",
        "is_active": True,
    }
    
    try:
        result = supabase.table("admin_profiles").insert(admin).execute()
        logger.info(f"✅ Created admin profile: {admin['email']}")
    except Exception as e:
        logger.warning(f"⚠️ Could not create admin: {e}")


def main():
    """Run all seed functions."""
    logger.info("🌱 Seeding test data...")
    
    seed_members()
    seed_agents()
    seed_payments()
    seed_admin()
    
    logger.info("✅ Seeding complete!")


if __name__ == "__main__":
    main()
