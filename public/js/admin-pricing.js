// Masika Benevolent — admin-pricing.js
// Aligned with Supabase public.plans table

let allPlans = [];

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
    try {
        const session = await AdminAuth.requireSession();

        if (!session) {
            return;
        }

        const form = document.getElementById("planForm");

        if (form) {
            form.addEventListener("submit", handlePlanFormSubmit);
        }

        await loadPlans();

    } catch (error) {
        console.error("Pricing page initialization error:", error);
    }
});


// ============================================================
// LOAD PLANS
// ============================================================

async function loadPlans() {
    const container = document.getElementById("plansList");

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
            ascending: true,
            nullsFirst: false
        });

    if (error) {
        console.error("Could not load plans:", error);

        container.innerHTML = `
            <p class="form-error" style="display:block;">
                Could not load plans: ${escapeHtml(error.message)}
            </p>
        `;

        return;
    }

    allPlans = data || [];

    if (allPlans.length === 0) {
        container.innerHTML = `
            <p style="color:var(--text-light);">
                No plans found. Use "New Plan" to create one.
            </p>
        `;
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
                        <th>Benefits</th>
                        <th>Parents</th>
                        <th>Age</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="plansTableBody"></tbody>
            </table>
        </div>
    `;

    const tbody = document.getElementById("plansTableBody");

    allPlans.forEach((plan) => {
        tbody.appendChild(renderPlanRow(plan));
    });
}


// ============================================================
// FORMATTING
// ============================================================

function fmtKES(value) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
        return "—";
    }

    return "KES " + number.toLocaleString("en-KE", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}


function fmtNumber(value) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    return Number(value).toLocaleString("en-KE");
}


function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ============================================================
// RENDER PLAN ROW
// ============================================================

function renderPlanRow(plan) {
    const tr = document.createElement("tr");

    const isActive = plan.is_active !== false;

    const planCode = escapeHtml(plan.plan_code || "");
    const planName = escapeHtml(plan.plan_name || "");
    const description = escapeHtml(plan.description || "");

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
                            margin-top:4px;
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
                <strong>${fmtKES(plan.principal_monthly_premium)}</strong>
            </div>

            <div style="
                font-size:12px;
                color:var(--text-light);
                margin-top:3px;
            ">
                Parent:
                ${fmtKES(plan.parent_monthly_premium)}
            </div>
        </td>

        <td>
            <div>
                Principal:
                <strong>${fmtKES(plan.principal_registration_fee)}</strong>
            </div>

            <div style="
                font-size:12px;
                color:var(--text-light);
                margin-top:3px;
            ">
                Dependant:
                ${fmtKES(plan.dependant_registration_fee)}
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
                margin-top:3px;
            ">
                Dependant:
                ${fmtKES(plan.dependant_benefit)}
            </div>
        </td>

        <td>
            ${
                Number(plan.minimum_parents || 0) > 0
                    ? `
                        <div>
                            ${fmtNumber(plan.minimum_parents)}
                            –
                            ${fmtNumber(plan.maximum_parents)}
                        </div>
                    `
                    : "Not required"
            }
        </td>

        <td>
            <div>
                Entry: ${fmtNumber(plan.principal_entry_max_age)}
            </div>

            <div style="
                font-size:12px;
                color:var(--text-light);
            ">
                Exit: ${fmtNumber(plan.exit_age)}
            </div>
        </td>

        <td>
            <span class="status-badge ${isActive ? "active" : "inactive"}">
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
                data-action="edit"
            >
                Edit
            </button>

            <button
                type="button"
                class="btn-sm gray"
                data-action="toggle"
            >
                ${isActive ? "Deactivate" : "Activate"}
            </button>

            <button
                type="button"
                class="btn-sm danger"
                data-action="delete"
            >
                Delete
            </button>
        </td>
    `;

    const editButton = tr.querySelector('[data-action="edit"]');
    const toggleButton = tr.querySelector('[data-action="toggle"]');
    const deleteButton = tr.querySelector('[data-action="delete"]');

    editButton.addEventListener("click", () => {
        openPlanModal(plan);
    });

    toggleButton.addEventListener("click", () => {
        togglePlanStatus(plan, tr);
    });

    deleteButton.addEventListener("click", () => {
        deletePlan(plan, tr);
    });

    return tr;
}


