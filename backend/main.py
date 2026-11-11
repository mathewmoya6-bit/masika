       if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("member_number").eq("id", member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    result = (
        supabase.table("payments").select("*")
        .eq("member_id", member_id).order("created_at", desc=True)
        .range(offset, offset + limit - 1).execute()
    )
    return result.data or []


@payments_router.post("/", response_model=PaymentResponse)
async def create_payment(payment: PaymentCreate):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("id").eq("id", payment.member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")
    result = supabase.table("payments").insert({
        "member_id": payment.member_id,
        "amount": payment.amount,
        "payment_type": payment.payment_type.value,
        "payment_method": "mpesa",
        "mpesa_receipt": None,
        "status": "pending",
        "payment_date": datetime.now().date().isoformat(),
        "phone": payment.phone,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
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

    member_result = supabase.table("members").select("*").eq("id", member_id).execute()
    if not member_result.data:
        raise HTTPException(status_code=404, detail="Member not found")
    member = member_result.data[0]

    dependants = supabase.table("dependants").select("*").eq("principal_member_id", member_id).execute()
    recent = (
        supabase.table("payments").select("*")
        .eq("member_id", member_id).order("created_at", desc=True).limit(5).execute()
    )
    completed = (
        supabase.table("payments").select("*")
        .eq("member_id", member_id).eq("status", "completed").execute()
    )
    total_payments = sum(float(p.get("amount", 0)) for p in completed.data or [])

    return {
        "success": True,
        "member": get_member_safe(member),
        "dependants": dependants.data or [],
        "dependants_count": len(dependants.data or []),
        "recent_payments": recent.data or [],
        "total_payments": total_payments,
        "coverage_status": get_coverage_status(member),
    }


@dashboard_router.get("/recent/{member_id}")
async def get_recent_activity(member_id: str, limit: int = 5):
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not available")
    member = supabase.table("members").select("member_number").eq("id", member_id).execute()
    if not member.data:
        raise HTTPException(status_code=404, detail="Member not found")

    payments = (
        supabase.table("payments").select("*")
        .eq("member_id", member_id).order("created_at", desc=True).limit(limit).execute()
    )
    dependants = (
        supabase.table("dependants").select("*")
        .eq("principal_member_id", member_id).order("created_at", desc=True).limit(limit).execute()
    )
    return {
        "success": True,
        "recent_payments": payments.data or [],
        "recent_dependants": dependants.data or [],
    }


app.include_router(dashboard_router)

# uvicorn imports this module as "main:app"
