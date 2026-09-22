
# ------------------------------------------------------------
# 8. PAYMENT CALLBACK
# ------------------------------------------------------------

@public_router.post("/payment/callback")
async def payment_callback(request: Request):
    """
    M-Pesa payment callback webhook. Called by Safaricom when the STK
    transaction completes (success, user cancellation, or timeout).

    Registered at two paths (see the app.post alias right after this router
    is included below) — /api/public/payment/callback, which is what the
    outgoing STK payload's CallBackURL defaults to, and /api/webhooks/mpesa,
    which is what MPESA_CALLBACK_URL was set to on Render. Whichever one
    Safaricom actually calls, both land here.

    Always returns {"ResultCode": 0} to Safaricom once the payload is
    parsed — even if our own processing hits an error — because returning
    a non-zero code makes Daraja retry the callback, and retries won't fix
    a bug on our side, they'll just resend the same webhook repeatedly.
    """
    client_ip = request.client.host if request.client else None
    if not is_ip_allowed(client_ip):
        logger.warning(f"Rejected M-Pesa callback from disallowed IP: {client_ip}")
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        data = await request.json()
    except Exception as e:
        logger.error(f"Payment callback: could not parse JSON body: {e}")
        return {"ResultCode": 0, "ResultDesc": "Success"}

    logger.info(f"Payment callback received from {client_ip}: {data}")

    try:
        body = data.get("Body", {})
        stk_callback = body.get("stkCallback", {})

        result_code = stk_callback.get("ResultCode")
        result_desc = stk_callback.get("ResultDesc")
        checkout_request_id = stk_callback.get("CheckoutRequestID")
        callback_metadata = stk_callback.get("CallbackMetadata", {})

        if not checkout_request_id:
            logger.warning("Payment callback missing CheckoutRequestID — ignoring")
            return {"ResultCode": 0, "ResultDesc": "Success"}

        payment_result = supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).execute()
        if not payment_result.data:
            logger.warning(f"Payment not found for checkout_request_id: {checkout_request_id}")
            return {"ResultCode": 0, "ResultDesc": "Success"}

        payment = payment_result.data[0]

        # Idempotency: Safaricom can and does resend the same callback
        # (network retries on their end). If we've already resolved this
        # payment, don't reactivate the member or overwrite the receipt.
        # FIX: normalize case/whitespace so "COMPLETED"/"Completed"/" completed "
        # all count as terminal, not just the exact lowercase form.
        payment_status = str(payment.get("status") or "").strip().lower()
        if payment_status in ("completed", "failed"):
            logger.info(f"Duplicate callback for already-{payment_status} payment {checkout_request_id} — ignoring")
            return {"ResultCode": 0, "ResultDesc": "Success"}

        # FIX: ResultCode may arrive as int 0 or str "0" depending on the
        # channel/environment. Compare as a normalized string so both are
        # correctly recognized as success.
        if str(result_code).strip() == "0":
            mpesa_receipt = None
            items = callback_metadata.get("Item", [])
            for item in items:
                if item.get("Name") == "MpesaReceiptNumber":
                    mpesa_receipt = item.get("Value")

            update_data = {
                "status": "completed",
                "mpesa_receipt": mpesa_receipt,
                "updated_at": datetime.now().isoformat()
            }
            try:
                supabase.table("payments").update(update_data).eq("id", payment["id"]).execute()
            except Exception:
                # Older schemas may not have every column below yet — retry
                # with just the fields we know exist rather than losing the
                # receipt entirely because of one unrecognized column.
                supabase.table("payments").update({
                    "status": "completed",
                    "mpesa_receipt": mpesa_receipt
                }).eq("id", payment["id"]).execute()

            await activate_registration(payment)
            logger.info(f"Payment completed: {checkout_request_id}, receipt: {mpesa_receipt}")
        else:
            logger.info(f"Payment not completed: {checkout_request_id} - {result_desc}")
            try:
                supabase.table("payments").update({
                    "status": "failed",
                    "failure_reason": result_desc,
                    "updated_at": datetime.now().isoformat()
                }).eq("id", payment["id"]).execute()
            except Exception:
                supabase.table("payments").update({"status": "failed"}).eq("id", payment["id"]).execute()

        return {"ResultCode": 0, "ResultDesc": "Success"}

    except Exception as e:
        logger.error(f"Payment callback processing error: {e}")
        # Still ack with ResultCode 0 — see docstring above.
        return {"ResultCode": 0, "ResultDesc": "Success"}

# ------------------------------------------------------------
# 8b. RECONCILIATION SWEEP (for STK pushes whose callback never arrives)
# ------------------------------------------------------------
# Safaricom's callback is a best-effort webhook — it can be delayed, dropped,
# or fail to reach us (deploy restart, transient network issue). Without a
# sweep, a member who paid but whose callback was lost stays stuck on
# "pending" forever. Call this on a schedule (e.g. a Render cron job hitting
# it every few minutes) with the shared secret in the X-Reconcile-Key header.

