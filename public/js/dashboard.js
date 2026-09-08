// =========================================================
// DASHBOARD.JS - Complete Fixed Dashboard Controller
// =========================================================

(function() {
    'use strict';

    // =========================================================
    // STATE
    // =========================================================
    const state = {
        user: null,
        member: null,
        dependants: [],
        payments: [],
        isLoading: true,
        initialized: false
    };

    // =========================================================
    // DOM REFERENCES
    // =========================================================
    const DOM = {
        loadingScreen: document.getElementById('loadingScreen'),
        dashboardContent: document.getElementById('dashboardContent'),
        welcomeCard: document.getElementById('welcomeCard'),
        
        // User
        userNameDisplay: document.getElementById('userNameDisplay'),
        welcomeName: document.getElementById('welcomeName'),
        welcomeSubtext: document.getElementById('welcomeSubtext'),
        memberNumberDisplay: document.getElementById('memberNumberDisplay'),
        paymentMemberNumber: document.getElementById('paymentMemberNumber'),
        
        // Stats
        planDisplay: document.getElementById('planDisplay'),
        planStatus: document.getElementById('planStatus'),
        dependantCount: document.getElementById('dependantCount'),
        coverageStatusText: document.getElementById('coverageStatusText'),
        coverageStatusBadge: document.getElementById('coverageStatusBadge'),
        benefitAmount: document.getElementById('benefitAmount'),
        
        // Containers
        planDetailsContainer: document.getElementById('planDetailsContainer'),
        memberListContainer: document.getElementById('memberListContainer'),
        paymentListContainer: document.getElementById('paymentListContainer'),
        
        // Modals
        dependantModal: document.getElementById('dependantModal'),
        paymentModal: document.getElementById('paymentModal'),
        dependantForm: document.getElementById('dependantForm'),
        paymentForm: document.getElementById('paymentForm'),
        
        // Toast
        toastContainer: document.getElementById('toastContainer')
    };

    // =========================================================
    // PLAN CONFIGURATION
    // =========================================================
    const PLAN_CONFIG = {
        comfort: {
            name: 'Comfort Plan',
            price: 'KES 300',
            benefit: 'KES 110,000',
            waiting: '4 months',
            monthlyPremium: 300
        },
        dignity: {
            name: 'Dignity Plan',
            price: 'KES 1,000',
            benefit: 'KES 110,000',
            waiting: '6 months',
            monthlyPremium: 1000
        },
        wazazi: {
            name: 'Wazazi Plan',
            price: 'KES 350',
            benefit: 'KES 110,000',
            waiting: '6 months',
            monthlyPremium: 350
        }
    };

    // =========================================================
    // RELATIONSHIP MAP
    // =========================================================
    const RELATIONSHIP_MAP = {
        spouse: 'Spouse',
        child: 'Child',
        parent: 'Parent',
        in_law: 'In-Law'
    };

    // =========================================================
    // ESCAPE HTML HELPER
    // =========================================================
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // =========================================================
    // INITIALIZATION
    // =========================================================
    function init() {
        if (state.initialized) return;
        state.initialized = true;

        console.log('📊 Dashboard initializing...');

        // Set up event listeners
        setupEventListeners();

        // Check authentication and load data
        checkAuthAndLoad();
    }

    // =========================================================
    // AUTH CHECK
    // =========================================================
    async function checkAuthAndLoad() {
        try {
            if (typeof authManager === 'undefined') {
                console.error('❌ authManager not found');
                showToast('error', 'Authentication system unavailable');
                return;
            }

            const user = authManager.getUser();
            if (!user) {
                console.warn('⚠️ User not authenticated');
                redirectToLogin();
                return;
            }

            state.user = user;
            console.log('👤 User authenticated:', user.email);

            // Update greeting
            updateUserGreeting(user);

            // Load dashboard data
            await loadDashboardData();

        } catch (error) {
            console.error('❌ Auth check error:', error);
            showToast('error', 'Authentication error: ' + error.message);
            showLoading(false);
        }
    }

    // =========================================================
    // LOAD DASHBOARD DATA
    // =========================================================
    async function loadDashboardData() {
        try {
            showLoading(true);

            // Get member profile
            const memberResult = await supabaseClient.getMember(state.user.id);
            
            if (!memberResult.success) {
                // Check if member doesn't exist (PGRST116 error)
                if (memberResult.error && (
                    memberResult.error.includes('PGRST116') ||
                    memberResult.error.includes('0 rows')
                )) {
                    console.log('ℹ️ No member record found - showing registration prompt');
                    showWelcomeCard();
                    showLoading(false);
                    return;
                }
                throw new Error(memberResult.error || 'Failed to load member profile');
            }

            state.member = memberResult.data;
            
            if (!state.member) {
                showWelcomeCard();
                showLoading(false);
                return;
            }

            console.log('✅ Member loaded:', state.member.membership_number);

            // Store member in localStorage
            if (typeof authManager !== 'undefined' && authManager.setMember) {
                authManager.setMember(state.member);
            }
            localStorage.setItem('masika_member', JSON.stringify(state.member));

            // Load dependants (FIXED: uses principal_member_id)
            await loadDependants();

            // Load payments
            await loadPayments();

            // Render dashboard
            renderDashboard();

            // Show dashboard content
            showDashboardContent();
            showLoading(false);

        } catch (error) {
            console.error('❌ Failed to load dashboard:', error);
            showToast('error', 'Failed to load dashboard: ' + error.message);
            showLoading(false);
        }
    }

    // =========================================================
    // LOAD DEPENDANTS (FIXED: uses principal_member_id)
    // =========================================================
    async function loadDependants() {
        try {
            const result = await supabaseClient.getMemberDependants(state.member.id);
            if (result.success) {
                state.dependants = result.data || [];
                console.log(`👨‍👩‍👦 ${state.dependants.length} dependants loaded`);
            } else {
                console.warn('⚠️ Failed to load dependants:', result.error);
                state.dependants = [];
            }
        } catch (error) {
            console.warn('⚠️ Dependant load error:', error);
            state.dependants = [];
        }
    }

    // =========================================================
    // LOAD PAYMENTS
    // =========================================================
    async function loadPayments() {
        try {
            const result = await supabaseClient.getMemberPayments(
                state.member.membership_number,
                5
            );
            if (result.success) {
                state.payments = result.data || [];
                console.log(`💰 ${state.payments.length} payments loaded`);
            } else {
                console.warn('⚠️ Failed to load payments:', result.error);
                state.payments = [];
            }
        } catch (error) {
            console.warn('⚠️ Payment load error:', error);
            state.payments = [];
        }
    }

    // =========================================================
    // RENDER DASHBOARD
    // =========================================================
    function renderDashboard() {
        renderWelcomeBanner();
        renderStats();
        renderPlanDetails();
        renderFamilyMembers(state.dependants);
        renderPayments(state.payments);
        updatePaymentModalMemberNumber();
    }

    // =========================================================
    // RENDER: Welcome Banner
    // =========================================================
    function renderWelcomeBanner() {
        const member = state.member;
        const fullName = `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Member';
        
        if (DOM.userNameDisplay) DOM.userNameDisplay.textContent = member.first_name || 'Member';
        if (DOM.welcomeName) DOM.welcomeName.textContent = fullName;
        if (DOM.memberNumberDisplay) DOM.memberNumberDisplay.textContent = member.membership_number || '---';
        
        const joinDate = member.registration_date ? 
            new Date(member.registration_date) : new Date();
        if (DOM.welcomeSubtext) {
            DOM.welcomeSubtext.textContent = 
                `Member since ${joinDate.toLocaleDateString('en-KE', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                })}`;
        }
    }

    // =========================================================
    // RENDER: Stats
    // =========================================================
    function renderStats() {
        const member = state.member;
        const planConfig = PLAN_CONFIG[member.plan_type] || PLAN_CONFIG.comfort;
        
        if (DOM.planDisplay) DOM.planDisplay.textContent = planConfig.name;
        if (DOM.planStatus) {
            DOM.planStatus.textContent = '● Active';
            DOM.planStatus.className = 'stat-status active';
        }
        
        if (DOM.dependantCount) DOM.dependantCount.textContent = state.dependants.length;
        
        const isWaitingPeriodOver = checkWaitingPeriod(member);
        if (DOM.coverageStatusText) {
            DOM.coverageStatusText.textContent = isWaitingPeriodOver ? 'Active' : 'Waiting';
        }
        if (DOM.coverageStatusBadge) {
            DOM.coverageStatusBadge.textContent = isWaitingPeriodOver ? 'Coverage Active' : 'Waiting Period';
            DOM.coverageStatusBadge.className = `stat-status ${isWaitingPeriodOver ? 'active' : 'pending'}`;
        }
        
        if (DOM.benefitAmount) DOM.benefitAmount.textContent = planConfig.benefit || 'KES 0';
    }

    // =========================================================
    // RENDER: Plan Details
    // =========================================================
    function renderPlanDetails() {
        const member = state.member;
        const planConfig = PLAN_CONFIG[member.plan_type] || PLAN_CONFIG.comfort;
        
        if (!DOM.planDetailsContainer) return;
        
        DOM.planDetailsContainer.innerHTML = `
            <div class="plan-detail-item">
                <span class="label">Plan Name</span>
                <span class="value gold">${planConfig.name}</span>
            </div>
            <div class="plan-detail-item">
                <span class="label">Monthly Premium</span>
                <span class="value green">${planConfig.price}</span>
            </div>
            <div class="plan-detail-item">
                <span class="label">Benefit Option</span>
                <span class="value">${member.benefit_option === 'cash' ? 'Cash Benefit (KES 110,000)' : 'Service Benefit'}</span>
            </div>
            <div class="plan-detail-item">
                <span class="label">Waiting Period</span>
                <span class="value">${planConfig.waiting}</span>
            </div>
            <div class="plan-detail-item">
                <span class="label">Status</span>
                <span class="value green">● Active</span>
            </div>
        `;
    }

    // =========================================================
    // RENDER: Family Members (FIXED: Table format)
    // =========================================================
    function renderFamilyMembers(deps) {
        const container = DOM.memberListContainer;
        
        if (!container) {
            console.error('❌ memberListContainer not found');
            return;
        }

        if (!deps || deps.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <p>No family members have been added yet.</p>
                    <button onclick="openDependantModal()" class="btn btn-primary btn-sm" style="margin-top:12px;">
                        <i class="fas fa-user-plus"></i> Add Family Member
                    </button>
                </div>
            `;
            return;
        }

        let html = `
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <thead>
                        <tr style="border-bottom:2px solid #f0f4f2;text-align:left;">
                            <th style="padding:12px 8px;">Member</th>
                            <th style="padding:12px 8px;">Relationship</th>
                            <th style="padding:12px 8px;">Date of Birth</th>
                            <th style="padding:12px 8px;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        deps.forEach(dep => {
            const firstName = dep.first_name || '';
            const lastName = dep.last_name || '';
            const fullName = `${firstName} ${lastName}`.trim() || 'Unnamed';
            
            const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || '?';
            
            const relationship = RELATIONSHIP_MAP[dep.relationship] || dep.relationship || 'Family';
            
            let dob = '—';
            if (dep.date_of_birth) {
                const date = new Date(dep.date_of_birth);
                if (!isNaN(date.getTime())) {
                    dob = date.toLocaleDateString('en-KE', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });
                }
            }

            html += `
                <tr style="border-bottom:1px solid #f0f4f2;">
                    <td style="padding:14px 8px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="width:36px;height:36px;min-width:36px;border-radius:50%;background:var(--primary-100);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--primary-700);">
                                ${escapeHtml(initials)}
                            </div>
                            <div>
                                <div style="font-weight:700;color:var(--text-dark);">
                                    ${escapeHtml(fullName)}
                                </div>
                                <div style="font-size:11px;color:var(--text-gray);">
                                    Family Member
                                </div>
                            </div>
                        </div>
                    </td>
                    <td style="padding:14px 8px;color:var(--text-gray);">
                        ${escapeHtml(relationship)}
                    </td>
                    <td style="padding:14px 8px;color:var(--text-gray);">
                        ${escapeHtml(dob)}
                    </td>
                    <td style="padding:14px 8px;">
                        <span style="display:inline-block;padding:4px 10px;border-radius:12px;background:#e8f5e9;color:var(--success);font-size:11px;font-weight:700;">
                            Active
                        </span>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    }

    // =========================================================
    // RENDER: Payments
    // =========================================================
    function renderPayments(payments) {
        const container = DOM.paymentListContainer;
        
        if (!container) return;

        if (!payments || payments.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-receipt"></i>
                    <p>No payments recorded yet.</p>
                    <button onclick="openPaymentModal()" class="btn btn-gold btn-sm">
                        <i class="fas fa-plus"></i> Make Payment
                    </button>
                </div>
            `;
            return;
        }

        const typeLabels = {
            'registration': 'Registration Fee',
            'monthly': 'Monthly Premium',
            'topup': 'Top-up',
            'addon': 'Add-on'
        };

        let html = '<ul class="payment-list">';
        payments.forEach(pay => {
            const statusClass = pay.status === 'completed' ? 'paid' : 
                               pay.status === 'pending' ? 'pending' : 'failed';
            const statusText = pay.status === 'completed' ? 'Paid' : 
                              pay.status === 'pending' ? 'Pending' : 'Failed';
            
            const typeLabel = typeLabels[pay.payment_type] || pay.payment_type || 'Payment';
            
            const date = pay.created_at ? 
                new Date(pay.created_at).toLocaleDateString('en-KE', {
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric'
                }) : 'N/A';

            const amount = parseFloat(pay.amount || 0).toLocaleString();

            html += `
                <li>
                    <div class="payment-info">
                        <div class="p-icon"><i class="fas fa-mobile-screen-button"></i></div>
                        <div class="p-details">
                            <div class="p-title">${typeLabel}</div>
                            <div class="p-date">${date} ${pay.mpesa_receipt ? '• ' + pay.mpesa_receipt : ''}</div>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <span class="payment-status ${statusClass}">${statusText}</span>
                        <div class="payment-amount">KES ${amount}</div>
                    </div>
                </li>
            `;
        });
        html += '</ul>';
        container.innerHTML = html;
    }

    // =========================================================
    // UPDATE PAYMENT MODAL MEMBER NUMBER
    // =========================================================
    function updatePaymentModalMemberNumber() {
        if (state.member && DOM.paymentMemberNumber) {
            DOM.paymentMemberNumber.textContent = state.member.membership_number || 'Your Membership Number';
        }
    }

    // =========================================================
    // UPDATE USER GREETING
    // =========================================================
    function updateUserGreeting(user) {
        if (!user || !DOM.userNameDisplay) return;
        const name = user.user_metadata?.first_name || 
                     user.email?.split('@')[0] || 
                     'Member';
        DOM.userNameDisplay.textContent = name;
    }

    // =========================================================
    // CHECK WAITING PERIOD
    // =========================================================
    function checkWaitingPeriod(member) {
        if (!member || !member.waiting_period_end) return false;
        const waitEnd = new Date(member.waiting_period_end);
        const today = new Date();
        return today >= waitEnd;
    }

    // =========================================================
    // UI HELPERS
    // =========================================================
    function showLoading(show) {
        state.isLoading = show;
        if (DOM.loadingScreen) {
            DOM.loadingScreen.style.display = show ? 'flex' : 'none';
        }
    }

    function showDashboardContent() {
        if (DOM.dashboardContent) DOM.dashboardContent.style.display = 'block';
        if (DOM.welcomeCard) DOM.welcomeCard.style.display = 'none';
    }

    function showWelcomeCard() {
        if (DOM.loadingScreen) DOM.loadingScreen.style.display = 'none';
        if (DOM.dashboardContent) DOM.dashboardContent.style.display = 'none';
        if (DOM.welcomeCard) DOM.welcomeCard.style.display = 'block';
    }

    function redirectToLogin() {
        const loginUrl = CONFIG?.ROUTES?.LOGIN || 'login.html';
        window.location.href = loginUrl;
    }

    // =========================================================
    // MODAL FUNCTIONS
    // =========================================================
    function openDependantModal() {
        if (DOM.dependantModal) {
            DOM.dependantModal.classList.add('show');
            if (DOM.dependantForm) DOM.dependantForm.reset();
        }
    }

    function openPaymentModal() {
        if (DOM.paymentModal) {
            DOM.paymentModal.classList.add('show');
            if (DOM.paymentForm) DOM.paymentForm.reset();
            updatePaymentModalMemberNumber();
        }
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove('show');
    }

    // =========================================================
    // HANDLE ADD DEPENDANT (FIXED: uses principal_member_id)
    // =========================================================
    async function handleAddDependant(event) {
        event.preventDefault();

        const firstName = document.getElementById('depFirstName')?.value?.trim();
        const lastName = document.getElementById('depLastName')?.value?.trim();
        const dob = document.getElementById('depDob')?.value;
        const relationship = document.getElementById('depRelationship')?.value;

        if (!firstName || !lastName || !dob || !relationship) {
            showToast('error', 'Please fill in all fields.');
            return;
        }

        const submitBtn = document.getElementById('depSubmitBtn');
        if (!submitBtn) return;
        
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';

        try {
            // Get authenticated user
            const user = authManager.getUser();
            if (!user?.id) {
                throw new Error('Your login session has expired. Please login again.');
            }

            // Get the actual member record
            const memberResult = await supabaseClient.getMember(user.id);
            if (!memberResult.success || !memberResult.data) {
                throw new Error('Member profile not found. Please complete registration first.');
            }

            const member = memberResult.data;
            console.log('👤 Adding dependant to member:', member.id);

            // IMPORTANT: Database column is principal_member_id
            const result = await supabaseClient.createDependant({
                principal_member_id: member.id,
                first_name: firstName,
                last_name: lastName,
                date_of_birth: dob,
                relationship: relationship
            });

            if (!result.success) {
                throw new Error(result.error);
            }

            console.log('✅ Dependant created:', result.data);

            // Reload dependants
            const depsResult = await supabaseClient.getMemberDependants(member.id);
            if (!depsResult.success) {
                throw new Error(depsResult.error || 'Dependant was added but the family list could not be refreshed.');
            }

            const dependants = depsResult.data || [];
            renderFamilyMembers(dependants);

            const countElement = document.getElementById('dependantCount');
            if (countElement) {
                countElement.textContent = dependants.length;
            }

            closeModal('dependantModal');
            document.getElementById('dependantForm').reset();

            showToast('success', `${firstName} ${lastName} added successfully!`);

        } catch (error) {
            console.error('❌ Add dependant error:', error);
            showToast('error', error.message || 'Failed to add dependant.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-plus"></i> Add Dependant';
        }
    }

    // =========================================================
    // HANDLE PAYMENT
    // =========================================================
    async function handlePayment(event) {
        event.preventDefault();
        
        const amountInput = document.getElementById('paymentAmount');
        const paymentTypeSelect = document.getElementById('paymentType');
        const mpesaReceiptInput = document.getElementById('mpesaReceipt');

        const amount = parseFloat(amountInput?.value);
        const paymentType = paymentTypeSelect?.value;
        const mpesaReceipt = mpesaReceiptInput?.value?.trim();

        if (!amount || amount < 100) {
            showToast('error', 'Please enter a valid amount (minimum KES 100)');
            return;
        }
        if (!mpesaReceipt) {
            showToast('error', 'Please enter the M-Pesa confirmation code');
            return;
        }

        const submitBtn = document.getElementById('paymentSubmitBtn');
        if (!submitBtn) return;
        
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Confirming...';

        try {
            if (!state.member) {
                throw new Error('Member profile not found. Please complete registration first.');
            }

            const result = await supabaseClient.createPayment({
                membership_number: state.member.membership_number,
                amount: amount,
                payment_type: paymentType,
                status: 'completed',
                mpesa_receipt: mpesaReceipt
            });

            if (!result.success) {
                throw new Error(result.error || 'Failed to confirm payment');
            }

            // Refresh payments
            await loadPayments();
            renderPayments(state.payments);

            closeModal('paymentModal');
            showToast('success', `Payment of KES ${amount.toLocaleString()} confirmed successfully!`);

        } catch (error) {
            console.error('Payment error:', error);
            showToast('error', error.message || 'Failed to confirm payment');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check"></i> Confirm Payment';
        }
    }

    // =========================================================
    // QUICK ACTIONS
    // =========================================================
    function downloadStatement() {
        if (!state.member) {
            showToast('error', 'Member profile not found');
            return;
        }
        showToast('info', `Generating statement for ${state.member.membership_number}...`);
        const url = `/api/v1/members/${state.member.membership_number}/statement`;
        window.open(url, '_blank');
    }

    function fileClaim() {
        if (!state.member) {
            showToast('error', 'Member profile not found');
            return;
        }
        showToast('info', 'Opening claims form...');
        window.location.href = 'claims.html';
    }

    // =========================================================
    // LOGOUT
    // =========================================================
    async function handleLogout() {
        try {
            if (typeof authManager !== 'undefined' && authManager.logout) {
                await authManager.logout();
            } else {
                localStorage.removeItem('masika_user');
                localStorage.removeItem('masika_member');
            }
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Logout error:', error);
            showToast('error', 'Failed to logout');
        }
    }

    // =========================================================
    // TOAST NOTIFICATIONS
    // =========================================================
    function showToast(type, message) {
        const container = DOM.toastContainer;
        if (!container) {
            console.log(`[${type}] ${message}`);
            return;
        }

        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-triangle-exclamation',
            info: 'fa-info-circle'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon"><i class="fas ${icons[type] || icons.info}"></i></span>
            <span>${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100px)';
            toast.style.transition = 'all 0.4s ease';
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    // =========================================================
    // EVENT LISTENERS
    // =========================================================
    function setupEventListeners() {
        // Close modals on overlay click
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.remove('show');
                }
            });
        });

        // Close modals with Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.show').forEach(modal => {
                    modal.classList.remove('show');
                });
            }
            // Ctrl+P = Open payment modal
            if (e.ctrlKey && e.key === 'p') {
                e.preventDefault();
                openPaymentModal();
            }
            // Ctrl+D = Open dependant modal
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                openDependantModal();
            }
        });

        // Form submissions
        if (DOM.dependantForm) {
            DOM.dependantForm.addEventListener('submit', handleAddDependant);
        }
        if (DOM.paymentForm) {
            DOM.paymentForm.addEventListener('submit', handlePayment);
        }

        console.log('✅ Event listeners set up');
    }

    // =========================================================
    // EXPOSE PUBLIC API
    // =========================================================
    window.Dashboard = {
        init: init,
        loadDashboard: loadDashboardData,
        openDependantModal: openDependantModal,
        openPaymentModal: openPaymentModal,
        closeModal: closeModal,
        handleAddDependant: handleAddDependant,
        handlePayment: handlePayment,
        handleLogout: handleLogout,
        showToast: showToast,
        downloadStatement: downloadStatement,
        fileClaim: fileClaim,
        renderFamilyMembers: renderFamilyMembers,
        getState: () => ({ ...state }),
        refresh: loadDashboardData
    };

    // Also expose individual functions for inline onclick handlers
    window.openDependantModal = openDependantModal;
    window.openPaymentModal = openPaymentModal;
    window.closeModal = closeModal;
    window.handleAddDependant = handleAddDependant;
    window.handlePayment = handlePayment;
    window.handleLogout = handleLogout;
    window.showToast = showToast;
    window.downloadStatement = downloadStatement;
    window.fileClaim = fileClaim;
    window.renderFamilyMembers = renderFamilyMembers;

    // Auto-initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('📊 Dashboard module loaded');

})();
