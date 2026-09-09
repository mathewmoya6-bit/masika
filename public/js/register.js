// ============================================================
// REGISTER - js/register.js
// Fixed version
// ============================================================

// ============================================================
// CONFIGURATION - Fallback if not loaded from config.js
// Fee values below mirror exactly what the backend's
// GET /api/public/plans returns (and what POST /api/public/register
// actually charges) so the on-page summary never disagrees with
// what the server bills.
// ============================================================
if (typeof CONFIG === 'undefined') {
    var CONFIG = {
        PLANS: {
            COMFORT: {
                slug: "comfort",
                name: "Comfort Plan",
                description: "Affordable individual membership protection for you and your family.",
                registration_fee: 200,
                monthly_fee: 300,
                waiting_period_months: 4
            },
            DIGNITY: {
                slug: "dignity",
                name: "Dignity Plan",
                description: "Enhanced membership protection with premium benefits for your entire family.",
                registration_fee: 500,
                monthly_fee: 1000,
                waiting_period_months: 6
            },
            WAZAZI: {
                slug: "wazazi",
                name: "Wazazi Plan",
                description: "Membership protection specifically designed for parents and elders.",
                registration_fee: 200,
                monthly_fee: 650,
                waiting_period_months: 6
            }
        },
        // Per-parent surcharge the backend adds for the Wazazi plan only.
        // Comfort/Dignity dependants are free at registration.
        WAZAZI_PARENT_FEE: 100,
        ROUTES: {
            LOGIN: 'login.html',
            DASHBOARD: 'dashboard.html',
            PAYMENT: 'payment.html'
        },
        API: {
            BASE_URL: 'https://masika-c921.onrender.com/api'
        }
    };
}

// ============================================================
// MAIN INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    // Set footer year here (was previously run unguarded at the bottom of
    // this file; if the script isn't loaded with `defer`, that line could
    // throw before the DOM existed and silently skip every statement after
    // it, including the window.* exports the inline onclick handlers need).
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Check if already logged in
    if (typeof authManager !== 'undefined' && authManager.isAuthenticated) {
        window.location.href = CONFIG.ROUTES.DASHBOARD;
        return;
    }

    // Initialize registration
    initRegistration();
});

