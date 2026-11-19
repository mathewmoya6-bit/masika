    if not payload.member_id and not payload.membership_number:
        raise HTTPException(status_code=400, detail="member_id or membership_number is required")

    query = supabase.table("members").select("id, member_number, first_name, last_name")
    query = query.eq("id", payload.member_id) if payload.member_id else query.eq("member_number", payload.membership_number)
    member_res = query.limit(1).execute()
    if not member_res.data:
        raise HTTPException(status_code=404, detail="Member not found")
    member = member_res.data[0]

    if payload.membership_number and member.get("member_number") != payload.membership_number:
        raise HTTPException(status_code=400, detail="Membership number does not match the selected member")

    if not (MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET and MPESA_PASSKEY and MPESA_SHORTCODE):
        raise HTTPException(status_code=503, detail="M-Pesa server configuration is incomplete")

    ptype = payload.payment_type.value
    transaction_ref = f"TXN-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(4).upper()}"
    now_iso = datetime.now(timezone.utc).isoformat()

    supabase.table("payments").insert({
        "transaction_reference": transaction_ref,
        "member_id": member["id"],
        "phone": phone,
        "amount": amount,
        "payment_type": PAYMENT_TYPE_DB_LABELS.get(ptype, ptype.upper()),
        "payment_method": "MPESA",
        "status": "pending",
        "payment_date": datetime.now(timezone.utc).date().isoformat(),
        "created_at": now_iso,
        "updated_at": now_iso,
    }).execute()

    stk = await initiate_mpesa_stk_push(phone, amount, transaction_ref, "Masika Payment")
    checkout_id = stk.get("checkout_request_id")
    if not (stk.get("success") and checkout_id):
        reason = stk.get("message") or "M-Pesa did not accept the request"
        _mark_payment_failed(transaction_ref, reason)
        raise HTTPException(status_code=502, detail=reason)

    supabase.table("payments").update({
        "checkout_request_id": checkout_id,
        "merchant_request_id": stk.get("merchant_request_id"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("transaction_reference", transaction_ref).execute()

    logger.info(
        "Admin STK push: staff=%s (%s) member=%s amount=%s type=%s checkout=%s",
        staff.get("id"), staff.get("full_name"), member.get("member_number"), amount, ptype, checkout_id,
    )

    return {
        "success": True,
        "message": "STK push sent. Waiting for the member to enter their M-Pesa PIN.",
        "checkout_request_id": checkout_id,
        "merchant_request_id": stk.get("merchant_request_id"),
        "transaction_id": transaction_ref,
        "member_number": member.get("member_number"),
        "amount": amount,
        "phone_number": phone,
        "payment_type": ptype,
    }


@admin_router.get("/payments/status/{checkout_request_id}")
async def admin_payment_status(checkout_request_id: str, staff: dict = Depends(get_current_collector)):
    res = supabase.table("payments").select("*").eq("checkout_request_id", checkout_request_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Payment not found")
    payment = res.data[0]

    state = str(payment.get("status") or "").lower()
    if state == "pending":
        # Callback may have been lost; ask Safaricom directly.
        try:
            q = await query_mpesa_transaction_status(checkout_request_id)
            now_iso = datetime.now(timezone.utc).isoformat()
            if q.get("success"):
                receipt = q.get("receipt")
                upd = {
                    "status": "completed", "payment_status": "CONFIRMED",
                    "mpesa_receipt": receipt, "mpesa_receipt_number": receipt,
                    "confirmed_at": now_iso, "verified_at": now_iso,
                    "counts_toward_membership": True, "updated_at": now_iso,
                }
                supabase.table("payments").update(upd).eq("id", payment["id"]).execute()
                payment.update(upd)
                if payment.get("member_id"):
                    try:
                        calculate_member_payment_validation(payment["member_id"])
                    except Exception:
                        logger.exception("Post-status validation failed")
            elif q.get("failed"):
                upd = {
                    "status": "failed", "payment_status": "FAILED",
                    "failure_reason": q.get("reason"), "updated_at": now_iso,
                }
                supabase.table("payments").update(upd).eq("id", payment["id"]).execute()
                payment.update(upd)
        except Exception:
            logger.exception("Admin status query failed")

    return {
        "status": payment.get("status"),
        "payment_status": payment.get("payment_status"),
        "amount": payment.get("amount"),
        "payment_type": payment.get("payment_type"),
        "mpesa_receipt": payment.get("mpesa_receipt") or payment.get("mpesa_receipt_number"),
        "mpesa_receipt_number": payment.get("mpesa_receipt_number") or payment.get("mpesa_receipt"),
        "transaction_id": payment.get("transaction_reference"),
        "checkout_request_id": checkout_request_id,
        "failure_reason": payment.get("failure_reason"),
    }


# ============================================================
# MOUNT ROUTERS
# ============================================================

app.include_router(public_router)
app.include_router(webhook_router)
app.include_router(admin_router)
