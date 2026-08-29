"""
Member Service
Business Logic for Members

IMPORTANT:
This service is designed specifically for the current Masika Benevolent
Supabase schema.

members columns:
    id
    membership_number
    full_name
    national_id
    passport_number
    date_of_birth
    gender
    phone
    alternative_phone
    email
    address
    county
    sub_county
    town
    next_of_kin_name
    next_of_kin_phone
    next_of_kin_relationship
    branch_id
    agent_name
    member_status
    registration_date
    created_at
    updated_at
    created_by_staff_id
    assigned_agent_id
    dormant_at
    dormant_reason
    member_number
    benefit_option

dependants columns:
    id
    principal_member_id
    dependant_number
    full_name
    national_id
    birth_certificate_number
    date_of_birth
    gender
    relationship
    phone
    status
    created_at
    updated_at
"""

import logging
from datetime import date
from typing import Optional, List, Dict, Any
from uuid import UUID

from app.database import get_supabase

from app.models import (
    MemberCreate,
    MemberUpdate,
    MemberResponse,
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
    """Business logic for members using the CURRENT Supabase schema."""

    def __init__(self):
        self.supabase = get_supabase()

    # ============================================================
    # HELPERS
    # ============================================================

    @staticmethod
    def _build_full_name(
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        other_name: Optional[str] = None,
        full_name: Optional[str] = None,
    ) -> str:
        """
        Convert frontend/model first/last/other names into the single
        members.full_name column.
        """

        if full_name:
            value = str(full_name).strip()
            if value:
                return value

        parts = []

        for value in [first_name, other_name, last_name]:
            if value:
                value = str(value).strip()
                if value:
                    parts.append(value)

        return " ".join(parts).strip()

    @staticmethod
    def _enum_value(value):
        """Safely extract enum value."""
        if value is None:
            return None

        return getattr(value, "value", value)

    @staticmethod
    def _calculate_waiting_months(plan):
        """Return waiting period in months."""
        plan_value = getattr(plan, "value", plan)

        if str(plan_value).upper() == "COMFORT":
            return 4

        return 6

    # ============================================================
    # MEMBER CREATE
    # ============================================================

    async def create_member(
        self,
        data: RegistrationRequest
    ) -> Dict[str, Any]:
        """
        Create a member using the EXACT current members schema.

        DO NOT insert:
            first_name
            last_name
            other_name
            id_number
            location
            plan
            registration_fee_paid
            is_active
            waiting_period_months

        Those columns DO NOT exist in the current members table.
        """

        try:
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
                .select("id, phone, membership_number, member_number")
                .eq("phone", phone)
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

            email = None

            if getattr(data, "email", None):
                email = str(data.email).strip()

                existing_email = (
                    self.supabase
                    .table("members")
                    .select("id, email")
                    .eq("email", email)
                    .execute()
                )

                if existing_email.data:
                    raise DuplicateError(
                        "Member",
                        "email",
                        email
                    )

            # ----------------------------------------------------
            # FULL NAME
            # ----------------------------------------------------

            full_name = self._build_full_name(
                first_name=getattr(data, "first_name", None),
                last_name=getattr(data, "last_name", None),
                other_name=getattr(data, "other_name", None),
                full_name=getattr(data, "full_name", None),
            )

            if not full_name:
                raise ValidationError(
                    "Full name is required"
                )

            # ----------------------------------------------------
            # MEMBER NUMBER
            # ----------------------------------------------------

            generated_number = generate_member_number()

            # Your database has both membership_number and
            # member_number. membership_number is NOT NULL.
            membership_number = generated_number

            # ----------------------------------------------------
            # PLAN / BENEFIT
            # ----------------------------------------------------

            benefit_option = getattr(
                data,
                "benefit_option",
                None
            )

            benefit_value = self._enum_value(
                benefit_option
            )

            # Database default is "service".
            if not benefit_value:
                benefit_value = "service"

            # ----------------------------------------------------
            # OPTIONAL FIELDS
            # ----------------------------------------------------

            national_id = getattr(
                data,
                "id_number",
                None
            )

            if national_id:
                national_id = str(
                    national_id
                ).strip()

            date_of_birth = getattr(
                data,
                "date_of_birth",
                None
            )

            gender = getattr(
                data,
                "gender",
                None
            )

            if gender:
                gender = self._enum_value(gender)

            county = getattr(
                data,
                "county",
                None
            )

            if county:
                county = str(county).strip()

            # Some older frontend models use "location".
            # Current DB uses town/sub_county instead.
            location = getattr(
                data,
                "location",
                None
            )

            if location:
                location = str(location).strip()

            address = getattr(
                data,
                "address",
                None
            )

            if address:
                address = str(address).strip()

            # ----------------------------------------------------
            # MEMBER DATA
            #
            # THIS IS THE CRITICAL FIX.
            #
            # Every column below exists in your posted schema.
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
                "town": location,
                "benefit_option": benefit_value,
            }

            # ----------------------------------------------------
            # MEMBER STATUS
            #
            # Do not send it unless your model specifically needs it.
            # Database default is PENDING.
            # ----------------------------------------------------

            logger.info(
                "Creating member with schema-compatible fields: %s",
                list(member_data.keys())
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

            logger.info(
                "Member created successfully: %s",
                member.get("membership_number")
            )

            # ----------------------------------------------------
            # DEPENDANTS
            # ----------------------------------------------------

            dependants = getattr(
                data,
                "dependants",
                []
            ) or []

            for index, dep in enumerate(
                dependants,
                start=1
            ):

                try:
                    dep_first_name = getattr(
                        dep,
                        "first_name",
                        None
                    )

                    dep_last_name = getattr(
                        dep,
                        "last_name",
                        None
                    )

                    dep_other_name = getattr(
                        dep,
                        "other_name",
                        None
                    )

                    dep_full_name = self._build_full_name(
                        first_name=dep_first_name,
                        last_name=dep_last_name,
                        other_name=dep_other_name,
                        full_name=getattr(
                            dep,
                            "full_name",
                            None
                        ),
                    )

                    if not dep_full_name:
                        logger.warning(
                            "Skipping dependant %s: missing name",
                            index
                        )
                        continue

                    relationship = getattr(
                        dep,
                        "relationship",
                        None
                    )

                    relationship = self._enum_value(
                        relationship
                    )

                    if not relationship:
                        relationship = "OTHER"

                    dependant_number = (
                        f"{membership_number}-D{index:02d}"
                    )

                    dep_data = {
                        "principal_member_id": member["id"],
                        "dependant_number": dependant_number,
                        "full_name": dep_full_name,
                        "date_of_birth": getattr(
                            dep,
                            "date_of_birth",
                            None
                        ),
                        "gender": self._enum_value(
                            getattr(
                                dep,
                                "gender",
                                None
                            )
                        ),
                        "relationship": relationship,
                        "phone": getattr(
                            dep,
                            "phone",
                            None
                        ),
                        "status": "ACTIVE",
                    }

                    # Optional national ID
                    dep_national_id = getattr(
                        dep,
                        "national_id",
                        None
                    )

                    if dep_national_id:
                        dep_data["national_id"] = str(
                            dep_national_id
                        ).strip()

                    # Optional birth certificate
                    birth_certificate = getattr(
                        dep,
                        "birth_certificate_number",
                        None
                    )

                    if birth_certificate:
                        dep_data[
                            "birth_certificate_number"
                        ] = str(
                            birth_certificate
                        ).strip()

                    logger.info(
                        "Creating dependant %s for member %s",
                        dependant_number,
                        member["id"]
                    )

                    dep_result = (
                        self.supabase
                        .table("dependants")
                        .insert(dep_data)
                        .execute()
                    )

                    if not dep_result.data:
                        logger.warning(
                            "Dependant %s was not created",
                            dependant_number
                        )

                except Exception as dep_error:
                    # Do not destroy successful member registration
                    # because one dependant failed.
                    logger.exception(
                        "Failed to insert dependant %s: %s",
                        index,
                        dep_error
                    )

            return member

        except DuplicateError:
            raise

        except ValidationError:
            raise

        except Exception as e:
            logger.exception(
                "create_member failed: %s",
                e
            )
            raise

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
            .execute()
        )

        if not result.data:
            raise NotFoundError(
                "Member",
                str(member_id)
            )

        return result.data[0]

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
            .execute()
        )

        return (
            result.data[0]
            if result.data
            else None
        )

    # ============================================================
    # GET MEMBER BY NUMBER
    # ============================================================

    async def get_member_by_number(
        self,
        member_number: str
    ) -> Optional[Dict[str, Any]]:

        # Search member_number first
        result = (
            self.supabase
            .table("members")
            .select("*")
            .eq(
                "member_number",
                member_number
            )
            .execute()
        )

        if result.data:
            return result.data[0]

        # Also support membership_number
        result = (
            self.supabase
            .table("members")
            .select("*")
            .eq(
                "membership_number",
                member_number
            )
            .execute()
        )

        return (
            result.data[0]
            if result.data
            else None
        )

    # ============================================================
    # UPDATE MEMBER
    # ============================================================

    async def update_member(
        self,
        member_id: UUID,
        updates: MemberUpdate
    ) -> Dict[str, Any]:

        await self.get_member(member_id)

        update_data = {}

        # --------------------------------------------------------
        # Build full_name from old-style model fields
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

        supplied_full_name = getattr(
            updates,
            "full_name",
            None
        )

        if any(
            value is not None
            for value in [
                first_name,
                last_name,
                other_name,
                supplied_full_name,
            ]
        ):

            current = await self.get_member(
                member_id
            )

            full_name = self._build_full_name(
                first_name=first_name,
                last_name=last_name,
                other_name=other_name,
                full_name=supplied_full_name,
            )

            # If only one component was supplied, preserve
            # existing full name rather than accidentally erasing it.
            if not full_name:
                full_name = current.get(
                    "full_name"
                )

            update_data["full_name"] = full_name

        # --------------------------------------------------------
        # Phone
        # --------------------------------------------------------

        phone = getattr(
            updates,
            "phone",
            None
        )

        if phone is not None:
            update_data["phone"] = normalize_phone(
                phone
            )

        # --------------------------------------------------------
        # Email
        # --------------------------------------------------------

        email = getattr(
            updates,
            "email",
            None
        )

        if email is not None:
            update_data["email"] = str(
                email
            )

        # --------------------------------------------------------
        # Address
        # --------------------------------------------------------

        address = getattr(
            updates,
            "address",
            None
        )

        if address is not None:
            update_data["address"] = str(
                address
            ).strip()

        # --------------------------------------------------------
        # Benefit option
        # --------------------------------------------------------

        benefit_option = getattr(
            updates,
            "benefit_option",
            None
        )

        if benefit_option is not None:
            update_data[
                "benefit_option"
            ] = self._enum_value(
                benefit_option
            )

        # --------------------------------------------------------
        # National ID
        # --------------------------------------------------------

        id_number = getattr(
            updates,
            "id_number",
            None
        )

        if id_number is not None:
            update_data[
                "national_id"
            ] = str(
                id_number
            ).strip()

        # --------------------------------------------------------
        # DOB
        # --------------------------------------------------------

        dob = getattr(
            updates,
            "date_of_birth",
            None
        )

        if dob is not None:
            update_data[
                "date_of_birth"
            ] = dob

        # --------------------------------------------------------
        # Gender
        # --------------------------------------------------------

        gender = getattr(
            updates,
            "gender",
            None
        )

        if gender is not None:
            update_data[
                "gender"
            ] = self._enum_value(
                gender
            )

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
        limit: int = 20,
    ) -> Dict[str, Any]:

        # Current schema does NOT have first_name, last_name,
        # plan or is_active.
        query = (
            self.supabase
            .table("members")
            .select("*")
        )

        # --------------------------------------------------------
        # SEARCH
        # --------------------------------------------------------

        if search:
            search = str(search).strip()

            query = query.or_(
                "full_name.ilike.%{0}%,"
                "phone.ilike.%{0}%,"
                "membership_number.ilike.%{0}%,"
                "member_number.ilike.%{0}%".format(
                    search
                )
            )

        # --------------------------------------------------------
        # STATUS
        # --------------------------------------------------------

        if status:
            status_upper = str(
                status
            ).upper()

            if status_upper in [
                "PENDING",
                "ACTIVE",
                "DORMANT",
                "CANCELLED",
            ]:
                query = query.eq(
                    "member_status",
                    status_upper
                )

        # --------------------------------------------------------
        # COUNT
        # --------------------------------------------------------

        count_result = (
            self.supabase
            .table("members")
            .select(
                "id",
                count="exact"
            )
            .execute()
        )

        total = count_result.count or 0

        # --------------------------------------------------------
        # PAGINATION
        # --------------------------------------------------------

        page = max(1, page)
        limit = max(1, min(limit, 100))

        offset = (
            page - 1
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

        return {
            "members": result.data or [],
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

        await self.get_member(
            member_id
        )

        # Existing dependants
        existing = await self.get_dependants(
            member_id
        )

        dependant_number = (
            f"DEP-{len(existing) + 1:03d}"
        )

        full_name = self._build_full_name(
            first_name=getattr(
                dependant,
                "first_name",
                None
            ),
            last_name=getattr(
                dependant,
                "last_name",
                None
            ),
            other_name=getattr(
                dependant,
                "other_name",
                None
            ),
            full_name=getattr(
                dependant,
                "full_name",
                None
            ),
        )

        if not full_name:
            raise ValidationError(
                "Dependant full name is required"
            )

        relationship = self._enum_value(
            getattr(
                dependant,
                "relationship",
                None
            )
        )

        if not relationship:
            raise ValidationError(
                "Dependant relationship is required"
            )

        dep_data = {
            "principal_member_id": str(
                member_id
            ),
            "dependant_number": dependant_number,
            "full_name": full_name,
            "date_of_birth": getattr(
                dependant,
                "date_of_birth",
                None
            ),
            "gender": self._enum_value(
                getattr(
                    dependant,
                    "gender",
                    None
                )
            ),
            "relationship": relationship,
            "phone": getattr(
                dependant,
                "phone",
                None
            ),
            "status": "ACTIVE",
        }

        national_id = getattr(
            dependant,
            "national_id",
            None
        )

        if national_id:
            dep_data[
                "national_id"
            ] = str(
                national_id
            ).strip()

        birth_certificate = getattr(
            dependant,
            "birth_certificate_number",
            None
        )

        if birth_certificate:
            dep_data[
                "birth_certificate_number"
            ] = str(
                birth_certificate
            ).strip()

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

        # Total
        total = (
            self.supabase
            .table("members")
            .select(
                "id",
                count="exact"
            )
            .execute()
        )

        # Active
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

        # Pending
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

        # Recent members
        recent = (
            self.supabase
            .table("members")
            .select(
                """
                id,
                full_name,
                phone,
                membership_number,
                member_number,
                member_status,
                created_at
                """
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
            "pending_registrations": pending.count or 0,
            "recent_members": recent.data or [],
        }


# ============================================================
# SINGLETON
# ============================================================

member_service = MemberService()
