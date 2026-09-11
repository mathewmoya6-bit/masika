// js/register.js
// ============================================================
// MASIKA BENEVOLENT - Registration Logic
// ============================================================

// ============================================================
// CONFIGURATION - Fallback only (used if Supabase AND backend fail)
// ============================================================
if (typeof CONFIG === 'undefined') {
    var CONFIG = {
        API: {
            BASE_URL: 'https://masika-c921.onrender.com/api'
        },
        PLANS: {
            COMFORT: {
                slug: 'comfort',
                name: 'Comfort Plan',
                description: 'Affordable individual membership protection.',
                registration_fee: 200,
                monthly_fee: 300,
                waiting_period_months: 4
            },
            DIGNITY: {
                slug: 'dignity',
                name: 'Dignity Plan',
                description: 'Enhanced membership protection with premium benefits.',
                registration_fee: 500,
                monthly_fee: 1000,
                waiting_period_months: 6
            },
            WAZAZI: {
                slug: 'wazazi',
                name: 'Wazazi Plan',
                description: 'Membership protection designed for parents and elders.',
                registration_fee: 200,
                monthly_fee: 650,
                waiting_period_months: 6
            }
        },
        WAZAZI_PARENT_FEE: 100,
        CHAMA_REGISTRATION_RATE: 100,
        MIN_CHAMA_MEMBERS: 30,
        MAX_DEPENDANTS: 10,
        ROUTES: {
            PAYMENT: 'payment.html'
        }
    };
}

// ============================================================
// SUPABASE CONFIG
// ============================================================
const SUPABASE_URL = 'https://wpxzlcdrirlcyvfiquld.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndweHpsY2RyaXJsY3l2ZmlxdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Mjc4MDcsImV4cCI6MjEwMzUwMzgwN30.OUP9pmPbrML_egpHflZtDfLv1_UDM37_BYjtb842xjg';

console.log('🚀 Register.js loaded');
console.log('📡 Supabase URL:', SUPABASE_URL);

// Initialize Supabase client
let supabaseClient = null;

// Cache plans loaded from Supabase (or fallbacks)
let allPlans = [];
// Chama rate read from plans table (or default)
let chamaRegistrationRate = CONFIG.CHAMA_REGISTRATION_RATE;

function initSupabase() {
    try {
        if (typeof supabase !== 'undefined') {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            console.log('✅ Supabase client initialized');
            return supabaseClient;
        } else {
            console.warn('⚠️ Supabase library not loaded');
            return null;
        }
    } catch (error) {
        console.error('❌ Failed to initialize Supabase:', error);
        return null;
    }
}

// ============================================================
// MAIN INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM loaded - Register page');

    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    initSupabase();
    initRegistration();
});

function initRegistration() {
    console.log('🔧 Initializing registration...');

    const form = document.getElementById('registrationForm');

    // IMPORTANT: load plans BEFORE anything else so summary + agent loads work
    loadPlans().then(() => {
        // After plans are loaded, refresh summary in case it changed
        updateSummary();
    });

    // Load agents from Supabase
    loadAgentsFromSupabase();

    // Setup plan selection
    setupPlanSelection();
    setupDependants();
    setupSummaryUpdates();
    setupModeSwitch();
    setupChamaUpload();

    // Form submission
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        await handleRegistration();
    });

    // Reset button
    document.getElementById('resetBtn').addEventListener('click', function() {
        form.reset();
        clearAlerts();
        document.getElementById('dependantsContainer').innerHTML = '';
        updateSummary();
    });

    // Chama form submission
    document.getElementById('chamaForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        await handleChamaRegistration();
    });

    document.getElementById('chamaResetBtn').addEventListener('click', function() {
        document.getElementById('chamaForm').reset();
        document.getElementById('csvPreview').classList.remove('show');
        document.getElementById('csvPreview').innerHTML = '';
        document.getElementById('csvCount').textContent = '';
        document.getElementById('chamaMemberCount').textContent = '0';
        document.getElementById('chamaTotal').textContent = 'KES 0';
        window.__parsedChamaMembers = [];
        clearAlerts();
    });
}