@public_router.post("/payment/reconcile")
async def reconcile_pending_payments(request: Request, older_than_minutes: int = 2, limit: int = 25):
    """
    Actively poll M-Pesa for any payment still 'pending' with a
    checkout_request_id older than `older_than_minutes`, and resolve it the
    same way the callback would. Protected by RECONCILE_SECRET since it
    triggers real calls against your M-Pesa credentials.

    A payment is only ever completed by an EXPLICIT M-Pesa success result.
    Never mark a payment completed just because it is old.
    """
    if not RECONCILE_SECRET:
        raise HTTPException(status_code=503, detail="Reconciliation is not configured (RECONCILE_SECRET unset)")
    if request.headers.get("X-Reconcile-Key") != RECONCILE_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    cutoff = (datetime.now() - timedelta(minutes=older_than_minutes)).isoformat()

    pending = (
        supabase.table("payments")
        .select("*")
        .eq("status", "pending")
        .not_.is_("checkout_request_id", "null")
        .lte("created_at", cutoff)
        .limit(limit)
        .execute()
    )

    resolved, still_pending, errors = [], [], []

    for payment in (pending.data or []):
        checkout_request_id = payment.get("checkout_request_id")

        # Defensive guard: a pending row with no CheckoutRequestID can't be
        # reconciled against M-Pesa. Skip it rather than guessing.
        if not checkout_request_id:
            still_pending.append({"id": payment.get("id"), "reason": "no_checkout_request_id"})
            continue

        try:
            result = await query_mpesa_transaction_status(checkout_request_id)
            if result.get("success"):
                supabase.table("payments").update({
                    "status": "completed",
                    "mpesa_receipt": result.get("receipt"),
                    "updated_at": datetime.now().isoformat()
                }).eq("id", payment["id"]).execute()
                await activate_registration(payment)
                resolved.append({"checkout_request_id": checkout_request_id, "outcome": "completed"})
            elif result.get("failed"):
                supabase.table("payments").update({
                    "status": "failed",
                    "updated_at": datetime.now().isoformat()
                }).eq("id", payment["id"]).execute()
                resolved.append({"checkout_request_id": checkout_request_id, "outcome": "failed"})
            else:
                # Still genuinely pending at Safaricom. NEVER mark a payment
                # completed just because it's old — only M-Pesa's own result
                # can complete a payment.
                still_pending.append(checkout_request_id)
        except Exception as e:
            logger.error(f"Reconciliation error for {checkout_request_id}: {e}")
            errors.append(checkout_request_id)

    return {
        "success": True,
        "checked": len(pending.data or []),
        "resolved": resolved,
        "still_pending": still_pending,
        "errors": errors
    }

# ------------------------------------------------------------
# 9. ACTIVATE REGISTRATION
# ------------------------------------------------------------

async def activate_registration(payment: dict):
    """
    Activate member or chama registration after a successful REGISTRATION payment.

    FIX: this used to run for EVERY completed member payment, so a monthly
    contribution also set registration_fee_paid = True and member_status =
    ACTIVE. It now only acts on registration payments; other payment types
    (monthly / topup / addon) are simply recorded.

    Also sends the payment-confirmation SMS for EVERY completed member
    payment (registration, monthly, topup, addon) — not just registrations —
    since the member should be told their money arrived regardless of type.
    """
    try:
        payment_type = (payment.get("payment_type") or "").lower()

        if payment.get("member_id"):
            member_result = (
                supabase.table("members")
                .select("phone, member_number")
                .eq("id", payment["member_id"])
                .limit(1)
                .execute()
            )
            member_phone = None
            member_number = None
            if member_result.data:
                member_phone = member_result.data[0].get("phone")
                member_number = member_result.data[0].get("member_number")

            if payment_type != "registration":
                logger.info(
                    f"Payment {payment.get('id')} is '{payment_type}', not registration "
                    f"- member activation skipped"
                )
            else:
                supabase.table("members").update({
                    "registration_fee_paid": True,
                    "member_status": "ACTIVE",
                    "updated_at": datetime.now().isoformat()
                }).eq("id", payment["member_id"]).execute()

                logger.info(f"Member {payment['member_id']} activated")

            # Best-effort payment confirmation SMS, regardless of payment type.
            phone_for_sms = member_phone or payment.get("phone")
            if phone_for_sms and member_number:
                try:
                    asyncio.create_task(
                        send_payment_confirmation_sms(
                            phone_for_sms,
                            str(payment.get("amount", "")),
                            member_number,
                        )
                    )
                except Exception as e:
                    logger.error(f"Could not schedule payment confirmation SMS: {e}")

        elif payment.get("chama_group_id"):
            supabase.table("chama_groups").update({
                "status": "ACTIVE",
                "payment_status": "paid",
                "updated_at": datetime.now().isoformat()
            }).eq("id", payment["chama_group_id"]).execute()

            supabase.table("chama_members").update({
                "is_active": True,
                "updated_at": datetime.now().isoformat()
            }).eq("chama_group_id", payment["chama_group_id"]).execute()

            logger.info(f"Chama group {payment['chama_group_id']} activated")

    except Exception as e:
        logger.error(f"Activation failed: {e}")


# ============================================================
# ADMIN PAYMENT COLLECTION
# ============================================================
# Staff-initiated STK push for an EXISTING member (monthly, top-up, add-on
# or registration), used by admin-collectpayments.html.
#
# Auth: the admin page sends the SUPABASE access token from its login. It is
# validated with Supabase, then the user must be an ACTIVE row in `staff`
# (linked by staff.auth_user_id) whose role (roles.role_code) is listed in
# PAYMENT_COLLECTOR_ROLES.

