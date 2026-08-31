"""
Membership Service - Card eligibility
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from app.database import get_supabase
from app.utils.helpers import normalize_phone

logger = logging.getLogger(__name__)

# How long after coverage starts a member's digital card unlocks.
CARD_WAITING_PERIOD_DAYS = 30


class MembershipService:
    """Service for membership card eligibility checks."""

    def __init__(self):
        self.supabase = get_supabase()

    # ============================================================
    # CARD STATUS
    # ============================================================

    async def get_card_status(self, member_number: str, phone: str) -> Dict[str, Any]:
        """
        Look up a member by member_number AND phone together. Both must
        match the same record -- deliberately not a lookup-by-number-alone,
        same reasoning already used for member lookups elsewhere: it stops
        this public endpoint being used to enumerate member records.

        Returns a dict matching what membership-card.html expects:
            eligible, full_name, member_number, plan_name,
            registration_date, activation_date, days_remaining, status
        """
        member_number = member_number.strip()
        phone = normalize_phone(phone)

        member_result = (
            self.supabase.table("members")
            .select("*")
            .ilike("member_number", member_number)
            .execute()
        )

        if not member_result.data:
            return self._not_found()

        member = member_result.data[0]

        stored_phone = normalize_phone(member.get("phone") or "")
        # Compare last 9 digits so 07xx / 254xx / +254xx all match regardless
        # of which format was stored vs. entered.
        if not stored_phone or stored_phone[-9:] != phone[-9:]:
            # Same response as a genuinely missing member -- don't reveal
            # that the member_number matched but the phone didn't.
            return self._not_found()

        if not member.get("registration_fee_paid"):
            return {
                "eligible": False,
                "full_name": member.get("full_name"),
                "member_number": member.get("member_number"),
                "plan_name": member.get("plan_name"),
                "registration_date": None,
                "activation_date": None,
                "days_remaining": None,
                "status": "unpaid",
            }

        coverage_start_raw = member.get("coverage_start_date")

        # coverage_start_date is normally set the moment the registration
        # payment is confirmed (see PaymentService.query_stk_status /
        # handle_mpesa_webhook). Fall back to the confirmed registration
        # payment's confirmed_at if it's somehow missing on the member row.
        if not coverage_start_raw:
            payment_result = (
                self.supabase.table("payments")
                .select("confirmed_at")
                .eq("member_id", member["id"])
                .eq("payment_type", "registration")
                .eq("status", "confirmed")
                .order("confirmed_at")
                .limit(1)
                .execute()
            )
            if payment_result.data:
                coverage_start_raw = payment_result.data[0].get("confirmed_at")

        if not coverage_start_raw:
            # Flag says paid but we can't find when -- treat as unpaid
            # rather than guessing a start date.
            logger.warning(
                f"Member {member.get('member_number')} has registration_fee_paid=True "
                f"but no coverage_start_date or confirmed registration payment."
            )
            return {
                "eligible": False,
                "full_name": member.get("full_name"),
                "member_number": member.get("member_number"),
                "plan_name": member.get("plan_name"),
                "registration_date": None,
                "activation_date": None,
                "days_remaining": None,
                "status": "unpaid",
            }

        coverage_start = self._parse_datetime(coverage_start_raw)
        activation_date = coverage_start + timedelta(days=CARD_WAITING_PERIOD_DAYS)
        now = datetime.now(timezone.utc)
        eligible = now >= activation_date
        days_remaining = max(0, (activation_date - now).days)

        return {
            "eligible": eligible,
            "full_name": member.get("full_name"),
            "member_number": member.get("member_number"),
            "plan_name": member.get("plan_name"),
            "registration_date": coverage_start.date().isoformat(),
            "activation_date": activation_date.date().isoformat(),
            "days_remaining": days_remaining,
            "status": "active" if eligible else "pending",
        }

    # ============================================================
    # HELPERS
    # ============================================================

    @staticmethod
    def _not_found() -> Dict[str, Any]:
        return {
            "eligible": False,
            "full_name": None,
            "member_number": None,
            "plan_name": None,
            "registration_date": None,
            "activation_date": None,
            "days_remaining": None,
            "status": "not_found",
        }

    @staticmethod
    def _parse_datetime(value) -> datetime:
        """Supabase returns timestamps as ISO strings; normalize to an
        aware UTC datetime regardless of whether 'Z' or '+00:00' is used."""
        if isinstance(value, datetime):
            dt = value
        else:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt


# ============================================================
# SINGLETON
# ============================================================

membership_service = MembershipService()
