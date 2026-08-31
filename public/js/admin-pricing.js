```javascript
// Masika Benevolent — admin-pricing.js
// ------------------------------------------------------------
// Supabase table: public.plans
//
// Actual database fields:
// id
// plan_code
// plan_name
// description
// monthly_premium
// registration_fee
// waiting_period_days
// grace_period_days
// renewal_period_months
// principal_benefit
// dependant_benefit
// max_dependants
// is_active
// created_at
// updated_at
// principal_monthly_premium
// parent_monthly_premium
// dependant_registration_fee
// minimum_parents
// maximum_parents
// principal_entry_max_age
// principal_exit_age
// principal_registration_fee
// waiting_period_months
// monthly_payment_deadline_days
// activation_required_months
// exit_age
// ------------------------------------------------------------

let allPlans = [];

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const session = await AdminAuth.requireSession();
    if (!session) return;

    const form = document.getElementById("planForm");

    if (form) {
      form.addEventListener("submit", handlePlanFormSubmit);
    }

    await loadPlans();
  } catch (error) {
    console.error("Admin pricing initialization error:", error);
    showGlobalError(error.message || "Could not initialize pricing management.");
  }
});

// ============================================================
// HELPERS
// ============================================================

function getElement(id) {
  return document.getElementById(id);
}

function getText(id) {
  const el = getElement(id);
  return el ? el.value.trim() : "";
}

function getNumber(id) {
  const el = getElement(id);

  if (!el) return null;

  const value = el.value.trim();

  if (value === "") return null;

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function setField(id, value) {
  const el = getElement(id);

  if (!el) return;

  el.value =
    value !== null &&
    value !== undefined
      ? value
      : "";
}

function fmtKES(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  return `KES ${number.toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}