def _resolve_payment_collector_sync(token: str) -> dict:
    """Validate a Supabase access token and confirm the staff member may collect payments."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        auth_response = supabase.auth.get_user(token)
        auth_user = getattr(auth_response, "user", None)
    except Exception as e:
        logger.warning(f"Supabase token validation failed: {e}")
        auth_user = None

    if not auth_user:
        raise HTTPException(status_code=401, detail="Invalid or expired session. Please log in again.")

    staff_result = (
        supabase.table("staff")
        .select("id, full_name, status, role_id")
        .eq("auth_user_id", str(auth_user.id))
        .limit(1)
        .execute()
    )

    if not staff_result.data:
        raise HTTPException(status_code=403, detail="This account is not a staff account.")

    staff = staff_result.data[0]

    if str(staff.get("status") or "").upper() != "ACTIVE":
        raise HTTPException(status_code=403, detail="Staff account is not active.")

    role_code = ""
    if staff.get("role_id"):
        role_result = (
            supabase.table("roles")
            .select("role_code")
            .eq("id", staff["role_id"])
            .limit(1)
            .execute()
        )
        if role_result.data:
            role_code = str(role_result.data[0].get("role_code") or "").upper()

    if role_code not in PAYMENT_COLLECTOR_ROLES:
        raise HTTPException(status_code=403, detail="Your role is not allowed to collect payments.")

    return {
        "staff_id": staff["id"],
        "full_name": staff.get("full_name"),
        "role_code": role_code,
    }


async def get_payment_collector(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    # supabase-py is synchronous, so keep it off the event loop
    return await asyncio.to_thread(_resolve_payment_collector_sync, credentials.credentials)


class AdminCollectPaymentRequest(BaseModel):
    member_id: Optional[str] = None
    membership_number: Optional[str] = None
    phone_number: str
    amount: float
    payment_type: PaymentTypeEnum = PaymentTypeEnum.MONTHLY


# The `payments.payment_type` Postgres enum was built up ad hoc over time
# and is genuinely inconsistent in case ('REGISTRATION'/'MONTHLY' uppercase,
# but 'registration'/'chama_registration' also exist lowercase from other
# insert paths in this file — see /api/public/register and
# /api/public/payment/stk-push above). It has NO lowercase 'monthly',
# 'topup', or 'addon' value at all.
#
# Rather than touch every other write path in this file (which already
# works and is depended on), this endpoint is the only one that maps
# PaymentTypeEnum's lowercase values onto the DB's actual uppercase labels
# before insert. Requires this one-time migration on the `payment_type`
# enum (values TOPUP/ADDON don't exist yet as of this comment):
#   ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'TOPUP';
#   ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'ADDON';
PAYMENT_TYPE_DB_LABELS = {
    "registration": "REGISTRATION",
    "monthly": "MONTHLY",
    "topup": "TOPUP",
    "addon": "ADDON",
}


admin_payments_router = APIRouter(prefix="/api/admin/payments", tags=["Admin Payments"])


@admin_payments_router.post("/collect")
async def admin_collect_payment(
    payload: AdminCollectPaymentRequest,
    collector: dict = Depends(get_payment_collector),
):
    """
    Send an STK push on behalf of a member. Requires a valid Supabase login
    token belonging to an active staff member with an allowed role.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    if not (MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET):
        raise HTTPException(status_code=503, detail="M-Pesa is not configured on the server.")

    phone = format_phone_number(payload.phone_number)
    if not re.match(r"^254[17]\d{8}$", phone):
        raise HTTPException(status_code=400, detail="Invalid phone number format")

    amount = float(round(payload.amount))
    if amount != payload.amount:
        raise HTTPException(status_code=400, detail="Amount must be a whole number of shillings")
    if amount < 1 or amount > ADMIN_MAX_COLLECT_AMOUNT:
        raise HTTPException(
            status_code=400,
            detail=f"Amount must be between 1 and {int(ADMIN_MAX_COLLECT_AMOUNT)}",
        )

    # ---- find the member ----
    member_query = supabase.table("members").select("id, member_number, first_name, last_name")

    if payload.member_id:
        member_query = member_query.eq("id", payload.member_id)
    elif payload.membership_number:
        member_query = member_query.eq("member_number", payload.membership_number)
    else:
        raise HTTPException(status_code=400, detail="member_id or membership_number is required")

    member_result = member_query.limit(1).execute()
    if not member_result.data:
        raise HTTPException(status_code=404, detail="Member not found")

    member = member_result.data[0]
    payment_type = payload.payment_type.value

    # The `payment_type` Postgres enum uses inconsistent casing historically
    # (REGISTRATION/MONTHLY uppercase, "registration"/"chama_registration"
    # lowercase — see payments table). This endpoint always writes the
    # uppercase labels so admin-collected rows are internally consistent,
    # even though PaymentTypeEnum itself stays lowercase for every other
    # caller of this file.
    db_payment_type = PAYMENT_TYPE_DB_LABELS[payment_type]

    transaction_ref = f"TXN-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(4).upper()}"

    # ---- create the pending payment row ----
    try:
        inserted = supabase.table("payments").insert({
            "member_id": member["id"],
            "amount": amount,
            "payment_type": db_payment_type,
            "payment_method": "mpesa",
            "status": "pending",
            "payment_date": datetime.now().date().isoformat(),
            "phone": phone,
            "transaction_reference": transaction_ref,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }).execute()
    except Exception as e:
        logger.error(f"Admin collect: could not create payment row: {e}")
        raise HTTPException(status_code=400, detail=f"Could not create payment record: {str(e)}")

    payment_id = inserted.data[0]["id"] if inserted.data else None

    # ---- send the STK push (member number shows as the account reference) ----
    stk_result = await initiate_mpesa_stk_push(
        phone,
        amount,
        member.get("member_number") or transaction_ref,
        f"Masika {payment_type}",
    )

    if not stk_result.get("success"):
        supabase.table("payments").update({
            "status": "failed",
            "updated_at": datetime.now().isoformat(),
        }).eq("transaction_reference", transaction_ref).execute()

        raise HTTPException(
            status_code=502,
            detail=stk_result.get("message") or "M-Pesa STK push failed",
        )

    checkout_request_id = stk_result.get("checkout_request_id")
    merchant_request_id = stk_result.get("merchant_request_id")

    # Guard: even a success=True result from initiate_mpesa_stk_push should
    # have carried a CheckoutRequestID. If it didn't, treat the collection
    # as failed rather than leaving the row pending with nothing to reconcile.
    if not checkout_request_id:
        supabase.table("payments").update({
            "status": "failed",
            "updated_at": datetime.now().isoformat(),
        }).eq("transaction_reference", transaction_ref).execute()
        raise HTTPException(
            status_code=502,
            detail="M-Pesa did not return a CheckoutRequestID. Payment not initiated.",
        )

    supabase.table("payments").update({
        "checkout_request_id": checkout_request_id,
        "merchant_request_id": merchant_request_id,
        "updated_at": datetime.now().isoformat(),
    }).eq("transaction_reference", transaction_ref).execute()

    logger.info(
        f"Admin STK push: staff={collector['staff_id']} ({collector.get('full_name')}) "
        f"member={member.get('member_number')} amount={amount} type={payment_type} "
        f"checkout={checkout_request_id}"
    )

    return {
        "success": True,
        "message": "STK push sent. Waiting for the member to enter their M-Pesa PIN.",
        "payment_id": payment_id,
        "checkout_request_id": checkout_request_id,
        "merchant_request_id": merchant_request_id,
        "amount": amount,
        "phone_number": phone,
        "payment_type": payment_type,
    }


