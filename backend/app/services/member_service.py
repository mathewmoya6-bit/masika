```python
"""
Member Service - Business Logic for Members

Compatible with the current Masika Benevolent Supabase schema.

IMPORTANT:
The frontend can submit:
    first_name
    other_name
    last_name

The database stores these as:
    members.full_name

The dependants table uses:
    principal_member_id
    dependant_number
    full_name
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
    """Member business logic using the current database schema."""

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
        Create principal member, membership and dependants.

        Frontend:
            first_name
            other_name
            last_name

        Database:
            members.full_name
        """

        try:
            # ----------------------------------------------------
            # 1. READ NAME FIELDS FROM REGISTRATION REQUEST
            # ----------------------------------------------------

            first_name = (
                getattr(data, "first_name", None) or ""
            ).strip()

            other_name = (
                getattr(data, "other_name", None) or ""
            ).strip()

            last_name = (
                getattr(data, "last_name", None) or ""
            ).strip()

            # ----------------------------------------------------
            # 2. BUILD REQUIRED full_name
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

            if not full_name:
                raise ValidationError(
                    "First name and/or last name is required"
                )

            logger.info(
                "Registration name: %s",
                full_name
            )

            # ----------------------------------------------------
            # 3. NORMALIZE PHONE
            # ----------------------------------------------------

            raw_phone = getattr(data, "phone", None)

            if not raw_phone:
                raise ValidationError(
                    "Phone number is required"
                )

            phone = normalize_phone(raw_phone)

            # ----------------------------------------------------
            # 4. CHECK DUPLICATE PHONE
            # ----------------------------------------------------

            existing = (
                self.supabase
                .table("members")
                .select(
                    "id, phone, membership_number"
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
            # 5. CHECK DUPLICATE EMAIL
            # ----------------------------------------------------

            email = None

            raw_email = getattr(
                data,
                "email",
                None
            )

            if raw_email:
                email = str(
                    raw_email
                ).strip().lower()

                existing_email = (
                    self.supabase
                    .table("members")
                    .select(
                        "id, email, membership_number"
                    )
                    .eq(
                        "email",
                        email
                    )
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
            # 6. GENERATE MEMBERSHIP NUMBER
            # ----------------------------------------------------

            membership_number = generate_member_number()

            # ----------------------------------------------------
            # 7. OTHER MEMBER DETAILS
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

            passport_number = getattr(
                data,
                "passport_number",
                None
            )

            if passport_number:
                passport_number = str(
                    passport_number
                ).strip()

            alternative_phone = getattr(
                data,
                "alternative_phone",
                None
            )

            if alternative_phone:
                alternative_phone = normalize_phone(
                    alternative_phone
                )

            address = getattr(
                data,
                "address",
                None
            )

            county = getattr(
                data,
                "county",
                None
            )

            sub_county = getattr(
                data,
                "sub_county",
                None
            )

            town = getattr(
                data,
                "town",
                None
            )

            # Your existing registration form may call this
            # field "location", so use it as a fallback for town.
            if not town:
                location = getattr(
                    data,
                    "location",
                    None
                )

                if location:
                    town = location

            # ----------------------------------------------------
            # 8. NEXT OF KIN
            # ----------------------------------------------------

            next_of_kin_name = getattr(
                data,
                "next_of_kin_name",
                None
            )

            next_of_kin_phone = getattr(
                data,
                "next_of_kin_phone",
                None
            )

            next_of_kin_relationship = getattr(
                data,
                "next_of_kin_relationship",
                None
            )

            if next_of_kin_phone:
                next_of_kin_phone = normalize_phone(
                    next_of_kin_phone
                )

            # ----------------------------------------------------
            # 9. AGENT
            # ----------------------------------------------------

            agent_name = getattr(
                data,
                "agent_name",
                None
            )

            # ----------------------------------------------------
            # 10. BENEFIT OPTION
            # ----------------------------------------------------

            benefit_option = getattr(
                data,
                "benefit_option",
                None
            )

            if benefit_option is not None:
                try:
                    benefit_option = (
                        benefit_option.value
                    )
                except AttributeError:
                    benefit_option = str(
                        benefit_option
                    )

            else:
                benefit_option = "service"

            # ----------------------------------------------------
            # 11. INSERT INTO MEMBERS
            #
            # IMPORTANT:
            # Only columns that actually exist in your posted
            # members table are used here.
            # ----------------------------------------------------

            member_data = {
                "membership_number":
                    membership_number,

                "member_number":
                    membership_number,

                "full_name":
                    full_name,

                "national_id":
                    national_id,

                "passport_number":
                    passport_number,

                "date_of_birth":
                    getattr(
                        data,
                        "date_of_birth",
                        None
                    ),

                "gender":
                    getattr(
                        data,
                        "gender",
                        None
                    ),

                "phone":
                    phone,

                "alternative_phone":
                    alternative_phone,

                "email":
                    email,

                "address":
                    address.strip()
                    if isinstance(address, str)
                    else address,

                "county":
                    county.strip()
                    if isinstance(county, str)
                    else county,

                "sub_county":
                    sub_county.strip()
                    if isinstance(sub_county, str)
                    else sub_county,

                "town":
                    town.strip()
                    if isinstance(town, str)
                    else town,

                "next_of_kin_name":
                    next_of_kin_name,

                "next_of_kin_phone":
                    next_of_kin_phone,

                "next_of_kin_relationship":
                    next_of_kin_relationship,

                "agent_name":
                    agent_name,

                "benefit_option":
                    benefit_option,
            }

            # ----------------------------------------------------
            # 12. SAFETY CHECK
            # ----------------------------------------------------

            if not member_data["full_name"]:
                raise ValidationError(
                    "full_name cannot be empty"
                )

            logger.info(
                "Inserting member: %s | %s",
                membership_number,
                full_name
            )

            # ----------------------------------------------------
            # 13. INSERT MEMBER
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

            logger.info(
                "Member created successfully: %s",
                member_id
            )

            # ----------------------------------------------------
            # 14. FIND SELECTED PLAN
            # ----------------------------------------------------

            plan_code = getattr(
                data,
                "plan",
                None
            )

            plan = None
            membership = None

            if plan_code is not None:

                try:
                    plan_code = plan_code.value
                except AttributeError:
                    plan_code = str(
                        plan_code
                    )

                plan_code = plan_code.upper()

                plan_result = (
                    self.supabase
                    .table("plans")
                    .select(
                        """
                        id,
                        plan_code,
                        plan_name,
                        monthly_premium,
                        registration_fee,
                        principal_registration_fee,
                        dependant_registration_fee,
                        waiting_period_months,
                        waiting_period_days,
                        renewal_period_months,
                        grace_period_days,
                        max_dependants
                        """
                    )
                    .eq(
                        "plan_code",
                        plan_code
                    )
                    .eq(
                        "is_active",
                        True
                    )
                    .limit(1)
                    .execute()
                )

                if not plan_result.data:
                    raise ValidationError(
                        f"Membership plan "
                        f"'{plan_code}' was not found"
                    )

                plan = plan_result.data[0]

                # ------------------------------------------------
                # PLAN FEES
                # ------------------------------------------------

                monthly_premium = (
                    plan.get(
                        "monthly_premium"
                    ) or 0
                )

                registration_fee = (
                    plan.get(
                        "principal_registration_fee"
                    )
                )

                if registration_fee is None:
                    registration_fee = (
                        plan.get(
                            "registration_fee"
                        ) or 0
                    )

                waiting_period_months = (
                    plan.get(
                        "waiting_period_months"
                    ) or 0
                )

                # ------------------------------------------------
                # 15. CREATE MEMBERSHIP
                # ------------------------------------------------

                membership_data = {
                    "member_id":
                        str(member_id),

                    "plan_id":
                        plan["id"],

                    "membership_start_date":
                        date.today().isoformat(),

                    "registration_fee_due":
                        registration_fee,

                    "registration_fee_paid":
                        0,

                    "monthly_premium":
                        monthly_premium,

                    "monthly_equivalent_units":
                        0,

                    "required_monthly_equivalent_units":
                        0,

                    "waiting_period_months":
                        waiting_period_months,

                    "monthly_payment_deadline":
                        None,

                    "activation_date":
                        None,
                }

                membership_result = (
                    self.supabase
                    .table("memberships")
                    .insert(
                        membership_data
                    )
                    .execute()
                )

                if not membership_result.data:
                    raise ValidationError(
                        "Member created but "
                        "membership could not be created"
                    )

                membership = (
                    membership_result.data[0]
                )

                logger.info(
                    "Membership created: %s",
                    membership["id"]
                )

            # ----------------------------------------------------
            # 16. CREATE DEPENDANTS
            # ----------------------------------------------------

            dependants_created = []

            dependants = (
                getattr(
                    data,
                    "dependants",
                    None
                )
                or []
            )

            for index, dep in enumerate(
                dependants,
                start=1
            ):

                try:

                    dep_first_name = (
                        getattr(
                            dep,
                            "first_name",
                            None
                        ) or ""
                    ).strip()

                    dep_other_name = (
                        getattr(
                            dep,
                            "other_name",
                            None
                        ) or ""
                    ).strip()

                    dep_last_name = (
                        getattr(
                            dep,
                            "last_name",
                            None
                        ) or ""
                    ).strip()

                    dep_full_name = " ".join(
                        part
                        for part in [
                            dep_first_name,
                            dep_other_name,
                            dep_last_name,
                        ]
                        if part
                    ).strip()

                    if not dep_full_name:
                        logger.warning(
                            "Skipping dependant %s: "
                            "no name",
                            index
                        )
                        continue

                    dependant_number = (
                        f"{membership_number}"
                        f"-D{index:02d}"
                    )

                    dep_relationship = getattr(
                        dep,
                        "relationship",
                        None
                    )

                    if dep_relationship is not None:
                        try:
                            dep_relationship = (
                                dep_relationship.value
                            )
                        except AttributeError:
                            dep_relationship = str(
                                dep_relationship
                            )

                    dep_phone = getattr(
                        dep,
                        "phone",
                        None
                    )

                    if dep_phone:
                        dep_phone = normalize_phone(
                            dep_phone
                        )

                    dependant_data = {
                        "principal_member_id":
                            str(member_id),

                        "dependant_number":
                            dependant_number,

                        "full_name":
                            dep_full_name,

                        "national_id":
                            getattr(
                                dep,
                                "national_id",
                                None
                            ),

                        "birth_certificate_number":
                            getattr(
                                dep,
                                "birth_certificate_number",
                                None
                            ),

                        "date_of_birth":
                            getattr(
                                dep,
                                "date_of_birth",
                                None
                            ),

                        "gender":
                            getattr(
                                dep,
                                "gender",
                                None
                            ),

                        "relationship":
                            dep_relationship,

                        "phone":
                            dep_phone,

                        "status":
                            "ACTIVE",
                    }

                    dep_result = (
                        self.supabase
                        .table("dependants")
                        .insert(
                            dependant_data
                        )
                        .execute()
                    )

                    if dep_result.data:
                        dependants_created.append(
                            dep_result.data[0]
                        )

                except Exception as dep_error:

                    logger.error(
                        "Failed to create dependant "
                        "%s: %s",
                        index,
                        dep_error
                    )

            # ----------------------------------------------------
            # 17. RETURN COMPLETE REGISTRATION
            # ----------------------------------------------------

            member["membership_id"] = (
                membership["id"]
                if membership
                else None
            )

            member["plan"] = (
                plan.get("plan_code")
                if plan
                else None
            )

            member["dependants"] = (
                dependants_created
            )

            return member

        except DuplicateError:
            raise

        except ValidationError:
            raise

        except Exception as e:

            logger.exception(
                "Unexpected member registration error"
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

        result = (
            self.supabase
            .table("members")
            .select("*")
            .eq(
                "id",
                str(member_id)
            )
            .limit(1)
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
            .eq(
                "phone",
                phone
            )
            .limit(1)
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

        if result.data:
            return result.data[0]

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

        current = await self.get_member(
            member_id
        )

        update_data = {}

        # --------------------------------------------------------
        # NAME
        # --------------------------------------------------------

        first_name = getattr(
            updates,
            "first_name",
            None
        )

        other_name = getattr(
            updates,
            "other_name",
            None
        )

        last_name = getattr(
            updates,
            "last_name",
            None
        )

        if (
            first_name is not None
            or other_name is not None
            or last_name is not None
        ):

            current_full_name = (
                current.get("full_name")
                or ""
            )

            existing_parts = (
                current_full_name.split()
            )

            new_first = (
                first_name.strip()
                if first_name is not None
                else (
                    existing_parts[0]
                    if existing_parts
                    else ""
                )
            )

            new_last = (
                last_name.strip()
                if last_name is not None
                else (
                    existing_parts[-1]
                    if len(existing_parts) > 1
                    else ""
                )
            )

            new_other = (
                other_name.strip()
                if other_name is not None
                else ""
            )

            update_data[
                "full_name"
            ] = " ".join(
                part
                for part in [
                    new_first,
                    new_other,
                    new_last,
                ]
                if part
            ).strip()

        # --------------------------------------------------------
        # PHONE
        # --------------------------------------------------------

        phone = getattr(
            updates,
            "phone",
            None
        )

        if phone is not None:
            update_data[
                "phone"
            ] = normalize_phone(phone)

        # --------------------------------------------------------
        # EMAIL
        # --------------------------------------------------------

        email = getattr(
            updates,
            "email",
            None
        )

        if email is not None:
            update_data[
                "email"
            ] = str(email).strip().lower()

        # --------------------------------------------------------
        # ADDRESS
        # --------------------------------------------------------

        address = getattr(
            updates,
            "address",
            None
        )

        if address is not None:
            update_data[
                "address"
            ] = address.strip()

        # --------------------------------------------------------
        # BENEFIT OPTION
        # --------------------------------------------------------

        benefit_option = getattr(
            updates,
            "benefit_option",
            None
        )

        if benefit_option is not None:

            try:
                benefit_option = (
                    benefit_option.value
                )
            except AttributeError:
                benefit_option = str(
                    benefit_option
                )

            update_data[
                "benefit_option"
            ] = benefit_option

        if not update_data:
            raise ValidationError(
                "No fields to update"
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

        offset = (page - 1) * limit

        query = (
            self.supabase
            .table("members")
            .select(
                "*",
                count="exact"
            )
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

            if safe_search:

                query = query.or_(
                    "full_name.ilike.%"
                    + safe_search
                    + "%,"
                    "phone.ilike.%"
                    + safe_search
                    + "%,"
                    "membership_number.ilike.%"
                    + safe_search
                    + "%,"
                    "member_number.ilike.%"
                    + safe_search
                    + "%"
                )

        # --------------------------------------------------------
        # STATUS
        # --------------------------------------------------------

        if status:

            status_upper = status.upper()

            if status_upper in {
                "PENDING",
                "ACTIVE",
                "DORMANT",
                "CANCELLED",
            }:

                query = query.eq(
                    "member_status",
                    status_upper
                )

        # --------------------------------------------------------
        # QUERY
        # --------------------------------------------------------

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

        total = result.count or 0

        return {
            "members":
                result.data or [],

            "total":
                total,

            "page":
                page,

            "limit":
                limit,

            "pages":
                (
                    (total + limit - 1)
                    // limit
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

        first_name = (
            getattr(
                dependant,
                "first_name",
                None
            ) or ""
        ).strip()

        other_name = (
            getattr(
                dependant,
                "other_name",
                None
            ) or ""
        ).strip()

        last_name = (
            getattr(
                dependant,
                "last_name",
                None
            ) or ""
        ).strip()

        full_name = " ".join(
            part
            for part in [
                first_name,
                other_name,
                last_name,
            ]
            if part
        ).strip()

        if not full_name:
            raise ValidationError(
                "Dependant full name is required"
            )

        # Count existing dependants
        existing = (
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

        dependant_count = (
            existing.count or 0
        )

        member = await self.get_member(
            member_id
        )

        membership_number = (
            member.get(
                "membership_number"
            )
            or member.get(
                "member_number"
            )
        )

        dependant_number = (
            f"{membership_number}"
            f"-D{dependant_count + 1:02d}"
        )

        relationship = getattr(
            dependant,
            "relationship",
            None
        )

        if relationship is not None:

            try:
                relationship = (
                    relationship.value
                )
            except AttributeError:
                relationship = str(
                    relationship
                )

        phone = getattr(
            dependant,
            "phone",
            None
        )

        if phone:
            phone = normalize_phone(
                phone
            )

        dep_data = {
            "principal_member_id":
                str(member_id),

            "dependant_number":
                dependant_number,

            "full_name":
                full_name,

            "national_id":
                getattr(
                    dependant,
                    "national_id",
                    None
                ),

            "birth_certificate_number":
                getattr(
                    dependant,
                    "birth_certificate_number",
                    None
                ),

            "date_of_birth":
                getattr(
                    dependant,
                    "date_of_birth",
                    None
                ),

            "gender":
                getattr(
                    dependant,
                    "gender",
                    None
                ),

            "relationship":
                relationship,

            "phone":
                phone,

            "status":
                "ACTIVE",
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

        total = (
            self.supabase
            .table("members")
            .select(
                "id",
                count="exact"
            )
            .execute()
        )

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

        recent = (
            self.supabase
            .table("members")
            .select(
                """
                id,
                membership_number,
                member_number,
                full_name,
                phone,
                member_status,
                registration_date,
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
            "total_members":
                total.count or 0,

            "active_members":
                active.count or 0,

            "pending_registrations":
                pending.count or 0,

            "recent_members":
                recent.data or [],
        }


# ============================================================
# SINGLETON
# ============================================================

member_service = MemberService()
```
