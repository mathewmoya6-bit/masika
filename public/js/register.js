"use strict";

/* ============================================================
   MASIKA BENEVOLENT — PUBLIC REGISTRATION
   Requires masika-utils.js to be loaded first.
   ============================================================ */

const U = window.MasikaUtils;

const CONFIG = {
    MIN_CHAMA_MEMBERS: 30,
    CHAMA_REGISTRATION_RATE: 100,
    MAX_DEPENDANTS: 10,

    FALLBACK_PLANS: [
        {
            plan_code: "Comfort",
            plan_name: "Comfort",
            description: "Basic membership protection for individuals and families.",
            principal_registration_fee: 200,
            dependant_registration_fee: 0,
            principal_monthly_premium: 300
        },
        {
            plan_code: "Dignity",
            plan_name: "Dignity",
            description: "Enhanced family protection and benevolent support.",
            principal_registration_fee: 500,
            dependant_registration_fee: 0,
            principal_monthly_premium: 1000
        },
        {
            plan_code: "Wazazi",
            plan_name: "Wazazi",
            description: "Comprehensive parent and family protection.",
            principal_registration_fee: 200,
            dependant_registration_fee: 100,
            principal_monthly_premium: 650
        },
        {
            plan_code: "Chama",
            plan_name: "Chama",
            description: "Group membership for communities and organizations.",
            principal_registration_fee: 100,
            dependant_registration_fee: 0,
            principal_monthly_premium: 0
        }
    ]
};

const state = {
    plans: [],
    selectedPlan: null,
    dependantIndex: 0,
    dependants: [],
    isChamaMode: false,
    parsedChamaMembers: [],
    submitting: false
};

const $ = id => document.getElementById(id);

const elements = {
    registrationForm: $("registrationForm"),
    chamaForm: $("chamaForm"),
    individualModeBtn: $("individualModeBtn"),
    chamaModeBtn: $("chamaModeBtn"),
    chamaSection: $("chamaSection"),
    plansContainer: $("plansContainer"),
    planHelp: $("planHelp"),
    salesCode: $("salesCode"),
    salesCodeHelp: $("salesCodeHelp"),
    dependantsContainer: $("dependantsContainer"),
    addDependantBtn: $("addDependantBtn"),
    submitBtn: $("submitBtn"),
    resetBtn: $("resetBtn"),
    chamaSubmitBtn: $("chamaSubmitBtn"),
    chamaResetBtn: $("chamaResetBtn"),
    chamaCsv: $("chamaCsv"),
    csvPreview: $("csvPreview"),
    csvCount: $("csvCount"),
    chamaMemberCount: $("chamaMemberCount"),
    chamaTotal: $("chamaTotal"),
    summaryPlan: $("summaryPlan"),
    summaryPrincipal: $("summaryPrincipal"),
    summaryDependants: $("summaryDependants"),
    summaryTotal: $("summaryTotal"),
    alertBox: $("alertBox"),
    loadingBox: $("loadingBox"),
    loadingText: $("loadingText")
};

/* ============================================================
   INITIALIZATION
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
    U.log("register.js: DOMContentLoaded");

    try {
        const year = $("year");
        if (year) {
            year.textContent = new Date().getFullYear();
        }
    } catch (err) {
        U.error("register.js: failed to set footer year:", err);
    }

    try {
        bindEvents();
    } catch (err) {
        U.error("register.js: bindEvents() failed:", err);
    }

    try {
        renderDependants();
    } catch (err) {
        U.error("register.js: initial dependant rendering failed:", err);
    }

    try {
        await Promise.all([loadPlans(), loadSalesCodes()]);
    } catch (err) {
        U.error("register.js: initial data loading failed:", err);
    }

    try {
        updateSummary();
    } catch (err) {
        U.error("register.js: initial summary update failed:", err);
    }

    U.log("register.js: initialization complete");
});

/* ============================================================
   EVENT BINDING
   ============================================================ */

function bindEvents() {
    const bind = (element, name, event, handler) => {
        if (!element) {
            U.error(`register.js: #${name} was not found.`);
            return;
        }
        element.addEventListener(event, handler);
    };

    bind(elements.individualModeBtn, "individualModeBtn", "click", () => setMode(false));
    bind(elements.chamaModeBtn, "chamaModeBtn", "click", () => setMode(true));
    bind(elements.registrationForm, "registrationForm", "submit", registerMember);
    bind(elements.chamaForm, "chamaForm", "submit", registerChamaGroup);
    bind(elements.addDependantBtn, "addDependantBtn", "click", addDependant);
    bind(elements.resetBtn, "resetBtn", "click", resetIndividualForm);
    bind(elements.chamaResetBtn, "chamaResetBtn", "click", resetChamaForm);
    bind(elements.chamaCsv, "chamaCsv", "change", handleChamaCsv);

    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("mode") === "chama") {
            setMode(true);
        }
    } catch (err) {
        U.error("register.js: unable to read URL parameters:", err);
    }
}

/* ============================================================
   MODE
   ============================================================ */

function setMode(chamaMode) {
    state.isChamaMode = chamaMode;

    if (chamaMode) {
        elements.individualModeBtn.classList.remove("active");
        elements.chamaModeBtn.classList.add("active");
        elements.registrationForm.style.display = "none";
        elements.chamaSection.classList.add("show");
    } else {
        elements.chamaModeBtn.classList.remove("active");
        elements.individualModeBtn.classList.add("active");
        elements.chamaSection.classList.remove("show");
        elements.registrationForm.style.display = "block";
    }

    clearAlert();
}

/* ============================================================
   UI HELPERS
   ============================================================ */

function showAlert(message, type = "info") {
    if (!elements.alertBox) {
        U.error("register.js: alertBox missing:", message);
        return;
    }
    elements.alertBox.textContent = String(message || "");
    elements.alertBox.className = `alert ${type} show`;
}

function clearAlert() {
    if (!elements.alertBox) return;
    elements.alertBox.textContent = "";
    elements.alertBox.className = "alert";
}

function setLoading(isLoading, message = "Processing...") {
    if (elements.loadingText) elements.loadingText.textContent = message;
    if (elements.loadingBox) elements.loadingBox.classList.toggle("show", isLoading);
    if (elements.submitBtn) elements.submitBtn.disabled = isLoading;
    if (elements.chamaSubmitBtn) elements.chamaSubmitBtn.disabled = isLoading;
}

/* ============================================================
   PLANS
   ============================================================ */

async function loadPlans() {
    let plans = [];

    try {
        if (typeof supabaseClient !== "undefined" && supabaseClient) {
            const { data, error: sbError } = await supabaseClient
                .from("plans")
                .select(
                    [
                        "plan_code",
                        "plan_name",
                        "description",
                        "principal_registration_fee",
                        "dependant_registration_fee",
                        "principal_monthly_premium"
                    ].join(",")
                )
                .eq("is_active", true)
                .order("principal_monthly_premium", { ascending: true });

            if (!sbError && Array.isArray(data)) {
                plans = data;
            }

            if (sbError) {
                U.warn("register.js: unable to load plans from Supabase:", sbError);
            }
        } else {
            U.warn("register.js: supabaseClient unavailable. Using fallback plans.");
        }
    } catch (err) {
        U.warn("register.js: plan loading failed:", err);
    }

    if (!plans.length) {
        plans = CONFIG.FALLBACK_PLANS;
    }

    state.plans = plans.filter(
        plan => String(plan.plan_code || "").toLowerCase() !== "chama"
    );

    renderPlans();
}

function renderPlans() {
    if (!elements.plansContainer) return;

    if (!state.plans.length) {
        elements.plansContainer.innerHTML =
            `<div class="help-text">No active plans are currently available.</div>`;
        return;
    }

    elements.plansContainer.innerHTML = state.plans
        .map((plan, index) => {
            const code = U.escapeHtml(plan.plan_code || "");
            const name = U.escapeHtml(plan.plan_name || plan.plan_code || "Plan");
            const description = U.escapeHtml(plan.description || "");
            const registrationFee = U.money(plan.principal_registration_fee);
            const monthly = U.money(plan.principal_monthly_premium);

            return `
                <div class="plan-option">
                    <input type="radio" id="plan_${index}" name="plan" value="${code}" data-index="${index}">
                    <label for="plan_${index}" class="plan-label">
                        <div class="plan-name">${name}</div>
                        <div class="plan-description">${description}</div>
                        <div class="plan-price">KES ${registrationFee}<small> registration</small></div>
                        <div class="help-text" style="margin-top:4px;">KES ${monthly}/month</div>
                    </label>
                </div>
            `;
        })
        .join("");

    document.querySelectorAll('input[name="plan"]').forEach(input => {
        input.addEventListener("change", handlePlanChange);
    });

    const defaultPlan =
        state.plans.find(plan => String(plan.plan_code).toLowerCase() === "comfort") ||
        state.plans[0];

    if (defaultPlan) {
        const index = state.plans.indexOf(defaultPlan);
        const input = document.querySelector(`input[name="plan"][data-index="${index}"]`);
        if (input) {
            input.checked = true;
            handlePlanChange();
        }
    }
}

function handlePlanChange() {
    const selected = document.querySelector('input[name="plan"]:checked');

    if (!selected) {
        state.selectedPlan = null;
        updateSummary();
        return;
    }

    const index = Number(selected.dataset.index);
    state.selectedPlan = state.plans[index] || null;

    if (state.selectedPlan && String(state.selectedPlan.plan_code).toLowerCase() === "wazazi") {
        elements.planHelp.textContent =
            "Wazazi requires at least 1 parent and allows a maximum of 4 parents.";
    } else {
        elements.planHelp.textContent = "Add eligible dependants if required.";
    }

    validateDependantsForPlan();
    updateSummary();
}

/* ============================================================
   SALES AGENTS
   ============================================================ */

async function loadSalesCodes() {
    if (typeof supabaseClient === "undefined" || !supabaseClient) {
        U.warn("register.js: supabaseClient unavailable.");
        if (elements.salesCodeHelp) {
            elements.salesCodeHelp.textContent =
                "Sales agent list unavailable right now — you can leave this blank.";
        }
        return;
    }

    try {
        const { data, error: sbError } = await supabaseClient
            .from("public_agent_codes")
            .select("code, agent_name")
            .order("agent_name", { ascending: true });

        if (sbError) {
            U.error("register.js: loading public_agent_codes failed:", sbError);
            if (elements.salesCodeHelp) {
                elements.salesCodeHelp.textContent =
                    "Unable to load sales agents. You can leave this blank.";
            }
            return;
        }

        if (!data || !data.length) {
            if (elements.salesCodeHelp) {
                elements.salesCodeHelp.textContent =
                    "No sales agents are currently listed — you can leave this blank.";
            }
            return;
        }

        elements.salesCode.innerHTML = `<option value="">Select sales agent</option>`;

        data.forEach(agent => {
            const option = document.createElement("option");
            option.value = agent.code || "";
            option.textContent = agent.agent_name
                ? `${agent.agent_name} (${agent.code})`
                : agent.code || "Agent";
            elements.salesCode.appendChild(option);
        });
    } catch (err) {
        U.error("register.js: unexpected sales code error:", err);
        if (elements.salesCodeHelp) {
            elements.salesCodeHelp.textContent =
                "Unable to load sales agents. You can leave this blank.";
        }
    }
}

/* ============================================================
   DEPENDANTS
   ============================================================ */

function addDependant() {
    if (state.dependants.length >= CONFIG.MAX_DEPENDANTS) {
        showAlert(
            `A maximum of ${CONFIG.MAX_DEPENDANTS} dependants can be entered.`,
            "warning"
        );
        return;
    }

    state.dependants.push({ index: state.dependantIndex++ });

    renderDependants();
    updateSummary();
}

function removeDependant(index) {
    state.dependants = state.dependants.filter(dependant => dependant.index !== index);
    renderDependants();
    updateSummary();
}

function renderDependants() {
    if (!elements.dependantsContainer) return;

    if (!state.dependants.length) {
        elements.dependantsContainer.innerHTML =
            `<div class="help-text">No dependants added.</div>`;
        return;
    }

    elements.dependantsContainer.innerHTML = state.dependants
        .map(dependant => {
            const i = dependant.index;
            const position = state.dependants.indexOf(dependant) + 1;

            return `
                <div class="dependant-card" data-dependant="${i}">
                    <div class="dependant-header">
                        <strong>Dependant ${position}</strong>
                        <button type="button" class="remove-dependant" data-remove="${i}">Remove</button>
                    </div>

                    <div class="form-grid">
                        <div class="form-group">
                            <label>Relationship <span class="required">*</span></label>
                            <select class="dependant-field" data-field="relationship" data-index="${i}">
                                <option value="">Select relationship</option>
                                <option value="SPOUSE">Spouse</option>
                                <option value="CHILD">Child</option>
                                <option value="PARENT">Parent</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>Gender <span class="required">*</span></label>
                            <select class="dependant-field" data-field="gender" data-index="${i}">
                                <option value="">Select gender</option>
                                <option value="MALE">Male</option>
                                <option value="FEMALE">Female</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>First Name <span class="required">*</span></label>
                            <input type="text" class="dependant-field" data-field="first_name" data-index="${i}">
                        </div>

                        <div class="form-group">
                            <label>Last Name <span class="required">*</span></label>
                            <input type="text" class="dependant-field" data-field="last_name" data-index="${i}">
                        </div>

                        <div class="form-group">
                            <label>ID / Passport</label>
                            <input type="text" class="dependant-field" data-field="id_number" data-index="${i}">
                        </div>

                        <div class="form-group">
                            <label>Date of Birth <span class="required">*</span></label>
                            <input type="date" class="dependant-field" data-field="date_of_birth" data-index="${i}">
                        </div>

                        <div class="form-group">
                            <label>Phone</label>
                            <input type="tel" class="dependant-field" data-field="phone" data-index="${i}">
                        </div>
                    </div>
                </div>
            `;
        })
        .join("");

    document.querySelectorAll(".remove-dependant").forEach(button => {
        button.addEventListener("click", () => removeDependant(Number(button.dataset.remove)));
    });

    document.querySelectorAll(".dependant-field").forEach(field => {
        field.addEventListener("change", syncDependantState);
        field.addEventListener("input", syncDependantState);
    });

    syncAllDependantState();
}

function syncDependantState(event) {
    const field = event.target;
    const index = Number(field.dataset.index);
    const key = field.dataset.field;
    const dependant = state.dependants.find(item => item.index === index);

    if (!dependant) return;

    dependant[key] = field.value;

    if (key === "relationship") {
        updateSummary();
    }
}

function syncAllDependantState() {
    document.querySelectorAll(".dependant-field").forEach(field => {
        const index = Number(field.dataset.index);
        const key = field.dataset.field;
        const dependant = state.dependants.find(item => item.index === index);

        if (dependant) {
            field.value = dependant[key] || "";
        }
    });
}

function validateDependantsForPlan() {
    if (!state.selectedPlan) return;

    const plan = String(state.selectedPlan.plan_code || "").toLowerCase();

    if (plan !== "wazazi") {
        const parents = state.dependants.filter(
            dependant => String(dependant.relationship || "").toUpperCase() === "PARENT"
        );

        if (parents.length) {
            showAlert(
                "Parent dependants are only applicable to the Wazazi plan.",
                "warning"
            );
        }
    }
}

/* ============================================================
   MEMBER PAYLOAD
   ============================================================ */

function getMemberPayload() {
    syncAllDependantState();

    const dependants = state.dependants.map(dependant => ({
        first_name: U.clean(dependant.first_name),
        last_name: U.clean(dependant.last_name),
        relationship: U.clean(dependant.relationship).toUpperCase(),
        id_number: U.optionalString(dependant.id_number),
        date_of_birth: dependant.date_of_birth || null,
        gender: U.clean(dependant.gender).toUpperCase(),
        phone: U.optionalPhone(dependant.phone)
    }));

    return {
        first_name: U.clean($("firstName").value),
        last_name: U.clean($("lastName").value),
        other_name: U.optionalString($("otherName").value),
        phone: U.normalizePhone($("phone").value),
        alternative_phone: U.optionalPhone($("alternativePhone").value),
        email: U.optionalString($("email").value),
        id_number: U.clean($("idNumber").value),
        date_of_birth: $("dateOfBirth").value || null,
        gender: U.clean($("gender").value).toUpperCase(),
        county: U.clean($("county").value),
        location: U.optionalString($("location").value),
        town: U.optionalString($("town").value),
        address: U.optionalString($("address").value),
        sales_code: U.optionalString($("salesCode").value),
        plan: state.selectedPlan ? U.clean(state.selectedPlan.plan_code) : "",
        benefit_option: U.clean($("benefitOption").value).toLowerCase(),
        dependants
    };
}

/* ============================================================
   VALIDATION
   ============================================================ */

function validateMemberPayload(payload) {
    if (!payload.first_name) return "Please enter the first name.";
    if (!payload.last_name) return "Please enter the last name.";
    if (!payload.id_number) return "Please enter the National ID or passport number.";
    if (!payload.date_of_birth) return "Please enter the date of birth.";
    if (!payload.gender) return "Please select gender.";
    if (!["MALE", "FEMALE"].includes(payload.gender)) return "Please select a valid gender.";
    if (!payload.phone) return "Please enter a phone number.";
    if (!U.isValidKenyanPhone(payload.phone)) {
        return "Please enter a valid Kenyan phone number.";
    }
    if (!payload.county || payload.county.trim().length < 2) {
        return "Please select your county.";
    }
    if (!["service", "cash"].includes(payload.benefit_option)) {
        return "Please select a valid benefit option: Service or Cash.";
    }
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
        return "Please enter a valid email address.";
    }
    if (!state.selectedPlan) return "Please select a membership plan.";

    const plan = String(state.selectedPlan.plan_code || "").toLowerCase();

    const parents = payload.dependants.filter(
        d => String(d.relationship || "").toUpperCase() === "PARENT"
    );
    const spouses = payload.dependants.filter(
        d => String(d.relationship || "").toUpperCase() === "SPOUSE"
    );
    const children = payload.dependants.filter(
        d => String(d.relationship || "").toUpperCase() === "CHILD"
    );

    if (spouses.length > 1) return "Only one spouse can be registered.";
    if (children.length > 4) return "A maximum of four children can be registered.";

    if (plan === "wazazi") {
        if (parents.length < 1) return "Wazazi requires at least one parent.";
        if (parents.length > 4) return "Wazazi allows a maximum of four parents.";
    } else if (parents.length > 0) {
        return "Parent dependants require the Wazazi plan.";
    }

    for (let index = 0; index < payload.dependants.length; index++) {
        const d = payload.dependants[index];
        const num = index + 1;

        if (!d.first_name) return `Dependant ${num} must have a first name.`;
        if (!d.last_name) return `Dependant ${num} must have a last name.`;
        if (!d.relationship) return `Please select the relationship for dependant ${num}.`;
        if (!["SPOUSE", "CHILD", "PARENT"].includes(d.relationship)) {
            return `Dependant ${num} has an invalid relationship.`;
        }
        if (!d.gender) return `Please select the gender for dependant ${num}.`;
        if (!["MALE", "FEMALE"].includes(d.gender)) {
            return `Dependant ${num} has an invalid gender.`;
        }
        if (!d.date_of_birth) {
            return `Please enter the date of birth for dependant ${num}.`;
        }
        if (d.phone && !U.isValidKenyanPhone(d.phone)) {
            return `Dependant ${num} has an invalid Kenyan phone number.`;
        }
    }

    return null;
}

/* ============================================================
   LOCAL AMOUNT CALCULATION
   ============================================================ */

function calculateRegistrationAmount() {
    if (!state.selectedPlan) return 0;

    const principal = Number(state.selectedPlan.principal_registration_fee || 0);
    const dependantFee = Number(state.selectedPlan.dependant_registration_fee || 0);
    const plan = String(state.selectedPlan.plan_code || "").toLowerCase();

    let chargeableDependants = state.dependants.length;

    if (plan === "wazazi") {
        chargeableDependants = state.dependants.filter(
            dependant => String(dependant.relationship || "").toUpperCase() === "PARENT"
        ).length;
    }

    return principal + dependantFee * chargeableDependants;
}

/* ============================================================
   SUMMARY
   ============================================================ */

function updateSummary() {
    if (!state.selectedPlan) {
        elements.summaryPlan.textContent = "—";
        elements.summaryPrincipal.textContent = "KES 0";
        elements.summaryDependants.textContent = "KES 0";
        elements.summaryTotal.textContent = "KES 0";
        return;
    }

    const principal = Number(state.selectedPlan.principal_registration_fee || 0);
    const dependantFee = Number(state.selectedPlan.dependant_registration_fee || 0);
    const planCode = String(state.selectedPlan.plan_code || "").toLowerCase();

    let chargeableDependants = state.dependants.length;

    if (planCode === "wazazi") {
        chargeableDependants = state.dependants.filter(
            dependant => String(dependant.relationship || "").toUpperCase() === "PARENT"
        ).length;
    }

    const dependantTotal = dependantFee * chargeableDependants;
    const total = principal + dependantTotal;

    elements.summaryPlan.textContent = state.selectedPlan.plan_name || state.selectedPlan.plan_code;
    elements.summaryPrincipal.textContent = `KES ${U.money(principal)}`;
    elements.summaryDependants.textContent = `KES ${U.money(dependantTotal)}`;
    elements.summaryTotal.textContent = `KES ${U.money(total)}`;
}

/* ============================================================
   PAYMENT SESSION HANDOFF
   ============================================================ */

function clearRegistrationSession() {
    const keys = [
        "newMemberId",
        "newMemberNumber",
        "newMemberName",
        "newMemberPhone",
        "newChamaGroupId",
        "newChamaGroupName",
        "newChamaMemberCount",
        "newChamaPhone",
        "registrationAmount",
        "registrationPlan",
        "registrationPlanName",
        "registrationType",
        "isChamaRegistration"
    ];

    keys.forEach(key => sessionStorage.removeItem(key));
}

function saveIndividualPaymentSession({
    memberId,
    memberNumber,
    memberName,
    memberPhone,
    registrationAmount,
    planCode,
    planName
}) {
    clearRegistrationSession();

    sessionStorage.setItem("newMemberId", String(memberId));
    sessionStorage.setItem("newMemberNumber", String(memberNumber || ""));
    sessionStorage.setItem("newMemberName", String(memberName || ""));
    sessionStorage.setItem("newMemberPhone", String(memberPhone || ""));
    sessionStorage.setItem("registrationAmount", String(registrationAmount));
    sessionStorage.setItem("registrationPlan", String(planCode || ""));
    sessionStorage.setItem("registrationPlanName", String(planName || ""));
    sessionStorage.setItem("registrationType", "Individual");
    sessionStorage.setItem("isChamaRegistration", "false");

    const verification = {
        memberId: sessionStorage.getItem("newMemberId"),
        registrationAmount: sessionStorage.getItem("registrationAmount")
    };

    U.log("register.js: payment session saved (member id + amount verified)");

    if (verification.memberId !== String(memberId)) {
        throw new Error("Unable to store the member ID for payment.");
    }

    if (Number(verification.registrationAmount) <= 0) {
        throw new Error("Unable to store a valid registration amount for payment.");
    }

    return verification;
}

/* ============================================================
   REGISTER MEMBER
   ============================================================ */

async function registerMember(event) {
    event.preventDefault();

    U.log("register.js: continue to payment clicked");

    if (state.submitting) {
        U.warn("register.js: registration already in progress.");
        return;
    }

    clearAlert();

    const payload = getMemberPayload();

    U.log("register.js: member payload prepared", {
        id_number: payload.id_number ? U.maskId(payload.id_number) : "",
        phone: U.maskPhone(payload.phone)
    });

    const validationError = validateMemberPayload(payload);

    if (validationError) {
        U.warn("register.js: validation failed:", validationError);
        showAlert(validationError, "error");
        return;
    }

    const locallyCalculatedAmount = calculateRegistrationAmount();

    state.submitting = true;
    setLoading(true, "Creating your registration...");

    try {
        const result = await U.apiRequest("/api/public/register", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        U.log("register.js: /api/public/register responded");

        const data = result?.data && typeof result.data === "object" ? result.data : {};
        const member = result?.member && typeof result.member === "object" ? result.member : {};

        if (result?.success === false) {
            throw new Error(
                result?.message ||
                    result?.error ||
                    data?.message ||
                    "Registration could not be completed."
            );
        }

        const memberId =
            result?.member_id ??
            data?.member_id ??
            member?.member_id ??
            result?.id ??
            data?.id ??
            member?.id ??
            null;

        if (!memberId) {
            U.error("register.js: no member ID returned in registration response.");
            throw new Error(
                "Registration was created, but the server did not return a member ID. Please contact support before trying again."
            );
        }

        const memberNumber =
            result?.member_number ?? data?.member_number ?? member?.member_number ?? "";

        const backendAmount =
            result?.registration_amount ??
            data?.registration_amount ??
            member?.registration_amount ??
            result?.amount ??
            data?.amount ??
            null;

        let registrationAmount;

        if (
            backendAmount !== null &&
            backendAmount !== undefined &&
            backendAmount !== "" &&
            Number.isFinite(Number(backendAmount))
        ) {
            registrationAmount = Number(backendAmount);
        } else {
            registrationAmount = Number(locallyCalculatedAmount);
        }

        if (!Number.isFinite(registrationAmount) || registrationAmount <= 0) {
            throw new Error(
                "The registration amount could not be determined. Please refresh the page and try again."
            );
        }

        const memberName = [payload.first_name, payload.other_name, payload.last_name]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        saveIndividualPaymentSession({
            memberId,
            memberNumber,
            memberName,
            memberPhone: payload.phone,
            registrationAmount,
            planCode: state.selectedPlan?.plan_code || payload.plan,
            planName: state.selectedPlan?.plan_name || payload.plan
        });

        state.submitting = false;
        setLoading(false);

        showAlert(
            `Registration created successfully. Amount due: KES ${U.money(
                registrationAmount
            )}. Redirecting to payment...`,
            "success"
        );

        await U.sleep(700);

        const paymentUrl = `payment.html?member_id=${encodeURIComponent(String(memberId))}`;
        window.location.replace(paymentUrl);
    } catch (err) {
        U.error("register.js: member registration failed:", err);
        state.submitting = false;
        setLoading(false);
        showAlert(U.friendlyError(err), "error");
    }
}

/* ============================================================
   CHAMA CSV
   ============================================================ */

function handleChamaCsv(event) {
    const file = event.target.files?.[0];

    if (!file) {
        state.parsedChamaMembers = [];
        renderChamaPreview();
        return;
    }

    clearAlert();

    if (!file.name.toLowerCase().endsWith(".csv")) {
        state.parsedChamaMembers = [];
        renderChamaPreview();
        showAlert("Please upload a CSV file.", "error");
        return;
    }

    // 5 MB guard — a chama CSV of legitimate size (hundreds of members)
    // is a few hundred KB at most; anything larger is almost certainly
    // the wrong file and would otherwise freeze the tab while parsing.
    const MAX_CSV_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_CSV_BYTES) {
        state.parsedChamaMembers = [];
        renderChamaPreview();
        showAlert("That CSV file is too large (max 5 MB). Please check the file.", "error");
        return;
    }

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: header =>
            String(header || "").trim().toLowerCase().replace(/\s+/g, "_"),

        complete: results => {
            if (results.errors?.length) {
                U.warn("register.js: CSV parse warnings:", results.errors);
            }

            try {
                const members = normalizeChamaMembers(results.data || []);
                state.parsedChamaMembers = members;
                renderChamaPreview();
            } catch (err) {
                state.parsedChamaMembers = [];
                renderChamaPreview();
                showAlert(err.message, "error");
            }
        },

        error: err => {
            state.parsedChamaMembers = [];
            renderChamaPreview();
            showAlert(`Unable to read CSV: ${err.message}`, "error");
        }
    });
}

function normalizeChamaMembers(rows) {
    const requiredColumns = [
        "first_name",
        "last_name",
        "phone",
        "id_number",
        "date_of_birth",
        "gender"
    ];

    if (!rows.length) {
        throw new Error("The CSV file contains no member records.");
    }

    const firstRow = rows[0];

    for (const column of requiredColumns) {
        if (!Object.prototype.hasOwnProperty.call(firstRow, column)) {
            throw new Error(`CSV is missing required column: ${column}`);
        }
    }

    const seenIds = new Set();
    const seenPhones = new Set();

    const members = rows.map((row, index) => {
        const member = {
            first_name: U.clean(row.first_name),
            last_name: U.clean(row.last_name),
            phone: U.normalizePhone(row.phone),
            id_number: U.clean(row.id_number),
            date_of_birth: U.clean(row.date_of_birth),
            gender: U.clean(row.gender).toUpperCase()
        };

        const rowNum = index + 2; // +1 for header row, +1 for 1-based indexing

        if (!member.first_name) throw new Error(`Row ${rowNum}: first_name is required.`);
        if (!member.last_name) throw new Error(`Row ${rowNum}: last_name is required.`);
        if (!member.phone) throw new Error(`Row ${rowNum}: phone is required.`);
        if (!U.isValidKenyanPhone(member.phone)) {
            throw new Error(`Row ${rowNum}: invalid Kenyan phone number.`);
        }
        if (!member.id_number) throw new Error(`Row ${rowNum}: id_number is required.`);
        if (!member.date_of_birth) throw new Error(`Row ${rowNum}: date_of_birth is required.`);
        if (!["MALE", "FEMALE"].includes(member.gender)) {
            throw new Error(`Row ${rowNum}: gender must be MALE or FEMALE.`);
        }

        if (seenIds.has(member.id_number)) {
            throw new Error(`Row ${rowNum}: duplicate id_number (${member.id_number}) in the file.`);
        }
        seenIds.add(member.id_number);

        if (seenPhones.has(member.phone)) {
            throw new Error(`Row ${rowNum}: duplicate phone number in the file.`);
        }
        seenPhones.add(member.phone);

        return member;
    });

    if (members.length < CONFIG.MIN_CHAMA_MEMBERS) {
        throw new Error(
            `A minimum of ${CONFIG.MIN_CHAMA_MEMBERS} members is required. Your file contains ${members.length}.`
        );
    }

    return members;
}

function renderChamaPreview() {
    const members = state.parsedChamaMembers;

    elements.chamaMemberCount.textContent = members.length;

    const total = members.length * CONFIG.CHAMA_REGISTRATION_RATE;
    elements.chamaTotal.textContent = `KES ${U.money(total)}`;

    if (!members.length) {
        elements.csvCount.textContent = "";
        elements.csvPreview.classList.remove("show");
        elements.csvPreview.innerHTML = "";
        return;
    }

    elements.csvCount.textContent = `${members.length} member(s) loaded.`;

    const previewRows = members
        .slice(0, 10)
        .map(
            member => `
                <tr>
                    <td>${U.escapeHtml(member.first_name)}</td>
                    <td>${U.escapeHtml(member.last_name)}</td>
                    <td>${U.escapeHtml(member.phone)}</td>
                    <td>${U.escapeHtml(member.id_number)}</td>
                    <td>${U.escapeHtml(member.date_of_birth)}</td>
                    <td>${U.escapeHtml(member.gender)}</td>
                </tr>
            `
        )
        .join("");

    elements.csvPreview.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>First Name</th>
                    <th>Last Name</th>
                    <th>Phone</th>
                    <th>ID</th>
                    <th>Date of Birth</th>
                    <th>Gender</th>
                </tr>
            </thead>
            <tbody>${previewRows}</tbody>
        </table>
        ${
            members.length > 10
                ? `<div style="padding:10px;font-size:12px;color:#66736f;">Showing first 10 of ${members.length} members.</div>`
                : ""
        }
    `;

    elements.csvPreview.classList.add("show");
}

/* ============================================================
   CHAMA PAYLOAD
   ============================================================ */

function getChamaPayload() {
    return {
        group_name: U.clean($("chamaName").value),
        phone: U.normalizePhone($("chamaPhone").value),
        chairperson: {
            name: U.clean($("chairpersonName").value),
            phone: U.normalizePhone($("chairpersonPhone").value),
            id_number: U.clean($("chairpersonId").value)
        },
        treasurer: {
            name: U.clean($("treasurerName").value),
            phone: U.normalizePhone($("treasurerPhone").value),
            id_number: U.clean($("treasurerId").value)
        },
        secretary: {
            name: U.clean($("secretaryName").value),
            phone: U.normalizePhone($("secretaryPhone").value),
            id_number: U.clean($("secretaryId").value)
        },
        members: state.parsedChamaMembers
    };
}

function validateChamaPayload(payload) {
    if (!payload.group_name) return "Please enter the chama/group name.";
    if (payload.group_name.length < 2) {
        return "The chama/group name must contain at least 2 characters.";
    }
    if (!payload.phone) return "Please enter the group contact phone.";
    if (!U.isValidKenyanPhone(payload.phone)) {
        return "Please enter a valid group contact phone.";
    }

    const officials = [
        ["Chairperson", payload.chairperson],
        ["Treasurer", payload.treasurer],
        ["Secretary", payload.secretary]
    ];

    for (const [label, official] of officials) {
        if (!official.name) return `${label} name is required.`;
        if (official.name.length < 2) {
            return `${label} name must contain at least 2 characters.`;
        }
        if (!official.phone) return `${label} phone is required.`;
        if (!U.isValidKenyanPhone(official.phone)) {
            return `${label} phone number is invalid.`;
        }
        if (!official.id_number) return `${label} ID is required.`;
    }

    if (!Array.isArray(payload.members) || payload.members.length < CONFIG.MIN_CHAMA_MEMBERS) {
        return `At least ${CONFIG.MIN_CHAMA_MEMBERS} members are required.`;
    }

    return null;
}

/* ============================================================
   REGISTER CHAMA
   ============================================================ */

async function registerChamaGroup(event) {
    event.preventDefault();

    U.log("register.js: chama continue to payment clicked");

    if (state.submitting) return;

    clearAlert();

    const payload = getChamaPayload();
    const validationError = validateChamaPayload(payload);

    if (validationError) {
        showAlert(validationError, "error");
        return;
    }

    state.submitting = true;
    setLoading(true, "Creating chama registration...");

    try {
        const result = await U.apiRequest("/api/public/register/chama", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        const data = result?.data && typeof result.data === "object" ? result.data : {};
        const group = result?.group && typeof result.group === "object" ? result.group : {};

        if (result?.success === false) {
            throw new Error(
                result?.message || result?.error || "Chama registration could not be completed."
            );
        }

        const groupId =
            result?.group_id ??
            result?.chama_group_id ??
            data?.group_id ??
            data?.chama_group_id ??
            group?.group_id ??
            group?.id ??
            result?.id ??
            data?.id ??
            null;

        if (!groupId) {
            throw new Error("Chama registration succeeded but no group ID was returned.");
        }

        const backendAmount =
            result?.registration_amount ??
            data?.registration_amount ??
            group?.registration_amount ??
            result?.amount ??
            data?.amount ??
            null;

        const calculatedAmount = payload.members.length * CONFIG.CHAMA_REGISTRATION_RATE;

        const registrationAmount =
            backendAmount !== null &&
            backendAmount !== undefined &&
            backendAmount !== "" &&
            Number.isFinite(Number(backendAmount))
                ? Number(backendAmount)
                : calculatedAmount;

        if (!Number.isFinite(registrationAmount) || registrationAmount <= 0) {
            throw new Error("The chama registration amount could not be determined.");
        }

        clearRegistrationSession();

        sessionStorage.setItem("newChamaGroupId", String(groupId));
        sessionStorage.setItem("newChamaGroupName", payload.group_name);
        sessionStorage.setItem("newChamaMemberCount", String(payload.members.length));
        sessionStorage.setItem("newChamaPhone", payload.phone);
        sessionStorage.setItem("registrationAmount", String(registrationAmount));
        sessionStorage.setItem("registrationType", "Chama");
        sessionStorage.setItem("isChamaRegistration", "true");

        state.submitting = false;
        setLoading(false);

        showAlert(
            `Chama registration created successfully. Amount due: KES ${U.money(
                registrationAmount
            )}. Redirecting to payment...`,
            "success"
        );

        await U.sleep(700);

        const paymentUrl = `payment.html?group_id=${encodeURIComponent(String(groupId))}`;
        window.location.replace(paymentUrl);
    } catch (err) {
        U.error("register.js: chama registration failed:", err);
        state.submitting = false;
        setLoading(false);
        showAlert(U.friendlyError(err), "error");
    }
}

/* ============================================================
   RESET
   ============================================================ */

function resetIndividualForm() {
    if (!confirm("Reset this registration form?")) return;

    elements.registrationForm.reset();
    state.dependants = [];
    state.dependantIndex = 0;
    state.selectedPlan = null;

    renderDependants();

    if (state.plans.length) {
        const defaultPlan =
            state.plans.find(plan => String(plan.plan_code).toLowerCase() === "comfort") ||
            state.plans[0];

        const index = state.plans.indexOf(defaultPlan);
        const input = document.querySelector(`input[name="plan"][data-index="${index}"]`);

        if (input) {
            input.checked = true;
            handlePlanChange();
        }
    }

    clearAlert();
    updateSummary();
}

function resetChamaForm() {
    if (!confirm("Reset this chama registration?")) return;

    elements.chamaForm.reset();
    state.parsedChamaMembers = [];
    renderChamaPreview();
    clearAlert();
}

/* ============================================================
   PREVENT ACCIDENTAL DOUBLE SUBMISSION
   ============================================================ */

window.addEventListener("beforeunload", event => {
    if (state.submitting) {
        event.preventDefault();
        event.returnValue = "Registration is being processed.";
    }
});
