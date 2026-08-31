// ============================================================
// MASIKA BENEVOLENT
// ADMIN PRICING / PLANS MANAGEMENT
// Supabase table: public.plans
// ============================================================

let allPlans = [];


// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async function () {
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
        console.error("Pricing initialization error:", error);
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

    container.innerHTML =
        '<div class="loading-spinner">' +
        '<div class="spinner"></div>' +
        '<p>Loading plans...</p>' +
        '</div>';

    const result = await supabaseClient
        .from("plans")
        .select("*")
        .order("principal_monthly_premium", {
            ascending: true,
            nullsFirst: false
        });

    if (result.error) {
        console.error("Load plans error:", result.error);

        container.innerHTML =
            '<p class="form-error" style="display:block;">' +
            'Could not load plans: ' +
            escapeHtml(result.error.message) +
            '</p>';

        return;
    }

    allPlans = result.data || [];

    if (allPlans.length === 0) {
        container.innerHTML =
            '<p style="color:var(--text-light);">' +
            'No plans yet. Use "New Plan" to add one.' +
            '</p>';

        return;
    }

    container.innerHTML =
        '<div class="table-wrapper">' +
        '<table>' +
        '<thead>' +
        '<tr>' +
        '<th>Plan</th>' +
        '<th>Monthly Premium</th>' +
        '<th>Registration Fee</th>' +
        '<th>Benefit</th>' +
        '<th>Parents</th>' +
        '<th>Age</th>' +
        '<th>Waiting</th>' +
        '<th>Status</th>' +
        '<th>Actions</th>' +
        '</tr>' +
        '</thead>' +
        '<tbody id="plansTableBody"></tbody>' +
        '</table>' +
        '</div>';

    const tbody = document.getElementById("plansTableBody");

    allPlans.forEach(function (plan) {
        tbody.appendChild(renderPlanRow(plan));
    });
}


// ============================================================
// FORMATTING
// ============================================================

function fmtKES(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "—";
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
        return "—";
    }

    return (
        "KES " +
        number.toLocaleString("en-KE", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        })
    );
}


function fmtNumber(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "—";
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
        return "—";
    }

    return number.toLocaleString("en-KE");
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

    const code = escapeHtml(plan.plan_code);
    const name = escapeHtml(plan.plan_name);
    const description = escapeHtml(plan.description);

    const minParents = Number(plan.minimum_parents || 0);
    const maxParents = Number(plan.maximum_parents || 0);

    let parentDisplay = "Not required";

    if (minParents > 0) {
        parentDisplay =
            minParents +
            " – " +
            maxParents;
    }

    tr.innerHTML =
        '<td>' +
        '<div style="font-weight:700;">' +
        code +
        ' — ' +
        name +
        '</div>' +
        (
            description
                ? '<div style="font-size:12px;color:var(--text-light);' +
                  'max-width:220px;white-space:normal;margin-top:4px;">' +
                  description +
                  '</div>'
                : ""
        ) +
        '</td>' +

        '<td>' +
        '<div>Principal: <strong>' +
        fmtKES(plan.principal_monthly_premium) +
        '</strong></div>' +
        '<div style="font-size:12px;color:var(--text-light);">' +
        'Parent: ' +
        fmtKES(plan.parent_monthly_premium) +
        '</div>' +
        '</td>' +

        '<td>' +
        '<div>Principal: <strong>' +
        fmtKES(plan.principal_registration_fee) +
        '</strong></div>' +
        '<div style="font-size:12px;color:var(--text-light);">' +
        'Dependant: ' +
        fmtKES(plan.dependant_registration_fee) +
        '</div>' +
        '</td>' +

        '<td>' +
        '<div>Principal: ' +
        fmtKES(plan.principal_benefit) +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-light);">' +
        'Dependant: ' +
        fmtKES(plan.dependant_benefit) +
        '</div>' +
        '</td>' +

        '<td>' +
        parentDisplay +
        '</td>' +

        '<td>' +
        '<div>Entry: ' +
        fmtNumber(plan.principal_entry_max_age) +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-light);">' +
        'Exit: ' +
        fmtNumber(plan.exit_age) +
        '</div>' +
        '</td>' +

        '<td>' +
        fmtNumber(plan.waiting_period_months) +
        ' month(s)' +
        '</td>' +

        '<td>' +
        '<span class="status-badge ' +
        (isActive ? "active" : "inactive") +
        '">' +
        (isActive ? "Active" : "Inactive") +
        '</span>' +
        '</td>' +

        '<td style="text-align:right;white-space:nowrap;">' +

        '<button type="button" ' +
        'class="btn-sm gray" ' +
        'data-action="edit">' +
        'Edit' +
        '</button> ' +

        '<button type="button" ' +
        'class="btn-sm gray" ' +
        'data-action="toggle">' +
        (isActive ? "Deactivate" : "Activate") +
        '</button> ' +

        '<button type="button" ' +
        'class="btn-sm danger" ' +
        'data-action="delete">' +
        'Delete' +
        '</button>' +

        '</td>';

    tr.querySelector(
        '[data-action="edit"]'
    ).addEventListener("click", function () {
        openPlanModal(plan);
    });

    tr.querySelector(
        '[data-action="toggle"]'
    ).addEventListener("click", function () {
        togglePlanStatus(plan, tr);
    });

    tr.querySelector(
        '[data-action="delete"]'
    ).addEventListener("click", function () {
        deletePlan(plan, tr);
    });

    return tr;
}