// ============================================================
// LOAD PLANS
// Priority:
//   1. Supabase `plans` table   ← admin-pricing writes here
//   2. Backend /api/public/plans
//   3. Hard-coded CONFIG.PLANS
// ============================================================
async function loadPlans() {
    const container = document.getElementById('plansContainer');
    if (!container) {
        console.error('❌ plansContainer not found');
        return;
    }

    let plans = [];

    // ---------------------------------------------------------
    // 1. Supabase plans table
    // ---------------------------------------------------------
    if (supabaseClient) {
        try {
            console.log('🔄 Loading plans from Supabase plans table...');

            const { data, error } = await supabaseClient
                .from('plans')
                .select('slug, name, description, registration_fee, monthly_fee, waiting_period_months, is_active')
                .order('registration_fee', { ascending: true });

            if (error) throw error;

            plans = (data || []).filter(p => p.is_active !== false);

            console.log(`✅ Loaded ${plans.length} plans from Supabase plans table`);

            // Read chama rate if a 'chama' slug exists
            const chamaPlan = (data || []).find(p => p.slug === 'chama');
            if (chamaPlan && chamaPlan.registration_fee) {
                chamaRegistrationRate = Number(chamaPlan.registration_fee);
                console.log(`✅ Chama rate set to ${chamaRegistrationRate}`);

                // Update the display in the chama form
                const chamaRateEl = document.getElementById('chamaRateDisplay');
                if (chamaRateEl) {
                    chamaRateEl.textContent = `KES ${chamaRegistrationRate.toLocaleString()} per member`;
                }
            }

        } catch (sbError) {
            console.warn('⚠️ Supabase plans load failed:', sbError);
        }
    }

    // ---------------------------------------------------------
    // 2. Backend API
    // ---------------------------------------------------------
    if (plans.length === 0) {
        try {
            const response = await fetch(`${CONFIG.API.BASE_URL}/public/plans`);
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    plans = data;
                    console.log(`✅ Loaded ${plans.length} plans from backend API`);
                }
            }
        } catch (apiError) {
            console.warn('⚠️ Backend plans load failed:', apiError);
        }
    }

    // ---------------------------------------------------------
    // 3. Hard-coded fallback
    // ---------------------------------------------------------
    if (plans.length === 0) {
        plans = Object.values(CONFIG.PLANS);
        console.warn('⚠️ Using hard-coded plan fallback');
    }

    // Cache the loaded plans
    allPlans = plans;

    renderPlans(plans);
}

function renderPlans(plans) {
    const container = document.getElementById('plansContainer');
    if (!container) return;

    if (!plans || plans.length === 0) {
        container.innerHTML = `<div class="help-text">No active plans are currently available.</div>`;
        return;
    }

    container.innerHTML = plans.map((plan, index) => {
        const slug = plan.slug || plan.plan_type || 'plan';
        const name = plan.name || plan.plan_name || 'Plan';
        const description = plan.description || '';
        const registrationFee = Number(plan.registration_fee || 0);
        const monthlyFee = Number(plan.monthly_fee || 0);

        // Escape JSON for the data attribute
        const planJson = String(JSON.stringify({ ...plan, slug }))
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        return `
            <div class="plan-option">
                <input
                    type="radio"
                    name="plan_type"
                    value="${slug}"
                    id="plan_${index}"
                    ${index === 0 ? 'checked' : ''}
                    data-plan="${planJson}"
                >
                <label for="plan_${index}" class="plan-label">
                    <div class="plan-name">${name}</div>
                    <div class="plan-description">${description}</div>
                    <div class="plan-price">
                        KES ${registrationFee.toLocaleString()}
                        <small>one-time registration</small>
                        <br>
                        <small>KES ${monthlyFee.toLocaleString()}/month</small>
                    </div>
                </label>
            </div>
        `;
    }).join('');

    // Add change listeners
    document.querySelectorAll('input[name="plan_type"]').forEach(input => {
        input.addEventListener('change', function() {
            updateSummary();
            updateDependantEligibility(this.value);
        });
    });

    // Select first plan and update
    const firstPlan = container.querySelector('input[name="plan_type"]');
    if (firstPlan) {
        firstPlan.checked = true;
        updateDependantEligibility(firstPlan.value);
        updateSummary();
    }
}

