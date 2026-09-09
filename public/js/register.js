// ============================================================
// REGISTER - js/register.js
// Complete fixed version
// ============================================================

// ============================================================
// CONFIGURATION - Fallback if not loaded from config.js
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
                registration_fee: 300,
                monthly_fee: 1000,
                waiting_period_months: 6
            },
            WAZAZI: {
                slug: "wazazi",
                name: "Wazazi Plan",
                description: "Membership protection specifically designed for parents and elders.",
                registration_fee: 250,
                monthly_fee: 350,
                waiting_period_months: 6
            }
        },
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
    // Check if already logged in
    if (typeof authManager !== 'undefined' && authManager.isAuthenticated) {
        window.location.href = CONFIG.ROUTES.DASHBOARD;
        return;
    }

    // Initialize registration
    initRegistration();
});

function initRegistration() {
    console.log('📋 Initializing registration...');
    
    const form = document.getElementById('registrationForm');
    const alertBox = document.getElementById('alertBox');
    const loadingBox = document.getElementById('loadingBox');
    const submitBtn = document.getElementById('submitBtn');

    // Load plans
    loadPlans();

    // Load agents
    loadAgents();

    // Setup plan selection
    setupPlanSelection();

    // Setup dependants
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
        updateSummary();
        document.getElementById('dependantsContainer').innerHTML = '';
        addDependant(); // Add initial dependant
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
            updateSummary();
        }

        console.log('✅ Plans loaded successfully from config');

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
// LOAD AGENTS - From API
// ============================================================
async function loadAgents() {
    try {
        const select = document.getElementById('salesCode');
        
        // Try to load from API
        try {
            const response = await fetch(`${CONFIG.API.BASE_URL}/public/agents`);
            if (response.ok) {
                const data = await response.json();
                if (data && data.length > 0) {
                    select.innerHTML = '<option value="">Select sales agent</option>';
                    data.forEach(agent => {
                        const option = document.createElement('option');
                        option.value = agent.id || agent.agent_code;
                        option.textContent = `${agent.full_name || agent.name} - ${agent.phone || ''}`;
                        select.appendChild(option);
                    });
                    return;
                }
            }
        } catch (e) {
            console.log('API fetch failed, using fallback agents');
        }
        
        // Fallback: Add default agents
        const defaultAgents = [
            { id: 'AG001', name: 'John Mwangi' },
            { id: 'AG002', name: 'Mary Wanjiru' },
            { id: 'AG003', name: 'Peter Ochieng' }
        ];
        
        defaultAgents.forEach(agent => {
            const option = document.createElement('option');
            option.value = agent.id;
            option.textContent = agent.name;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('Error loading agents:', error);
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
    // Add initial dependant
    addDependant();
    
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
}

function removeDependant(btn) {
    const card = btn.closest('.dependant-card');
    if (card) {
        const container = document.getElementById('dependantsContainer');
        if (container.querySelectorAll('.dependant-card').length > 1) {
            card.remove();
            // Re-index
            container.querySelectorAll('.dependant-card').forEach((el, i) => {
                el.dataset.index = i + 1;
                el.querySelector('.dependant-header strong').textContent = `Dependant #${i + 1}`;
            });
            updateSummary();
        } else {
            showAlert('You must have at least one dependant.', 'warning');
        }
    }
}

// ============================================================
// SUMMARY UPDATES
// ============================================================
function setupSummaryUpdates() {
    // Listen to all form inputs
    document.querySelectorAll('#registrationForm input, #registrationForm select, #registrationForm textarea')
        .forEach(el => {
            el.addEventListener('change', updateSummary);
            el.addEventListener('input', updateSummary);
        });
    
    // Initial summary
    updateSummary();
}

function updateSummary() {
    // Get selected plan
    const planInput = document.querySelector('input[name="plan_type"]:checked');
    const planSlug = planInput ? planInput.value : 'comfort';
    const plan = CONFIG.PLANS[planSlug.toUpperCase()] || CONFIG.PLANS.COMFORT;
    
    // Get dependants
    const dependantCards = document.querySelectorAll('.dependant-card');
    const dependantCount = dependantCards.length;
    
    // Calculate costs
    const registrationFee = plan.registration_fee || 200;
    const dependantFee = dependantCount * 100; // KES 100 per dependant
    
    const total = registrationFee + dependantFee;
    
    // Update summary
    document.getElementById('summaryPlan').textContent = plan.name || 'Plan';
    document.getElementById('summaryPrincipal').textContent = `KES ${registrationFee.toLocaleString()}`;
    document.getElementById('summaryDependants').textContent = `KES ${dependantFee.toLocaleString()}`;
    document.getElementById('summaryTotal').textContent = `KES ${total.toLocaleString()}`;
    
    // Update hidden fields if they exist
    const regFeeEl = document.getElementById('registrationFee');
    const depFeeEl = document.getElementById('dependantFee');
    const totalEl = document.getElementById('totalAmount');
    
    if (regFeeEl) regFeeEl.value = registrationFee;
    if (depFeeEl) depFeeEl.value = dependantFee;
    if (totalEl) totalEl.value = total;
}

function updateDependantEligibility(planSlug) {
    const plan = CONFIG.PLANS[planSlug.toUpperCase()] || CONFIG.PLANS.COMFORT;
    const helpText = document.getElementById('planHelp');
    
    if (planSlug === 'wazazi') {
        helpText.textContent = 'Wazazi Plan: You can add up to 4 parents.';
    } else if (planSlug === 'dignity') {
        helpText.textContent = 'Dignity Plan: Covers spouse and children under 18.';
    } else {
        helpText.textContent = 'Comfort Plan: Covers spouse and up to 4 children under 18.';
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
    let parsedData = [];
    
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
            
            parsedData = result.data;
            displayCsvPreview(parsedData);
            
            // Update count
            document.getElementById('chamaMemberCount').textContent = parsedData.length;
            document.getElementById('chamaTotal').textContent = `KES ${(parsedData.length * 100).toLocaleString()}`;
            
            showAlert(`Successfully loaded ${parsedData.length} members.`, 'success');
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
// HANDLE REGISTRATION - Uses Backend API
// ============================================================
async function handleRegistration() {
    const alertBox = document.getElementById('alertBox');
    const loadingBox = document.getElementById('loadingBox');
    const submitBtn = document.getElementById('submitBtn');
    
    // Validate form
    const formData = getFormData();
    const validation = validateFormData(formData);
    
    if (!validation.valid) {
        showAlert(validation.error, 'error');
        return;
    }
    
    // Show loading
    loadingBox.classList.add('show');
    submitBtn.disabled = true;
    clearAlerts();
    
    try {
        // Send registration to backend API
        const response = await fetch(`${CONFIG.API.BASE_URL}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (!response.ok || !result.success) {
            throw new Error(result.message || result.detail || 'Registration failed');
        }
        
        // Show success
        showAlert('Registration successful! Redirecting to payment...', 'success');
        
        // Store member data for payment
        localStorage.setItem('pending_member', JSON.stringify(result.member));
        localStorage.setItem('pending_credentials', JSON.stringify(result.credentials));
        localStorage.setItem('pending_user', JSON.stringify(result.user || {}));
        
        // Redirect to payment page
        setTimeout(() => {
            window.location.href = CONFIG.ROUTES.PAYMENT;
        }, 2000);
        
    } catch (error) {
        console.error('Registration error:', error);
        showAlert(error.message || 'Registration failed. Please try again.', 'error');
    } finally {
        loadingBox.classList.remove('show');
        submitBtn.disabled = false;
    }
}

function getFormData() {
    const planInput = document.querySelector('input[name="plan_type"]:checked');
    const planSlug = planInput ? planInput.value : 'comfort';
    const plan = CONFIG.PLANS[planSlug.toUpperCase()] || CONFIG.PLANS.COMFORT;
    
    // Get dependants
    const dependantCards = document.querySelectorAll('.dependant-card');
    const dependants = [];
    dependantCards.forEach((card, index) => {
        const num = index + 1;
        dependants.push({
            first_name: document.querySelector(`[name="dep_first_name_${num}"]`)?.value || '',
            last_name: document.querySelector(`[name="dep_last_name_${num}"]`)?.value || '',
            relationship: document.querySelector(`[name="dep_relationship_${num}"]`)?.value || '',
            date_of_birth: document.querySelector(`[name="dep_dob_${num}"]`)?.value || '',
            phone: document.querySelector(`[name="dep_phone_${num}"]`)?.value || ''
        });
    });
    
    return {
        first_name: document.getElementById('firstName').value.trim(),
        last_name: document.getElementById('lastName').value.trim(),
        other_name: document.getElementById('otherName').value.trim(),
        id_number: document.getElementById('idNumber').value.trim(),
        date_of_birth: document.getElementById('dateOfBirth').value,
        gender: document.getElementById('gender').value,
        phone: document.getElementById('phone').value.trim(),
        alternative_phone: document.getElementById('alternativePhone').value.trim(),
        email: document.getElementById('email').value.trim(),
        county: document.getElementById('county').value,
        location: document.getElementById('location').value.trim(),
        town: document.getElementById('town').value.trim(),
        address: document.getElementById('address').value.trim(),
        plan: planSlug,
        sales_code: document.getElementById('salesCode').value,
        benefit_option: document.getElementById('benefitOption').value,
        dependants: dependants,
        accept_terms: true
    };
}

function validateFormData(data) {
    // Check required fields
    const required = ['first_name', 'last_name', 'id_number', 'date_of_birth', 'gender', 'phone', 'county', 'benefit_option'];
    
    for (const field of required) {
        if (!data[field] || data[field].trim() === '') {
            return { valid: false, error: `Please fill in ${field.replace('_', ' ')}` };
        }
    }
    
    // Validate phone
    const phone = data.phone.replace(/\D/g, '');
    if (phone.length < 10) {
        return { valid: false, error: 'Please enter a valid phone number' };
    }
    
    // Validate ID
    if (data.id_number.length < 5) {
        return { valid: false, error: 'Please enter a valid ID number' };
    }
    
    // Validate age
    const birthDate = new Date(data.date_of_birth);
    const age = new Date().getFullYear() - birthDate.getFullYear();
    if (age < 1 || age > 80) {
        return { valid: false, error: 'Age must be between 1 and 80 years' };
    }
    
    return { valid: true };
}

// ============================================================
// CHAMA REGISTRATION
// ============================================================
async function handleChamaRegistration() {
    const alertBox = document.getElementById('alertBox');
    const loadingBox = document.getElementById('loadingBox');
    const submitBtn = document.getElementById('chamaSubmitBtn');
    
    // Validate chama form
    const chamaName = document.getElementById('chamaName').value;
    const chamaPhone = document.getElementById('chamaPhone').value;
    
    if (!chamaName || !chamaPhone) {
        showAlert('Please fill in all required group details.', 'error');
        return;
    }
    
    // Get CSV data
    const fileInput = document.getElementById('chamaCsv');
    if (!fileInput.files || !fileInput.files[0]) {
        showAlert('Please upload a CSV file with members.', 'error');
        return;
    }
    
    // Show loading
    loadingBox.classList.add('show');
    submitBtn.disabled = true;
    clearAlerts();
    
    try {
        // Parse CSV again to get data
        const file = fileInput.files[0];
        const csvText = await file.text();
        const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        
        if (result.errors.length > 0) {
            throw new Error('Error parsing CSV: ' + result.errors[0].message);
        }
        
        const members = result.data;
        
        if (members.length < 30) {
            throw new Error('Minimum 30 members required for chama registration.');
        }
        
        // Create chama registration
        const chamaData = {
            name: chamaName,
            phone: chamaPhone,
            chairperson: {
                name: document.getElementById('chairpersonName').value,
                phone: document.getElementById('chairpersonPhone').value,
                id: document.getElementById('chairpersonId').value
            },
            treasurer: {
                name: document.getElementById('treasurerName').value,
                phone: document.getElementById('treasurerPhone').value,
                id: document.getElementById('treasurerId').value
            },
            secretary: {
                name: document.getElementById('secretaryName').value,
                phone: document.getElementById('secretaryPhone').value,
                id: document.getElementById('secretaryId').value
            },
            members: members,
            total_members: members.length,
            total_amount: members.length * 100
        };
        
        // Store chama data for payment
        localStorage.setItem('chama_registration', JSON.stringify(chamaData));
        
        showAlert(`Chama registration successful! ${members.length} members loaded. Redirecting to payment...`, 'success');
        
        setTimeout(() => {
            window.location.href = CONFIG.ROUTES.PAYMENT + '?type=chama';
        }, 2000);
        
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
// SET YEAR IN FOOTER
// ============================================================
document.getElementById('year').textContent = new Date().getFullYear();

// ============================================================
// EXPOSE FUNCTIONS
// ============================================================
window.removeDependant = removeDependant;
window.addDependant = addDependant;
window.updateSummary = updateSummary;
window.showAlert = showAlert;
window.clearAlerts = clearAlerts;
window.loadPlans = loadPlans;
window.loadAgents = loadAgents;
window.initRegistration = initRegistration;
