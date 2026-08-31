// ============================================================
// ADMIN PRICING
// Masika Benevolent - Plan (pricing) management
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  loadAdminProfileForPricingPage();
  loadAgentBadgeCount();
  loadPlans();

  document.getElementById("planForm").addEventListener("submit", submitPlanForm);
});

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatKES(amount) {
  if (amount === null || amount === undefined) return "—";
  return "KES " + Number(amount).toLocaleString("en-KE", { maximumFractionDigits: 0 });
}

// ------------------------------------------------------------

async function loadAdminProfileForPricingPage() {
  try {
    const {
      data: { session },
    } = await window.supabaseClient.auth.getSession();
    if (!session) return;

    const { data: staffRow } = await window.supabaseClient
      .from("staff")
      .select("full_name, roles(role_name)")
      .eq("auth_user_id", session.user.id)
      .single();

    if (!staffRow) return;
    document.getElementById("adminName").textContent = staffRow.full_name;
    document.getElementById("adminRole").textContent = staffRow.roles?.role_name || "Administrator";
    document.getElementById("adminAvatar").textContent = staffRow.full_name.charAt(0).toUpperCase();
  } catch (err) {
    console.error("Failed to load admin profile:", err);
  }
}

async function loadAgentBadgeCount() {
  try {
    const { count, error } = await window.supabaseClient
      .from("staff")
      .select("id, roles!inner(role_code)", { count: "exact", head: true })
      .eq("roles.role_code", "SALES_AGENT");
    if (error) throw error;
    document.getElementById("agentCountBadge").textContent = count || 0;
  } catch (err) {
    console.error("Failed to load agent count:", err);
  }
}

// ------------------------------------------------------------

let plansCache = [];

async function loadPlans() {
  const container = document.getElementById("plansList");
  container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Loading...</p></div>`;

  try {
    const { data, error } = await window.supabaseClient
      .from("plans")
      .select("*")
      .order("plan_name");

    if (error) throw error;
    plansCache = data || [];

    if (plansCache.length === 0) {
      container.innerHTML = `<div class="loading-spinner"><p style="color:var(--text-light);">No plans yet. Create your first one.</p></div>`;
      return;
    }

    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Plan</th><th>Code</th><th>Principal Premium</th><th>Parent Premium</th>
              <th>Registration Fee</th><th>Max Dependants</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${plansCache.map((p) => `
              <tr>
                <td>${escapeHtml(p.plan_name)}</td>
                <td>${escapeHtml(p.plan_code)}</td>
                <td>${formatKES(p.principal_monthly_premium)}</td>
                <td>${formatKES(p.parent_monthly_premium)}</td>
                <td>${formatKES(p.principal_registration_fee)}</td>
                <td>${p.max_dependants ?? "—"}</td>
                <td><span class="status-badge ${p.is_active ? "active" : "inactive"}">${p.is_active ? "Active" : "Inactive"}</span></td>
                <td>
                  <button class="btn-sm gray" onclick="openPlanModal('${p.id}')"><i class="fas fa-pen"></i></button>
                  <button class="btn-sm ${p.is_active ? "danger" : "primary"}" onclick="togglePlanActive('${p.id}', ${!p.is_active})">
                    ${p.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    console.error("Failed to load plans:", err);
    container.innerHTML = `
      <div class="loading-spinner">
        <p style="color:var(--danger);">Couldn't load plans.</p>
        <button class="btn-sm primary" onclick="loadPlans()" style="margin-top:10px;">Retry</button>
      </div>`;
  }
}

async function togglePlanActive(planId, newValue) {
  try {
    const { error } = await window.supabaseClient
      .from("plans")
      .update({ is_active: newValue })
      .eq("id", planId);
    if (error) throw error;
    loadPlans();
  } catch (err) {
    console.error("Failed to toggle plan status:", err);
    alert("Couldn't update plan status. " + err.message);
  }
}

// ------------------------------------------------------------
// Modal: create + edit share one form
// ------------------------------------------------------------