// ============================================================
// LOAD AGENTS - From Supabase sales_agents table
// Displays: sales_code - Full Name (phone removed)
// ============================================================
async function loadAgentsFromSupabase() {
    const select = document.getElementById('salesCode');
    if (!select) {
        console.warn('⚠️ Sales code select element not found');
        return;
    }

    select.innerHTML = '<option value="">Loading agents...</option>';

    const client = supabaseClient;

    if (!client) {
        console.warn('⚠️ Supabase client not available. Trying to initialize...');
        const newClient = initSupabase();
        if (newClient) {
            setTimeout(() => loadAgentsFromSupabase(), 500);
            return;
        }
        select.innerHTML = '<option value="">Supabase not available</option>';
        return;
    }

    try {
        console.log('🔄 Loading sales agents from sales_agents...');

        const { data, error } = await client
            .from("sales_agents")
            .select("sales_code, full_name, status")
            .ilike("status", "active")
            .order("full_name", { ascending: true });

        if (error) {
            console.error('❌ Supabase query error:', error);
            throw error;
        }

        if (!data || data.length === 0) {
            console.log('ℹ️ No active sales agents found');
            select.innerHTML = '<option value="">No sales agents available</option>';
            return;
        }

        console.log(`✅ Loaded ${data.length} sales agents`);

        select.innerHTML = '<option value="">Select sales agent</option>';

        data.forEach(agent => {
            if (!agent.sales_code) return;

            const option = document.createElement('option');
            option.value = String(agent.sales_code).trim();

            // Display: sales_code - Full Name (NO phone)
            option.textContent = `${agent.sales_code} - ${agent.full_name || 'Agent'}`;
            select.appendChild(option);
        });

    } catch (error) {
        console.error('❌ Unable to load sales agents from Supabase:', error);
        select.innerHTML = '<option value="">Error loading agents</option>';
        showAlert('Failed to load sales agents. Please refresh the page.', 'warning');
    }
}

// ============================================================
// PLAN SELECTION
// ============================================================
function setupPlanSelection() {
    document.querySelectorAll('input[name="plan_type"]').forEach(input => {
        input.addEventListener('change', function() {
            updateSummary();
        });
    });
}

// ============================================================
// DEPENDANTS
// ============================================================
function setupDependants() {
    document.getElementById('addDependantBtn').addEventListener('click', function() {
        addDependant();
    });
}

function addDependant() {
    const container = document.getElementById('dependantsContainer');
    const count = container.querySelectorAll('.dependant-card').length + 1;

    if (count > CONFIG.MAX_DEPENDANTS) {
        showAlert(`A maximum of ${CONFIG.MAX_DEPENDANTS} dependants can be entered.`, 'warning');
        return;
    }

    const card = document.createElement('div');
    card.className = 'dependant-card';
    card.dataset.index = count;

    card.innerHTML = `
        <div class="dependant-header">
            <strong>Dependant #${count}</strong>
            <button type="button" class="remove-dependant" onclick="removeDependant(this)">
                × Remove
            </button>
        </div>
        <div class="form-grid">
            <div class="form-group">
                <label>First Name <span class="required">*</span></label>
                <input type="text" name="dep_first_name_${count}" required>
            </div>
            <div class="form-group">
                <label>Last Name <span class="required">*</span></label>
                <input type="text" name="dep_last_name_${count}" required>
            </div>
            <div class="form-group">
                <label>Relationship <span class="required">*</span></label>
                <select name="dep_relationship_${count}" required>
                    <option value="">Select</option>
                    <option value="SPOUSE">Spouse</option>
                    <option value="CHILD">Child</option>
                    <option value="PARENT">Parent</option>
                </select>
            </div>
            <div class="form-group">
                <label>Date of Birth <span class="required">*</span></label>
                <input type="date" name="dep_dob_${count}" required>
            </div>
            <div class="form-group">
                <label>Phone</label>
                <input type="tel" name="dep_phone_${count}" placeholder="Optional">
            </div>
        </div>
    `;

    container.appendChild(card);

    card.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('change', updateSummary);
        el.addEventListener('input', updateSummary);
    });

    updateSummary();
}

