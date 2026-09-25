// ============================================================
// MEMBER DASHBOARD - js/dashboard.js
// ============================================================

let currentMember = null;

document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

async function initDashboard() {
    if (!authManager.requireAuth()) return; // redirects to login.html

    const user = authManager.getUser();
    if (!user) {
        window.location.href = CONFIG.ROUTES.LOGIN;
        return;
    }

    try {
        // Fetch live — do not trust cached localStorage member data (stale-data bug precedent)
        const memberResult = await supabaseClient.getMember(user.id);

        if (!memberResult.success || !memberResult.data) {
            showWelcomeCard();
            return;
        }

        currentMember = memberResult.data;
        localStorage.setItem(CONFIG.STORAGE.MEMBER, JSON.stringify(currentMember));

        populateHeader(currentMember);

        await Promise.all([
            loadPlanDetails(currentMember),
            loadDependants(currentMember),
            loadPayments(currentMember)
        ]);

        showDashboard();

    } catch (error) {
        console.error('Dashboard init error:', error);
        showToast('error', 'Could not load your dashboard. Please refresh.');
        showDashboard(); // still exit the spinner
    }
}

function showDashboard() {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('dashboardContent').style.display = 'block';
}

function showWelcomeCard() {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('welcomeCard').style.display = 'block';
}

function populateHeader(member) {
    document.getElementById('userNameDisplay').textContent = member.first_name || 'Member';
    document.getElementById('welcomeName').textContent = member.first_name || 'Member';
    document.getElementById('memberNumberDisplay').textContent = member.member_number || '---';
    document.getElementById('paymentMemberNumber').textContent = member.member_number || '---';

    // ASSUMPTION: members.is_active exists (boolean). Confirm in Supabase.
    const active = member.is_active !== false;
    document.getElementById('coverageStatusText').textContent = active ? 'Active' : 'Pending';
    const badge = document.getElementById('coverageStatusBadge');
    badge.textContent = active ? 'Covered' : 'Waiting';
    badge.className = `stat-status ${active ? 'active' : 'pending'}`;
    document.getElementById('welcomeSubtext').textContent = active
        ? 'Your Masika Benevolent membership is active and ready.'
        : 'Your membership is pending activation.';
}

async function loadPlanDetails(member) {
    const container = document.getElementById('planDetailsContainer');
    try {
        const result = await supabaseClient.getPlans();
        if (!result.success) throw new Error(result.error);

        // ASSUMPTION: members.plan_type stores the plan slug (comfort/dignity/wazazi)
        // matching plans.slug. Confirm — if plan_type stores the display name instead,
        // change `p.slug === member.plan_type` to `p.name === member.plan_type`.
        const plan = (result.data || []).find(p => p.slug === member.plan_type);

        document.getElementById('planDisplay').textContent = plan?.name || member.plan_type || '—';
        // ASSUMPTION: plans.benefit_amount exists.
        document.getElementById('benefitAmount').textContent =
            `KES ${Number(plan?.benefit_amount || 0).toLocaleString()}`;

        if (plan) {
            container.innerHTML = `
                <div class="plan-detail-item"><span class="label">Plan</span><span class="value gold">${escapeHtml(plan.name)}</span></div>
                <div class="plan-detail-item"><span class="label">Monthly Premium</span><span class="value">KES ${Number(plan.monthly_fee || 0).toLocaleString()}</span></div>
                <div class="plan-detail-item"><span class="label">Benefit Amount</span><span class="value green">KES ${Number(plan.benefit_amount || 0).toLocaleString()}</span></div>
            `;
        } else {
            container.innerHTML = `<div class="empty-state"><i class="fas fa-crown"></i><p>Plan details unavailable.</p></div>`;
        }
    } catch (error) {
        console.error('Plan load error:', error);
        container.innerHTML = `<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Could not load plan details.</p></div>`;
    }
}