// ============================================================
// OPEN PLAN MODAL
// ============================================================

function openPlanModal(plan) {
    if (plan === undefined) {
        plan = null;
    }

    const form = document.getElementById("planForm");
    const modal = document.getElementById("planModal");

    if (!form || !modal) {
        console.error("Plan modal or form not found.");
        return;
    }

    form.reset();

    const errorEl =
        document.getElementById("planFormError");

    const successEl =
        document.getElementById("planFormSuccess");

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

    document.getElementById(
        "planModalTitle"
    ).innerHTML = plan
        ? '<i class="fas fa-tags" style="color:var(--primary);"></i> Edit Plan'
        : '<i class="fas fa-tags" style="color:var(--primary);"></i> New Plan';


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


    Object.keys(fieldMap).forEach(function (elementId) {
        const element =
            document.getElementById(elementId);

        if (!element) {
            return;
        }

        const columnName =
            fieldMap[elementId];

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


    const activeCheckbox =
        document.getElementById("planIsActive");

    if (activeCheckbox) {
        activeCheckbox.checked =
            plan ? plan.is_active !== false : true;
    }


    modal.classList.add("open");
}


// ============================================================
// CLOSE PLAN MODAL
// ============================================================

function closePlanModal() {
    const modal =
        document.getElementById("planModal");

    if (modal) {
        modal.classList.remove("open");
    }
}


// ============================================================
// READ TEXT FIELD
// ============================================================

function getText(id) {
    const element =
        document.getElementById(id);

    if (!element) {
        return "";
    }

    return element.value.trim();
}


// ============================================================
// READ NUMERIC FIELD
// ============================================================

function getNumber(id, defaultValue) {
    const element =
        document.getElementById(id);

    if (!element) {
        return defaultValue === undefined
            ? null
            : defaultValue;
    }

    const value =
        element.value.trim();

    if (value === "") {
        return defaultValue === undefined
            ? null
            : defaultValue;
    }

    const number = Number(value);

    if (Number.isNaN(number)) {
        return defaultValue === undefined
            ? null
            : defaultValue;
    }

    return number;
}


// ============================================================
// CREATE / UPDATE PLAN
// ============================================================

async function handlePlanFormSubmit(event) {
    event.preventDefault();

    const errorEl =
        document.getElementById("planFormError");

    const successEl =
        document.getElementById("planFormSuccess");

    const submitBtn =
        document.getElementById("planSubmitBtn");


    errorEl.style.display = "none";
    successEl.style.display = "none";


    const planCode =
        getText("planCode");

    const planName =
        getText("planName");


    if (!planCode) {
        errorEl.textContent =
            "Plan code is required.";

        errorEl.style.display = "block";
        return;
    }


    if (!planName) {
        errorEl.textContent =
            "Plan name is required.";

        errorEl.style.display = "block";
        return;
    }


    const principalPremium =
        getNumber("principalMonthlyPremium", 0);

    const parentPremium =
        getNumber("parentMonthlyPremium", 0);

    const principalRegistration =
        getNumber("principalRegistrationFee", 0);

    const dependantRegistration =
        getNumber("dependantRegistrationFee", 0);


    // --------------------------------------------------------
    // IMPORTANT:
    // The database still has legacy NOT NULL columns:
    //
    // monthly_premium
    // registration_fee
    // waiting_period_days
    //
    // Keep them synchronized with the current fields.
    // --------------------------------------------------------

    const waitingMonths =
        getNumber("waitingPeriodMonths", 0);

    const waitingDays =
        waitingMonths * 30;


    const minimumParents =
        getNumber("minimumParents", 0);

    const maximumParents =
        getNumber("maximumParents", 0);


    if (minimumParents > maximumParents) {
        errorEl.textContent =
            "Minimum parents cannot be greater than maximum parents.";

        errorEl.style.display = "block";
        return;
    }


    const activeCheckbox =
        document.getElementById("planIsActive");


    const payload = {

        plan_code: planCode,

        plan_name: planName,

        description:
            getText("planDescription") || null,


        // Current pricing fields
        principal_monthly_premium:
            principalPremium,

        parent_monthly_premium:
            parentPremium,

        principal_registration_fee:
            principalRegistration,

        dependant_registration_fee:
            dependantRegistration,


        // Legacy fields — required by current schema
        monthly_premium:
            principalPremium,

        registration_fee:
            principalRegistration,

        waiting_period_days:
            waitingDays,


        principal_benefit:
            getNumber("principalBenefit"),

        dependant_benefit:
            getNumber("dependantBenefit"),


        max_dependants:
            getNumber("maxDependants"),


        minimum_parents:
            minimumParents,

        maximum_parents:
            maximumParents,


        principal_entry_max_age:
            getNumber("principalEntryMaxAge", 70),

        principal_exit_age:
            getNumber("principalExitAge", 80),

        exit_age:
            getNumber("exitAge", 80),


        waiting_period_months:
            waitingMonths,

        grace_period_days:
            getNumber("gracePeriodDays", 0),

        renewal_period_months:
            getNumber("renewalPeriodMonths", 1),

        monthly_payment_deadline_days:
            getNumber("monthlyPaymentDeadlineDays", 10),

        activation_required_months:
            getNumber("activationRequiredMonths", 0),


        is_active:
            activeCheckbox
                ? activeCheckbox.checked
                : true
    };


    const planId =
        document.getElementById("planId").value.trim();


    submitBtn.disabled = true;

    const originalButtonText =
        submitBtn.innerHTML;

    submitBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Saving...';


    try {

        let result;


        if (planId) {

            result = await supabaseClient
                .from("plans")
                .update(payload)
                .eq("id", planId);

        } else {

            result = await supabaseClient
                .from("plans")
                .insert(payload);
        }


        if (result.error) {
            throw result.error;
        }


        successEl.textContent =
            planId
                ? "Plan updated successfully."
                : "Plan created successfully.";

        successEl.style.display = "block";


        await loadPlans();


        setTimeout(function () {
            closePlanModal();
        }, 700);


    } catch (error) {

        console.error(
            "Save plan error:",
            error
        );

        errorEl.textContent =
            "Could not save plan: " +
            error.message;

        errorEl.style.display = "block";

    } finally {

        submitBtn.disabled = false;

        submitBtn.innerHTML =
            originalButtonText;
    }
}


// ============================================================
// TOGGLE PLAN STATUS
// ============================================================

async function togglePlanStatus(plan, rowEl) {

    const currentActive =
        plan.is_active !== false;

    const nextActive =
        !currentActive;


    const buttons =
        rowEl.querySelectorAll("button");


    buttons.forEach(function (button) {
        button.disabled = true;
    });


    try {

        const result =
            await supabaseClient
                .from("plans")
                .update({
                    is_active: nextActive
                })
                .eq("id", plan.id);


        if (result.error) {
            throw result.error;
        }


        plan.is_active =
            nextActive;


        rowEl.replaceWith(
            renderPlanRow(plan)
        );


    } catch (error) {

        console.error(
            "Toggle plan error:",
            error
        );

        buttons.forEach(function (button) {
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

    const name =
        plan.plan_name ||
        plan.plan_code ||
        "this plan";


    const confirmed =
        confirm(
            'Delete "' +
            name +
            '"?\n\n' +
            "This cannot be undone."
        );


    if (!confirmed) {
        return;
    }


    const buttons =
        rowEl.querySelectorAll("button");


    buttons.forEach(function (button) {
        button.disabled = true;
    });


    try {

        const result =
            await supabaseClient
                .from("plans")
                .delete()
                .eq("id", plan.id);


        if (result.error) {
            throw result.error;
        }


        rowEl.remove();


        allPlans =
            allPlans.filter(function (item) {
                return item.id !== plan.id;
            });


        if (allPlans.length === 0) {

            document.getElementById(
                "plansList"
            ).innerHTML =
                '<p style="color:var(--text-light);">' +
                'No plans yet. Use "New Plan" to add one.' +
                '</p>';
        }


    } catch (error) {

        console.error(
            "Delete plan error:",
            error
        );


        buttons.forEach(function (button) {
            button.disabled = false;
        });


        alert(
            "Could not delete plan: " +
            error.message
        );
    }
}


// ============================================================
// MODAL OUTSIDE CLICK
// ============================================================

document.addEventListener(
    "click",
    function (event) {

        const modal =
            document.getElementById("planModal");

        if (
            modal &&
            event.target === modal
        ) {
            closePlanModal();
        }
    }
);


// ============================================================
// ESC KEY
// ============================================================

document.addEventListener(
    "keydown",
    function (event) {

        if (event.key === "Escape") {
            closePlanModal();
        }
    }
);


// ============================================================
// EXPOSE FUNCTIONS GLOBALLY
// Required because admin-pricing.html uses onclick="..."
// ============================================================

window.openPlanModal =
    openPlanModal;

window.closePlanModal =
    closePlanModal;

window.loadPlans =
    loadPlans;

window.handlePlanFormSubmit =
    handlePlanFormSubmit;

window.togglePlanStatus =
    togglePlanStatus;

window.deletePlan =
    deletePlan;
```
