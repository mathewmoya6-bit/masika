// ============================================================
// MASIKA BENEVOLENT - ADMIN PRICING
// Database table: public.plans
// ============================================================

let allPlans = [];


// ------------------------------------------------------------
// INITIALIZE
// ------------------------------------------------------------

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
        console.error("Admin pricing initialization error:", error);
    }
});


// ------------------------------------------------------------
// LOAD PLANS
// ------------------------------------------------------------

async function loadPlans() {

    const container = document.getElementById("plansList");

    if (!container) {
        console.error("plansList not found");
        return;
    }

    container.innerHTML =
        '<div class="loading-spinner">' +
        '<div class="spinner"></div>' +
        '<p>Loading plans...</p>' +
        '</div>';

    const response = await supabaseClient
        .from("plans")
        .select("*")
        .order("principal_monthly_premium", {
            ascending: true
        });

    if (response.error) {

        console.error(
            "Could not load plans:",
            response.error
        );

        container.innerHTML =
            '<p class="form-error" style="display:block;">' +
            escapeHtml(response.error.message) +
            '</p>';

        return;
    }

    allPlans = response.data || [];

    if (allPlans.length === 0) {

        container.innerHTML =
            '<p style="color:var(--text-light);">' +
            'No plans found.' +
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
        '<th>Registration</th>' +
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

    const tbody =
        document.getElementById("plansTableBody");

    allPlans.forEach(function (plan) {

        tbody.appendChild(
            renderPlanRow(plan)
        );

    });
}


// ------------------------------------------------------------
// FORMAT CURRENCY
// ------------------------------------------------------------

function fmtKES(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "—";
    }

    const amount = Number(value);

    if (Number.isNaN(amount)) {
        return "—";
    }

    return "KES " + amount.toLocaleString("en-KE", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}


// ------------------------------------------------------------
// ESCAPE HTML
// ------------------------------------------------------------

function escapeHtml(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// ------------------------------------------------------------
// RENDER PLAN
// ------------------------------------------------------------

function renderPlanRow(plan) {

    const tr =
        document.createElement("tr");

    const active =
        plan.is_active !== false;

    const code =
        escapeHtml(plan.plan_code);

    const name =
        escapeHtml(plan.plan_name);

    const description =
        escapeHtml(plan.description);

    let parents = "Not required";

    const minParents =
        Number(plan.minimum_parents || 0);

    const maxParents =
        Number(plan.maximum_parents || 0);

    if (minParents > 0) {

        parents =
            minParents +
            " - " +
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
                  'max-width:220px;white-space:normal;">' +
                  description +
                  '</div>'
                : ""
        ) +

        '</td>' +

        '<td>' +

        '<div>Principal: ' +
        fmtKES(plan.principal_monthly_premium) +
        '</div>' +

        '<div style="font-size:12px;color:var(--text-light);">' +
        'Parent: ' +
        fmtKES(plan.parent_monthly_premium) +
        '</div>' +

        '</td>' +

        '<td>' +

        '<div>Principal: ' +
        fmtKES(plan.principal_registration_fee) +
        '</div>' +

        '<div style="font-size:12px;color:var(--text-light);">' +
        'Dependant: ' +
        fmtKES(plan.dependant_registration_fee) +
        '</div>' +

        '</td>' +

        '<td>' +
        parents +
        '</td>' +

        '<td>' +

        '<div>Entry: ' +
        (plan.principal_entry_max_age || "—") +
        '</div>' +

        '<div style="font-size:12px;color:var(--text-light);">' +
        'Exit: ' +
        (plan.exit_age || "—") +
        '</div>' +

        '</td>' +

        '<td>' +
        (plan.waiting_period_months || 0) +
        ' month(s)' +
        '</td>' +

        '<td>' +

        '<span class="status-badge ' +
        (active ? "active" : "inactive") +
        '">' +

        (active ? "Active" : "Inactive") +

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
        (active ? "Deactivate" : "Activate") +
        '</button> ' +

        '<button type="button" ' +
        'class="btn-sm danger" ' +
        'data-action="delete">' +
        'Delete' +
        '</button>' +

        '</td>';


    tr.querySelector(
        '[data-action="edit"]'
    ).addEventListener(
        "click",
        function () {
            openPlanModal(plan);
        }
    );


    tr.querySelector(
        '[data-action="toggle"]'
    ).addEventListener(
        "click",
        function () {
            togglePlanStatus(plan, tr);
        }
    );


    tr.querySelector(
        '[data-action="delete"]'
    ).addEventListener(
        "click",
        function () {
            deletePlan(plan, tr);
        }
    );


    return tr;
}


// ------------------------------------------------------------
// OPEN MODAL
// ------------------------------------------------------------

function openPlanModal(plan) {

    if (plan === undefined) {
        plan = null;
    }

    const modal =
        document.getElementById("planModal");

    const form =
        document.getElementById("planForm");

    if (!modal || !form) {

        console.error(
            "Plan modal/form not found"
        );

        return;
    }

    form.reset();


    const error =
        document.getElementById("planFormError");

    const success =
        document.getElementById("planFormSuccess");


    if (error) {
        error.style.display = "none";
        error.textContent = "";
    }


    if (success) {
        success.style.display = "none";
        success.textContent = "";
    }


    document.getElementById("planId").value =
        plan ? plan.id : "";


    document.getElementById("planModalTitle").innerHTML =
        plan
            ? '<i class="fas fa-tags" style="color:var(--primary);"></i> Edit Plan'
            : '<i class="fas fa-tags" style="color:var(--primary);"></i> New Plan';


    const fields = {

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


    Object.keys(fields).forEach(
        function (elementId) {

            const element =
                document.getElementById(elementId);

            if (!element) {
                return;
            }

            const column =
                fields[elementId];

            if (
                plan &&
                plan[column] !== null &&
                plan[column] !== undefined
            ) {

                element.value =
                    plan[column];

            } else {

                element.value = "";

            }

        }
    );


    const active =
        document.getElementById("planIsActive");


    if (active) {

        active.checked =
            plan
                ? plan.is_active !== false
                : true;

    }


    modal.classList.add("open");
}


// ------------------------------------------------------------
// CLOSE MODAL
// ------------------------------------------------------------

function closePlanModal() {

    const modal =
        document.getElementById("planModal");

    if (modal) {
        modal.classList.remove("open");
    }
}


// ------------------------------------------------------------
// GET TEXT
// ------------------------------------------------------------

function getText(id) {

    const element =
        document.getElementById(id);

    if (!element) {
        return "";
    }

    return element.value.trim();
}


// ------------------------------------------------------------
// GET NUMBER
// ------------------------------------------------------------

function getNumber(id, fallback) {

    const element =
        document.getElementById(id);

    if (!element) {
        return fallback;
    }

    const value =
        element.value.trim();

    if (value === "") {
        return fallback;
    }

    const number =
        Number(value);

    if (Number.isNaN(number)) {
        return fallback;
    }

    return number;
}


// ------------------------------------------------------------
// SAVE PLAN
// ------------------------------------------------------------

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


    if (!planCode || !planName) {

        errorEl.textContent =
            "Plan code and plan name are required.";

        errorEl.style.display =
            "block";

        return;
    }


    const principalPremium =
        getNumber(
            "principalMonthlyPremium",
            0
        );


    const parentPremium =
        getNumber(
            "parentMonthlyPremium",
            0
        );


    const principalRegistration =
        getNumber(
            "principalRegistrationFee",
            0
        );


    const dependantRegistration =
        getNumber(
            "dependantRegistrationFee",
            0
        );


    const waitingMonths =
        getNumber(
            "waitingPeriodMonths",
            0
        );


    const minimumParents =
        getNumber(
            "minimumParents",
            0
        );


    const maximumParents =
        getNumber(
            "maximumParents",
            0
        );


    if (minimumParents > maximumParents) {

        errorEl.textContent =
            "Minimum parents cannot be greater than maximum parents.";

        errorEl.style.display =
            "block";

        return;
    }


    const activeCheckbox =
        document.getElementById(
            "planIsActive"
        );


    const payload = {

        plan_code:
            planCode,

        plan_name:
            planName,

        description:
            getText("planDescription") || null,


        principal_monthly_premium:
            principalPremium,

        parent_monthly_premium:
            parentPremium,


        principal_registration_fee:
            principalRegistration,

        dependant_registration_fee:
            dependantRegistration,


        principal_benefit:
            getNumber(
                "principalBenefit",
                null
            ),

        dependant_benefit:
            getNumber(
                "dependantBenefit",
                null
            ),


        max_dependants:
            getNumber(
                "maxDependants",
                null
            ),


        minimum_parents:
            minimumParents,

        maximum_parents:
            maximumParents,


        principal_entry_max_age:
            getNumber(
                "principalEntryMaxAge",
                70
            ),

        principal_exit_age:
            getNumber(
                "principalExitAge",
                80
            ),

        exit_age:
            getNumber(
                "exitAge",
                80
            ),


        waiting_period_months:
            waitingMonths,

        waiting_period_days:
            waitingMonths * 30,


        grace_period_days:
            getNumber(
                "gracePeriodDays",
                0
            ),

        renewal_period_months:
            getNumber(
                "renewalPeriodMonths",
                1
            ),

        monthly_payment_deadline_days:
            getNumber(
                "monthlyPaymentDeadlineDays",
                10
            ),

        activation_required_months:
            getNumber(
                "activationRequiredMonths",
                0
            ),


        // Required legacy fields
        monthly_premium:
            principalPremium,

        registration_fee:
            principalRegistration,


        is_active:
            activeCheckbox
                ? activeCheckbox.checked
                : true
    };


    const planId =
        document.getElementById(
            "planId"
        ).value.trim();


    submitBtn.disabled = true;


    const oldText =
        submitBtn.innerHTML;


    submitBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Saving...';


    try {

        let response;


        if (planId) {

            response =
                await supabaseClient
                    .from("plans")
                    .update(payload)
                    .eq("id", planId);

        } else {

            response =
                await supabaseClient
                    .from("plans")
                    .insert(payload);

        }


        if (response.error) {
            throw response.error;
        }


        successEl.textContent =
            planId
                ? "Plan updated successfully."
                : "Plan created successfully.";

        successEl.style.display =
            "block";


        await loadPlans();


        setTimeout(
            function () {
                closePlanModal();
            },
            700
        );


    } catch (error) {

        console.error(
            "Save plan error:",
            error
        );


        errorEl.textContent =
            "Could not save plan: " +
            error.message;


        errorEl.style.display =
            "block";


    } finally {

        submitBtn.disabled =
            false;

        submitBtn.innerHTML =
            oldText;
    }
}


// ------------------------------------------------------------
// TOGGLE STATUS
// ------------------------------------------------------------

async function togglePlanStatus(
    plan,
    rowEl
) {

    const nextStatus =
        !(plan.is_active !== false);


    const buttons =
        rowEl.querySelectorAll("button");


    buttons.forEach(
        function (button) {
            button.disabled = true;
        }
    );


    try {

        const response =
            await supabaseClient
                .from("plans")
                .update({
                    is_active: nextStatus
                })
                .eq("id", plan.id);


        if (response.error) {
            throw response.error;
        }


        plan.is_active =
            nextStatus;


        rowEl.replaceWith(
            renderPlanRow(plan)
        );


    } catch (error) {

        console.error(
            "Status update error:",
            error
        );


        buttons.forEach(
            function (button) {
                button.disabled = false;
            }
        );


        alert(
            "Could not update plan status: " +
            error.message
        );
    }
}


// ------------------------------------------------------------
// DELETE PLAN
// ------------------------------------------------------------

async function deletePlan(
    plan,
    rowEl
) {

    const name =
        plan.plan_name ||
        plan.plan_code ||
        "this plan";


    const confirmed =
        window.confirm(
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


    buttons.forEach(
        function (button) {
            button.disabled = true;
        }
    );


    try {

        const response =
            await supabaseClient
                .from("plans")
                .delete()
                .eq("id", plan.id);


        if (response.error) {
            throw response.error;
        }


        rowEl.remove();


        allPlans =
            allPlans.filter(
                function (item) {
                    return item.id !== plan.id;
                }
            );


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


        buttons.forEach(
            function (button) {
                button.disabled = false;
            }
        );


        alert(
            "Could not delete plan: " +
            error.message
        );
    }
}


// ------------------------------------------------------------
// CLOSE MODAL WITH ESC
// ------------------------------------------------------------

document.addEventListener(
    "keydown",
    function (event) {

        if (event.key === "Escape") {
            closePlanModal();
        }

    }
);


// ------------------------------------------------------------
// CLOSE MODAL WHEN CLICKING OUTSIDE
// ------------------------------------------------------------

document.addEventListener(
    "click",
    function (event) {

        const modal =
            document.getElementById(
                "planModal"
            );

        if (
            modal &&
            event.target === modal
        ) {
            closePlanModal();
        }

    }
);


// ------------------------------------------------------------
// EXPOSE FUNCTIONS TO HTML
// ------------------------------------------------------------

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
