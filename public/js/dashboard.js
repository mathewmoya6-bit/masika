// ============================================================
// STAFF DASHBOARD
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {

    if (!document.getElementById("dashboard")) {
        return;
    }

    await loadDashboard();
});


// ============================================================
// LOAD DASHBOARD
// ============================================================

async function loadDashboard() {

    try {
        await Promise.all([
            loadMemberCount(),
            loadPaymentStatistics(),
            loadActiveMemberships(),
            loadRecentMembers()
        ]);

    } catch (error) {
        console.error("Dashboard loading error:", error);
    }
}


// ============================================================
// MEMBER COUNT
// ============================================================

async function loadMemberCount() {

    const { count, error } = await window.supabaseClient
        .from("members")
        .select("*", { count: "exact", head: true });

    if (error) {
        console.error("Member count error:", error);
        return;
    }

    updateElement(["totalMembers", "memberCount"], count || 0);
}


// ============================================================
// ACTIVE MEMBERSHIPS
// ============================================================

async function loadActiveMemberships() {

    const { count, error } = await window.supabaseClient
        .from("members")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);

    if (error) {
        console.error("Active membership error:", error);
        return;
    }

    updateElement(["activeMembers", "activeMemberships"], count || 0);
}


// ============================================================
// PAYMENT STATISTICS
// ============================================================

async function loadPaymentStatistics() {

    const { data, error } = await window.supabaseClient
        .from("payments")
        .select("amount, status");

    if (error) {
        console.error("Payment statistics error:", error);
        return;
    }

    let totalCollected = 0;
    let successfulPayments = 0;
    let pendingPayments = 0;

    (data || []).forEach(payment => {
        const status = String(payment.status || "").toUpperCase();
        const amount = Number(payment.amount) || 0;

        if (status === "PAID" || status === "SUCCESS" || status === "COMPLETED" || status === "confirmed") {
            totalCollected += amount;
            successfulPayments++;
        } else if (status === "PENDING") {
            pendingPayments++;
        }
    });

    updateElement(["totalCollected", "totalRevenue"], formatKES(totalCollected));
    updateElement(["successfulPayments", "paymentCount"], successfulPayments);
    updateElement(["pendingPayments"], pendingPayments);
}


// ============================================================
// RECENT MEMBERS
// ============================================================

async function loadRecentMembers() {

    const { data, error } = await window.supabaseClient
        .from("members")
        .select(`
            id,
            first_name,
            last_name,
            phone,
            plan,
            is_active,
            created_at
        `)
        .order("created_at", { ascending: false })
        .limit(10);

    if (error) {
        console.error("Recent members error:", error);
        return;
    }

    renderRecentMembers(data || []);
}


// ============================================================
// RENDER RECENT MEMBERS
// ============================================================

function renderRecentMembers(members) {

    const container = document.getElementById("recentMembers");

    if (!container) return;

    if (!members.length) {
        container.innerHTML = `<div class="empty-state">No members registered yet.</div>`;
        return;
    }

    container.innerHTML = members.map(member => {
        const name = escapeHTML(`${member.first_name || ''} ${member.last_name || ''}`.trim() || "Unknown");
        const phone = escapeHTML(member.phone || "");
        const plan = escapeHTML(member.plan || "-");
        const status = member.is_active ? "Active" : "Inactive";

        return `
            <div class="member-row">
                <div class="member-info">
                    <strong>${name}</strong>
                    <small>${phone}</small>
                </div>
                <div class="member-plan">${plan}</div>
                <div class="member-status">${status}</div>
            </div>
        `;
    }).join("");
}


// ============================================================
// UPDATE ELEMENT
// ============================================================

function updateElement(ids, value) {

    ids.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    });
}


// ============================================================
// FORMAT MONEY
// ============================================================

function formatKES(amount) {
    return new Intl.NumberFormat("en-KE", {
        style: "currency",
        currency: "KES",
        minimumFractionDigits: 0
    }).format(Number(amount) || 0);
}


// ============================================================
// SECURITY
// ============================================================

function escapeHTML(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ============================================================
// REFRESH DASHBOARD
// ============================================================

window.refreshDashboard = loadDashboard;