@admin_payments_router.get("/status/{checkout_request_id}", response_model=PaymentStatusResponse)
async def admin_payment_status(
    checkout_request_id: str,
    collector: dict = Depends(get_payment_collector),
):
    # Reuses the public status logic (polls M-Pesa and resolves the payment)
    return await get_payment_status(checkout_request_id)


app.include_router(admin_payments_router)


# ============================================================
# PAYMENT VALIDATION / MEMBERSHIP RECONCILIATION
# ============================================================
# Reconciles a member's registration + monthly contributions using the
# payments ledger. The registration payment is never counted as a monthly
# contribution. Legacy status fields (legacy_status, legacy_missing_months)
# are returned for reference only and never influence the computed status.

def _parse_date(value):
    """Safely convert a Supabase date/datetime value to a date."""
    if not value:
        return None

    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except Exception:
        try:
            return date.fromisoformat(str(value)[:10])
        except Exception:
            return None


def _months_between(start_date: date, end_date: date) -> int:
    """
    Number of monthly contribution periods between two dates.

    Monthly contributions begin in the month after registration.
    The current month is included only if it has already started as
    a required contribution period.
    """
    if not start_date or not end_date:
        return 0

    start_month = start_date.year * 12 + start_date.month
    end_month = end_date.year * 12 + end_date.month

    # Monthly contribution starts the month after registration.
    months = end_month - start_month

    return max(0, months)