function removeDependant(btn) {
    const card = btn.closest('.dependant-card');
    if (!card) return;
    const container = document.getElementById('dependantsContainer');
    card.remove();

    container.querySelectorAll('.dependant-card').forEach((el, i) => {
        el.dataset.index = i + 1;
        el.querySelector('.dependant-header strong').textContent = `Dependant #${i + 1}`;
    });

    updateSummary();
}

// ============================================================
// SUMMARY UPDATES
// ============================================================
function setupSummaryUpdates() {
    document.querySelectorAll('#registrationForm input, #registrationForm select, #registrationForm textarea')
        .forEach(el => {
            el.addEventListener('change', updateSummary);
            el.addEventListener('input', updateSummary);
        });

    updateSummary();
}

// ------------------------------------------------------------
// getSelectedPlan()
// Reads the selected radio button's data-plan attribute, which
// holds the FULL plan object (with the price from Supabase).
// Falls back to CONFIG.PLANS only if the data attribute is missing.
// ------------------------------------------------------------
function getSelectedPlan() {
    const planInput = document.querySelector('input[name="plan_type"]:checked');
    const planSlug = planInput ? planInput.value : 'comfort';

    // Try to read the plan from the radio's data attribute
    if (planInput && planInput.dataset && planInput.dataset.plan) {
        try {
            const planFromAttr = JSON.parse(
                planInput.dataset.plan
                    .replace(/&quot;/g, '"')
                    .replace(/&#039;/g, "'")
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
            );

            if (planFromAttr && planFromAttr.slug) {
                return { slug: planSlug, plan: planFromAttr };
            }
        } catch (e) {
            console.warn('Could not parse plan data attribute:', e);
        }
    }

    // Fallback: hard-coded config
    const planKey = Object.keys(CONFIG.PLANS).find(key =>
        CONFIG.PLANS[key].slug === planSlug
    );

    const plan = planKey ? CONFIG.PLANS[planKey] : CONFIG.PLANS.COMFORT;
    return { slug: planSlug, plan };
}

function countParentDependants() {
    let count = 0;
    document.querySelectorAll('.dependant-card').forEach((card, index) => {
        const num = index + 1;
        const rel = document.querySelector(`[name="dep_relationship_${num}"]`)?.value || '';
        if (rel === 'PARENT') count++;
    });
    return count;
}

function updateSummary() {
    const { slug: planSlug, plan } = getSelectedPlan();

    const registrationFee = Number(plan.registration_fee || 0);

    // Dependants are free except parents on the Wazazi plan
    let dependantFee = 0;
    if (planSlug === 'wazazi') {
        dependantFee = countParentDependants() * CONFIG.WAZAZI_PARENT_FEE;
    }

    const total = registrationFee + dependantFee;

    const planEl = document.getElementById('summaryPlan');
    if (planEl) planEl.textContent = plan.name || 'Plan';

    const principalEl = document.getElementById('summaryPrincipal');
    if (principalEl) principalEl.textContent = `KES ${registrationFee.toLocaleString()}`;

    const depEl = document.getElementById('summaryDependants');
    if (depEl) depEl.textContent = `KES ${dependantFee.toLocaleString()}`;

    const totalEl = document.getElementById('summaryTotal');
    if (totalEl) totalEl.textContent = `KES ${total.toLocaleString()}`;
}

function updateDependantEligibility(planSlug) {
    const helpText = document.getElementById('planHelp');
    if (!helpText) return;

    if (planSlug === 'wazazi') {
        helpText.textContent = 'Wazazi Plan: add up to 4 parents (KES 100 registration fee per parent).';
    } else if (planSlug === 'dignity') {
        helpText.textContent = 'Dignity Plan: covers spouse and children under 18, at no extra registration cost.';
    } else {
        helpText.textContent = 'Comfort Plan: covers spouse and up to 4 children under 18, at no extra registration cost.';
    }
}

// ============================================================
// MODE SWITCH
// ============================================================
function setupModeSwitch() {
    const individualBtn = document.getElementById('individualModeBtn');
    const chamaBtn = document.getElementById('chamaModeBtn');
    const individualForm = document.getElementById('registrationForm');
    const chamaSection = document.getElementById('chamaSection');

    individualBtn.addEventListener('click', function() {
        this.classList.add('active');
        chamaBtn.classList.remove('active');
        individualForm.style.display = 'block';
        chamaSection.classList.remove('show');
        chamaSection.style.display = 'none';
        clearAlerts();
    });

    chamaBtn.addEventListener('click', function() {
        this.classList.add('active');
        individualBtn.classList.remove('active');
        individualForm.style.display = 'none';
        chamaSection.classList.add('show');
        chamaSection.style.display = 'block';
        clearAlerts();
    });
}

// ============================================================
// CHAMA UPLOAD
// ============================================================
function setupChamaUpload() {
    const fileInput = document.getElementById('chamaCsv');
    window.__parsedChamaMembers = [];

    fileInput.addEventListener('change', function(e) {
        const file = this.files[0];
        if (!file) return;

        if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
            showAlert('Please upload a CSV file.', 'error');
            this.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = function(event) {
            const csv = event.target.result;
            const result = Papa.parse(csv, {
                header: true,
                skipEmptyLines: true,
                trimHeaders: true
            });

            if (result.errors.length > 0) {
                showAlert('Error parsing CSV: ' + result.errors[0].message, 'error');
                return;
            }

            window.__parsedChamaMembers = result.data;
            displayCsvPreview(window.__parsedChamaMembers);

            document.getElementById('chamaMemberCount').textContent = window.__parsedChamaMembers.length;
            document.getElementById('chamaTotal').textContent =
                `KES ${(window.__parsedChamaMembers.length * chamaRegistrationRate).toLocaleString()}`;

            showAlert(`Successfully loaded ${window.__parsedChamaMembers.length} members.`, 'success');
        };
        reader.readAsText(file);
    });
}

function displayCsvPreview(data) {
    const preview = document.getElementById('csvPreview');
    const container = document.getElementById('csvCount');

    if (!data || data.length === 0) {
        preview.classList.remove('show');
        preview.innerHTML = '';
        container.textContent = '';
        return;
    }

    const headers = Object.keys(data[0]);
    let html = '<table><thead><tr>';
    headers.forEach(h => {
        html += `<th>${h}</th>`;
    });
    html += '</tr></thead><tbody>';

    const previewRows = data.slice(0, 5);
    previewRows.forEach(row => {
        html += '<tr>';
        headers.forEach(h => {
            html += `<td>${row[h] || ''}</td>`;
        });
        html += '</tr>';
    });

    if (data.length > 5) {
        html += `<tr><td colspan="${headers.length}" style="text-align:center;font-weight:700;">
            ... and ${data.length - 5} more rows
        </td></tr>`;
    }

    html += '</tbody></table>';
    preview.innerHTML = html;
    preview.classList.add('show');
    container.textContent = `Total members: ${data.length}`;
}

// ============================================================
// PHONE NORMALIZATION
// ============================================================
function normalizePhone(value) {
    let v = String(value || '').trim().replace(/\s+/g, '').replace(/-/g, '');
    if (!v) return '';
    if (v.startsWith('+254')) v = v.substring(1);
    else if (v.startsWith('0')) v = '254' + v.substring(1);
    else if (/^[17]/.test(v) && v.length === 9) v = '254' + v;
    return v;
}

// ============================================================
// HANDLE REGISTRATION
// ============================================================
async function handleRegistration() {
    const loadingBox = document.getElementById('loadingBox');
    const submitBtn = document.getElementById('submitBtn');

    const formData = getFormData();
    const validation = validateFormData(formData);

    if (!validation.valid) {
        showAlert(validation.error, 'error');
        return;
    }

    loadingBox.classList.add('show');
    submitBtn.disabled = true;
    clearAlerts();

    try {
        const response = await fetch(`${CONFIG.API.BASE_URL}/public/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            const detail = Array.isArray(result.detail)
                ? result.detail.map(d => d.msg).join(' | ')
                : (result.detail || result.message);
            throw new Error(detail || 'Registration failed');
        }

        const memberId = result.member_id;
        if (!memberId) {
            throw new Error('Registration succeeded but no member ID was returned.');
        }

        // Compute amount — trust backend, fall back to frontend
        const { plan } = getSelectedPlan();
        const frontendPrincipal = Number(plan.registration_fee || 0);
        const parentCount = formData.dependants.filter(d => d.relationship === 'PARENT').length;
        const frontendDependantFee = formData.plan === 'wazazi' ? parentCount * CONFIG.WAZAZI_PARENT_FEE : 0;
        const frontendTotal = frontendPrincipal + frontendDependantFee;

        const registrationAmount = Number(
            result.registration_amount ??
            result.amount ??
            frontendTotal
        );

        showAlert('Registration successful! Redirecting to payment...', 'success');

        // Store data for payment page
        sessionStorage.removeItem('newChamaGroupId');
        sessionStorage.setItem('newMemberId', String(memberId));
        if (result.member_number) sessionStorage.setItem('newMemberNumber', String(result.member_number));
        sessionStorage.setItem('newMemberName', `${formData.first_name} ${formData.last_name}`.trim());
        sessionStorage.setItem('newMemberPhone', formData.phone);
        sessionStorage.setItem('registrationAmount', String(registrationAmount));
        sessionStorage.setItem('isChamaRegistration', 'false');
        sessionStorage.setItem('newPlanSlug', formData.plan); // ← payment.html can use this

        if (formData.sales_code) {
            sessionStorage.setItem('newSalesCode', formData.sales_code);
        }

        setTimeout(() => {
            window.location.href = `${CONFIG.ROUTES.PAYMENT}?member_id=${encodeURIComponent(memberId)}`;
        }, 1200);

    } catch (error) {
        console.error('Registration error:', error);
        showAlert(error.message || 'Registration failed. Please try again.', 'error');
    } finally {
        loadingBox.classList.remove('show');
        submitBtn.disabled = false;
    }
}

function getFormData() {
    const { slug: planSlug } = getSelectedPlan();

    const dependantCards = document.querySelectorAll('.dependant-card');
    const dependants = [];
    dependantCards.forEach((card, index) => {
        const num = index + 1;
        dependants.push({
            first_name: document.querySelector(`[name="dep_first_name_${num}"]`)?.value.trim() || '',
            last_name: document.querySelector(`[name="dep_last_name_${num}"]`)?.value.trim() || '',
            relationship: document.querySelector(`[name="dep_relationship_${num}"]`)?.value || '',
            date_of_birth: document.querySelector(`[name="dep_dob_${num}"]`)?.value || '',
            phone: normalizePhone(document.querySelector(`[name="dep_phone_${num}"]`)?.value || '') || null
        });
    });

    const salesCodeSelect = document.getElementById('salesCode');
    const salesCode = salesCodeSelect ? salesCodeSelect.value : null;

    return {
        first_name: document.getElementById('firstName').value.trim(),
        last_name: document.getElementById('lastName').value.trim(),
        other_name: document.getElementById('otherName').value.trim() || null,
        id_number: document.getElementById('idNumber').value.trim(),
        date_of_birth: document.getElementById('dateOfBirth').value,
        gender: document.getElementById('gender').value,
        phone: normalizePhone(document.getElementById('phone').value),
        alternative_phone: normalizePhone(document.getElementById('alternativePhone').value) || null,
        email: document.getElementById('email').value.trim() || null,
        county: document.getElementById('county').value,
        location: document.getElementById('location').value.trim() || null,
        town: document.getElementById('town').value.trim() || null,
        address: document.getElementById('address').value.trim() || null,
        plan: planSlug,
        sales_code: salesCode,
        benefit_option: document.getElementById('benefitOption').value,
        dependants: dependants
    };
}

function validateFormData(data) {
    const required = ['first_name', 'last_name', 'id_number', 'date_of_birth', 'gender', 'phone', 'county', 'benefit_option'];

    for (const field of required) {
        if (!data[field] || String(data[field]).trim() === '') {
            return { valid: false, error: `Please fill in ${field.replace(/_/g, ' ')}` };
        }
    }

    if (!/^254[17]\d{8}$/.test(data.phone)) {
        return { valid: false, error: 'Please enter a valid Kenyan phone number (e.g. 07XXXXXXXX).' };
    }

    if (data.id_number.length < 5) {
        return { valid: false, error: 'Please enter a valid ID number' };
    }

    const birthDate = new Date(data.date_of_birth);
    const age = new Date().getFullYear() - birthDate.getFullYear();
    if (age < 1 || age > 80) {
        return { valid: false, error: 'Age must be between 1 and 80 years' };
    }

    const parents = data.dependants.filter(d => d.relationship === 'PARENT');
    if (data.plan !== 'wazazi' && parents.length > 0) {
        return { valid: false, error: 'Parent dependants require the Wazazi plan.' };
    }
    if (data.plan === 'wazazi' && parents.length > 4) {
        return { valid: false, error: 'Wazazi allows a maximum of four parents.' };
    }

    for (let i = 0; i < data.dependants.length; i++) {
        const d = data.dependants[i];
        const num = i + 1;
        if (!d.first_name || !d.last_name) return { valid: false, error: `Please complete the name for dependant ${num}.` };
        if (!d.relationship) return { valid: false, error: `Please select a relationship for dependant ${num}.` };
        if (!d.date_of_birth) return { valid: false, error: `Please enter a date of birth for dependant ${num}.` };
    }

    return { valid: true };
}

// ============================================================
// HANDLE CHAMA REGISTRATION
// ============================================================
async function handleChamaRegistration() {
    const loadingBox = document.getElementById('loadingBox');
    const submitBtn = document.getElementById('chamaSubmitBtn');

    const chamaName = document.getElementById('chamaName').value.trim();
    const chamaPhone = normalizePhone(document.getElementById('chamaPhone').value);

    const chairperson = {
        name: document.getElementById('chairpersonName').value.trim(),
        phone: normalizePhone(document.getElementById('chairpersonPhone').value),
        id_number: document.getElementById('chairpersonId').value.trim()
    };
    const treasurer = {
        name: document.getElementById('treasurerName').value.trim(),
        phone: normalizePhone(document.getElementById('treasurerPhone').value),
        id_number: document.getElementById('treasurerId').value.trim()
    };
    const secretary = {
        name: document.getElementById('secretaryName').value.trim(),
        phone: normalizePhone(document.getElementById('secretaryPhone').value),
        id_number: document.getElementById('secretaryId').value.trim()
    };

    if (!chamaName) return showAlert('Please enter the chama/group name.', 'error');
    if (!/^254[17]\d{8}$/.test(chamaPhone)) return showAlert('Please enter a valid group contact phone.', 'error');

    for (const [label, official] of [['Chairperson', chairperson], ['Treasurer', treasurer], ['Secretary', secretary]]) {
        if (!official.name) return showAlert(`${label} name is required.`, 'error');
        if (!/^254[17]\d{8}$/.test(official.phone)) return showAlert(`${label} phone number is invalid.`, 'error');
        if (!official.id_number) return showAlert(`${label} ID is required.`, 'error');
    }

    const members = window.__parsedChamaMembers || [];
    if (members.length < CONFIG.MIN_CHAMA_MEMBERS) {
        return showAlert(`Minimum ${CONFIG.MIN_CHAMA_MEMBERS} members required. Currently ${members.length}.`, 'error');
    }

    const normalizedMembers = members.map(m => ({
        first_name: (m.first_name || '').trim(),
        last_name: (m.last_name || '').trim(),
        phone: normalizePhone(m.phone),
        id_number: (m.id_number || '').trim(),
        date_of_birth: (m.date_of_birth || '').trim(),
        gender: (m.gender || '').trim().toUpperCase()
    }));

    loadingBox.classList.add('show');
    submitBtn.disabled = true;
    clearAlerts();

    try {
        const payload = {
            group_name: chamaName,
            phone: chamaPhone,
            chairperson,
            treasurer,
            secretary,
            members: normalizedMembers
        };

        const response = await fetch(`${CONFIG.API.BASE_URL}/public/register/chama`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            const detail = Array.isArray(result.detail)
                ? result.detail.map(d => d.msg).join(' | ')
                : (result.detail || result.message);
            throw new Error(detail || 'Chama registration failed');
        }

        const groupId = result.group_id;
        if (!groupId) {
            throw new Error('Chama registration succeeded but no group ID was returned.');
        }

        // Use the configurable chama rate
        const totalAmount = Number(
            result.registration_amount ??
            result.amount ??
            (normalizedMembers.length * chamaRegistrationRate)
        );

        sessionStorage.removeItem('newMemberId');
        sessionStorage.setItem('newChamaGroupId', String(groupId));
        sessionStorage.setItem('newChamaGroupName', chamaName);
        sessionStorage.setItem('newChamaMemberCount', String(normalizedMembers.length));
        sessionStorage.setItem('newChamaPhone', chamaPhone);
        sessionStorage.setItem('registrationAmount', String(totalAmount));
        sessionStorage.setItem('isChamaRegistration', 'true');

        showAlert(`Chama registration successful! ${normalizedMembers.length} members loaded. Redirecting to payment...`, 'success');

        setTimeout(() => {
            window.location.href = `${CONFIG.ROUTES.PAYMENT}?group_id=${encodeURIComponent(groupId)}`;
        }, 1200);

    } catch (error) {
        console.error('Chama registration error:', error);
        showAlert(error.message || 'Chama registration failed.', 'error');
    } finally {
        loadingBox.classList.remove('show');
        submitBtn.disabled = false;
    }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function showAlert(message, type = 'info') {
    const alertBox = document.getElementById('alertBox');
    alertBox.className = `alert show ${type}`;
    alertBox.textContent = message;
    alertBox.style.display = 'block';
}

function clearAlerts() {
    const alertBox = document.getElementById('alertBox');
    alertBox.className = 'alert';
    alertBox.textContent = '';
    alertBox.style.display = 'none';
}

// ============================================================
// EXPOSE FUNCTIONS (for inline onclick handlers)
// ============================================================
window.removeDependant = removeDependant;
window.addDependant = addDependant;
window.updateSummary = updateSummary;
window.showAlert = showAlert;
window.clearAlerts = clearAlerts;
window.loadPlans = loadPlans;
window.loadAgentsFromSupabase = loadAgentsFromSupabase;
window.initRegistration = initRegistration;
window.normalizePhone = normalizePhone;
window.initSupabase = initSupabase;
window.supabaseClient = supabaseClient;

console.log('✅ Register.js fully loaded');
console.log('📌 Plans are loaded from Supabase plans table (admin-pricing)');
console.log('📌 Sales agents are loaded from sales_agents table');
console.log('📌 Chama rate is read from plans table (slug = chama)');