// ============================================================
// OPEN PLAN MODAL
// ============================================================

function openPlanModal(plan = null) {
    const form = document.getElementById("planForm");
    const modal = document.getElementById("planModal");
    const title = document.getElementById("planModalTitle");

    if (!form || !modal) {
        console.error("Plan modal/form not found.");
        return;
    }

    form.reset();

    const errorEl = document.getElementById("planFormError");
    const successEl = document.getElementById("planFormSuccess");

    if (errorEl) {
        errorEl.style.display = "none";
        errorEl.textContent = "";
    }

    if (successEl) {
        successEl.style.display = "none";
        successEl.textContent = "";
    }

    document.getElementById("planId").value =
        plan && plan.id ? plan.id : "";

    title.innerHTML = plan
        ? '<i class="fas fa-tags" style="color:var(--primary);"></i> Edit Plan'
        : '<i class="fas fa-tags" style="color:var(--primary);"></i> New Plan';


    // --------------------------------------------------------
    // Database column -> HTML field mapping
    // --------------------------------------------------------

    const fieldMap = {
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

        monthlyPaymentDeadlineDays:
            "monthly_payment_deadline_days",

        activationRequiredMonths:
            "activation_required_months"
    };


    Object.entries(fieldMap).forEach(([elementId, columnName]) => {
        const element = document.getElementById(elementId);

        if (!element) {
            return;
        }

        if (
            plan &&
            plan[columnName] !== null &&
            plan[columnName] !== undefined
        ) {
            element.value = plan[columnName];
        } else {
            element.value = "";
        }
    });


    // --------------------------------------------------------
    // Active status
    // --------------------------------------------------------

    const activeCheckbox = document.getElementById("planIsActive");

    if (activeCheckbox) {
        activeCheckbox.checked = plan
            ? plan.is_active !== false
            : true;
    }


    modal.classList.add("open");
}


// ============================================================
// CLOSE MODAL
// ============================================================

function closePlanModal() {
    const modal = document.getElementById("planModal");

    if (modal) {
        modal.classList.remove("open");
    }
}


// ============================================================
// CREATE / UPDATE PLAN
// ============================================================