def get_plan_monthly_fee(plan_slug: str) -> float:
    """
    Get the current monthly contribution from the live plans table.
    Never hardcode the monthly fee.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    plan_slug = (plan_slug or "").strip().lower()

    result = (
        supabase.table("plans")
        .select("plan_code, monthly_premium, is_active")
        .ilike("plan_code", plan_slug)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=400,
            detail=f"Plan '{plan_slug}' was not found in pricing."
        )

    plan = result.data[0]

    return float(plan.get("monthly_premium") or 0)


def calculate_member_payment_validation(member_id: str) -> dict:
    """
    Reconcile a member using the NEW SYSTEM payment ledger.

    IMPORTANT:
    legacy_status / legacy_missing_months are historical only.
    They are NEVER used to determine the new status.
    """

    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    member_result = (
        supabase.table("members")
        .select("*")
        .eq("id", member_id)
        .limit(1)
        .execute()
    )

    if not member_result.data:
        raise HTTPException(status_code=404, detail="Member not found")

    member = member_result.data[0]

    plan = (member.get("plan") or "").strip().lower()

    if plan == "chama":
        return {
            "success": False,
            "validation_status": "NOT_APPLICABLE",
            "message": "Chama members use group payment validation."
        }

    registration_date = _parse_date(member.get("registration_date"))

    if not registration_date:
        return {
            "success": False,
            "validation_status": "REQUIRES_RECONCILIATION",
            "message": "Member has no valid registration date."
        }

    monthly_fee = get_plan_monthly_fee(plan)

    if monthly_fee <= 0:
        return {
            "success": False,
            "validation_status": "REQUIRES_RECONCILIATION",
            "message": f"No monthly contribution is configured for plan '{plan}'."
        }

    # --------------------------------------------------------
    # Load ALL completed payments in the new system.
    # Do NOT use only the last 10 payments.
    # --------------------------------------------------------

    payment_result = (
        supabase.table("payments")
        .select("*")
        .eq("member_id", member_id)
        .eq("status", "completed")
        .order("payment_date", desc=False)
        .execute()
    )

    payments = payment_result.data or []

    registration_paid = 0.0
    monthly_paid = 0.0
    monthly_payments = []

    for payment in payments:
        payment_type = (payment.get("payment_type") or "").lower()
        amount = float(payment.get("amount") or 0)

        if payment_type == "registration":
            registration_paid += amount

        elif payment_type in ("monthly", "topup", "addon"):
            monthly_paid += amount
            monthly_payments.append(payment)

    # --------------------------------------------------------
    # Registration payment is NOT counted as monthly payment.
    # --------------------------------------------------------

    expected_months = _months_between(
        registration_date,
        date.today()
    )

    expected_monthly_amount = expected_months * monthly_fee

    # --------------------------------------------------------
    # Match monthly payments chronologically against required
    # monthly contributions.
    #
    # Example:
    # monthly fee = 50
    # payment = 100
    #
    # This satisfies two months.
    # --------------------------------------------------------

    remaining_credit = monthly_paid
    months_paid = 0
    months_short = 0
    months_missing = 0

    for _ in range(expected_months):
        if remaining_credit >= monthly_fee:
            remaining_credit -= monthly_fee
            months_paid += 1

        elif remaining_credit > 0:
            months_short += 1
            remaining_credit = 0

        else:
            months_missing += 1

    # --------------------------------------------------------
    # Determine status.
    #
    # No historical payment evidence:
    # don't falsely declare DORMANT.
    # --------------------------------------------------------

    has_new_system_monthly_evidence = len(monthly_payments) > 0

    if expected_months == 0:
        current_status = "ACTIVE"
        validation_status = "VALIDATED"
        note = "No monthly contribution period is currently due."

    elif months_missing == 0 and months_short == 0:
        current_status = "ACTIVE"
        validation_status = "VALIDATED"
        note = "All required monthly contributions are satisfied."

    elif not has_new_system_monthly_evidence:
        current_status = "PENDING"
        validation_status = "REQUIRES_RECONCILIATION"
        note = (
            "No completed monthly payments exist in the new system. "
            "Historical payments must be imported or verified before "
            "determining current arrears."
        )

    else:
        current_status = "DORMANT"
        validation_status = "VALIDATED"
        note = (
            f"{months_missing} month(s) missing and "
            f"{months_short} month(s) short."
        )

    # --------------------------------------------------------
    # Update BOTH status fields.
    #
    # member_status is the existing field used throughout the
    # application.
    #
    # status is the new normalized field.
    # --------------------------------------------------------

    update_data = {
        "status": current_status,
        "member_status": current_status,
        "payment_validation_status": validation_status,
        "months_paid": months_paid,
        "months_missing": months_missing,
        "months_short": months_short,
        "amount_expected": expected_monthly_amount,
        "amount_paid": monthly_paid,
        "payment_validated_at": datetime.now().isoformat(),
        "payment_validation_note": note,
        "updated_at": datetime.now().isoformat()
    }

    try:
        update_result = (
            supabase.table("members")
            .update(update_data)
            .eq("id", member_id)
            .execute()
        )
    except Exception as e:
        logger.error(
            f"Could not save payment validation for {member_id}: {e}"
        )
        raise HTTPException(
            status_code=400,
            detail=f"Could not save payment validation: {str(e)}"
        )

    return {
        "success": True,
        "member_id": member_id,
        "member_number": member.get("member_number"),
        "plan": plan,

        "registration_date": registration_date.isoformat(),

        "monthly_fee": monthly_fee,

        "expected_months": expected_months,
        "months_paid": months_paid,
        "months_missing": months_missing,
        "months_short": months_short,

        "amount_expected": round(expected_monthly_amount, 2),
        "amount_paid": round(monthly_paid, 2),

        "registration_paid": round(registration_paid, 2),

        "status": current_status,
        "payment_validation_status": validation_status,

        "legacy_status": member.get("legacy_status"),
        "legacy_missing_months": member.get("legacy_missing_months"),

        "note": note
    }


# ------------------------------------------------------------
# 9b. PAYMENT VALIDATION ENDPOINTS
# ------------------------------------------------------------
# Wraps calculate_member_payment_validation() so the admin panel
# (admin-members.html "Validate Payments" button) and any cron /
# reporting job can trigger the reconciliation on demand.

class BulkValidateRequest(BaseModel):
    """Optionally restrict the sweep to a specific list of member ids."""
    member_ids: Optional[List[str]] = None
    # Safety cap so a misconfigured call can't try to reconcile
    # tens of thousands of members in one request.
    limit: int = 200


@public_router.post("/payment/validate/{member_id}")
async def validate_member_payment(member_id: str):
    """
    Reconcile ONE member's payment history against their plan's
    current monthly contribution and update their status.

    Returns the full audit dict from calculate_member_payment_validation(),
    including months_paid / months_missing / months_short and amounts.
    """
    try:
        result = calculate_member_payment_validation(member_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Payment validation failed for {member_id}: {e}")
        raise HTTPException(
            status_code=400,
            detail=f"Payment validation failed: {str(e)}"
        )


@public_router.post("/payment/validate-bulk")
async def validate_members_bulk(payload: BulkValidateRequest):
    """
    Reconcile many members at once.

    - If `member_ids` is provided, only those are validated.
    - Otherwise the newest `limit` members with a known plan are swept.

    Returns per-member results plus a summary count so a cron job or
    an admin "Refresh all" button can see what changed.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    if payload.member_ids:
        ids = payload.member_ids[: payload.limit]
    else:
        try:
            rows = (
                supabase.table("members")
                .select("id")
                .not_.is_("plan", "null")
                .order("created_at", desc=True)
                .limit(payload.limit)
                .execute()
                .data or []
            )
        except Exception as e:
            logger.error(f"Bulk validation: could not list members: {e}")
            raise HTTPException(status_code=400, detail="Could not list members")

        ids = [r["id"] for r in rows if r.get("id")]

    results = []
    summary = {
        "checked": 0,
        "active": 0,
        "dormant": 0,
        "pending": 0,
        "requires_reconciliation": 0,
        "not_applicable": 0,
        "errors": 0,
    }

    for member_id in ids:
        try:
            result = calculate_member_payment_validation(member_id)
        except HTTPException as http_err:
            results.append({
                "member_id": member_id,
                "success": False,
                "error": http_err.detail,
            })
            summary["errors"] += 1
            continue
        except Exception as e:
            logger.error(f"Bulk validation error for {member_id}: {e}")
            results.append({
                "member_id": member_id,
                "success": False,
                "error": str(e),
            })
            summary["errors"] += 1
            continue

        results.append(result)
        summary["checked"] += 1

        if result.get("validation_status") == "NOT_APPLICABLE":
            summary["not_applicable"] += 1
            continue

        if result.get("validation_status") == "REQUIRES_RECONCILIATION":
            summary["requires_reconciliation"] += 1
            continue

        status = result.get("status")
        if status == "ACTIVE":
            summary["active"] += 1
        elif status == "DORMANT":
            summary["dormant"] += 1
        elif status == "PENDING":
            summary["pending"] += 1

    return {
        "success": True,
        "summary": summary,
        "results": results,
    }


# ------------------------------------------------------------
# 10. PUBLIC MEMBER LOOKUP (plain record)
# ------------------------------------------------------------