async function loadDependants(member) {
    const container = document.getElementById('memberListContainer');
    try {
        const result = await supabaseClient.getMemberDependants(member.id);
        if (!result.success) throw new Error(result.error);

        const dependants = result.data || [];
        document.getElementById('dependantCount').textContent = dependants.length;

        if (dependants.length === 0) {
            container.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><p>No family members have been added yet.</p></div>`;
            return;
        }

        container.innerHTML = `
            <div class="family-table-wrapper">
                <table class="family-table">
                    <thead><tr><th>Name</th><th>Relationship</th><th>DOB</th><th>Status</th></tr></thead>
                    <tbody>
                        ${dependants.map(d => `
                            <tr>
                                <td>
                                    <div class="family-member-info">
                                        <div class="family-member-avatar">${escapeHtml((d.first_name || '?')[0])}</div>
                                        <div class="family-member-name">${escapeHtml(d.first_name || '')} ${escapeHtml(d.last_name || '')}</div>
                                    </div>
                                </td>
                                <td class="family-relationship">${escapeHtml(d.relationship || '—')}</td>
                                <td class="family-dob">${d.date_of_birth ? new Date(d.date_of_birth).toLocaleDateString('en-KE') : '—'}</td>
                                <td><span class="status-badge">Active</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        console.error('Dependants load error:', error);
        container.innerHTML = `<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Could not load family members.</p></div>`;
    }
}

async function loadPayments(member) {
    const container = document.getElementById('paymentListContainer');
    try {
        // Querying directly by member_id rather than via supabaseClient.getMemberPayments(),
        // which filters on a "membership_number" column that may not actually exist
        // (same class of bug as the earlier payments schema mismatch). Confirm column names.
        const { data, error } = await supabaseClient.client
            .from('payments')
            .select('*')
            .eq('member_id', member.id)
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) throw error;
        const payments = data || [];

        if (payments.length === 0) {
            container.innerHTML = `<div class="empty-state"><i class="fas fa-receipt"></i><p>No payments recorded yet.</p></div>`;
            return;
        }

        container.innerHTML = `
            <ul class="payment-list">
                ${payments.map(p => `
                    <li>
                        <div class="payment-info">
                            <div class="p-icon"><i class="fas fa-mobile-screen-button"></i></div>
                            <div class="p-details">
                                <div class="p-title">${escapeHtml(p.payment_type || 'Payment')}</div>
                                <div class="p-date">${p.created_at ? new Date(p.created_at).toLocaleDateString('en-KE') : ''}</div>
                            </div>
                        </div>
                        <div>
                            <span class="payment-amount">KES ${Number(p.amount || 0).toLocaleString()}</span>
                            <span class="payment-status ${(p.payment_status || 'pending').toLowerCase()}">${p.payment_status || 'Pending'}</span>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;
    } catch (error) {
        console.error('Payments load error:', error);
        container.innerHTML = `<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><p>Could not load payments.</p></div>`;
    }
}

// ============================================================
// MODALS
// ============================================================

function openPaymentModal() {
    document.getElementById('paymentMemberNumber').textContent = currentMember?.member_number || '---';
    document.getElementById('paymentModal').classList.add('show');
}

function openDependantModal() {
    document.getElementById('dependantModal').classList.add('show');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('show');
}

async function handleAddDependant(event) {
    event.preventDefault();
    if (!currentMember) return;

    const btn = document.getElementById('depSubmitBtn');
    btn.disabled = true;

    const dependantData = {
        member_id: currentMember.id,
        first_name: document.getElementById('depFirstName').value.trim(),
        last_name: document.getElementById('depLastName').value.trim(),
        date_of_birth: document.getElementById('depDob').value,
        relationship: document.getElementById('depRelationship').value,
        phone: document.getElementById('depPhone').value.trim() || null
    };

    try {
        const result = await supabaseClient.createDependant(dependantData);
        if (!result.success) throw new Error(result.error);

        showToast('success', 'Family member added.');
        closeModal('dependantModal');
        document.getElementById('dependantForm').reset();
        await loadDependants(currentMember);
    } catch (error) {
        console.error('Add dependant error:', error);
        showToast('error', error.message || 'Could not add family member.');
    } finally {
        btn.disabled = false;
    }
}

async function handlePayment(event) {
    event.preventDefault();
    if (!currentMember) return;

    const btn = document.getElementById('paymentSubmitBtn');
    btn.disabled = true;

    const paymentData = {
        member_id: currentMember.id,
        amount: Number(document.getElementById('paymentAmount').value),
        payment_type: document.getElementById('paymentType').value,
        mpesa_receipt: document.getElementById('mpesaReceipt').value.trim(),
        payment_status: 'pending'
    };

    try {
        const result = await supabaseClient.createPayment(paymentData);
        if (!result.success) throw new Error(result.error);

        showToast('success', 'Payment submitted for confirmation.');
        closeModal('paymentModal');
        document.getElementById('paymentForm').reset();
        await loadPayments(currentMember);
    } catch (error) {
        console.error('Payment error:', error);
        showToast('error', error.message || 'Could not record payment.');
    } finally {
        btn.disabled = false;
    }
}

function handleLogout() {
    authManager.logout().finally(() => {
        window.location.href = CONFIG.ROUTES.LOGIN;
    });
}

function downloadStatement() {
    showToast('info', 'Statement download coming soon.');
}

function fileClaim() {
    showToast('info', 'Claim filing coming soon.');
}

// ============================================================
// UTIL
// ============================================================

function escapeHtml(value) {
    if (!value) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(type, message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = {
        success: 'fa-circle-check',
        error: 'fa-circle-exclamation',
        info: 'fa-circle-info',
        warning: 'fa-triangle-exclamation'
    };
    toast.innerHTML = `
        <i class="fas ${icons[type] || 'fa-circle-info'} toast-icon"></i>
        <span>${escapeHtml(message)}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}
