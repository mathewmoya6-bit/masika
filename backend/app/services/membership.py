"""
Membership Service - Card eligibility
"""

import calendar
import logging
from datetime import date, datetime, timezone
from typing import Any, Dict

from app.database import get_supabase
from app.utils.helpers import normalize_phone

logger = logging.getLogger(__name__)

# Used only if a member row somehow has no waiting_period_months set.
DEFAULT_WAITING_PERIOD_MONTHS = 1


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
        match the same record -- this is deliberately not a lookup by
        member_number alone, so this public endpoint can't be used to
        enumerate member records.

        Eligibility is driven entirely by columns already on `members`:
        registration_date + waiting_period_months. No `payments` lookup
        is needed for this.

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

        full_name = member.get("full_name")
        plan_name = member.get("plan")
        member_number_out = member.get("member_number")

        if not member.get("registration_fee_paid"):
            return {
                "eligible": False,
                "full_name": full_name,
                "member_number": member_number_out,
                "plan_name": plan_name,
                "registration_date": None,
                "activation_date": None,
                "days_remaining": None,
                "status": "unpaid",
            }

        registration_date_raw = member.get("registration_date")
        if not registration_date_raw:
            logger.warning(
                f"Member {member_number_out} has registration_fee_paid=True "
                f"but no registration_date set."
            )
            return {
                "eligible": False,
                "full_name": full_name,
                "member_number": member_number_out,
                "plan_name": plan_name,
                "registration_date": None,
                "activation_date": None,
                "days_remaining": None,
                "status": "unpaid",
            }

        registration_date = self._parse_date(registration_date_raw)
        waiting_months = member.get("waiting_period_months") or DEFAULT_WAITING_PERIOD_MONTHS
        activation_date = self._add_months(registration_date, waiting_months)

        today = datetime.now(timezone.utc).date()
        is_active = member.get("is_active", True)
        date_reached = today >= activation_date
        eligible = date_reached and is_active

        days_remaining = max(0, (activation_date - today).days)

        if not is_active:
            status = "dormant" if member.get("dormant_at") else "inactive"
        elif eligible:
            status = "active"
        else:
            status = "pending"

        return {
            "eligible": eligible,
            "full_name": full_name,
            "member_number": member_number_out,
            "plan_name": plan_name,
            "registration_date": registration_date.isoformat(),
            "activation_date": activation_date.isoformat(),
            "days_remaining": days_remaining,
            "status": status,
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
    def _parse_date(value) -> date:
        """members.registration_date is a plain date column, but Supabase
        may hand it back as a 'YYYY-MM-DD' string or a date object depending
        on the client version -- normalize either way."""
        if isinstance(value, date):
            return value
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()

    @staticmethod
    def _add_months(d: date, months: int) -> date:
        """Calendar-correct month addition with no extra dependency
        (dateutil isn't imported anywhere else in this codebase).
        Clamps the day if the target month is shorter (e.g. Jan 31 + 1
        month -> Feb 28/29, not an overflow into March)."""
        month_index = d.month - 1 + int(months)
        year = d.year + month_index // 12
        month = month_index % 12 + 1
        day = min(d.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)


# ============================================================
# SINGLETON
# ============================================================

membership_service = MembershipService()