function initRegistration() {
    console.log('Initializing registration...');

    const form = document.getElementById('registrationForm');

    // Load plans
    loadPlans();

    // Load agents
    loadAgents();

    // Setup plan selection
    setupPlanSelection();

    // Setup dependants (no dependant is pre-added; most registrants,
    // especially Comfort/Dignity members, add none)
    setupDependants();

    // Setup summary updates
    setupSummaryUpdates();

    // Setup mode switch
    setupModeSwitch();

    // Setup CSV upload for chama
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
// LOAD PLANS - From CONFIG directly
// ============================================================
function loadPlans() {
    try {
        const container = document.getElementById('plansContainer');

        if (!container) {
            console.error('plansContainer not found');
            return;
        }

        const plans = CONFIG.PLANS;

        if (!plans || typeof plans !== 'object') {
            throw new Error('CONFIG.PLANS is missing or invalid');
        }

        container.innerHTML = '';

        Object.entries(plans).forEach(([key, plan]) => {
            const slug = plan.slug || key.toLowerCase();

            const div = document.createElement('div');
            div.className = 'plan-option';

            div.innerHTML = `
                <input
                    type="radio"
                    name="plan_type"
                    value="${slug}"
                    id="plan_${slug}"
                >
                <label for="plan_${slug}" class="plan-label">
                    <div class="plan-name">${plan.name || key}</div>
                    <div class="plan-description">${plan.description || ''}</div>
                    <div class="plan-price">
                        KES ${Number(plan.registration_fee || 0).toLocaleString()}
                        <small>one-time registration</small>
                        <br>
                        <small>KES ${Number(plan.monthly_fee || 0).toLocaleString()}/month</small>
                    </div>
                </label>
            `;

            container.appendChild(div);
        });

        // Add event listeners for plan selection
        document.querySelectorAll('input[name="plan_type"]').forEach(input => {
            input.addEventListener('change', function() {
                updateSummary();
                updateDependantEligibility(this.value);
            });
        });

        // Select first plan by default
        const firstPlan = container.querySelector('input[name="plan_type"]');
        if (firstPlan) {
            firstPlan.checked = true;
            updateDependantEligibility(firstPlan.value);
            updateSummary();
        }

        console.log('Plans loaded successfully from config');

    } catch (error) {
        console.error('Error loading plans:', error);

        const container = document.getElementById('plansContainer');
        if (container) {
            container.innerHTML = `
                <div class="help-text" style="color:#b91c1c;">
                    Unable to load membership plans. Please refresh the page.
                </div>
            `;
        }
        showAlert('Failed to load plans. Please refresh.', 'error');
    }
}

// ============================================================
// LOAD AGENTS - From API only. No fabricated fallback agents:
// this field feeds a real payment record, so injecting made-up
// names/codes when the API is unreachable or genuinely has no
// agents configured would let someone submit a sales_code that
// doesn't correspond to any real agent. Sales agent is optional,
// so an empty/unreachable result just leaves the default option.
// ============================================================
async function loadAgents() {
    const select = document.getElementById('salesCode');
    if (!select) return;

    select.innerHTML = '<option value="">Select sales agent</option>';

    try {
        const response = await fetch(`${CONFIG.API.BASE_URL}/public/agents`);
        if (!response.ok) {
            console.warn(`Agents request failed: HTTP ${response.status}`);
            return;
        }
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) {
            console.log('No sales agents currently available.');
            return;
        }
        data.forEach(agent => {
            const option = document.createElement('option');
            option.value = agent.agent_code || agent.id || '';
            const label = agent.full_name || agent.name || agent.agent_code || 'Agent';
            option.textContent = agent.phone ? `${label} (${agent.phone})` : label;
            select.appendChild(option);
        });
    } catch (error) {
        console.warn('Unable to load sales agents:', error);
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
// Dependants are optional: no card is pre-added, and there is no
// enforced minimum. Forcing a required dependant card on every
// registration (as before) blocked Comfort/Dignity members with
// no dependants from ever submitting the form.
// ============================================================
function setupDependants() {
    document.getElementById('addDependantBtn').addEventListener('click', function() {
        addDependant();
    });
}

function addDependant() {
    const container = document.getElementById('dependantsContainer');
    const count = container.querySelectorAll('.dependant-card').length + 1;

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
                    <option value="spouse">Spouse</option>
                    <option value="child">Child</option>
                    <option value="parent">Parent</option>
                    <option value="in_law">In-Law</option>
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

    // Add change listeners for summary update
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
    // Re-index remaining cards
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

function getSelectedPlan() {
    const planInput = document.querySelector('input[name="plan_type"]:checked');
    const planSlug = planInput ? planInput.value : 'comfort';
    const plan = CONFIG.PLANS[planSlug.toUpperCase()] || CONFIG.PLANS.COMFORT;
    return { slug: planSlug, plan };
}

function countParentDependants() {
    let count = 0;
    document.querySelectorAll('.dependant-card').forEach((card, index) => {
        const num = index + 1;
        const rel = document.querySelector(`[name="dep_relationship_${num}"]`)?.value || '';
        if (rel === 'parent') count++;
    });
    return count;
}

function updateSummary() {
    const { slug: planSlug, plan } = getSelectedPlan();

    const registrationFee = Number(plan.registration_fee || 0);

    // Dependants are free except parents on the Wazazi plan, matching the
    // backend's public_register() logic exactly.
    let dependantFee = 0;
    if (planSlug === 'wazazi') {
        dependantFee = countParentDependants() * CONFIG.WAZAZI_PARENT_FEE;
    }

    const total = registrationFee + dependantFee;

    document.getElementById('summaryPlan').textContent = plan.name || 'Plan';
    document.getElementById('summaryPrincipal').textContent = `KES ${registrationFee.toLocaleString()}`;
    document.getElementById('summaryDependants').textContent = `KES ${dependantFee.toLocaleString()}`;
    document.getElementById('summaryTotal').textContent = `KES ${total.toLocaleString()}`;

    const regFeeEl = document.getElementById('registrationFee');
    const depFeeEl = document.getElementById('dependantFee');
    const totalEl = document.getElementById('totalAmount');

    if (regFeeEl) regFeeEl.value = registrationFee;
    if (depFeeEl) depFeeEl.value = dependantFee;
    if (totalEl) totalEl.value = total;
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
                `KES ${(window.__parsedChamaMembers.length * 100).toLocaleString()}`;

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
// The backend's STK push step strictly requires 2547XXXXXXXX /
// 2541XXXXXXXX format. Normalizing here means the number saved at
// registration is already in the shape payment.html will need.
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
// HANDLE REGISTRATION - Uses the PUBLIC backend endpoint.
// (Previously posted to /api/auth/register, the internal/staff
// endpoint, whose response has no registration_amount and isn't
// what payment.html expects. The public flow is /api/public/register.)
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
            throw new Error('Registration succeeded but no member ID was returned by the server.');
        }

        showAlert('Registration successful! Redirecting to payment...', 'success');

        // Store what payment.html needs, matching the contract used across
        // the rest of the site (sessionStorage keys + ?member_id= param).
        sessionStorage.removeItem('newChamaGroupId');
        sessionStorage.setItem('newMemberId', String(memberId));
        if (result.member_number) sessionStorage.setItem('newMemberNumber', String(result.member_number));
        sessionStorage.setItem('newMemberName', `${formData.first_name} ${formData.last_name}`.trim());
        sessionStorage.setItem('newMemberPhone', formData.phone);
        sessionStorage.setItem('registrationAmount', String(result.registration_amount ?? 0));
        sessionStorage.setItem('isChamaRegistration', 'false');

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
        sales_code: document.getElementById('salesCode').value || null,
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

    const parents = data.dependants.filter(d => d.relationship === 'parent');
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
// CHAMA REGISTRATION - Now actually calls the backend
// (POST /api/public/register/chama) instead of only storing the
// parsed CSV to localStorage and redirecting with no group ID.
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
    if (members.length < 30) {
        return showAlert(`Minimum 30 members required for chama registration. Currently ${members.length}.`, 'error');
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

        sessionStorage.removeItem('newMemberId');
        sessionStorage.setItem('newChamaGroupId', String(groupId));
        sessionStorage.setItem('newChamaGroupName', chamaName);
        sessionStorage.setItem('newChamaMemberCount', String(normalizedMembers.length));
        sessionStorage.setItem('newChamaPhone', chamaPhone);
        sessionStorage.setItem('registrationAmount', String(result.registration_amount ?? normalizedMembers.length * 100));
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
// EXPOSE FUNCTIONS (inline onclick="removeDependant(this)" needs this)
// ============================================================
window.removeDependant = removeDependant;
window.addDependant = addDependant;
window.updateSummary = updateSummary;
window.showAlert = showAlert;
window.clearAlerts = clearAlerts;
window.loadPlans = loadPlans;
window.loadAgents = loadAgents;
window.initRegistration = initRegistration;
