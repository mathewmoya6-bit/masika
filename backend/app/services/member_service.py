"""
Member Service - Business Logic for Members

Compatible with the current Masika Benevolent Supabase schema.

Current database structure:
    members
    memberships
    dependants
    plans
    payments

IMPORTANT:
    This service does NOT use the old members columns:
        first_name
        last_name
        other_name
        id_number
        location
        plan
        is_active
        registration_fee_paid
        waiting_period_months
"""

import logging
from datetime import date
from typing import Optional, List, Dict, Any
from uuid import UUID

from app.database import get_supabase
from app.models import (
    MemberUpdate,
    DependantCreate,
    RegistrationRequest,
    PlanEnum,
    BenefitOptionEnum,
)
from app.exceptions import (
    NotFoundError,
    DuplicateError,
    ValidationError,
)
from app.utils.helpers import (
    normalize_phone,
    generate_member_number,
)

logger = logging.getLogger(__name__)


class MemberService:
    """Service for member operations."""

    def __init__(self):
        self.supabase = get_supabase()

    # ============================================================
    # INTERNAL HELPERS
    # ============================================================

    @staticmethod
    def _safe_string(value: Any) -> Optional[str]:
        """Convert a value to a trimmed string or None."""
        if value is None:
            return None

        value = str(value).strip()

        return value if value else None

    @staticmethod
    def _get_full_name(data: RegistrationRequest) -> str:
        """
        Build full_name from the registration request.

        Supports the existing frontend/model structure:
            first_name
            last_name
            other_name
        """

        parts = []

        first_name = getattr(data, "first_name", None)
        other_name = getattr(data, "other_name", None)
        last_name = getattr(data, "last_name", None)

        for value in [first_name, other_name, last_name]:
            value = MemberService._safe_string(value)

            if value:
                parts.append(value)

        # Fallback in case RegistrationRequest already has full_name
        if not parts:
            full_name = getattr(data, "full_name", None)

            if full_name:
                return str(full_name).strip()

        if not parts:
            raise ValidationError("Member full name is required")

        return " ".join(parts)

    @staticmethod
    def _get_national_id(data: RegistrationRequest) -> Optional[str]:
        """
        Support the current model's id_number while storing it
        in the actual database column national_id.
        """

        value = getattr(data, "id_number", None)

        if value is None:
            value = getattr(data, "national_id", None)

        return MemberService._safe_string(value)

    @staticmethod
    def _get_town(data: RegistrationRequest) -> Optional[str]:
        """
        The old model called this 'location'.

        Current database column is 'town'.
        """

        value = getattr(data, "location", None)

        if value is None:
            value = getattr(data, "town", None)

        return MemberService._safe_string(value)

    @staticmethod
    def _get_sub_county(data: RegistrationRequest) -> Optional[str]:
        return MemberService._safe_string(
            getattr(data, "sub_county", None)
        )

    @staticmethod
    def _get_address(data: RegistrationRequest) -> Optional[str]:
        return MemberService._safe_string(
            getattr(data, "address", None)
        )

    @staticmethod
    def _get_email(data: RegistrationRequest) -> Optional[str]:
        value = getattr(data, "email", None)

        if value is None:
            return None

        return str(value).strip()

    @staticmethod
    def _get_plan_code(data: RegistrationRequest) -> str:
        """Return the selected plan code."""
        plan = getattr(data, "plan", None)

        if plan is None:
            raise ValidationError("Membership plan is required")

        if hasattr(plan, "value"):
            return str(plan.value).upper()

        return str(plan).upper()

    @staticmethod
    def _get_benefit_option(data: RegistrationRequest) -> str:
        """Return benefit option safely."""
        benefit = getattr(data, "benefit_option", None)

        if benefit is None:
            return "service"

        if hasattr(benefit, "value"):
            return str(benefit.value)

        return str(benefit)

    @staticmethod
    def _get_gender(data: RegistrationRequest) -> Optional[str]:
        gender = getattr(data, "gender", None)

        if gender is None:
            return None

        if hasattr(gender, "value"):
            return str(gender.value)

        return str(gender)

    @staticmethod
    def _get_date_of_birth(data: RegistrationRequest):
        return getattr(data, "date_of_birth", None)

    @staticmethod
    def _get_dependants(data: RegistrationRequest) -> List[Any]:
        dependants = getattr(data, "dependants", None)

        if not dependants:
            return []

        return list(dependants)

    async def _get_plan(self, plan_code: str) -> Dict[str, Any]:
        """
        Get plan from the actual plans table.
        """

        result = (
            self.supabase
            .table("plans")
            .select("*")
            .eq("plan_code", plan_code)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )

        if not result.data:
            raise ValidationError(
                f"Membership plan '{plan_code}' was not found or is inactive"
            )

        return result.data[0]

    @staticmethod
    def _calculate_registration_amount(
        plan: Dict[str, Any],
        dependant_count: int,
    ) -> float:
        """
        Calculate registration amount using the CURRENT plans schema.

        Principal registration fee:
            plans.principal_registration_fee

        Dependant registration fee:
            plans.dependant_registration_fee
        """

        principal_fee = float(
            plan.get("principal_registration_fee")
            or plan.get("registration_fee")
            or 0
        )

        dependant_fee = float(
            plan.get("dependant_registration_fee")
            or 0
        )

        return principal_fee + (
            dependant_fee * dependant_count
        )

    @staticmethod
    def _calculate_waiting_period_months(
        plan: Dict[str, Any],
    ) -> int:
        """
        Current plans table contains waiting_period_months.

        Fall back to waiting_period_days if necessary.
        """

        value = plan.get("waiting_period_months")

        if value is not None:
            return int(value)

        waiting_days = plan.get("waiting_period_days")

        if waiting_days:
            return max(0, int(round(int(waiting_days) / 30)))

        return 0

    @staticmethod
    def _calculate_next_payment_due_date(
        start_date: date,
        deadline_days: int,
    ) -> date:
        """
        Calculate the initial payment deadline.
        """

        from datetime import timedelta

        return start_date + timedelta(days=int(deadline_days or 10))

    # ============================================================
    # MEMBER REGISTRATION
    # ============================================================

    async def create_member(
        self,
        data: RegistrationRequest
    ) -> Dict[str, Any]:
        """
        Create a new member using the current database schema.

        Flow:

            1. Validate phone
            2. Check duplicate phone/email
            3. Load selected plan
            4. Generate membership number
            5. Insert members row
            6. Insert memberships row
            7. Insert dependant rows
            8. Return member information
        """

        try:
            # ----------------------------------------------------
            # BASIC INFORMATION
            # ----------------------------------------------------

            phone = normalize_phone(data.phone)

            if not phone:
                raise ValidationError("Phone number is required")

            full_name = self._get_full_name(data)
            national_id = self._get_national_id(data)
            email = self._get_email(data)

            county = self._safe_string(
                getattr(data, "county", None)
            )

            sub_county = self._get_sub_county(data)
            town = self._get_town(data)
            address = self._get_address(data)

            next_of_kin_name = self._safe_string(
                getattr(data, "next_of_kin_name", None)
            )

            next_of_kin_phone = self._safe_string(
                getattr(data, "next_of_kin_phone", None)
            )

            next_of_kin_relationship = self._safe_string(
                getattr(data, "next_of_kin_relationship", None)
            )

            gender = self._get_gender(data)
            date_of_birth = self._get_date_of_birth(data)

            benefit_option = self._get_benefit_option(data)

            # ----------------------------------------------------
            # PLAN
            # ----------------------------------------------------

            plan_code = self._get_plan_code(data)

            plan = await self._get_plan(plan_code)

            # ----------------------------------------------------
            # DUPLICATE PHONE
            # ----------------------------------------------------

            existing = (
                self.supabase
                .table("members")
                .select("id, membership_number, full_name")
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

            if email:
                existing_email = (
                    self.supabase
                    .table("members")
                    .select("id, membership_number, full_name")
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

            # ----------------------------------------------------
            # MEMBER NUMBER
            # ----------------------------------------------------

            membership_number = generate_member_number()

            # ----------------------------------------------------
            # MEMBER DATA
            #
            # ONLY columns that actually exist in members table.
            # ----------------------------------------------------

            member_data = {
                "membership_number": membership_number,
                "full_name": full_name,
                "national_id": national_id,
                "date_of_birth": date_of_birth,
                "gender": gender,
                "phone": phone,
                "email": email,
                "address": address,
                "county": county,
                "sub_county": sub_county,
                "town": town,
                "next_of_kin_name": next_of_kin_name,
                "next_of_kin_phone": next_of_kin_phone,
                "next_of_kin_relationship": next_of_kin_relationship,
                "agent_name": None,
                "member_number": membership_number,
                "benefit_option": benefit_option,
            }

            # Remove None values except where you may want explicit NULL.
            member_data = {
                key: value
                for key, value in member_data.items()
                if value is not None
            }

            logger.info(
                "Creating member: %s (%s)",
                full_name,
                membership_number
            )

            # ----------------------------------------------------
            # INSERT MEMBER
            # ----------------------------------------------------

            result = (
                self.supabase
                .table("members")
                .insert(member_data)
                .execute()
            )

            if not result.data:
                raise ValidationError(
                    "Failed to create member"
                )

            member = result.data[0]

            member_id = member["id"]

            # ----------------------------------------------------
            # DEPENDANTS
            # ----------------------------------------------------

            dependants = self._get_dependants(data)

            max_dependants = plan.get("max_dependants")

            if (
                max_dependants is not None
                and len(dependants) > int(max_dependants)
            ):
                raise ValidationError(
                    f"The {plan.get('plan_name', plan_code)} "
                    f"allows a maximum of {max_dependants} dependants"
                )

            dependant_count = len(dependants)

            registration_amount = (
                self._calculate_registration_amount(
                    plan,
                    dependant_count
                )
            )

            dependant_records = []

            for index, dep in enumerate(
                dependants,
                start=1
            ):
                dependant_full_name = self._safe_string(
                    getattr(dep, "full_name", None)
                )

                # Support existing model structure
                if not dependant_full_name:

                    first_name = self._safe_string(
                        getattr(dep, "first_name", None)
                    )

                    last_name = self._safe_string(
                        getattr(dep, "last_name", None)
                    )

                    dependant_full_name = " ".join(
                        x for x in [
                            first_name,
                            last_name
                        ]
                        if x
                    )

                if not dependant_full_name:
                    raise ValidationError(
                        f"Dependant {index} full name is required"
                    )

                relationship = getattr(
                    dep,
                    "relationship",
                    None
                )

                if hasattr(relationship, "value"):
                    relationship = relationship.value

                relationship = self._safe_string(
                    relationship
                )

                if not relationship:
                    raise ValidationError(
                        f"Relationship is required for dependant {index}"
                    )

                national_id_dep = self._safe_string(
                    getattr(dep, "national_id", None)
                )

                birth_certificate_number = self._safe_string(
                    getattr(
                        dep,
                        "birth_certificate_number",
                        None
                    )
                )

                dependant_phone = self._safe_string(
                    getattr(dep, "phone", None)
                )

                dependant_dob = getattr(
                    dep,
                    "date_of_birth",
                    None
                )

                dependant_gender = getattr(
                    dep,
                    "gender",
                    None
                )

                if hasattr(dependant_gender, "value"):
                    dependant_gender = dependant_gender.value

                # ----------------------------------------------
                # CURRENT DEPENDANTS SCHEMA
                # ----------------------------------------------

                dep_data = {
                    "principal_member_id": member_id,
                    "dependant_number": (
                        f"{membership_number}-D{index:02d}"
                    ),
                    "full_name": dependant_full_name,
                    "national_id": national_id_dep,
                    "birth_certificate_number": (
                        birth_certificate_number
                    ),
                    "date_of_birth": dependant_dob,
                    "gender": dependant_gender,
                    "relationship": relationship,
                    "phone": dependant_phone,
                    "status": "ACTIVE",
                }

                dep_data = {
                    key: value
                    for key, value in dep_data.items()
                    if value is not None
                }

                dep_result = (
                    self.supabase
                    .table("dependants")
                    .insert(dep_data)
                    .execute()
                )

                if dep_result.data:
                    dependant_records.append(
                        dep_result.data[0]
                    )

            # ----------------------------------------------------
            # MEMBERSHIP
            # ----------------------------------------------------

            today = date.today()

            waiting_period_months = (
                self._calculate_waiting_period_months(plan)
            )

            monthly_premium = float(
                plan.get("monthly_premium")
                or plan.get("principal_monthly_premium")
                or 0
            )

            monthly_deadline_days = int(
                plan.get(
                    "monthly_payment_deadline_days"
                )
                or 10
            )

            next_payment_due_date = (
                self._calculate_next_payment_due_date(
                    today,
                    monthly_deadline_days
                )
            )

            # ----------------------------------------------------
            # CURRENT MEMBERSHIPS SCHEMA
            # ----------------------------------------------------

            membership_data = {
                "member_id": member_id,
                "plan_id": plan["id"],
                "membership_start_date": today,
                "status": "PENDING",
                "registration_fee_due": registration_amount,
                "registration_fee_paid": 0,
                "monthly_premium": monthly_premium,
                "monthly_equivalent_units": monthly_premium,
                "required_monthly_equivalent_units": monthly_premium,
                "waiting_period_months": waiting_period_months,
                "monthly_payment_deadline": next_payment_due_date,
            }

            membership_result = (
                self.supabase
                .table("memberships")
                .insert(membership_data)
                .execute()
            )

            if not membership_result.data:

                logger.error(
                    "Member was created but membership creation failed. "
                    "member_id=%s",
                    member_id
                )

                raise ValidationError(
                    "Member created but membership could not be created"
                )

            membership = membership_result.data[0]

            # ----------------------------------------------------
            # UPDATE MEMBER STATUS
            # ----------------------------------------------------

            # Member remains PENDING until registration payment.
            #
            # The database default is already PENDING, so this is
            # intentionally not changing member_status here.

            # ----------------------------------------------------
            # RETURN
            # ----------------------------------------------------

            return {
                "id": member_id,
                "member_id": member_id,
                "membership_id": membership.get("id"),
                "membership_number": membership_number,
                "member_number": membership_number,
                "full_name": full_name,
                "phone": phone,
                "email": email,
                "plan": plan_code,
                "plan_id": plan.get("id"),
                "plan_name": plan.get("plan_name"),
                "benefit_option": benefit_option,
                "registration_amount": registration_amount,
                "dependant_count": dependant_count,
                "dependants": dependant_records,
                "member_status": member.get(
                    "member_status",
                    "PENDING"
                ),
                "membership_status": membership.get(
                    "status",
                    "PENDING"
                ),
            }

        except (
            DuplicateError,
            ValidationError,
            NotFoundError,
        ):
            raise

        except Exception as e:
            logger.exception(
                "Unexpected error creating member"
            )

            raise ValidationError(
                f"Failed to create member: {str(e)}"
            )

    # ============================================================
    # GET MEMBER
    # ============================================================

    async def get_member(
        self,
        member_id: UUID
    ) -> Dict[str, Any]:
        """Get member by ID."""

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

        member = result.data[0]

        # Get membership
        membership_result = (
            self.supabase
            .table("memberships")
            .select(
                "*, plans(*)"
            )
            .eq(
                "member_id",
                str(member_id)
            )
            .order(
                "created_at",
                desc=True
            )
            .limit(1)
            .execute()
        )

        if membership_result.data:
            member["membership"] = (
                membership_result.data[0]
            )

        # Get dependants
        dependant_result = (
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

        member["dependants"] = (
            dependant_result.data or []
        )

        return member

    # ============================================================
    # GET MEMBER BY PHONE
    # ============================================================

    async def get_member_by_phone(
        self,
        phone: str
    ) -> Optional[Dict[str, Any]]:
        """Get member by phone number."""

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

        return result.data[0]

    # ============================================================
    # GET MEMBER BY NUMBER
    # ============================================================

    async def get_member_by_number(
        self,
        member_number: str
    ) -> Optional[Dict[str, Any]]:
        """Get member by membership/member number."""

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
            return None

        return result.data[0]

    # ============================================================
    # UPDATE MEMBER
    # ============================================================

    async def update_member(
        self,
        member_id: UUID,
        updates: MemberUpdate
    ) -> Dict[str, Any]:
        """
        Update member using the CURRENT members schema.
        """

        # Confirm member exists
        await self.get_member(member_id)

        update_data: Dict[str, Any] = {}

        # --------------------------------------------
        # FULL NAME
        # --------------------------------------------

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

            current = await self.get_member(
                member_id
            )

            current_name = current.get(
                "full_name",
                ""
            )

            parts = []

            if first_name is not None:
                parts.append(
                    str(first_name).strip()
                )

            if other_name:
                parts.append(
                    str(other_name).strip()
                )

            if last_name is not None:
                parts.append(
                    str(last_name).strip()
                )

            if parts:
                update_data["full_name"] = (
                    " ".join(parts)
                )
            else:
                update_data["full_name"] = (
                    current_name
                )

        # --------------------------------------------
        # PHONE
        # --------------------------------------------

        phone = getattr(
            updates,
            "phone",
            None
        )

        if phone is not None:
            update_data["phone"] = (
                normalize_phone(phone)
            )

        # --------------------------------------------
        # EMAIL
        # --------------------------------------------

        email = getattr(
            updates,
            "email",
            None
        )

        if email is not None:
            update_data["email"] = (
                str(email).strip()
                if email
                else None
            )

        # --------------------------------------------
        # ADDRESS
        # --------------------------------------------

        address = getattr(
            updates,
            "address",
            None
        )

        if address is not None:
            update_data["address"] = (
                str(address).strip()
                if address
                else None
            )

        # --------------------------------------------
        # OTHER CURRENT COLUMNS
        # --------------------------------------------

        for field in [
            "national_id",
            "passport_number",
            "date_of_birth",
            "gender",
            "alternative_phone",
            "county",
            "sub_county",
            "town",
            "next_of_kin_name",
            "next_of_kin_phone",
            "next_of_kin_relationship",
            "benefit_option",
        ]:

            value = getattr(
                updates,
                field,
                None
            )

            if value is not None:

                if hasattr(value, "value"):
                    value = value.value

                update_data[field] = value

        if not update_data:
            raise ValidationError(
                "No fields to update"
            )

        update_data["updated_at"] = (
            "now()"
        )

        result = (
            self.supabase
            .table("members")
            .update(update_data)
            .eq(
                "id",
                str(member_id)
            )
            .execute()
        )

        if not result.data:
            raise ValidationError(
                "Failed to update member"
            )

        return result.data[0]

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
        """
        Get paginated members.

        Uses CURRENT columns:
            full_name
            phone
            member_number
            membership_number
            member_status
        """

        page = max(1, page)
        limit = min(max(1, limit), 100)

        query = (
            self.supabase
            .table("members")
            .select("*", count="exact")
        )

        # --------------------------------------------
        # SEARCH
        # --------------------------------------------

        if search:

            search = search.strip()

            query = query.or_(
                "full_name.ilike.%"
                + search
                + "%,"
                "phone.ilike.%"
                + search
                + "%,"
                "member_number.ilike.%"
                + search
                + "%,"
                "membership_number.ilike.%"
                + search
                + "%"
            )

        # --------------------------------------------
        # STATUS
        # --------------------------------------------

        if status:

            status_upper = status.upper()

            valid_statuses = {
                "PENDING",
                "ACTIVE",
                "DORMANT",
                "CANCELLED",
                "INACTIVE",
            }

            if status_upper in valid_statuses:
                query = query.eq(
                    "member_status",
                    status_upper
                )

        # --------------------------------------------
        # PLAN FILTER
        #
        # Plan lives in memberships/plans, not members.
        #
        # Therefore we don't send an invalid:
        #
        # members.plan
        #
        # filter.
        #
        # Plan filtering can be implemented through a
        # membership query if needed.
        # --------------------------------------------

        offset = (
            (page - 1) * limit
        )

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

        members = result.data or []

        # --------------------------------------------
        # ADD MEMBERSHIP INFORMATION
        # --------------------------------------------

        for member in members:

            membership_result = (
                self.supabase
                .table("memberships")
                .select(
                    "*, plans(*)"
                )
                .eq(
                    "member_id",
                    member["id"]
                )
                .order(
                    "created_at",
                    desc=True
                )
                .limit(1)
                .execute()
            )

            if membership_result.data:

                membership = (
                    membership_result.data[0]
                )

                member["membership"] = (
                    membership
                )

                plan_data = membership.get(
                    "plans"
                )

                if plan_data:

                    member["plan"] = (
                        plan_data.get(
                            "plan_code"
                        )
                    )

                    member["plan_name"] = (
                        plan_data.get(
                            "plan_name"
                        )
                    )

        total = result.count or 0

        return {
            "members": members,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": (
                (total + limit - 1) // limit
                if total
                else 1
            ),
        }

    # ============================================================
    # DEPENDANTS
    # ============================================================

    async def get_dependants(
        self,
        member_id: UUID
    ) -> List[Dict[str, Any]]:
        """Get all dependants for a member."""

        await self.get_member(member_id)

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
        """Add dependant using current schema."""

        member = await self.get_member(
            member_id
        )

        # Get membership to determine maximum dependants
        membership_result = (
            self.supabase
            .table("memberships")
            .select(
                "*, plans(*)"
            )
            .eq(
                "member_id",
                str(member_id)
            )
            .order(
                "created_at",
                desc=True
            )
            .limit(1)
            .execute()
        )

        if membership_result.data:

            membership = (
                membership_result.data[0]
            )

            plan = membership.get(
                "plans"
            )

            if plan:

                max_dependants = (
                    plan.get(
                        "max_dependants"
                    )
                )

                if max_dependants is not None:

                    current = (
                        self.supabase
                        .table("dependants")
                        .select(
                            "id",
                            count="exact"
                        )
                        .eq(
                            "principal_member_id",
                            str(member_id)
                        )
                        .eq(
                            "status",
                            "ACTIVE"
                        )
                        .execute()
                    )

                    current_count = (
                        current.count or 0
                    )

                    if current_count >= int(
                        max_dependants
                    ):
                        raise ValidationError(
                            f"This plan allows a "
                            f"maximum of "
                            f"{max_dependants} "
                            f"dependants"
                        )

        # --------------------------------------------
        # DEPENDANT NUMBER
        # --------------------------------------------

        current_count_result = (
            self.supabase
            .table("dependants")
            .select(
                "id",
                count="exact"
            )
            .eq(
                "principal_member_id",
                str(member_id)
            )
            .execute()
        )

        next_number = (
            (current_count_result.count or 0)
            + 1
        )

        membership_number = (
            member.get(
                "membership_number"
            )
            or member.get(
                "member_number"
            )
        )

        # --------------------------------------------
        # NAME
        # --------------------------------------------

        full_name = getattr(
            dependant,
            "full_name",
            None
        )

        if not full_name:

            first_name = getattr(
                dependant,
                "first_name",
                None
            )

            last_name = getattr(
                dependant,
                "last_name",
                None
            )

            full_name = " ".join(
                str(x).strip()
                for x in [
                    first_name,
                    last_name
                ]
                if x
            )

        if not full_name:
            raise ValidationError(
                "Dependant full name is required"
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
            relationship = (
                relationship.value
            )

        if not relationship:
            raise ValidationError(
                "Dependant relationship is required"
            )

        gender = getattr(
            dependant,
            "gender",
            None
        )

        if hasattr(
            gender,
            "value"
        ):
            gender = gender.value

        # --------------------------------------------
        # CURRENT DEPENDANTS SCHEMA
        # --------------------------------------------

        dep_data = {
            "principal_member_id": str(
                member_id
            ),
            "dependant_number": (
                f"{membership_number}"
                f"-D{next_number:02d}"
            ),
            "full_name": str(
                full_name
            ).strip(),
            "national_id": getattr(
                dependant,
                "national_id",
                None
            ),
            "birth_certificate_number": getattr(
                dependant,
                "birth_certificate_number",
                None
            ),
            "date_of_birth": getattr(
                dependant,
                "date_of_birth",
                None
            ),
            "gender": gender,
            "relationship": str(
                relationship
            ),
            "phone": getattr(
                dependant,
                "phone",
                None
            ),
            "status": "ACTIVE",
        }

        dep_data = {
            key: value
            for key, value in dep_data.items()
            if value is not None
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
    # DASHBOARD STATISTICS
    # ============================================================

    async def get_dashboard_stats(
        self
    ) -> Dict[str, Any]:
        """Get dashboard statistics using current schema."""

        # --------------------------------------------
        # TOTAL MEMBERS
        # --------------------------------------------

        total = (
            self.supabase
            .table("members")
            .select(
                "id",
                count="exact"
            )
            .execute()
        )

        # --------------------------------------------
        # ACTIVE
        # --------------------------------------------

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

        # --------------------------------------------
        # PENDING
        # --------------------------------------------

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

        # --------------------------------------------
        # DORMANT
        # --------------------------------------------

        dormant = (
            self.supabase
            .table("members")
            .select(
                "id",
                count="exact"
            )
            .eq(
                "member_status",
                "DORMANT"
            )
            .execute()
        )

        # --------------------------------------------
        # RECENT MEMBERS
        # --------------------------------------------

        recent = (
            self.supabase
            .table("members")
            .select(
                "id, full_name, phone, "
                "membership_number, member_number, "
                "member_status, created_at"
            )
            .order(
                "created_at",
                desc=True
            )
            .limit(10)
            .execute()
        )

        return {
            "total_members": total.count or 0,
            "active_members": active.count or 0,
            "pending_registrations": (
                pending.count or 0
            ),
            "dormant_members": (
                dormant.count or 0
            ),
            "recent_members": (
                recent.data or []
            ),
        }


# ============================================================
# SINGLETON
# ============================================================

member_service = MemberService()
