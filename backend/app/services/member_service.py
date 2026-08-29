```python
"""
Member Service - Business Logic for Members

IMPORTANT:
This service is aligned with the CURRENT Masika Benevolent
Supabase database schema.

members:
    full_name
    national_id
    passport_number
    date_of_birth
    gender
    phone
    email
    address
    county
    town
    member_status
    membership_number
    member_number
    benefit_option

memberships:
    member_id
    plan_id
    membership_start_date
    waiting_period_end_date
    next_payment_due_date
    status
    registration_fee_due
    registration_fee_paid
    monthly_premium
    waiting_period_months
    monthly_payment_deadline

dependants:
    principal_member_id
    dependant_number
    full_name
    date_of_birth
    relationship
    status

payments:
    member_id
    membership_id
    amount
    expected_amount
    payment_type
    payment_status
    registration_amount
    monthly_amount
    dependant_registration_amount
    dependant_monthly_amount
    registration_paid
    monthly_paid
"""

import logging
from datetime import date, datetime, timedelta
from typing import Optional, List, Dict, Any
from uuid import UUID

from app.database import get_supabase

from app.models import (
    MemberUpdate,
    DependantCreate,
    RegistrationRequest,
    PlanEnum,
)

from app.exceptions import (
    NotFoundError,
    DuplicateError,
    ValidationError,
)

from app.utils.helpers import normalize_phone


logger = logging.getLogger(__name__)


class MemberService:
    """Service for member operations."""

    def __init__(self):
        self.supabase = get_supabase()

    # ============================================================
    # CREATE MEMBER
    # ============================================================

    async def create_member(
        self,
        data: RegistrationRequest
    ) -> Dict[str, Any]:
        """
        Create a member using the current database schema.

        Creates:

            1. members
            2. memberships
            3. dependants
            4. initial registration payment

        No first_name / last_name columns are used in members.
        """

        try:
            # ----------------------------------------------------
            # BASIC VALUES
            # ----------------------------------------------------

            first_name = (data.first_name or "").strip()
            last_name = (data.last_name or "").strip()

            other_name = ""

            if getattr(data, "other_name", None):
                other_name = data.other_name.strip()

            if not first_name:
                raise ValidationError("First name is required.")

            if not last_name:
                raise ValidationError("Last name is required.")

            if not data.phone:
                raise ValidationError("Phone number is required.")

            # ----------------------------------------------------
            # BUILD FULL NAME
            # ----------------------------------------------------

            full_name = " ".join(
                part
                for part in [
                    first_name,
                    other_name,
                    last_name,
                ]
                if part
            ).strip()

            # ----------------------------------------------------
            # PHONE
            # ----------------------------------------------------

            phone = normalize_phone(data.phone)

            # ----------------------------------------------------
            # DUPLICATE PHONE
            # ----------------------------------------------------

            existing = (
                self.supabase
                .table("members")
                .select(
                    "id,"
                    "member_number,"
                    "membership_number,"
                    "full_name,"
                    "phone"
                )
                .eq("phone", phone)
                .limit(1)
                .execute()
            )

            if existing.data:
                raise DuplicateError(
                    "Member",
                    "phone",
                    phone
                )

            # ----------------------------------------------------
            # DUPLICATE EMAIL
            # ----------------------------------------------------

            if data.email:

                email = str(data.email).strip()

                existing_email = (
                    self.supabase
                    .table("members")
                    .select(
                        "id,"
                        "member_number,"
                        "membership_number,"
                        "full_name,"
                        "email"
                    )
                    .eq("email", email)
                    .limit(1)
                    .execute()
                )

                if existing_email.data:
                    raise DuplicateError(
                        "Member",
                        "email",
                        email
                    )

            else:
                email = None

            # ----------------------------------------------------
            # NATIONAL ID
            # ----------------------------------------------------

            id_number = None

            if getattr(data, "id_number", None):
                id_number = data.id_number.strip()

            # ----------------------------------------------------
            # GENDER
            # ----------------------------------------------------

            gender = data.gender

            if hasattr(gender, "value"):
                gender = gender.value

            # ----------------------------------------------------
            # BENEFIT OPTION
            # ----------------------------------------------------

            benefit_option = getattr(
                data,
                "benefit_option",
                None
            )

            if hasattr(benefit_option, "value"):
                benefit_option = benefit_option.value

            if not benefit_option:
                benefit_option = "service"

            # ----------------------------------------------------
            # PLAN
            # ----------------------------------------------------

            plan_code = data.plan

            if hasattr(plan_code, "value"):
                plan_code = plan_code.value

            plan_code = str(plan_code).upper()

            # ----------------------------------------------------
            # GET PLAN FROM DATABASE
            #
            # Database is the source of truth.
            # ----------------------------------------------------

            plan_result = (
                self.supabase
                .table("plans")
                .select(
                    "id,"
                    "plan_code,"
                    "plan_name,"
                    "monthly_premium,"
                    "registration_fee,"
                    "dependant_registration_fee,"
                    "principal_registration_fee,"
                    "waiting_period_days,"
                    "waiting_period_months,"
                    "monthly_payment_deadline_days,"
                    "max_dependants,"
                    "is_active"
                )
                .eq("plan_code", plan_code)
                .eq("is_active", True)
                .limit(1)
                .execute()
            )

            if not plan_result.data:

                raise ValidationError(
                    f"Membership plan '{plan_code}' "
                    "was not found or is inactive."
                )

            plan = plan_result.data[0]

            plan_id = plan["id"]

            # ----------------------------------------------------
            # FEES
            # ----------------------------------------------------

            principal_registration_fee = float(
                plan.get("principal_registration_fee")
                if plan.get("principal_registration_fee") is not None
                else plan.get("registration_fee") or 0
            )

            dependant_registration_fee = float(
                plan.get("dependant_registration_fee") or 0
            )

            monthly_premium = float(
                plan.get("monthly_premium") or 0
            )

            # ----------------------------------------------------
            # DEPENDANTS
            # ----------------------------------------------------

            dependants = getattr(
                data,
                "dependants",
                []
            ) or []

            dependant_count = len(dependants)

            max_dependants = plan.get("max_dependants")

            if (
                max_dependants is not None
                and dependant_count > int(max_dependants)
            ):
                raise ValidationError(
                    f"{plan_code} allows a maximum of "
                    f"{max_dependants} dependants."
                )

            dependant_registration_amount = (
                dependant_count
                * dependant_registration_fee
            )

            total_registration_fee = (
                principal_registration_fee
                + dependant_registration_amount
            )

            # ----------------------------------------------------
            # DATE OF BIRTH
            # ----------------------------------------------------

            dob = data.date_of_birth

            if hasattr(dob, "isoformat"):
                dob = dob.isoformat()

            # ----------------------------------------------------
            # GENERATE NUMBERS
            # ----------------------------------------------------

            member_number = (
                await self._generate_member_number()
            )

            membership_number = (
                await self._generate_membership_number()
            )

            # ----------------------------------------------------
            # MEMBERS INSERT
            #
            # ONLY CURRENT DATABASE COLUMNS.
            # ----------------------------------------------------

            member_data = {
                "membership_number": membership_number,
                "member_number": member_number,
                "full_name": full_name,
                "national_id": id_number,
                "date_of_birth": dob,
                "gender": gender,
                "phone": phone,
                "email": email,
                "address": (
                    data.address.strip()
                    if getattr(data, "address", None)
                    else None
                ),
                "county": (
                    data.county.strip()
                    if getattr(data, "county", None)
                    else None
                ),
                "town": (
                    data.location.strip()
                    if getattr(data, "location", None)
                    else None
                ),
                "member_status": "PENDING",
                "benefit_option": benefit_option,
            }

            logger.info(
                "Creating member %s (%s)",
                full_name,
                phone
            )

            member_result = (
                self.supabase
                .table("members")
                .insert(member_data)
                .execute()
            )

            if not member_result.data:
                raise ValidationError(
                    "Failed to create member."
                )

            member = member_result.data[0]

            member_id = member["id"]

            logger.info(
                "Member created: %s",
                member_id
            )

            # ----------------------------------------------------
            # WAITING PERIOD
            # ----------------------------------------------------

            waiting_period_months = int(
                plan.get("waiting_period_months") or 0
            )

            waiting_period_days = int(
                plan.get("waiting_period_days") or 0
            )

            waiting_period_end_date = None

            if waiting_period_days > 0:

                waiting_period_end_date = (
                    date.today()
                    + timedelta(days=waiting_period_days)
                ).isoformat()

            elif waiting_period_months > 0:

                # Approximate calendar month calculation.
                end_month = (
                    date.today().month
                    + waiting_period_months
                )

                end_year = (
                    date.today().year
                    + (end_month - 1) // 12
                )

                end_month = (
                    (end_month - 1) % 12
                ) + 1

                # Keep day valid.
                import calendar

                last_day = calendar.monthrange(
                    end_year,
                    end_month
                )[1]

                end_day = min(
                    date.today().day,
                    last_day
                )

                waiting_period_end_date = date(
                    end_year,
                    end_month,
                    end_day
                ).isoformat()

            # ----------------------------------------------------
            # MONTHLY PAYMENT DEADLINE
            # ----------------------------------------------------

            deadline_days = int(
                plan.get(
                    "monthly_payment_deadline_days"
                ) or 0
            )

            monthly_payment_deadline = None

            if deadline_days > 0:

                monthly_payment_deadline = (
                    date.today()
                    + timedelta(days=deadline_days)
                ).isoformat()

            # ----------------------------------------------------
            # MEMBERSHIP INSERT
            # ----------------------------------------------------

            membership_data = {
                "member_id": member_id,
                "plan_id": plan_id,
                "membership_start_date": date.today().isoformat(),
                "waiting_period_end_date": (
                    waiting_period_end_date
                ),
                "next_payment_due_date": (
                    monthly_payment_deadline
                ),
                "status": "PENDING",
                "registration_fee_due": (
                    total_registration_fee
                ),
                "registration_fee_paid": 0,
                "monthly_premium": monthly_premium,
                "monthly_equivalent_units": 0,
                "required_monthly_equivalent_units": 0,
                "waiting_period_months": (
                    waiting_period_months
                ),
                "monthly_payment_deadline": (
                    monthly_payment_deadline
                ),
            }

            membership_result = (
                self.supabase
                .table("memberships")
                .insert(membership_data)
                .execute()
            )

            if not membership_result.data:

                # Roll back member.
                await self._delete_member(
                    member_id
                )

                raise ValidationError(
                    "Failed to create membership."
                )

            membership = membership_result.data[0]

            membership_id = membership["id"]

            # ----------------------------------------------------
            # DEPENDANTS
            # ----------------------------------------------------

            created_dependants = []

            for index, dependant in enumerate(
                dependants,
                start=1
            ):

                dep_first_name = (
                    getattr(
                        dependant,
                        "first_name",
                        None
                    )
                    or ""
                ).strip()

                dep_last_name = (
                    getattr(
                        dependant,
                        "last_name",
                        None
                    )
                    or ""
                ).strip()

                dep_full_name = " ".join(
                    part
                    for part in [
                        dep_first_name,
                        dep_last_name
                    ]
                    if part
                ).strip()

                # ------------------------------------------------
                # Support dependant model using full_name
                # ------------------------------------------------

                if not dep_full_name:

                    dep_full_name = (
                        getattr(
                            dependant,
                            "full_name",
                            None
                        )
                        or ""
                    ).strip()

                if not dep_full_name:

                    raise ValidationError(
                        "Dependant name is required."
                    )

                relationship = getattr(
                    dependant,
                    "relationship",
                    None
                )

                if hasattr(
                    relationship,
                    "value"
                ):
                    relationship = relationship.value

                if not relationship:

                    raise ValidationError(
                        "Dependant relationship is required."
                    )

                dep_dob = getattr(
                    dependant,
                    "date_of_birth",
                    None
                )

                if hasattr(
                    dep_dob,
                    "isoformat"
                ):
                    dep_dob = dep_dob.isoformat()

                dependant_number = (
                    f"{membership_number}-D{index:02d}"
                )

                dep_data = {
                    "principal_member_id": member_id,
                    "dependant_number": (
                        dependant_number
                    ),
                    "full_name": dep_full_name,
                    "date_of_birth": dep_dob,
                    "relationship": relationship,
                    "status": "ACTIVE",
                }

                dep_result = (
                    self.supabase
                    .table("dependants")
                    .insert(dep_data)
                    .execute()
                )

                if not dep_result.data:

                    logger.warning(
                        "Dependant was not created for member %s",
                        member_id
                    )

                else:

                    created_dependants.extend(
                        dep_result.data
                    )

            # ----------------------------------------------------
            # INITIAL REGISTRATION PAYMENT
            # ----------------------------------------------------

            payment_data = {
                "member_id": member_id,
                "membership_id": membership_id,
                "amount": 0,
                "expected_amount": (
                    total_registration_fee
                ),
                "payment_method": "MPESA",
                "payment_status": "PENDING",
                "payment_type": "REGISTRATION",
                "registration_amount": (
                    total_registration_fee
                ),
                "monthly_amount": monthly_premium,
                "dependant_registration_amount": (
                    dependant_registration_amount
                ),
                "dependant_monthly_amount": 0,
                "monthly_equivalent_units": 0,
                "registration_paid": False,
                "monthly_paid": False,
                "phone_number": phone,
            }

            payment_result = (
                self.supabase
                .table("payments")
                .insert(payment_data)
                .execute()
            )

            payment = (
                payment_result.data[0]
                if payment_result.data
                else None
            )

            # ----------------------------------------------------
            # RETURN
            # ----------------------------------------------------

            return {
                "id": member_id,
                "member_id": member_id,
                "member_number": member_number,
                "membership_number": membership_number,
                "full_name": full_name,
                "phone": phone,
                "plan": plan_code,
                "plan_id": plan_id,
                "membership_id": membership_id,
                "payment_id": (
                    payment.get("id")
                    if payment
                    else None
                ),
                "registration_amount": (
                    total_registration_fee
                ),
                "dependant_registration_amount": (
                    dependant_registration_amount
                ),
                "monthly_amount": monthly_premium,
                "dependant_count": dependant_count,
                "success": True,
            }

        except (
            DuplicateError,
            ValidationError,
            NotFoundError
        ):
            raise

        except Exception as e:

            logger.exception(
                "Unexpected member creation error: %s",
                e
            )

            raise ValidationError(
                f"Failed to register member: {str(e)}"
            )

    # ============================================================
    # GET MEMBER
    # ============================================================

    async def get_member(
        self,
        member_id: UUID
    ) -> Dict[str, Any]:

        result = (
            self.supabase
            .table("members")
            .select("*")
            .eq("id", str(member_id))
            .limit(1)
            .execute()
        )

        if not result.data:

            raise NotFoundError(
                "Member",
                str(member_id)
            )

        return self._format_member(
            result.data[0]
        )

    # ============================================================
    # GET MEMBER BY PHONE
    # ============================================================

    async def get_member_by_phone(
        self,
        phone: str
    ) -> Optional[Dict[str, Any]]:

        phone = normalize_phone(phone)

        result = (
            self.supabase
            .table("members")
            .select("*")
            .eq("phone", phone)
            .limit(1)
            .execute()
        )

        if not result.data:
            return None

        return self._format_member(
            result.data[0]
        )

    # ============================================================
    # GET MEMBER BY NUMBER
    # ============================================================

    async def get_member_by_number(
        self,
        member_number: str
    ) -> Optional[Dict[str, Any]]:

        result = (
            self.supabase
            .table("members")
            .select("*")
            .eq(
                "member_number",
                member_number
            )
            .limit(1)
            .execute()
        )

        if not result.data:

            result = (
                self.supabase
                .table("members")
                .select("*")
                .eq(
                    "membership_number",
                    member_number
                )
                .limit(1)
                .execute()
            )

        if not result.data:
            return None

        return self._format_member(
            result.data[0]
        )

    # ============================================================
    # UPDATE MEMBER
    # ============================================================

    async def update_member(
        self,
        member_id: UUID,
        updates: MemberUpdate
    ) -> Dict[str, Any]:

        # Make sure member exists.
        member = await self.get_member(
            member_id
        )

        update_data = {}

        # --------------------------------------------------------
        # Names
        #
        # Database has full_name, not first_name/last_name.
        # --------------------------------------------------------

        first_name = getattr(
            updates,
            "first_name",
            None
        )

        last_name = getattr(
            updates,
            "last_name",
            None
        )

        other_name = getattr(
            updates,
            "other_name",
            None
        )

        if (
            first_name is not None
            or last_name is not None
            or other_name is not None
        ):

            current_name = (
                member.get("full_name")
                or ""
            )

            parts = current_name.split()

            current_first = (
                parts[0]
                if parts
                else ""
            )

            current_last = (
                parts[-1]
                if len(parts) > 1
                else ""
            )

            new_first = (
                first_name.strip()
                if first_name is not None
                else current_first
            )

            new_last = (
                last_name.strip()
                if last_name is not None
                else current_last
            )

            new_other = (
                other_name.strip()
                if other_name is not None
                else ""
            )

            update_data["full_name"] = " ".join(
                part
                for part in [
                    new_first,
                    new_other,
                    new_last
                ]
                if part
            )

        # --------------------------------------------------------
        # PHONE
        # --------------------------------------------------------

        if getattr(
            updates,
            "phone",
            None
        ) is not None:

            update_data["phone"] = (
                normalize_phone(
                    updates.phone
                )
            )

        # --------------------------------------------------------
        # EMAIL
        # --------------------------------------------------------

        if getattr(
            updates,
            "email",
            None
        ) is not None:

            update_data["email"] = (
                str(updates.email)
            )

        # --------------------------------------------------------
        # ADDRESS
        # --------------------------------------------------------

        if getattr(
            updates,
            "address",
            None
        ) is not None:

            update_data["address"] = (
                updates.address.strip()
                if updates.address
                else None
            )

        # --------------------------------------------------------
        # BENEFIT OPTION
        # --------------------------------------------------------

        if getattr(
            updates,
            "benefit_option",
            None
        ) is not None:

            benefit = updates.benefit_option

            if hasattr(
                benefit,
                "value"
            ):
                benefit = benefit.value

            update_data[
                "benefit_option"
            ] = benefit

        # --------------------------------------------------------
        # STATUS
        # --------------------------------------------------------

        is_active = getattr(
            updates,
            "is_active",
            None
        )

        if is_active is not None:

            update_data[
                "member_status"
            ] = (
                "ACTIVE"
                if is_active
                else "INACTIVE"
            )

        # --------------------------------------------------------
        # UPDATE
        # --------------------------------------------------------

        if not update_data:

            raise ValidationError(
                "No fields to update"
            )

        result = (
            self.supabase
            .table("members")
            .update(update_data)
            .eq("id", str(member_id))
            .execute()
        )

        if not result.data:

            raise ValidationError(
                "Failed to update member"
            )

        return self._format_member(
            result.data[0]
        )

    # ============================================================
    # GET MEMBERS
    # ============================================================

    async def get_members(
        self,
        search: Optional[str] = None,
        plan: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        limit: int = 20
    ) -> Dict[str, Any]:

        query = (
            self.supabase
            .table("members")
            .select("*")
        )

        # --------------------------------------------------------
        # SEARCH
        # --------------------------------------------------------

        if search:

            safe_search = (
                search
                .replace(",", "")
                .strip()
            )

            query = query.or_(
                "full_name.ilike.%"
                + safe_search
                + "%,"
                "phone.ilike.%"
                + safe_search
                + "%,"
                "member_number.ilike.%"
                + safe_search
                + "%,"
                "membership_number.ilike.%"
                + safe_search
                + "%"
            )

        # --------------------------------------------------------
        # STATUS
        # --------------------------------------------------------

        if status:

            status_upper = (
                status.upper()
            )

            if status_upper in {
                "ACTIVE",
                "PENDING",
                "INACTIVE",
                "DORMANT",
                "CANCELLED"
            }:

                query = query.eq(
                    "member_status",
                    status_upper
                )

        # --------------------------------------------------------
        # TOTAL
        # --------------------------------------------------------

        count_query = (
            self.supabase
            .table("members")
            .select(
                "id",
                count="exact"
            )
        )

        if search:

            safe_search = (
                search
                .replace(",", "")
                .strip()
            )

            count_query = count_query.or_(
                "full_name.ilike.%"
                + safe_search
                + "%,"
                "phone.ilike.%"
                + safe_search
                + "%,"
                "member_number.ilike.%"
                + safe_search
                + "%,"
                "membership_number.ilike.%"
                + safe_search
                + "%"
            )

        if status:

            status_upper = status.upper()

            if status_upper in {
                "ACTIVE",
                "PENDING",
                "INACTIVE",
                "DORMANT",
                "CANCELLED"
            }:

                count_query = count_query.eq(
                    "member_status",
                    status_upper
                )

        count_result = (
            count_query.execute()
        )

        total = count_result.count or 0

        # --------------------------------------------------------
        # PAGINATION
        # --------------------------------------------------------

        offset = (
            max(page, 1) - 1
        ) * limit

        result = (
            query
            .order(
                "created_at",
                desc=True
            )
            .range(
                offset,
                offset + limit - 1
            )
            .execute()
        )

        members = [
            self._format_member(member)
            for member in (
                result.data or []
            )
        ]

        return {
            "members": members,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": (
                (total + limit - 1) // limit
                if total
                else 1
            )
        }

    # ============================================================
    # DEPENDANTS
    # ============================================================

    async def get_dependants(
        self,
        member_id: UUID
    ) -> List[Dict[str, Any]]:

        result = (
            self.supabase
            .table("dependants")
            .select("*")
            .eq(
                "principal_member_id",
                str(member_id)
            )
            .order(
                "created_at",
                desc=True
            )
            .execute()
        )

        return result.data or []

    # ============================================================
    # ADD DEPENDANT
    # ============================================================

    async def add_dependant(
        self,
        member_id: UUID,
        dependant: DependantCreate
    ) -> Dict[str, Any]:

        member = await self.get_member(
            member_id
        )

        # --------------------------------------------------------
        # FULL NAME
        # --------------------------------------------------------

        first_name = getattr(
            dependant,
            "first_name",
            None
        ) or ""

        last_name = getattr(
            dependant,
            "last_name",
            None
        ) or ""

        full_name = (
            f"{first_name.strip()} "
            f"{last_name.strip()}"
        ).strip()

        if not full_name:

            full_name = (
                getattr(
                    dependant,
                    "full_name",
                    None
                )
                or ""
            ).strip()

        if not full_name:

            raise ValidationError(
                "Dependant name is required."
            )

        # --------------------------------------------------------
        # RELATIONSHIP
        # --------------------------------------------------------

        relationship = dependant.relationship

        if hasattr(
            relationship,
            "value"
        ):
            relationship = relationship.value

        # --------------------------------------------------------
        # NUMBER
        # --------------------------------------------------------

        membership_number = (
            member.get(
                "membership_number"
            )
            or member.get(
                "member_number"
            )
            or "MB"
        )

        existing = (
            self.supabase
            .table("dependants")
            .select("id")
            .eq(
                "principal_member_id",
                str(member_id)
            )
            .execute()
        )

        dependant_number = (
            f"{membership_number}-D"
            f"{len(existing.data or []) + 1:02d}"
        )

        # --------------------------------------------------------
        # INSERT
        # --------------------------------------------------------

        dep_data = {
            "principal_member_id": (
                str(member_id)
            ),
            "dependant_number": (
                dependant_number
            ),
            "full_name": full_name,
            "date_of_birth": (
                dependant.date_of_birth
            ),
            "relationship": relationship,
            "status": "ACTIVE",
        }

        result = (
            self.supabase
            .table("dependants")
            .insert(dep_data)
            .execute()
        )

        if not result.data:

            raise ValidationError(
                "Failed to add dependant"
            )

        return result.data[0]

    # ============================================================
    # DASHBOARD
    # ============================================================

    async def get_dashboard_stats(
        self
    ) -> Dict[str, Any]:

        # --------------------------------------------------------
        # TOTAL
        # --------------------------------------------------------

        total = (
            self.supabase
            .table("members")
            .select(
                "id",
                count="exact"
            )
            .execute()
        )

        # --------------------------------------------------------
        # ACTIVE
        # --------------------------------------------------------

        active = (
            self.supabase
            .table("members")
            .select(
                "id",
                count="exact"
            )
            .eq(
                "member_status",
                "ACTIVE"
            )
            .execute()
        )

        # --------------------------------------------------------
        # PENDING
        # --------------------------------------------------------

        pending = (
            self.supabase
            .table("members")
            .select(
                "id",
                count="exact"
            )
            .eq(
                "member_status",
                "PENDING"
            )
            .execute()
        )

        # --------------------------------------------------------
        # RECENT
        # --------------------------------------------------------

        recent = (
            self.supabase
            .table("members")
            .select(
                "id,"
                "full_name,"
                "phone,"
                "member_number,"
                "membership_number,"
                "member_status,"
                "created_at"
            )
            .order(
                "created_at",
                desc=True
            )
            .limit(10)
            .execute()
        )

        return {
            "total_members": (
                total.count or 0
            ),
            "active_members": (
                active.count or 0
            ),
            "pending_registrations": (
                pending.count or 0
            ),
            "recent_members": (
                recent.data or []
            )
        }

    # ============================================================
    # FORMAT MEMBER
    # ============================================================

    def _format_member(
        self,
        member: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Add compatibility fields for older frontend/API code.

        Database remains unchanged.
        """

        full_name = (
            member.get("full_name")
            or ""
        ).strip()

        parts = full_name.split()

        first_name = (
            parts[0]
            if parts
            else ""
        )

        last_name = (
            parts[-1]
            if len(parts) > 1
            else ""
        )

        member_status = str(
            member.get(
                "member_status",
                ""
            )
        ).upper()

        return {
            **member,

            # Compatibility only.
            "first_name": first_name,
            "last_name": last_name,

            "is_active": (
                member_status == "ACTIVE"
            ),

            # Kept for old API consumers.
            # Authoritative payment status belongs
            # to payments/memberships.
            "registration_fee_paid": False
        }

    # ============================================================
    # MEMBER NUMBER
    # ============================================================

    async def _generate_member_number(
        self
    ) -> str:

        year = datetime.now().year

        result = (
            self.supabase
            .table("members")
            .select("id")
            .like(
                "member_number",
                f"MB-{year}-%"
            )
            .execute()
        )

        count = (
            len(result.data or [])
            + 1
        )

        return (
            f"MB-{year}-{count:06d}"
        )

    # ============================================================
    # MEMBERSHIP NUMBER
    # ============================================================

    async def _generate_membership_number(
        self
    ) -> str:

        year = datetime.now().year

        result = (
            self.supabase
            .table("members")
            .select("id")
            .like(
                "membership_number",
                f"MBM-{year}-%"
            )
            .execute()
        )

        count = (
            len(result.data or [])
            + 1
        )

        return (
            f"MBM-{year}-{count:06d}"
        )

    # ============================================================
    # DELETE / ROLLBACK MEMBER
    # ============================================================

    async def _delete_member(
        self,
        member_id
    ) -> None:

        try:

            (
                self.supabase
                .table("members")
                .delete()
                .eq(
                    "id",
                    str(member_id)
                )
                .execute()
            )

        except Exception:

            logger.exception(
                "Failed to rollback member %s",
                member_id
            )


# ================================================================
# SINGLETON
# ================================================================

member_service = MemberService()
```