const FIELD_MAP = {
  planCode: "plan_code",
  planName: "plan_name",
  planDescription: "description",
  principalMonthlyPremium: "principal_monthly_premium",
  parentMonthlyPremium: "parent_monthly_premium",
  principalRegistrationFee: "principal_registration_fee",
  dependantRegistrationFee: "dependant_registration_fee",
  principalBenefit: "principal_benefit",
  dependantBenefit: "dependant_benefit",
  maxDependants: "max_dependants",
  minimumParents: "minimum_parents",
  maximumParents: "maximum_parents",
  principalEntryMaxAge: "principal_entry_max_age",
  principalExitAge: "principal_exit_age",
  exitAge: "exit_age",
  waitingPeriodMonths: "waiting_period_months",
  gracePeriodDays: "grace_period_days",
  renewalPeriodMonths: "renewal_period_months",
  monthlyPaymentDeadlineDays: "monthly_payment_deadline_days",
  activationRequiredMonths: "activation_required_months",
};

function openPlanModal(planId) {
  const form = document.getElementById("planForm");
  form.reset();
  document.getElementById("planFormError").style.display = "none";
  document.getElementById("planFormSuccess").style.display = "none";
  document.getElementById("planId").value = "";
  document.getElementById("planIsActive").checked = true;

  if (planId) {
    const plan = plansCache.find((p) => p.id === planId);
    if (plan) {
      document.getElementById("planModalTitle").innerHTML =
        `<i class="fas fa-tags" style="color:var(--primary);"></i> Edit ${escapeHtml(plan.plan_name)}`;
      document.getElementById("planId").value = plan.id;
      Object.entries(FIELD_MAP).forEach(([elId, col]) => {
        const el = document.getElementById(elId);
        if (el) el.value = plan[col] ?? "";
      });
      document.getElementById("planIsActive").checked = !!plan.is_active;
    }
  } else {
    document.getElementById("planModalTitle").innerHTML =
      `<i class="fas fa-tags" style="color:var(--primary);"></i> New Plan`;
  }

  document.getElementById("planModal").classList.add("open");
}

function closePlanModal() {
  document.getElementById("planModal").classList.remove("open");
}

function numOrNull(id) {
  const val = document.getElementById(id).value;
  return val === "" ? null : Number(val);
}

async function submitPlanForm(e) {
  e.preventDefault();
  const errorEl = document.getElementById("planFormError");
  const successEl = document.getElementById("planFormSuccess");
  const submitBtn = document.getElementById("planSubmitBtn");
  errorEl.style.display = "none";
  successEl.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;

  const planId = document.getElementById("planId").value;

  const payload = {
    plan_code: document.getElementById("planCode").value.trim(),
    plan_name: document.getElementById("planName").value.trim(),
    description: document.getElementById("planDescription").value.trim() || null,
    principal_monthly_premium: numOrNull("principalMonthlyPremium"),
    parent_monthly_premium: numOrNull("parentMonthlyPremium"),
    principal_registration_fee: numOrNull("principalRegistrationFee"),
    dependant_registration_fee: numOrNull("dependantRegistrationFee"),
    principal_benefit: numOrNull("principalBenefit"),
    dependant_benefit: numOrNull("dependantBenefit"),
    max_dependants: numOrNull("maxDependants"),
    minimum_parents: numOrNull("minimumParents"),
    maximum_parents: numOrNull("maximumParents"),
    principal_entry_max_age: numOrNull("principalEntryMaxAge"),
    principal_exit_age: numOrNull("principalExitAge"),
    exit_age: numOrNull("exitAge"),
    waiting_period_months: numOrNull("waitingPeriodMonths"),
    grace_period_days: numOrNull("gracePeriodDays"),
    renewal_period_months: numOrNull("renewalPeriodMonths"),
    monthly_payment_deadline_days: numOrNull("monthlyPaymentDeadlineDays"),
    activation_required_months: numOrNull("activationRequiredMonths"),
    is_active: document.getElementById("planIsActive").checked,
  };

  try {
    let error;
    if (planId) {
      ({ error } = await window.supabaseClient.from("plans").update(payload).eq("id", planId));
    } else {
      ({ error } = await window.supabaseClient.from("plans").insert(payload));
    }
    if (error) throw error;

    successEl.textContent = "Plan saved.";
    successEl.style.display = "block";
    loadPlans();
    setTimeout(closePlanModal, 1200);
  } catch (err) {
    console.error("Failed to save plan:", err);
    errorEl.textContent = err.message || "Something went wrong. Please try again.";
    errorEl.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fas fa-save"></i> Save Plan`;
  }
}

window.openPlanModal = openPlanModal;
window.closePlanModal = closePlanModal;
window.togglePlanActive = togglePlanActive;
window.loadPlans = loadPlans;

async function handleLogout() {
  try {
    await window.supabaseClient.auth.signOut();
  } finally {
    window.location.href = "login.html";
  }
}
window.handleLogout = handleLogout;
