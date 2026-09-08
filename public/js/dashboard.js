// =========================================================
// DASHBOARD.JS - Complete Dashboard Controller
// Aligned with your database schema
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
    // DOM REFERENCES
    // =========================================================
    const DOM = {
        loadingScreen: document.getElementById('loadingScreen'),
        dashboardContent: document.getElementById('dashboardContent'),
        welcomeCard: document.getElementById('welcomeCard'),
        
        userNameDisplay: document.getElementById('userNameDisplay'),
        welcomeName: document.getElementById('welcomeName'),
        welcomeSubtext: document.getElementById('welcomeSubtext'),
        memberNumberDisplay: document.getElementById('memberNumberDisplay'),
        paymentMemberNumber: document.getElementById('paymentMemberNumber'),
        
        planDisplay: document.getElementById('planDisplay'),
        planStatus: document.getElementById('planStatus'),
        dependantCount: document.getElementById('dependantCount'),
        coverageStatusText: document.getElementById('coverageStatusText'),
        coverageStatusBadge: document.getElementById('coverageStatusBadge'),
        benefitAmount: document.getElementById('benefitAmount'),
        
        planDetailsContainer: document.getElementById('planDetailsContainer'),
        memberListContainer: document.getElementById('memberListContainer'),
        paymentListContainer: document.getElementById('paymentListContainer'),
        
        dependantModal: document.getElementById('dependantModal'),
        paymentModal: document.getElementById('paymentModal'),
        dependantForm: document.getElementById('dependantForm'),
        paymentForm: document.getElementById('paymentForm'),
        
        toastContainer: document.getElementById('toastContainer')
    };

    // =========================================================
    // INITIALIZATION
    // =========================================================
    function init() {
        if (state.initialized) return;
        state.initialized = true;

        console.log('📊 Dashboard initializing...');
        setupEventListeners();
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
            console.log('👤 User authenticated:', user.id);

            updateUserGreeting(user);
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

            // Get member profile using auth.uid()
            const memberResult = await supabaseClient.getMember(state.user.id);
            
            if (!memberResult.success) {
                if (memberResult.error && (
                    memberResult.error.includes('PGRST116') ||
                    memberResult.error.includes('0 rows')
                )) {
                    console.log('ℹ️ No member record found');
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

            console.log('✅ Member found:', state.member.member_number);

            // Store member
            localStorage.setItem('masika_member', JSON.stringify(state.member));

            // Load dependants using principal_member_id
            await loadDependants();

            // Load payments using member_number
            await loadPayments();

            renderDashboard();
            showDashboardContent();
            showLoading(false);

        } catch (error) {
            console.error('❌ Failed to load dashboard:', error);
            showToast('error', 'Failed to load dashboard: ' + error.message);
            showLoading(false);
        }
    }

    // =========================================================
    // LOAD DEPENDANTS
    // CRITICAL: Uses principal_member_id
    // =========================================================
    async function loadDependants() {
        try {
            console.log('👨‍👩‍👦 Loading dependants for member:', state.member.id);
            console.log('🔍 Query: dependants.principal_member_id =', state.member.id);
            
            const result = await supabaseClient.getMemberDependants(state.member.id);
            
            if (result.success) {
                state.dependants = result.data || [];
                console.log(`✅ ${state.dependants.length} dependants loaded`);
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
                state.member.member_number,
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
        const fullName = `${member.first_name || ''} ${member.last_name || ''}`.trim() || 
                        member.full_name || 'Member';
        
        if (DOM.userNameDisplay) DOM.userNameDisplay.textContent = member.first_name || 'Member';
        if (DOM.welcomeName) DOM.welcomeName.textContent = fullName;
        if (DOM.memberNumberDisplay) DOM.memberNumberDisplay.textContent = member.member_number || '---';
        
        const joinDate = member.registration_date ? new Date(member.registration_date) : new Date();
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
        const planType = member.plan ? member.plan.toLowerCase() : 'comfort';
        const planConfig = PLAN_CONFIG[planType] || PLAN_CONFIG.comfort;
        
        if (DOM.planDisplay) DOM.planDisplay.textContent = planConfig.name;
        if (DOM.planStatus) {
            DOM.planStatus.textContent = member.is_active ? '● Active' : '● Inactive';
            DOM.planStatus.className = `stat-status ${member.is_active ? 'active' : 'inactive'}`;
        }
        
        if (DOM.dependantCount) DOM.dependantCount.textContent = state.dependants.length;
        
        // Coverage status based on waiting_period_months
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
        const planType = member.plan ? member.plan.toLowerCase() : 'comfort';
        const planConfig = PLAN_CONFIG[planType] || PLAN_CONFIG.comfort;
        
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
                <span class="value">${member.waiting_period_months || 4} months</span>
            </div>
            <div class="plan-detail-item">
                <span class="label">Status</span>
                <span class="value green">${member.is_active ? '● Active' : '● Inactive'}</span>
            </div>
        `;
    }

    // =========================================================
    // RENDER: Family Members (Table format)
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
            <div class="family-table-wrapper">
                <table class="family-table">
                    <thead>
                        <tr>
                            <th>Member</th>
                            <th>Relationship</th>
                            <th>Date of Birth</th>
                            <th>Status</th>
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
                <tr>
                    <td>
                        <div class="family-member-info">
                            <div class="family-member-avatar">${escapeHtml(initials)}</div>
                            <div>
                                <div class="family-member-name">${escapeHtml(fullName)}</div>
                                <div class="family-member-label">${dep.phone ? '📱 ' + escapeHtml(dep.phone) : 'Family Member'}</div>
                            </div>
                        </div>
                    </td>
                    <td class="family-relationship">${escapeHtml(relationship)}</td>
                    <td class="family-dob">${escapeHtml(dob)}</td>
                    <td><span class="status-badge">${dep.is_active ? 'Active' : 'Inactive'}</span></td>
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
            
            const date = pay.payment_date ? 
                new Date(pay.payment_date).toLocaleDateString('en-KE', {
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
            DOM.paymentMemberNumber.textContent = state.member.member_number || 'Your Member Number';
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
        if (!member) return false;
        // Use waiting_period_months from your schema
        const waitingMonths = member.waiting_period_months || 4;
        const regDate = member.registration_date ? new Date(member.registration_date) : new Date();
        const waitEnd = new Date(regDate);
        waitEnd.setMonth(waitEnd.getMonth() + waitingMonths);
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
    // HANDLE ADD DEPENDANT
    // CRITICAL: Uses principal_member_id
    // =========================================================
    async function handleAddDependant(event) {
        event.preventDefault();

        const firstName = document.getElementById('depFirstName')?.value?.trim();
        const lastName = document.getElementById('depLastName')?.value?.trim();
        const dob = document.getElementById('depDob')?.value;
        const relationship = document.getElementById('depRelationship')?.value;
        const phone = document.getElementById('depPhone')?.value?.trim();

        if (!firstName || !lastName || !dob || !relationship) {
            showToast('error', 'Please fill in all required fields.');
            return;
        }

        const submitBtn = document.getElementById('depSubmitBtn');
        if (!submitBtn) return;
        
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';

        try {
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
            console.log('🔑 Using principal_member_id:', member.id);

            // CRITICAL: Database column is principal_member_id
            const result = await supabaseClient.createDependant({
                principal_member_id: member.id,
                first_name: firstName,
                last_name: lastName,
                date_of_birth: dob,
                relationship: relationship,
                phone: phone || null
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
            state.dependants = dependants;
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
            submitBtn.innerHTML = '<i class="fas fa-plus"></i> Add Family Member';
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
                member_number: state.member.member_number,
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
        showToast('info', `Generating statement for ${state.member.member_number}...`);
        const url = `/api/v1/members/${state.member.member_number}/statement`;
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
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.remove('show');
                }
            });
        });

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.show').forEach(modal => {
                    modal.classList.remove('show');
                });
            }
            if (e.ctrlKey && e.key === 'p') {
                e.preventDefault();
                openPaymentModal();
            }
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                openDependantModal();
            }
        });

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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('📊 Dashboard module loaded');

})();