async function handlePlanFormSubmit(event) {
    event.preventDefault();

    const errorEl = document.getElementById("planFormError");
    const successEl = document.getElementById("planFormSuccess");
    const submitBtn = document.getElementById("planSubmitBtn");

    errorEl.style.display = "none";
    successEl.style.display = "none";

    const text = (id) => {
        const element = document.getElementById(id);

        if (!element) {
            return "";
        }

        return element.value.trim();
    };


    const numeric = (id) => {
        const element = document.getElementById(id);

        if (!element) {
            return null;
        }

        const value = element.value.trim();

        if (value === "") {
            return null;
        }

        const number = Number(value);

        return Number.isNaN(number) ? null : number;
    };


    // ========================================================
    // Payload aligned exactly to public.plans
    // ========================================================

    const payload = {
        plan_code: text("planCode"),
        plan_name: text("planName"),
        description: text("planDescription") || null,

        principal_monthly_premium:
            numeric("principalMonthlyPremium"),

        parent_monthly_premium:
            numeric("parentMonthlyPremium"),

        principal_registration_fee:
            numeric("principalRegistrationFee") ?? 0,

        dependant_registration_fee:
            numeric("dependantRegistrationFee") ?? 0,

        principal_benefit:
            numeric("principalBenefit"),

        dependant_benefit:
            numeric("dependantBenefit"),

        max_dependants:
            numeric("maxDependants"),

        minimum_parents:
            numeric("minimumParents") ?? 0,

        maximum_parents:
            numeric("maximumParents") ?? 0,

        principal_entry_max_age:
            numeric("principalEntryMaxAge") ?? 70,

        principal_exit_age:
            numeric("principalExitAge") ?? 80,

        exit_age:
            numeric("exitAge") ?? 80,

        waiting_period_months:
            numeric("waitingPeriodMonths") ?? 0,

        grace_period_days:
            numeric("gracePeriodDays") ?? 0,

        renewal_period_months:
            numeric("renewalPeriodMonths") ?? 1,

        monthly_payment_deadline_days:
            numeric("monthlyPaymentDeadlineDays") ?? 10,

        activation_required_months:
            numeric("activationRequiredMonths") ?? 0,

        is_active:
            document.getElementById("planIsActive").checked
    };


    // ========================================================
    // Validation
    // ========================================================

    if (!payload.plan_code) {
        errorEl.textContent = "Plan code is required.";
        errorEl.style.display = "block";
        return;
    }

    if (!payload.plan_name) {
        errorEl.textContent = "Plan name is required.";
        errorEl.style.display = "block";
        return;
    }

    if (
        payload.principal_monthly_premium === null ||
        payload.principal_monthly_premium < 0
    ) {
        errorEl.textContent =
            "Principal monthly premium must be a valid amount.";

        errorEl.style.display = "block";
        return;
    }

    if (
        payload.minimum_parents > payload.maximum_parents
    ) {
        errorEl.textContent =
            "Minimum parents cannot be greater than maximum parents.";

        errorEl.style.display = "block";
        return;
    }


    const planId = document.getElementById("planId").value.trim();

    submitBtn.disabled = true;

    const originalText = submitBtn.innerHTML;

    submitBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Saving...';


    try {
        let result;

        if (planId) {

            // UPDATE
            result = await supabaseClient
                .from("plans")
                .update(payload)
                .eq("id", planId);

        } else {

            // INSERT
            result = await supabaseClient
                .from("plans")
                .insert(payload);
        }


        if (result.error) {
            throw result.error;
        }


        successEl.textContent = planId
            ? "Plan updated successfully."
            : "Plan created successfully.";

        successEl.style.display = "block";


        await loadPlans();


        setTimeout(() => {
            closePlanModal();
        }, 700);


    } catch (error) {

        console.error("Plan save error:", error);

        errorEl.textContent =
            "Could not save plan: " + error.message;

        errorEl.style.display = "block";

    } finally {

        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}


// ============================================================
// TOGGLE ACTIVE / INACTIVE
// ============================================================

async function togglePlanStatus(plan, rowEl) {

    const nextActive = !(plan.is_active !== false);

    const buttons = rowEl.querySelectorAll("button");

    buttons.forEach((button) => {
        button.disabled = true;
    });


    try {

        const { error } = await supabaseClient
            .from("plans")
            .update({
                is_active: nextActive
            })
            .eq("id", plan.id);


        if (error) {
            throw error;
        }


        plan.is_active = nextActive;

        rowEl.replaceWith(
            renderPlanRow(plan)
        );


    } catch (error) {

        console.error("Plan status update error:", error);

        buttons.forEach((button) => {
            button.disabled = false;
        });

        alert(
            "Could not update plan status: " +
            error.message
        );
    }
}


// ============================================================
// DELETE PLAN
// ============================================================

async function deletePlan(plan, rowEl) {

    const planName =
        plan.plan_name ||
        plan.plan_code ||
        "this plan";


    const confirmed = confirm(
        'Delete "' +
        planName +
        '"?\n\n' +
        "This cannot be undone."
    );


    if (!confirmed) {
        return;
    }


    const buttons = rowEl.querySelectorAll("button");

    buttons.forEach((button) => {
        button.disabled = true;
    });


    try {

        const { error } = await supabaseClient
            .from("plans")
            .delete()
            .eq("id", plan.id);


        if (error) {
            throw error;
        }


        rowEl.remove();

        allPlans = allPlans.filter(
            (item) => item.id !== plan.id
        );


        if (allPlans.length === 0) {

            document.getElementById("plansList").innerHTML = `
                <p style="color:var(--text-light);">
                    No plans yet. Use "New Plan" to add one.
                </p>
            `;
        }


    } catch (error) {

        console.error("Plan deletion error:", error);

        buttons.forEach((button) => {
            button.disabled = false;
        });

        alert(
            "Could not delete plan: " +
            error.message
        );
    }
}


// ============================================================
// CLOSE MODAL WHEN CLICKING OUTSIDE
// ============================================================

document.addEventListener("click", (event) => {

    const modal = document.getElementById("planModal");

    if (
        modal &&
        event.target === modal
    ) {
        closePlanModal();
    }
});


// ============================================================
// ESC KEY CLOSES MODAL
// ============================================================

document.addEventListener("keydown", (event) => {

    if (event.key === "Escape") {
        closePlanModal();
    }
});
```
