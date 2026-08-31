// Masika Benevolent — admin-pricing.html logic
//
// Expected Supabase surface (adjust names to match your schema if they differ):
//   table  membership_plans
//     id, plan_code, name, description,
//     principal_monthly_premium, parent_monthly_premium,
//     principal_registration_fee, dependant_registration_fee,
//     principal_benefit, dependant_benefit,
//     max_dependants, minimum_parents, maximum_parents,
//     principal_entry_max_age, principal_exit_age, exit_age,
//     waiting_period_months, grace_period_days, renewal_period_months,
//     monthly_payment_deadline_days, activation_required_months,
//     is_active, created_at

let allPlans = [];

document.addEventListener("DOMContentLoaded", async () => {
  const session = await AdminAuth.requireSession();
  if (!session) return;

  document.getElementById("planForm").addEventListener("submit", handlePlanFormSubmit);
  loadPlans();
});

// ---------- Load & render ----------

async function loadPlans() {
  const container = document.getElementById("plansList");
  container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Loading...</p></div>`;

  const { data, error } = await supabaseClient
    .from("membership_plans")
    .select("*")
    .order("principal_monthly_premium", { ascending: true });

  if (error) {
    container.innerHTML = `<p class="form-error" style="display:block;">Could not load plans: ${error.message}</p>`;
    return;
  }

  allPlans = data || [];

  if (!allPlans.length) {
    container.innerHTML = `<p style="color:var(--text-light);">No plans yet. Use "New Plan" to add one.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Monthly Premium</th>
            <th>Registration Fee</th>
            <th>Benefit</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="plansTableBody"></tbody>
      </table>
    </div>
  `;

  const tbody = document.getElementById("plansTableBody");
  allPlans.forEach((plan) => tbody.appendChild(renderPlanRow(plan)));
}

function fmtKES(value) {
  if (value === null || value === undefined || value === "") return "—";
  return `KES ${Number(value).toLocaleString()}`;
}

function renderPlanRow(plan) {
  const tr = document.createElement("tr");
  const isActive = plan.is_active !== false;

  tr.innerHTML = `
    <td>
      <div style="font-weight:700;">${plan.plan_code || ""} — ${plan.name || ""}</div>
      ${plan.description ? `<div style="font-size:12px;color:var(--text-light);max-width:220px;white-space:normal;">${plan.description}</div>` : ""}
    </td>
    <td>
      <div>Principal: ${fmtKES(plan.principal_monthly_premium)}</div>
      <div style="font-size:12px;color:var(--text-light);">Parent: ${fmtKES(plan.parent_monthly_premium)}</div>
    </td>
    <td>
      <div>Principal: ${fmtKES(plan.principal_registration_fee)}</div>
      <div style="font-size:12px;color:var(--text-light);">Dependant: ${fmtKES(plan.dependant_registration_fee)}</div>
    </td>
    <td>
      <div>Principal: ${fmtKES(plan.principal_benefit)}</div>
      <div style="font-size:12px;color:var(--text-light);">Dependant: ${fmtKES(plan.dependant_benefit)}</div>
    </td>
    <td><span class="status-badge ${isActive ? "active" : "inactive"}">${isActive ? "Active" : "Inactive"}</span></td>
    <td style="text-align:right;white-space:nowrap;">
      <button type="button" class="btn-sm gray" data-action="edit">Edit</button>
      <button type="button" class="btn-sm gray" data-action="toggle">${isActive ? "Deactivate" : "Activate"}</button>
      <button type="button" class="btn-sm danger" data-action="delete">Delete</button>
    </td>
  `;

  tr.querySelector('[data-action="edit"]').addEventListener("click", () => openPlanModal(plan));
  tr.querySelector('[data-action="toggle"]').addEventListener("click", () => togglePlanStatus(plan, tr));
  tr.querySelector('[data-action="delete"]').addEventListener("click", () => deletePlan(plan, tr));

  return tr;
}

// ---------- Modal open/close/prefill ----------

function openPlanModal(plan) {
  const form = document.getElementById("planForm");
  form.reset();
  document.getElementById("planFormError").style.display = "none";
  document.getElementById("planFormSuccess").style.display = "none";

  const fieldMap = {
    planCode: "plan_code",
    planName: "name",
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

  document.getElementById("planId").value = plan ? plan.id : "";
  document.getElementById("planModalTitle").innerHTML = plan
    ? '<i class="fas fa-tags" style="color:var(--primary);"></i> Edit Plan'
    : '<i class="fas fa-tags" style="color:var(--primary);"></i> New Plan';

  Object.entries(fieldMap).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.value = plan && plan[key] !== null && plan[key] !== undefined ? plan[key] : "";
  });

  document.getElementById("planIsActive").checked = plan ? plan.is_active !== false : true;

  document.getElementById("planModal").classList.add("open");
}

function closePlanModal() {
  document.getElementById("planModal").classList.remove("open");
}

// ---------- Create / update ----------

async function handlePlanFormSubmit(e) {
  e.preventDefault();

  const errorEl = document.getElementById("planFormError");
  const successEl = document.getElementById("planFormSuccess");
  const submitBtn = document.getElementById("planSubmitBtn");
  errorEl.style.display = "none";
  successEl.style.display = "none";

  const numeric = (id) => {
    const val = document.getElementById(id).value;
    return val === "" ? null : Number(val);
  };
  const text = (id) => document.getElementById(id).value.trim();

  const payload = {
    plan_code: text("planCode"),
    name: text("planName"),
    description: text("planDescription") || null,
    principal_monthly_premium: numeric("principalMonthlyPremium"),
    parent_monthly_premium: numeric("parentMonthlyPremium"),
    principal_registration_fee: numeric("principalRegistrationFee"),
    dependant_registration_fee: numeric("dependantRegistrationFee"),
    principal_benefit: numeric("principalBenefit"),
    dependant_benefit: numeric("dependantBenefit"),
    max_dependants: numeric("maxDependants"),
    minimum_parents: numeric("minimumParents"),
    maximum_parents: numeric("maximumParents"),
    principal_entry_max_age: numeric("principalEntryMaxAge"),
    principal_exit_age: numeric("principalExitAge"),
    exit_age: numeric("exitAge"),
    waiting_period_months: numeric("waitingPeriodMonths"),
    grace_period_days: numeric("gracePeriodDays"),
    renewal_period_months: numeric("renewalPeriodMonths"),
    monthly_payment_deadline_days: numeric("monthlyPaymentDeadlineDays"),
    activation_required_months: numeric("activationRequiredMonths"),
    is_active: document.getElementById("planIsActive").checked,
  };

  if (!payload.plan_code || !payload.name) {
    errorEl.textContent = "Plan code and plan name are required.";
    errorEl.style.display = "block";
    return;
  }

  const planId = document.getElementById("planId").value;
  submitBtn.disabled = true;

  const { error } = planId
    ? await supabaseClient.from("membership_plans").update(payload).eq("id", planId)
    : await supabaseClient.from("membership_plans").insert(payload);

  submitBtn.disabled = false;

  if (error) {
    errorEl.textContent = error.message;
    errorEl.style.display = "block";
    return;
  }

  successEl.textContent = planId ? "Plan updated." : "Plan created.";
  successEl.style.display = "block";
  await loadPlans();
  setTimeout(closePlanModal, 600);
}

// ---------- Toggle / delete ----------

async function togglePlanStatus(plan, rowEl) {
  const nextActive = !(plan.is_active !== false);
  const buttons = rowEl.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));

  const { error } = await supabaseClient
    .from("membership_plans")
    .update({ is_active: nextActive })
    .eq("id", plan.id);

  buttons.forEach((b) => (b.disabled = false));

  if (error) {
    alert(`Could not update plan status: ${error.message}`);
    return;
  }
  plan.is_active = nextActive;
  rowEl.replaceWith(renderPlanRow(plan));
}

async function deletePlan(plan, rowEl) {
  const confirmed = confirm(`Delete "${plan.name}"? This cannot be undone. Members already on this plan are not affected.`);
  if (!confirmed) return;

  const buttons = rowEl.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));

  const { error } = await supabaseClient.from("membership_plans").delete().eq("id", plan.id);

  if (error) {
    buttons.forEach((b) => (b.disabled = false));
    alert(`Could not delete plan: ${error.message}`);
    return;
  }
  rowEl.remove();
  allPlans = allPlans.filter((p) => p.id !== plan.id);
  if (!allPlans.length) {
    document.getElementById("plansList").innerHTML =
      '<p style="color:var(--text-light);">No plans yet. Use "New Plan" to add one.</p>';
  }
}