function escapeHTML(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showGlobalError(message) {
  const container = getElement("plansList");

  if (!container) {
    alert(message);
    return;
  }

  container.innerHTML = `
    <p class="form-error" style="display:block;">
      ${escapeHTML(message)}
    </p>
  `;
}

// ============================================================
// LOAD PLANS
// ============================================================

async function loadPlans() {
  const container = getElement("plansList");

  if (!container) {
    console.error("plansList element not found.");
    return;
  }

  container.innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <p>Loading plans...</p>
    </div>
  `;

  const { data, error } = await supabaseClient
    .from("plans")
    .select("*")
    .order("principal_monthly_premium", {
      ascending: true
    });

  if (error) {
    console.error("Could not load plans:", error);

    container.innerHTML = `
      <p class="form-error" style="display:block;">
        Could not load plans:
        ${escapeHTML(error.message)}
      </p>
    `;

    return;
  }

  allPlans = data || [];

  if (!allPlans.length) {
    container.innerHTML = `
      <p style="color:var(--text-light);">
        No plans yet. Use "New Plan" to add one.
      </p>
    `;

    return;
  }

  renderPlans();
}

// ============================================================
// RENDER PLANS
// ============================================================

function renderPlans() {
  const container = getElement("plansList");

  if (!container) return;

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Plan</th>
            <th>Monthly Premium</th>
            <th>Registration Fee</th>
            <th>Benefit</th>
            <th>Parents</th>
            <th>Dependants</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody id="plansTableBody"></tbody>
      </table>
    </div>
  `;

  const tbody = getElement("plansTableBody");

  if (!tbody) return;

  allPlans.forEach((plan) => {
    tbody.appendChild(renderPlanRow(plan));
  });
}

function renderPlanRow(plan) {
  const tr = document.createElement("tr");

  const isActive = plan.is_active !== false;

  const planCode = escapeHTML(plan.plan_code || "");
  const planName = escapeHTML(plan.plan_name || "");
  const description = escapeHTML(plan.description || "");

  const principalPremium =
    plan.principal_monthly_premium ??
    plan.monthly_premium;

  const parentPremium =
    plan.parent_monthly_premium ?? 0;

  const principalRegistration =
    plan.principal_registration_fee ??
    plan.registration_fee ??
    0;

  const dependantRegistration =
    plan.dependant_registration_fee ?? 0;

  tr.innerHTML = `
    <td>
      <div style="font-weight:700;">
        ${planCode} — ${planName}
      </div>

      ${
        description
          ? `
            <div style="
              font-size:12px;
              color:var(--text-light);
              max-width:220px;
              white-space:normal;
            ">
              ${description}
            </div>
          `
          : ""
      }
    </td>

    <td>
      <div>
        Principal:
        <strong>${fmtKES(principalPremium)}</strong>
      </div>

      <div style="
        font-size:12px;
        color:var(--text-light);
      ">
        Parent:
        ${fmtKES(parentPremium)}
      </div>
    </td>

    <td>
      <div>
        Principal:
        <strong>${fmtKES(principalRegistration)}</strong>
      </div>

      <div style="
        font-size:12px;
        color:var(--text-light);
      ">
        Dependant:
        ${fmtKES(dependantRegistration)}
      </div>
    </td>

    <td>
      <div>
        Principal:
        ${fmtKES(plan.principal_benefit)}
      </div>

      <div style="
        font-size:12px;
        color:var(--text-light);
      ">
        Dependant:
        ${fmtKES(plan.dependant_benefit)}
      </div>
    </td>

    <td>
      ${
        Number(plan.maximum_parents || 0) > 0
          ? `
            ${plan.minimum_parents || 0}
            –
            ${plan.maximum_parents || 0}
          `
          : "—"
      }
    </td>

    <td>
      ${plan.max_dependants ?? "—"}
    </td>

    <td>
      <span class="status-badge ${
        isActive ? "active" : "inactive"
      }">
        ${isActive ? "Active" : "Inactive"}
      </span>
    </td>

    <td style="
      text-align:right;
      white-space:nowrap;
    ">
      <button
        type="button"
        class="btn-sm gray"
        data-action="edit">
        Edit
      </button>

      <button
        type="button"
        class="btn-sm gray"
        data-action="toggle">
        ${isActive ? "Deactivate" : "Activate"}
      </button>

      <button
        type="button"
        class="btn-sm danger"
        data-action="delete">
        Delete
      </button>
    </td>
  `;

  tr
    .querySelector('[data-action="edit"]')
    .addEventListener("click", () => {
      openPlanModal(plan);
    });

  tr
    .querySelector('[data-action="toggle"]')
    .addEventListener("click", () => {
      togglePlanStatus(plan, tr);
    });

  tr
    .querySelector('[data-action="delete"]')
    .addEventListener("click", () => {
      deletePlan(plan, tr);
    });

  return tr;
}

// ============================================================
// MODAL
// ============================================================

function openPlanModal(plan = null) {
  const form = getElement("planForm");

  if (!form) {
    console.error("planForm not found.");
    return;
  }

  form.reset();

  const errorEl = getElement("planFormError");
  const successEl = getElement("planFormSuccess");

  if (errorEl) {
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  if (successEl) {
    successEl.style.display = "none";
    successEl.textContent = "";
  }

  setField("planId", plan ? plan.id : "");

  const title = getElement("planModalTitle");

  if (title) {
    title.innerHTML = plan
      ? '<i class="fas fa-tags" style="color:var(--primary);"></i> Edit Plan'
      : '<i class="fas fa-tags" style="color:var(--primary);"></i> New Plan';
  }

  const fieldMap = {
    planCode: "plan_code",
    planName: "plan_name",
    planDescription: "description",

    principalMonthlyPremium:
      "principal_monthly_premium",

    parentMonthlyPremium:
      "parent_monthly_premium",

    principalRegistrationFee:
      "principal_registration_fee",

    dependantRegistrationFee:
      "dependant_registration_fee",

    principalBenefit:
      "principal_benefit",

    dependantBenefit:
      "dependant_benefit",

    maxDependants:
      "max_dependants",

    minimumParents:
      "minimum_parents",

    maximumParents:
      "maximum_parents",

    principalEntryMaxAge:
      "principal_entry_max_age",

    principalExitAge:
      "principal_exit_age",

    exitAge:
      "exit_age",

    waitingPeriodMonths:
      "waiting_period_months",

    gracePeriodDays:
      "grace_period_days",

    renewalPeriodMonths:
      "renewal_period_months",

    monthlyPaymentDeadlineDays:
      "monthly_payment_deadline_days",

    activationRequiredMonths:
      "activation_required_months"
  };

  Object.entries(fieldMap).forEach(
    ([elementId, databaseField]) => {
      const element = getElement(elementId);

      if (!element) return;

      let value = plan
        ? plan[databaseField]
        : "";

      // Fallback for legacy database fields
      if (
        plan &&
        (value === null || value === undefined)
      ) {
        if (
          databaseField ===
          "principal_monthly_premium"
        ) {
          value = plan.monthly_premium;
        }

        if (
          databaseField ===
          "principal_registration_fee"
        ) {
          value = plan.registration_fee;
        }
      }

      element.value =
        value !== null &&
        value !== undefined
          ? value
          : "";
    }
  );

  const activeCheckbox = getElement("planIsActive");

  if (activeCheckbox) {
    activeCheckbox.checked =
      plan ? plan.is_active !== false : true;
  }

  const modal = getElement("planModal");

  if (modal) {
    modal.classList.add("open");
  }
}

function closePlanModal() {
  const modal = getElement("planModal");

  if (modal) {
    modal.classList.remove("open");
  }
}

// ============================================================
// VALIDATION
// ============================================================

function validatePlanPayload(payload) {
  if (!payload.plan_code) {
    return "Plan code is required.";
  }

  if (!payload.plan_name) {
    return "Plan name is required.";
  }

  if (
    payload.principal_monthly_premium === null ||
    payload.principal_monthly_premium < 0
  ) {
    return "Principal monthly premium must be zero or greater.";
  }

  if (
    payload.principal_registration_fee === null ||
    payload.principal_registration_fee < 0
  ) {
    return "Principal registration fee must be zero or greater.";
  }

  if (
    payload.parent_monthly_premium !== null &&
    payload.parent_monthly_premium < 0
  ) {
    return "Parent monthly premium cannot be negative.";
  }

  if (
    payload.dependant_registration_fee !== null &&
    payload.dependant_registration_fee < 0
  ) {
    return "Dependant registration fee cannot be negative.";
  }

  if (
    payload.max_dependants !== null &&
    payload.max_dependants < 0
  ) {
    return "Maximum dependants cannot be negative.";
  }

  if (
    payload.minimum_parents !== null &&
    payload.minimum_parents < 0
  ) {
    return "Minimum parents cannot be negative.";
  }

  if (
    payload.maximum_parents !== null &&
    payload.maximum_parents < 0
  ) {
    return "Maximum parents cannot be negative.";
  }

  if (
    payload.minimum_parents !== null &&
    payload.maximum_parents !== null &&
    payload.minimum_parents >
      payload.maximum_parents
  ) {
    return "Minimum parents cannot exceed maximum parents.";
  }

  if (
    payload.principal_entry_max_age !== null &&
    payload.principal_entry_max_age < 0
  ) {
    return "Entry age cannot be negative.";
  }

  if (
    payload.exit_age !== null &&
    payload.exit_age < 0
  ) {
    return "Exit age cannot be negative.";
  }

  // WAZAZI-specific validation
  if (payload.plan_code === "WAZAZI") {
    if (
      !payload.minimum_parents ||
      payload.minimum_parents < 1
    ) {
      return "WAZAZI requires at least 1 parent.";
    }

    if (
      payload.maximum_parents === null ||
      payload.maximum_parents > 4
    ) {
      return "WAZAZI allows a maximum of 4 parents.";
    }

    if (
      payload.parent_monthly_premium === null ||
      payload.parent_monthly_premium < 0
    ) {
      return "WAZAZI parent monthly premium is required.";
    }
  }

  return null;
}

// ============================================================
// BUILD PAYLOAD
// ============================================================

function buildPlanPayload() {
  const principalMonthlyPremium =
    getNumber("principalMonthlyPremium");

  const principalRegistrationFee =
    getNumber("principalRegistrationFee");

  return {
    plan_code:
      getText("planCode").toUpperCase(),

    plan_name:
      getText("planName"),

    description:
      getText("planDescription") || null,

    // Primary pricing fields
    principal_monthly_premium:
      principalMonthlyPremium,

    parent_monthly_premium:
      getNumber("parentMonthlyPremium"),

    principal_registration_fee:
      principalRegistrationFee,

    dependant_registration_fee:
      getNumber("dependantRegistrationFee"),

    // Legacy fields kept synchronized
    // with the principal pricing.
    monthly_premium:
      principalMonthlyPremium,

    registration_fee:
      principalRegistrationFee,

    principal_benefit:
      getNumber("principalBenefit"),

    dependant_benefit:
      getNumber("dependantBenefit"),

    max_dependants:
      getNumber("maxDependants"),

    minimum_parents:
      getNumber("minimumParents"),

    maximum_parents:
      getNumber("maximumParents"),

    principal_entry_max_age:
      getNumber("principalEntryMaxAge"),

    principal_exit_age:
      getNumber("principalExitAge"),

    exit_age:
      getNumber("exitAge"),

    waiting_period_months:
      getNumber("waitingPeriodMonths"),

    grace_period_days:
      getNumber("gracePeriodDays"),

    renewal_period_months:
      getNumber("renewalPeriodMonths"),

    monthly_payment_deadline_days:
      getNumber("monthlyPaymentDeadlineDays"),

    activation_required_months:
      getNumber("activationRequiredMonths"),

    is_active:
      Boolean(
        getElement("planIsActive")?.checked
      )
  };
}

// ============================================================
// CREATE / UPDATE
// ============================================================

async function handlePlanFormSubmit(event) {
  event.preventDefault();

  const errorEl = getElement("planFormError");
  const successEl = getElement("planFormSuccess");
  const submitBtn = getElement("planSubmitBtn");

  if (errorEl) {
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  if (successEl) {
    successEl.style.display = "none";
    successEl.textContent = "";
  }

  const payload = buildPlanPayload();

  const validationError =
    validatePlanPayload(payload);

  if (validationError) {
    if (errorEl) {
      errorEl.textContent = validationError;
      errorEl.style.display = "block";
    }

    return;
  }

  const planId =
    getElement("planId")?.value || "";

  if (submitBtn) {
    submitBtn.disabled = true;
  }

  try {
    let result;

    if (planId) {
      result = await supabaseClient
        .from("plans")
        .update({
          ...payload,
          updated_at: new Date().toISOString()
        })
        .eq("id", planId)
        .select()
        .single();
    } else {
      result = await supabaseClient
        .from("plans")
        .insert(payload)
        .select()
        .single();
    }

    const { data, error } = result;

    if (error) {
      throw error;
    }

    console.log(
      planId
        ? "Plan updated:"
        : "Plan created:",
      data
    );

    if (successEl) {
      successEl.textContent =
        planId
          ? "Plan updated successfully."
          : "Plan created successfully.";

      successEl.style.display = "block";
    }

    await loadPlans();

    setTimeout(() => {
      closePlanModal();
    }, 700);

  } catch (error) {
    console.error(
      "Error saving plan:",
      error
    );

    if (errorEl) {
      errorEl.textContent =
        getSupabaseErrorMessage(error);

      errorEl.style.display = "block";
    }

  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
    }
  }
}

// ============================================================
// SUPABASE ERROR HANDLING
// ============================================================

function getSupabaseErrorMessage(error) {
  if (!error) {
    return "An unknown error occurred.";
  }

  if (error.code === "23505") {
    return "A plan with this plan code already exists.";
  }

  if (error.code === "23503") {
    return "This plan is linked to existing records and cannot be changed or deleted in this way.";
  }

  return (
    error.message ||
    "Could not save the plan."
  );
}

// ============================================================
// TOGGLE ACTIVE STATUS
// ============================================================

async function togglePlanStatus(
  plan,
  rowElement
) {
  if (!plan || !plan.id) return;

  const currentActive =
    plan.is_active !== false;

  const nextActive = !currentActive;

  const buttons =
    rowElement.querySelectorAll("button");

  buttons.forEach(
    (button) => {
      button.disabled = true;
    }
  );

  try {
    const { data, error } =
      await supabaseClient
        .from("plans")
        .update({
          is_active: nextActive,
          updated_at:
            new Date().toISOString()
        })
        .eq("id", plan.id)
        .select()
        .single();

    if (error) {
      throw error;
    }

    plan.is_active =
      data?.is_active ??
      nextActive;

    rowElement.replaceWith(
      renderPlanRow(plan)
    );

  } catch (error) {
    console.error(
      "Could not update plan status:",
      error
    );

    alert(
      `Could not update plan status: ${
        getSupabaseErrorMessage(error)
      }`
    );

    buttons.forEach(
      (button) => {
        button.disabled = false;
      }
    );
  }
}

// ============================================================
// DELETE PLAN
// ============================================================

async function deletePlan(
  plan,
  rowElement
) {
  if (!plan || !plan.id) return;

  const planName =
    plan.plan_name ||
    plan.plan_code ||
    "this plan";

  const confirmed = confirm(
    `Delete "${planName}"?\n\n` +
    `This should only be done if the plan has no existing memberships or payments.\n\n` +
    `For plans already used by members, deactivate the plan instead.\n\n` +
    `Continue?`
  );

  if (!confirmed) return;

  const buttons =
    rowElement.querySelectorAll("button");

  buttons.forEach(
    (button) => {
      button.disabled = true;
    }
  );

  try {
    const { error } =
      await supabaseClient
        .from("plans")
        .delete()
        .eq("id", plan.id);

    if (error) {
      throw error;
    }

    rowElement.remove();

    allPlans =
      allPlans.filter(
        (item) =>
          item.id !== plan.id
      );

    if (!allPlans.length) {
      const container =
        getElement("plansList");

      if (container) {
        container.innerHTML = `
          <p style="color:var(--text-light);">
            No plans yet. Use "New Plan" to add one.
          </p>
        `;
      }
    }

  } catch (error) {
    console.error(
      "Could not delete plan:",
      error
    );

    buttons.forEach(
      (button) => {
        button.disabled = false;
      }
    );

    alert(
      `Could not delete plan: ${
        getSupabaseErrorMessage(error)
      }`
    );
  }
}

// ============================================================
// OPTIONAL: CLOSE MODAL WHEN CLICKING OUTSIDE
// ============================================================

document.addEventListener("click", (event) => {
  const modal = getElement("planModal");

  if (!modal) return;

  if (
    event.target === modal
  ) {
    closePlanModal();
  }
});

// ============================================================
// OPTIONAL: ESC KEY CLOSE
// ============================================================

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  const modal = getElement("planModal");

  if (
    modal &&
    modal.classList.contains("open")
  ) {
    closePlanModal();
  }
});
```