@public_router.get("/member/{member_id}")
async def get_public_member(member_id: str):
    """
    Fetch a member's public-safe record (used by receipt/ID-card/confirmation
    pages that only have the member_id from the registration response).
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    result = supabase.table("members").select("*").eq("id", member_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Member not found")

    return {"success": True, "data": get_member_safe(result.data[0])}

# ------------------------------------------------------------
# 11. MEMBER STATUS
# ------------------------------------------------------------

@public_router.get("/member/{member_id}/status", response_model=MemberStatusResponse)
async def get_member_status(member_id: str):
    """
    Get member status including coverage information.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        member_result = supabase.table("members").select("*").eq("id", member_id).execute()
        if not member_result.data:
            raise HTTPException(status_code=404, detail="Member not found")

        member = member_result.data[0]

        dependants_result = supabase.table("dependants").select("count", count="exact").eq("principal_member_id", member_id).execute()
        dependants_count = dependants_result.count or 0

        waiting_months = member.get("waiting_period_months", 4)
        reg_date = member.get("registration_date")
        coverage_status = "Pending"

        if reg_date:
            reg_date = datetime.fromisoformat(reg_date) if isinstance(reg_date, str) else reg_date
            wait_end = reg_date + timedelta(days=waiting_months * 30)
            coverage_status = "Active" if datetime.now() >= wait_end else "Waiting"

        return MemberStatusResponse(
            member_id=member_id,
            member_number=member.get("member_number"),
            status=member.get("member_status", "PENDING"),
            registration_fee_paid=member.get("registration_fee_paid", False),
            waiting_period_months=waiting_months,
            coverage_status=coverage_status,
            registration_date=member.get("registration_date"),
            dependants_count=dependants_count
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Member status check failed: {e}")
        raise HTTPException(status_code=400, detail=f"Status check failed: {str(e)}")

# ------------------------------------------------------------
# 12. RECEIPT GENERATION
# ------------------------------------------------------------

@public_router.get("/receipt/{payment_id}", response_model=ReceiptResponse)
async def get_receipt(payment_id: str):
    """
    Generate/download receipt for a completed payment.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        payment_result = supabase.table("payments").select("*").eq("id", payment_id).execute()
        if not payment_result.data:
            raise HTTPException(status_code=404, detail="Payment not found")

        payment = payment_result.data[0]

        if payment.get("status") != "completed":
            raise HTTPException(status_code=400, detail="Payment not completed")

        member_name = "Unknown"
        member_number = "N/A"
        plan = "N/A"
        if payment.get("member_id"):
            member_result = supabase.table("members").select("first_name, last_name, member_number, plan").eq("id", payment["member_id"]).execute()
            if member_result.data:
                member = member_result.data[0]
                member_name = f"{member.get('first_name', '')} {member.get('last_name', '')}".strip()
                member_number = member.get("member_number", "N/A")
                plan = member.get("plan", "N/A")

        return ReceiptResponse(
            payment_id=payment_id,
            member_number=member_number,
            amount=payment.get("amount", 0),
            payment_date=payment.get("payment_date", datetime.now().date().isoformat()),
            receipt_number=payment.get("mpesa_receipt") or f"REC-{payment_id[:8]}",
            member_name=member_name,
            plan=plan
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Receipt generation failed: {e}")
        raise HTTPException(status_code=400, detail=f"Receipt generation failed: {str(e)}")

# ------------------------------------------------------------
# 13. ID CARD GENERATION
# ------------------------------------------------------------

@public_router.get("/id-card/{member_id}", response_model=IDCardResponse)
async def get_id_card(member_id: str):
    """
    Generate ID card data for a member.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        member_result = supabase.table("members").select("*").eq("id", member_id).execute()
        if not member_result.data:
            raise HTTPException(status_code=404, detail="Member not found")

        member = member_result.data[0]

        full_name = f"{member.get('first_name', '')} {member.get('last_name', '')}".strip()

        return IDCardResponse(
            member_id=member_id,
            member_number=member.get("member_number", "N/A"),
            full_name=full_name,
            plan=member.get("plan", "N/A"),
            status=member.get("member_status", "PENDING"),
            registration_date=member.get("registration_date", ""),
            qr_code=None
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ID card generation failed: {e}")
        raise HTTPException(status_code=400, detail=f"ID card generation failed: {str(e)}")

# This is the piece that was missing: without this line, every
# /api/public/* route defined above never gets mounted on the app,
# so FastAPI returns 404 for all of them.
app.include_router(public_router)

# Alias so the callback also works at whatever path MPESA_CALLBACK_URL is set
# to on Render (currently /api/webhooks/mpesa) — same handler, same
# idempotency/IP-allowlist logic, just reachable at both URLs so a mismatch
# between "what the STK payload says" and "what's configured in the env var"
# can't silently 404 a real payment callback.
app.post("/api/webhooks/mpesa", tags=["Public"])(payment_callback)

# ============================================================
# AUTH ROUTES
# ============================================================

auth_router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@auth_router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = find_member_by_identifier(request.identifier)
    if not member:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    password_hash = member.get("password_hash")
    temp_password = member.get("temp_password")
    if not (password_hash and verify_password(request.password, password_hash) or temp_password and request.password == temp_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    supabase.table("members").update({"last_login": datetime.now().isoformat()}).eq("id", member["id"]).execute()
    token = generate_jwt_token(member["id"], member["email"])
    refresh_token = secrets.token_urlsafe(32)
    return LoginResponse(success=True, user=get_member_safe(member), message="Login successful", token=token, refresh_token=refresh_token)

@auth_router.post("/register")
async def register(member_data: MemberCreate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    if supabase.table("members").select("email").eq("email", member_data.email).execute().data:
        raise HTTPException(status_code=400, detail="Email already registered")
    if supabase.table("members").select("id_number").eq("id_number", member_data.id_number).execute().data:
        raise HTTPException(status_code=400, detail="ID number already registered")
    member_number = generate_member_number()
    password = generate_password()
    password_hash = hash_password(password)
    username = member_number
    waiting_period = 6 if member_data.plan == PlanEnum.DIGNITY else 4
    member_record = {
        "member_number": member_number, "username": username,
        "first_name": member_data.first_name, "last_name": member_data.last_name,
        "other_name": member_data.other_name, "email": member_data.email,
        "phone": member_data.phone, "alternative_phone": member_data.alternative_phone,
        "id_number": member_data.id_number, "date_of_birth": member_data.date_of_birth,
        "gender": member_data.gender.value, "county": member_data.county,
        "location": member_data.location, "town": member_data.town,
        "address": member_data.address, "plan": member_data.plan.value,
        "benefit_option": member_data.benefit_option.value, "sales_code": member_data.sales_code,
        "password_hash": password_hash, "temp_password": password,
        "member_status": "PENDING", "is_active": True,
        "registration_date": datetime.now().date().isoformat(),
        "waiting_period_months": waiting_period, "registration_fee_paid": False,
        "created_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()
    }
    result = supabase.table("members").insert(member_record).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create member")
    new_member = result.data[0]
    # FIX: `dependants` has no first_name/last_name/is_active columns —
    # it stores full_name and status instead. See build_dependant_row().
    for dep in member_data.dependants:
        supabase.table("dependants").insert(
            build_dependant_row(
                principal_member_id=new_member["id"],
                first_name=dep.first_name,
                last_name=dep.last_name,
                relationship=dep.relationship.value,
                date_of_birth=dep.date_of_birth,
                phone=dep.phone,
                email=dep.email,
            )
        ).execute()

    # Best-effort welcome SMS (see /api/public/register for the same pattern).
    try:
        asyncio.create_task(
            send_registration_sms(member_data.phone, member_number, member_data.first_name)
        )
    except Exception as e:
        logger.error(f"Could not schedule registration SMS: {e}")

    return {
        "success": True,
        "member": {
            "id": new_member["id"], "member_number": member_number,
            "username": username, "first_name": new_member["first_name"],
            "last_name": new_member["last_name"], "email": new_member["email"],
            "phone": new_member["phone"], "plan": new_member["plan"],
            "member_status": new_member["member_status"]
        },
        "credentials": {"member_number": member_number, "username": username, "password": password},
        "message": "Registration successful. Please save your credentials."
    }

@auth_router.post("/verify")
async def verify_member(identifier: str):
    member = find_member_by_identifier(identifier)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return {
        "success": True,
        "member": {
            "id": member.get("id"), "member_number": member.get("member_number"),
            "username": member.get("username"), "email": member.get("email"),
            "first_name": member.get("first_name"), "last_name": member.get("last_name"),
            "plan": member.get("plan"), "member_status": member.get("member_status")
        }
    }

@auth_router.post("/refresh")
async def refresh_token(request: RefreshTokenRequest):
    return {"success": True, "token": secrets.token_urlsafe(32), "message": "Token refreshed successfully"}

@auth_router.post("/logout")
async def logout():
    return {"success": True, "message": "Logged out successfully. Please clear your local token."}

@auth_router.get("/me")
async def get_current_user_endpoint(user_id: str = Depends(get_current_user)):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("members").select("*").eq("id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    return get_member_safe(result.data[0])

app.include_router(auth_router)

# ============================================================
# MEMBERS ROUTES
# ============================================================

members_router = APIRouter(prefix="/api/members", tags=["Members"])

@members_router.get("/", response_model=List[MemberResponse])
async def list_members(page: int = 1, limit: int = 20, status: Optional[str] = None, plan: Optional[str] = None, search: Optional[str] = None, user_id: str = Depends(get_current_user)):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    query = supabase.table("members").select("*", count="exact")
    if status: query = query.eq("member_status", status)
    if plan: query = query.eq("plan", plan)
    if search: query = query.or_(f"first_name.ilike.%{search}%,last_name.ilike.%{search}%,email.ilike.%{search}%,member_number.ilike.%{search}%")
    offset = (page - 1) * limit
    result = query.range(offset, offset + limit - 1).order("created_at", desc=True).execute()
    return [get_member_safe(m) for m in (result.data or [])]

@members_router.get("/{member_id}", response_model=MemberResponse)
async def get_member(member_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("members").select("*").eq("id", member_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Member not found")
    return get_member_safe(result.data[0])

@members_router.get("/by-number/{member_number}", response_model=MemberResponse)
async def get_member_by_number(member_number: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("members").select("*").eq("member_number", member_number).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Member not found")
    return get_member_safe(result.data[0])

@members_router.put("/{member_id}", response_model=MemberResponse)
async def update_member(member_id: str, member_update: MemberUpdate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    existing = supabase.table("members").select("id").eq("id", member_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Member not found")
    update_data = member_update.dict(exclude_unset=True)
    if update_data:
        update_data["updated_at"] = datetime.now().isoformat()
        if "plan" in update_data and update_data["plan"]:
            update_data["plan"] = update_data["plan"].value
        if "benefit_option" in update_data and update_data["benefit_option"]:
            update_data["benefit_option"] = update_data["benefit_option"].value
    result = supabase.table("members").update(update_data).eq("id", member_id).execute()
    return get_member_safe(result.data[0])

@members_router.get("/{member_id}/stats", response_model=DashboardStats)
async def get_member_stats(member_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("*").eq("id", member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    member = member.data[0]
    member_number = member.get("member_number")
    dependants = supabase.table("dependants").select("count", count="exact").eq("principal_member_id", member_id).execute()
    active_dependants = supabase.table("dependants").select("count", count="exact").eq("principal_member_id", member_id).eq("status", "ACTIVE").execute()
    payments = supabase.table("payments").select("*").eq("member_id", member_id).eq("status", "completed").execute()
    total_payments = sum(float(p.get("amount", 0)) for p in (payments.data or []))
    waiting_months = member.get("waiting_period_months", 4)
    reg_date = member.get("registration_date")
    coverage_status = "Pending"
    if reg_date:
        reg_date = datetime.fromisoformat(reg_date) if isinstance(reg_date, str) else reg_date
        wait_end = reg_date + timedelta(days=waiting_months * 30)
        coverage_status = "Active" if datetime.now() >= wait_end else "Waiting"
    return DashboardStats(
        member_id=member.get("id"), member_number=member.get("member_number"),
        plan=member.get("plan"), benefit_option=member.get("benefit_option"),
        dependants_count=dependants.count or 0, payments_count=len(payments.data or []),
        total_payments=total_payments, last_payment_date=None,
        coverage_status=coverage_status, registration_date=member.get("registration_date"),
        waiting_period_months=member.get("waiting_period_months"), active_dependants=active_dependants.count or 0
    )

app.include_router(members_router)

# ============================================================
# DEPENDANTS ROUTES
# ============================================================

dependants_router = APIRouter(prefix="/api/dependants", tags=["Dependants"])

@dependants_router.get("/member/{member_id}")
async def get_dependants(member_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("dependants").select("*").eq("principal_member_id", member_id).order("created_at", desc=True).execute()
    return {"success": True, "data": result.data or [], "count": len(result.data or [])}

@dependants_router.post("/")
async def create_dependant(dependant: DependantCreate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("id").eq("id", dependant.member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    # FIX: `dependants` has no first_name/last_name/is_active columns —
    # it stores full_name and status instead. See build_dependant_row().
    result = supabase.table("dependants").insert(
        build_dependant_row(
            principal_member_id=dependant.member_id,
            first_name=dependant.first_name,
            last_name=dependant.last_name,
            relationship=dependant.relationship.value,
            date_of_birth=dependant.date_of_birth,
            phone=dependant.phone,
            email=dependant.email,
        )
    ).execute()
    return {"success": True, "data": result.data[0] if result.data else None, "message": "Dependant added successfully"}

@dependants_router.put("/{dependant_id}")
async def update_dependant(dependant_id: str, dependant_update: DependantUpdate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    existing_result = supabase.table("dependants").select("*").eq("id", dependant_id).execute()
    if not existing_result.data:
        raise HTTPException(status_code=404, detail="Dependant not found")
    existing = existing_result.data[0]

    update_fields = dependant_update.dict(exclude_unset=True)
    update_data: Dict[str, Any] = {}

    # FIX: map the incoming first_name/last_name/is_active fields onto the
    # real columns (full_name, status). If only one of first/last name is
    # given, fall back to splitting the existing full_name so we don't
    # clobber the other half.
    if "first_name" in update_fields or "last_name" in update_fields:
        current_first, _, current_last = (existing.get("full_name") or "").partition(" ")
        first_name = update_fields.get("first_name", current_first)
        last_name = update_fields.get("last_name", current_last)
        update_data["full_name"] = f"{first_name} {last_name}".strip()

    if "relationship" in update_fields and update_fields["relationship"]:
        update_data["relationship"] = update_fields["relationship"].value

    if "date_of_birth" in update_fields:
        update_data["date_of_birth"] = update_fields["date_of_birth"]

    if "phone" in update_fields:
        update_data["phone"] = update_fields["phone"]

    if "email" in update_fields:
        update_data["email"] = update_fields["email"]

    if "is_active" in update_fields:
        update_data["status"] = "ACTIVE" if update_fields["is_active"] else "INACTIVE"

    if not update_data:
        return {"success": True, "data": existing, "message": "Nothing to update"}

    update_data["updated_at"] = datetime.now().isoformat()
    result = supabase.table("dependants").update(update_data).eq("id", dependant_id).execute()
    return {"success": True, "data": result.data[0] if result.data else None, "message": "Dependant updated successfully"}

@dependants_router.delete("/{dependant_id}")
async def delete_dependant(dependant_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    # FIX: `dependants` has no is_active column — use status instead.
    # (deleted_at isn't part of the confirmed schema either; drop it unless
    # you've added that column separately.)
    result = supabase.table("dependants").update({"status": "INACTIVE", "updated_at": datetime.now().isoformat()}).eq("id", dependant_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Dependant not found")
    return {"success": True, "message": "Dependant removed successfully"}

app.include_router(dependants_router)

# ============================================================
# PAYMENTS ROUTES
# ============================================================

payments_router = APIRouter(prefix="/api/payments", tags=["Payments"])

@payments_router.get("/member/{member_id}", response_model=List[PaymentResponse])
async def get_member_payments(member_id: str, limit: int = 10, offset: int = 0):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("member_number").eq("id", member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    result = supabase.table("payments").select("*").eq("member_id", member_id).order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return result.data or []

@payments_router.post("/", response_model=PaymentResponse)
async def create_payment(payment: PaymentCreate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("id").eq("id", payment.member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    result = supabase.table("payments").insert({
        "member_id": payment.member_id, "amount": payment.amount,
        "payment_type": payment.payment_type.value, "payment_method": "mpesa",
        "mpesa_receipt": None, "status": "pending",
        "payment_date": datetime.now().date().isoformat(), "phone": payment.phone,
        "created_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()
    }).execute()
    return result.data[0] if result.data else None

@payments_router.put("/{payment_id}")
async def update_payment(payment_id: str, payment_update: PaymentUpdate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    result = supabase.table("payments").update(payment_update.dict(exclude_unset=True)).eq("id", payment_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Payment not found")
    return {"success": True, "data": result.data[0], "message": "Payment updated successfully"}

app.include_router(payments_router)

# ============================================================
# DASHBOARD ROUTES
# ============================================================

dashboard_router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

@dashboard_router.get("/summary/{member_id}")
async def get_dashboard_summary(member_id: str):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("*").eq("id", member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    member = member.data[0]
    dependants = supabase.table("dependants").select("*").eq("principal_member_id", member_id).execute()
    payments = supabase.table("payments").select("*").eq("member_id", member_id).order("created_at", desc=True).limit(5).execute()
    all_payments = supabase.table("payments").select("*").eq("member_id", member_id).eq("status", "completed").execute()
    total_payments = sum(float(p.get("amount", 0)) for p in (all_payments.data or []))
    waiting_months = member.get("waiting_period_months", 4)
    reg_date = member.get("registration_date")
    coverage_status = "Pending"
    if reg_date:
        reg_date = datetime.fromisoformat(reg_date) if isinstance(reg_date, str) else reg_date
        wait_end = reg_date + timedelta(days=waiting_months * 30)
        coverage_status = "Active" if datetime.now() >= wait_end else "Waiting"
    return {
        "success": True,
        "member": get_member_safe(member),
        "dependants": dependants.data or [],
        "dependants_count": len(dependants.data or []),
        "recent_payments": payments.data or [],
        "total_payments": total_payments,
        "coverage_status": coverage_status
    }

@dashboard_router.get("/recent/{member_id}")
async def get_recent_activity(member_id: str, limit: int = 5):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("member_number").eq("id", member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    payments = supabase.table("payments").select("*").eq("member_id", member_id).order("created_at", desc=True).limit(limit).execute()
    dependants = supabase.table("dependants").select("*").eq("principal_member_id", member_id).order("created_at", desc=True).limit(limit).execute()
    return {
        "success": True,
        "recent_payments": payments.data or [],
        "recent_dependants": dependants.data or []
    }

app.include_router(dashboard_router)

# ============================================================
# THIS IS WHAT UVICORN WILL IMPORT AS "main:app"
# ============================================================
