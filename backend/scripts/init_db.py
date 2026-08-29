#!/usr/bin/env python
"""
Database Initialization Script
Run this to create all necessary tables in Supabase
"""

import os
import sys
import logging
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import get_supabase
from app.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================================
# SQL SCHEMA
# ============================================================

SCHEMA_SQL = """
-- ============================================================
-- MASIKA BENEVOLENT - DATABASE SCHEMA
-- ============================================================

-- 1. MEMBERS TABLE
CREATE TABLE IF NOT EXISTS public.members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    other_name TEXT,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    id_number TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    gender TEXT NOT NULL,
    county TEXT NOT NULL,
    location TEXT,
    address TEXT,
    plan TEXT NOT NULL,
    benefit_option TEXT DEFAULT 'service',
    member_number TEXT UNIQUE,
    registration_fee_paid BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    waiting_period_months INTEGER DEFAULT 4,
    coverage_start_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. DEPENDANTS TABLE
CREATE TABLE IF NOT EXISTS public.dependants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE,
    relationship TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    payment_type TEXT NOT NULL,
    mpesa_receipt TEXT,
    paybill_number TEXT DEFAULT '348127',
    account_number TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. AGENT APPLICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.agent_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL UNIQUE,
    id_number TEXT NOT NULL,
    county TEXT NOT NULL,
    location TEXT,
    experience TEXT,
    reason TEXT NOT NULL,
    referral_code TEXT,
    status TEXT DEFAULT 'pending',
    rejection_reason TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. AGENT PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.agent_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL UNIQUE,
    id_number TEXT NOT NULL,
    county TEXT,
    location TEXT,
    status TEXT DEFAULT 'approved',
    commission_rate DECIMAL(5,2) DEFAULT 10.0,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SALES CODES TABLE
CREATE TABLE IF NOT EXISTS public.sales_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    agent_email TEXT NOT NULL,
    agent_name TEXT,
    agent_id UUID REFERENCES public.agent_profiles(id),
    status TEXT DEFAULT 'active',
    used BOOLEAN DEFAULT FALSE,
    used_by TEXT,
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. CLAIMS TABLE
CREATE TABLE IF NOT EXISTS public.claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    dependant_id UUID REFERENCES public.dependants(id) ON DELETE SET NULL,
    claim_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    amount DECIMAL(10,2),
    description TEXT,
    rejection_reason TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIM
