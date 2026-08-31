// ============================================================
// MASIKA BENEVOLENT - ADMIN PRICING
// Database table: public.plans
// ============================================================

// ------------------------------------------------------------
// STATE MANAGEMENT
// ------------------------------------------------------------

const state = {
    plans: [],
    isEditing: false,
    currentPlanId: null,
    isLoading: false
};

// ------------------------------------------------------------
// DOM CACHE
// ------------------------------------------------------------

const DOM = {
    get elements() {
        return {
            plansList: document.getElementById('plansList'),
            planModal: document.getElementById('planModal'),
            planForm: document.getElementById('planForm'),
            planFormError: document.getElementById('planFormError'),
            planFormSuccess: document.getElementById('planFormSuccess'),
            planSubmitBtn: document.getElementById('planSubmitBtn'),
            planModalTitle: document.getElementById('planModalTitle'),
            planId: document.getElementById('planId'),
            planIsActive: document.getElementById('planIsActive')
        };
    }
};

// ------------------------------------------------------------
// INITIALIZATION
// ------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const session = await AdminAuth.requireSession();
        if (!session) return;

        setupEventListeners();
        await loadPlans();
    } catch (error) {
        console.error('Admin pricing initialization error:', error);
        showError('Failed to initialize pricing management');
    }
});

// ------------------------------------------------------------
// EVENT SETUP
// ------------------------------------------------------------

function setupEventListeners() {
    const form = DOM.elements.planForm;
    if (form) {
        form.addEventListener('submit', handlePlanFormSubmit);
    }

    // Close modal on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePlanModal();
    });

    // Close modal on backdrop click
    document.addEventListener('click', (e) => {
        const modal = DOM.elements.planModal;
        if (modal && e.target === modal) closePlanModal();
    });
}

// ------------------------------------------------------------
// LOAD PLANS
// ------------------------------------------------------------

async function loadPlans() {
    const container = DOM.elements.plansList;
    if (!container) {
        console.error('plansList not found');
        return;
    }

    showLoading(container);

    try {
        const { data, error } = await supabaseClient
            .from('plans')
            .select('*')
            .order('principal_monthly_premium', { ascending: true });

        if (error) throw error;

        state.plans = data || [];
        renderPlans(container);

    } catch (error) {
        console.error('Could not load plans:', error);
        showErrorInContainer(container, error.message);
    }
}

// ------------------------------------------------------------
// RENDER PLANS
// ------------------------------------------------------------

function renderPlans(container) {
    if (state.plans.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-tags"></i>
                <p>No plans found. Create your first plan!</p>
            </div>
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
                        <th>Registration</th>
                        <th>Parents</th>
                        <th>Age</th>
                        <th>Waiting</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="plansTableBody"></tbody>
            </table>
        </div>
    `;

    const tbody = document.getElementById('plansTableBody');
    state.plans.forEach(plan => {
        tbody.appendChild(createPlanRow(plan));
    });
}

// ------------------------------------------------------------
// CREATE PLAN ROW
// ------------------------------------------------------------

function createPlanRow(plan) {
    const tr = document.createElement('tr');
    const isActive = plan.is_active !== false;
    const parentsRange = getParentsRange(plan);

    tr.innerHTML = `
        <td>
            <div class="plan-name">
                <span class="plan-code">${escapeHtml(plan.plan_code)}</span>
                <span class="plan-title">${escapeHtml(plan.plan_name)}</span>
            </div>
            ${plan.description ? `
                <div class="plan-description">${escapeHtml(plan.description)}</div>
            ` : ''}
        </td>
        <td>
            <div class="premium-row">
                <span>Principal: ${formatCurrency(plan.principal_monthly_premium)}</span>
                <span class="sub-text">Parent: ${formatCurrency(plan.parent_monthly_premium)}</span>
            </div>
        </td>
        <td>
            <div class="premium-row">
                <span>Principal: ${formatCurrency(plan.principal_registration_fee)}</span>
                <span class="sub-text">Dependant: ${formatCurrency(plan.dependant_registration_fee)}</span>
            </div>
        </td>
        <td>${parentsRange}</td>
        <td>
            <div>Entry: ${plan.principal_entry_max_age || '—'}</div>
            <div class="sub-text">Exit: ${plan.exit_age || '—'}</div>
        </td>
        <td>${plan.waiting_period_months || 0} month(s)</td>
        <td>
            <span class="status-badge ${isActive ? 'active' : 'inactive'}">
                ${isActive ? 'Active' : 'Inactive'}
            </span>
        </td>
        <td class="actions">
            <button class="btn-sm gray" data-action="edit" title="Edit plan">
                <i class="fas fa-edit"></i>
            </button>
            <button class="btn-sm ${isActive ? 'warning' : 'success'}" data-action="toggle" title="${isActive ? 'Deactivate' : 'Activate'}">
                <i class="fas ${isActive ? 'fa-pause' : 'fa-play'}"></i>
            </button>
            <button class="btn-sm danger" data-action="delete" title="Delete plan">
                <i class="fas fa-trash"></i>
            </button>
        </td>
    `;

    // Attach event listeners
    const actions = {
        edit: () => openPlanModal(plan),
        toggle: () => togglePlanStatus(plan, tr),
        delete: () => deletePlan(plan, tr)
    };

    tr.querySelectorAll('[data-action]').forEach(btn => {
        const action = btn.dataset.action;
        btn.addEventListener('click', actions[action]);
    });

    return tr;
}

// ------------------------------------------------------------
// UTILITY FUNCTIONS
// ------------------------------------------------------------

function getParentsRange(plan) {
    const minParents = Number(plan.minimum_parents || 0);
    const maxParents = Number(plan.maximum_parents || 0);
    return minParents > 0 ? `${minParents} - ${maxParents}` : 'Not required';
}

function formatCurrency(value) {
    if (value == null || value === '') return '—';
    const amount = Number(value);
    if (isNaN(amount)) return '—';
    return `KES ${amount.toLocaleString('en-KE', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    })}`;
}

function escapeHtml(value) {
    if (value == null) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(value).replace(/[&<>"']/g, m => map[m]);
}

function getText(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function getNumber(id, fallback = 0) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const value = el.value.trim();
    if (value === '') return fallback;
    const num = Number(value);
    return isNaN(num) ? fallback : num;
}

function showLoading(container) {
    container.innerHTML = `
        <div class="loading-spinner">
            <div class="spinner"></div>
            <p>Loading plans...</p>
        </div>
    `;
}

function showErrorInContainer(container, message) {
    container.innerHTML = `
        <div class="form-error" style="display:block;">
            <i class="fas fa-exclamation-circle"></i>
            ${escapeHtml(message)}
        </div>
    `;
}

function showError(message) {
    const errorEl = DOM.elements.planFormError;
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
    if (DOM.elements.planFormSuccess) {
        DOM.elements.planFormSuccess.style.display = 'none';
    }
}

function showSuccess(message) {
    const successEl = DOM.elements.planFormSuccess;
    if (successEl) {
        successEl.textContent = message;
        successEl.style.display = 'block';
    }
    if (DOM.elements.planFormError) {
        DOM.elements.planFormError.style.display = 'none';
    }
}

function clearMessages() {
    if (DOM.elements.planFormError) {
        DOM.elements.planFormError.style.display = 'none';
        DOM.elements.planFormError.textContent = '';
    }
    if (DOM.elements.planFormSuccess) {
        DOM.elements.planFormSuccess.style.display = 'none';
        DOM.elements.planFormSuccess.textContent = '';
    }
}

// ------------------------------------------------------------
// OPEN PLAN MODAL
// ------------------------------------------------------------

function openPlanModal(plan = null) {
    const modal = DOM.elements.planModal;
    const form = DOM.elements.planForm;
    
    if (!modal || !form) {
        console.error('Plan modal/form not found');
        return;
    }

    form.reset();
    clearMessages();

    state.isEditing = !!plan;
    state.currentPlanId = plan?.id || null;

    // Update title
    DOM.elements.planModalTitle.innerHTML = `
        <i class="fas fa-tags" style="color:var(--primary);"></i>
        ${state.isEditing ? 'Edit Plan' : 'New Plan'}
    `;

    // Set plan ID
    DOM.elements.planId.value = state.currentPlanId || '';

    // Field mappings
    const fieldMap = {
        planCode: 'plan_code',
        planName: 'plan_name',
        planDescription: 'description',
        principalMonthlyPremium: 'principal_monthly_premium',
        parentMonthlyPremium: 'parent_monthly_premium',
        principalRegistrationFee: 'principal_registration_fee',
        dependantRegistrationFee: 'dependant_registration_fee',
        principalBenefit: 'principal_benefit',
        dependantBenefit: 'dependant_benefit',
        maxDependants: 'max_dependants',
        minimumParents: 'minimum_parents',
        maximumParents: 'maximum_parents',
        principalEntryMaxAge: 'principal_entry_max_age',
        principalExitAge: 'principal_exit_age',
        exitAge: 'exit_age',
        waitingPeriodMonths: 'waiting_period_months',
        gracePeriodDays: 'grace_period_days',
        renewalPeriodMonths: 'renewal_period_months',
        monthlyPaymentDeadlineDays: 'monthly_payment_deadline_days',
        activationRequiredMonths: 'activation_required_months'
    };

    // Populate form fields
    Object.entries(fieldMap).forEach(([elementId, column]) => {
        const element = document.getElementById(elementId);
        if (!element) return;
        element.value = (plan && plan[column] != null) ? plan[column] : '';
    });

    // Set active status
    if (DOM.elements.planIsActive) {
        DOM.elements.planIsActive.checked = plan ? plan.is_active !== false : true;
    }

    modal.classList.add('open');
}

// ------------------------------------------------------------
// CLOSE PLAN MODAL
// ------------------------------------------------------------

function closePlanModal() {
    const modal = DOM.elements.planModal;
    if (modal) {
        modal.classList.remove('open');
    }
}

// ------------------------------------------------------------
// HANDLE PLAN FORM SUBMIT
// ------------------------------------------------------------

async function handlePlanFormSubmit(event) {
    event.preventDefault();

    const submitBtn = DOM.elements.planSubmitBtn;
    const planId = DOM.elements.planId.value.trim();

    clearMessages();

    // Validate required fields
    const planCode = getText('planCode');
    const planName = getText('planName');

    if (!planCode || !planName) {
        showError('Plan code and plan name are required.');
        return;
    }

    // Validate parent range
    const minParents = getNumber('minimumParents', 0);
    const maxParents = getNumber('maximumParents', 0);

    if (minParents > maxParents) {
        showError('Minimum parents cannot be greater than maximum parents.');
        return;
    }

    // Build payload
    const principalPremium = getNumber('principalMonthlyPremium', 0);
    const waitingMonths = getNumber('waitingPeriodMonths', 0);

    const payload = {
        plan_code: planCode,
        plan_name: planName,
        description: getText('planDescription') || null,
        principal_monthly_premium: principalPremium,
        parent_monthly_premium: getNumber('parentMonthlyPremium', 0),
        principal_registration_fee: getNumber('principalRegistrationFee', 0),
        dependant_registration_fee: getNumber('dependantRegistrationFee', 0),
        principal_benefit: getNumber('principalBenefit', null),
        dependant_benefit: getNumber('dependantBenefit', null),
        max_dependants: getNumber('maxDependants', null),
        minimum_parents: minParents,
        maximum_parents: maxParents,
        principal_entry_max_age: getNumber('principalEntryMaxAge', 70),
        principal_exit_age: getNumber('principalExitAge', 80),
        exit_age: getNumber('exitAge', 80),
        waiting_period_months: waitingMonths,
        waiting_period_days: waitingMonths * 30,
        grace_period_days: getNumber('gracePeriodDays', 0),
        renewal_period_months: getNumber('renewalPeriodMonths', 1),
        monthly_payment_deadline_days: getNumber('monthlyPaymentDeadlineDays', 10),
        activation_required_months: getNumber('activationRequiredMonths', 0),
        monthly_premium: principalPremium, // Legacy field
        registration_fee: getNumber('principalRegistrationFee', 0), // Legacy field
        is_active: DOM.elements.planIsActive ? DOM.elements.planIsActive.checked : true
    };

    // Set button loading state
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
        let response;

        if (planId) {
            response = await supabaseClient
                .from('plans')
                .update(payload)
                .eq('id', planId);
        } else {
            response = await supabaseClient
                .from('plans')
                .insert(payload);
        }

        if (response.error) throw response.error;

        showSuccess(planId ? 'Plan updated successfully.' : 'Plan created successfully.');
        await loadPlans();

        setTimeout(closePlanModal, 700);

    } catch (error) {
        console.error('Save plan error:', error);
        showError(`Could not save plan: ${error.message}`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

// ------------------------------------------------------------
// TOGGLE PLAN STATUS
// ------------------------------------------------------------

async function togglePlanStatus(plan, rowEl) {
    const nextStatus = !(plan.is_active !== false);
    const buttons = rowEl.querySelectorAll('button');
    disableButtons(buttons, true);

    try {
        const { error } = await supabaseClient
            .from('plans')
            .update({ is_active: nextStatus })
            .eq('id', plan.id);

        if (error) throw error;

        plan.is_active = nextStatus;
        rowEl.replaceWith(createPlanRow(plan));

    } catch (error) {
        console.error('Status update error:', error);
        disableButtons(buttons, false);
        alert(`Could not update plan status: ${error.message}`);
    }
}

// ------------------------------------------------------------
// DELETE PLAN
// ------------------------------------------------------------

async function deletePlan(plan, rowEl) {
    const name = plan.plan_name || plan.plan_code || 'this plan';
    
    if (!confirm(`Delete "${name}"?\n\nThis cannot be undone.`)) {
        return;
    }

    const buttons = rowEl.querySelectorAll('button');
    disableButtons(buttons, true);

    try {
        const { error } = await supabaseClient
            .from('plans')
            .delete()
            .eq('id', plan.id);

        if (error) throw error;

        rowEl.remove();
        state.plans = state.plans.filter(p => p.id !== plan.id);

        if (state.plans.length === 0) {
            document.getElementById('plansList').innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-tags"></i>
                    <p>No plans yet. Use "New Plan" to add one.</p>
                </div>
            `;
        }

    } catch (error) {
        console.error('Delete plan error:', error);
        disableButtons(buttons, false);
        alert(`Could not delete plan: ${error.message}`);
    }
}

// ------------------------------------------------------------
// HELPER FUNCTIONS
// ------------------------------------------------------------

function disableButtons(buttons, disabled) {
    buttons.forEach(button => {
        button.disabled = disabled;
    });
}

// ------------------------------------------------------------
// EXPOSE FUNCTIONS TO GLOBAL SCOPE
// ------------------------------------------------------------

window.openPlanModal = openPlanModal;
window.closePlanModal = closePlanModal;
window.loadPlans = loadPlans;
