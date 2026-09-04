// ============================================================
// ADMIN — COLLECT PAYMENT
// Masika Benevolent - search a member, then send an M-Pesa STK
// push on their behalf.
// ============================================================
//
// This mirrors payment.js (the public payment page) for the
// STK-push / poll / receipt logic, but sources the member from
// an admin search against the `members` table instead of
// sessionStorage or URL params left behind by register.html.
// Everything that actually moves money still goes through the
// same FastAPI backend — this page never talks to Supabase for
// anything payment-related, only to look the member up.
// ============================================================

// ============================================================
// CONFIGURATION
// ============================================================

const API_BASE_URL = 'https://masika-c921.onrender.com';

// ============================================================
// STATE
// ============================================================

let selectedMemberData = null;   // the member record chosen from search
let searchResultsCache = [];     // last set of search results (for lookup by id)
let checkoutRequestId = null;
let pollingInterval = null;
let pollAttempts = 0;
const maxPollAttempts = 60; // 60 * 3 seconds = 3 minutes
let isProcessing = false;
let lastReceiptData = null;

// ============================================================
// DOM REFERENCES
// ============================================================

const alertBox = document.getElementById('alertBox');
const paymentCard = document.getElementById('paymentCard');
const successCard = document.getElementById('successCard');
const paymentForm = document.getElementById('paymentForm');
const paymentStatus = document.getElementById('paymentStatus');
const payBtn = document.getElementById('payBtn');
const checkStatusBtn = document.getElementById('checkStatusBtn');
const retryBtn = document.getElementById('retryBtn');
const phoneNumber = document.getElementById('phoneNumber');
const amountInput = document.getElementById('amountInput');
const statusIcon = document.getElementById('statusIcon');
const statusTitle = document.getElementById('statusTitle');
const statusMessage = document.getElementById('statusMessage');
const statusBadge = document.getElementById('statusBadge');
const successName = document.getElementById('successName');
const successNumber = document.getElementById('successNumber');
const successAmount = document.getElementById('successAmount');
const memberSearchInput = document.getElementById('memberSearchInput');
const searchResultsEl = document.getElementById('searchResults');
const selectedMemberEl = document.getElementById('selectedMember');
const selectedMemberName = document.getElementById('selectedMemberName');
const selectedMemberNumber = document.getElementById('selectedMemberNumber');
const selectedMemberStatus = document.getElementById('selectedMemberStatus');

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    const isStaff = await requireStaffSession();
    if (!isStaff) return;

    loadAdminProfile();

    memberSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchMembers();
        }
    });

    // ------------------------------------------------------
    // Search button — bind by click in addition to Enter.
    // Previously the only way to trigger a search was pressing
    // Enter in the input; a "Search" button in the HTML with no
    // onclick attribute (or one wired to a name that doesn't
    // exist) would silently do nothing when clicked. This binds
    // it explicitly if such a button exists, under any of the
    // common id/data-action patterns, so the button works
    // regardless of how the HTML wires it.
    // ------------------------------------------------------
    const searchBtn =
        document.getElementById('memberSearchBtn') ||
        document.getElementById('searchMemberBtn') ||
        document.getElementById('searchBtn') ||
        document.querySelector('[data-action="search-member"]');

    if (searchBtn) {
        searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            searchMembers();
        });
    } else {
        console.warn(
            'Collect payment: no search button found (checked ' +
            '#memberSearchBtn, #searchMemberBtn, #searchBtn, ' +
            '[data-action="search-member"]). Search still works via ' +
            'Enter in the input; add one of those ids/attributes to ' +
            'the button in the HTML to make clicking it work too.'
        );
    }

    memberSearchInput.focus();
});

// ============================================================
// AUTH / ADMIN PROFILE
// ============================================================

// Same guard shape as the other admin pages: no session -> bounce
// to login before doing anything else on this page.
async function requireStaffSession() {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    } catch (err) {
        console.error('Failed to check session:', err);
        window.location.href = 'login.html';
        return false;
    }
}

async function loadAdminProfile() {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return;

        const { data: staffRow } = await window.supabaseClient
            .from('staff')
            .select('full_name, roles(role_name)')
            .eq('auth_user_id', session.user.id)
            .single();

        if (!staffRow) return;
        document.getElementById('adminName').textContent = staffRow.full_name;
        document.getElementById('adminRole').textContent = staffRow.roles?.role_name || 'Administrator';
        document.getElementById('adminAvatar').textContent = staffRow.full_name.charAt(0).toUpperCase();
    } catch (err) {
        console.error('Failed to load admin profile:', err);
    }
}

async function handleLogout() {
    try {
        await window.supabaseClient.auth.signOut();
    } finally {
        window.location.href = 'login.html';
    }
}
window.handleLogout = handleLogout;

// ============================================================
// HELPERS
// ============================================================

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function statusBadgeClass(status) {
    return {
        ACTIVE: 'active',
        DORMANT: 'pending',
        SUSPENDED: 'inactive',
        CANCELLED: 'rejected',
        PENDING: 'pending',
    }[status] || 'pending';
}

function showAlert(message, type = 'error') {
    alertBox.textContent = message;
    alertBox.className = `alert show ${type}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearAlert() {
    alertBox.className = 'alert';
}

function formatKES(amount) {
    return new Intl.NumberFormat('en-KE', {
        style: 'currency',
        currency: 'KES',
        minimumFractionDigits: 0
    }).format(Number(amount) || 0);
}

async function apiRequest(path, options = {}) {
    let response;
    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
    } catch (networkError) {
        console.error('Network error calling API:', networkError);
        throw new Error('Unable to reach the server. Please check your connection and try again.');
    }

    let body = null;
    try {
        body = await response.json();
    } catch (parseError) {
        // Non-JSON response body; fall through with body = null
    }

    if (!response.ok) {
        const detail = body && body.detail;
        const message =
            (typeof detail === 'string' && detail) ||
            (detail && detail.message) ||
            (body && body.message) ||
            `Request failed (HTTP ${response.status}).`;
        throw new Error(message);
    }

    return body;
}

// ============================================================
// MEMBER SEARCH
// ============================================================

async function searchMembers() {
    const term = memberSearchInput.value.trim();
    clearAlert();

    if (term.length < 2) {
        searchResultsEl.innerHTML = `<div class="search-empty">Type at least 2 characters to search.</div>`;
        return;
    }

    searchResultsEl.innerHTML = `<div class="search-empty"><i class="fas fa-spinner fa-spin"></i> Searching...</div>`;

    try {
        const like = `%${term}%`;
        const { data, error } = await window.supabaseClient
            .from('members')
            .select('id, full_name, member_number, phone, member_status, plan, id_number')
            .is('deleted_at', null)
            .or(`full_name.ilike.${like},member_number.ilike.${like},phone.ilike.${like},id_number.ilike.${like}`)
            .order('full_name', { ascending: true })
            .limit(8);

        if (error) throw error;

        searchResultsCache = data || [];

        if (searchResultsCache.length === 0) {
            searchResultsEl.innerHTML = `<div class="search-empty">No members match "${escapeHtml(term)}".</div>`;
            return;
        }

        searchResultsEl.innerHTML = searchResultsCache.map((m) => `
            <div class="search-result-row" data-member-id="${escapeHtml(m.id)}">
                <div>
                    <div class="name">${escapeHtml(m.full_name)}</div>
                    <div class="meta">#${escapeHtml(m.member_number || '—')} · ${escapeHtml(m.phone || 'no phone')}</div>
                </div>
                <span class="status-badge ${statusBadgeClass(m.member_status)}">${escapeHtml(m.member_status || '—')}</span>
            </div>
        `).join('');

        searchResultsEl.querySelectorAll('.search-result-row').forEach((row) => {
            row.addEventListener('click', () => {
                const id = row.getAttribute('data-member-id');
                selectMember(id);
            });
        });
    } catch (err) {
        console.error('Member search failed:', err);
        searchResultsEl.innerHTML = `<div class="search-empty" style="color:var(--danger);">Couldn't search members. ${escapeHtml(err.message || '')}</div>`;
    }
}
window.searchMembers = searchMembers;

function selectMember(memberId) {
    const member = searchResultsCache.find((m) => m.id === memberId);
    if (!member) return;

    selectedMemberData = member;

    selectedMemberName.textContent = member.full_name;
    selectedMemberNumber.textContent = member.member_number || member.id;
    selectedMemberStatus.innerHTML = `<span class="status-badge ${statusBadgeClass(member.member_status)}">${escapeHtml(member.member_status || '—')}</span>`;
    selectedMemberEl.classList.add('show');

    // Clear the search UI now that a member is picked, so the admin
    // isn't tempted to click a stale result.
    memberSearchInput.value = '';
    searchResultsEl.innerHTML = '';
    searchResultsCache = [];

    // Prefill and unlock the payment fields.
    phoneNumber.value = member.phone || '';
    phoneNumber.disabled = false;
    amountInput.disabled = false;
    amountInput.value = '';
    payBtn.disabled = false;

    amountInput.focus();
}
window.selectMember = selectMember;

function clearSelectedMember() {
    selectedMemberData = null;
    selectedMemberEl.classList.remove('show');

    phoneNumber.value = '';
    phoneNumber.disabled = true;
    amountInput.value = '';
    amountInput.disabled = true;
    payBtn.disabled = true;

    memberSearchInput.focus();
}
window.clearSelectedMember = clearSelectedMember;

// ============================================================
// INITIATE PAYMENT
// ============================================================

async function initiatePayment(event) {
    event.preventDefault();

    if (isProcessing) return;

    if (!selectedMemberData || !selectedMemberData.id) {
        showAlert('Please search for and select a member first.', 'error');
        return;
    }

    const phone = phoneNumber.value.trim();
    if (!phone || phone.length < 9) {
        showAlert('Please enter a valid M-Pesa phone number.', 'error');
        phoneNumber.focus();
        return;
    }

    const amount = Number(amountInput.value);
    if (!amount || amount <= 0) {
        showAlert('Please enter a valid amount.', 'error');
        amountInput.focus();
        return;
    }

    isProcessing = true;
    payBtn.classList.add('loading');
    payBtn.disabled = true;

    try {
        // Same backend endpoint the public payment page uses — an
        // STK push is an STK push regardless of who triggers it, and
        // the backend confirms via M-Pesa's callback either way.
        const result = await apiRequest('/api/public/payment/stk-push', {
            method: 'POST',
            body: JSON.stringify({
                member_id: selectedMemberData.id,
                phone: phone,
                amount: amount,
                transaction_desc: 'Membership Payment (Admin-Initiated)'
            })
        });

        if (!result.success) {
            throw new Error(result.message || 'Payment initiation failed');
        }

        checkoutRequestId = result.data.checkout_request_id;

        paymentForm.style.display = 'none';
        paymentStatus.style.display = 'block';
        statusIcon.textContent = '⏳';
        statusIcon.className = 'status-icon pending';
        statusTitle.textContent = 'Payment Sent to Phone';
        statusMessage.textContent = 'Waiting for the member to enter their M-Pesa PIN.';
        statusBadge.textContent = 'Pending';
        statusBadge.className = 'payment-status-badge pending';
        checkStatusBtn.style.display = 'inline-flex';
        retryBtn.style.display = 'none';

        showAlert(`📱 STK push sent to ${phone}.`, 'info');

        startPolling();
    } catch (error) {
        console.error('Payment error:', error);
        showAlert(error.message || 'Payment initiation failed. Please try again.', 'error');
        payBtn.classList.remove('loading');
        payBtn.disabled = false;
        isProcessing = false;
    }
}
window.initiatePayment = initiatePayment;

// ============================================================
// POLL PAYMENT STATUS
// ============================================================

function startPolling() {
    pollAttempts = 0;
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(checkPaymentStatus, 3000);
}

async function checkPaymentStatus() {
    if (!checkoutRequestId) {
        showAlert('No payment request found.', 'error');
        return;
    }

    pollAttempts++;
    checkStatusBtn.disabled = true;
    checkStatusBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';

    try {
        const result = await apiRequest(`/api/public/payment/status/${checkoutRequestId}`);

        if (result.success) {
            const data = result.data;
            const status = data.status;

            if (status === 'confirmed') {
                clearInterval(pollingInterval);
                paymentSuccess(data);
                return;
            } else if (status === 'failed') {
                clearInterval(pollingInterval);
                paymentFailed(data);
                return;
            } else if (pollAttempts >= maxPollAttempts) {
                clearInterval(pollingInterval);
                statusIcon.textContent = '⏰';
                statusIcon.className = 'status-icon warning';
                statusTitle.textContent = 'Payment Taking Too Long';
                statusMessage.textContent = 'Ask the member to check their M-Pesa app, or try again.';
                statusBadge.textContent = 'Pending';
                statusBadge.className = 'payment-status-badge pending';
                checkStatusBtn.style.display = 'none';
                retryBtn.style.display = 'inline-flex';
                showAlert('Payment confirmation is taking longer than expected.', 'warning');
            }
        }
    } catch (error) {
        console.error('Status check error:', error);
        if (pollAttempts >= maxPollAttempts) clearInterval(pollingInterval);
    } finally {
        checkStatusBtn.disabled = false;
        checkStatusBtn.innerHTML = '<i class="fas fa-sync"></i> Check Status';
    }
}
window.checkPaymentStatus = checkPaymentStatus;

// ============================================================
// PAYMENT SUCCESS / FAILED
// ============================================================

function paymentSuccess(data) {
    statusIcon.textContent = '✅';
    statusIcon.className = 'status-icon success';
    statusTitle.textContent = 'Payment Successful!';
    statusMessage.textContent = 'The payment has been confirmed.';
    statusBadge.textContent = 'Confirmed';
    statusBadge.className = 'payment-status-badge confirmed';
    checkStatusBtn.style.display = 'none';
    retryBtn.style.display = 'none';

    const memberName = selectedMemberData?.full_name || '—';
    const memberNumber = selectedMemberData?.member_number || selectedMemberData?.id || '—';
    const amount = Number(amountInput.value) || 0;

    successName.textContent = memberName;
    successNumber.textContent = memberNumber;
    successAmount.textContent = formatKES(amount);

    if (data.receipt) {
        const details = document.getElementById('successDetails');
        const receiptRow = document.createElement('div');
        receiptRow.className = 'row';
        receiptRow.innerHTML = `
            <span class="label">M-Pesa Receipt</span>
            <span class="value highlight">${escapeHtml(data.receipt)}</span>
        `;
        details.appendChild(receiptRow);
    }

    lastReceiptData = {
        memberName,
        memberNumber,
        planName: selectedMemberData?.plan || 'Masika Benevolent Membership',
        amount,
        mpesaReceipt: data.receipt || '—',
        phone: phoneNumber.value.trim(),
        paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
        checkoutRequestId
    };

    showAlert('🎉 Payment confirmed successfully!', 'success');

    setTimeout(() => {
        paymentCard.style.display = 'none';
        successCard.style.display = 'block';
    }, 1200);
}

function paymentFailed(data) {
    statusIcon.textContent = '❌';
    statusIcon.className = 'status-icon failed';
    statusTitle.textContent = 'Payment Failed';
    // Backend returns the failure reason under "message", not
    // "result_desc" — see the same note in payment.js.
    statusMessage.textContent = data.message || 'Payment was not completed.';
    statusBadge.textContent = 'Failed';
    statusBadge.className = 'payment-status-badge failed';
    checkStatusBtn.style.display = 'none';
    retryBtn.style.display = 'inline-flex';

    showAlert('Payment failed.', 'error');
    isProcessing = false;

    setTimeout(() => {
        paymentForm.style.display = 'block';
        paymentStatus.style.display = 'none';
        payBtn.classList.remove('loading');
        payBtn.disabled = false;
        clearAlert();
    }, 3000);
}

// ============================================================
// RECEIPT GENERATION (client-side PDF, same layout as payment.js)
// ============================================================

function downloadReceipt() {
    if (!lastReceiptData) {
        showAlert('Receipt data not available yet.', 'error');
        return;
    }
    if (!window.jspdf) {
        showAlert('Could not load the PDF library. Check your connection and try again.', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const green = [11, 93, 59];
    const gold = [212, 168, 67];
    const grayText = [107, 114, 128];

    doc.setFillColor(...green);
    doc.rect(0, 0, pageWidth, 32, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('MASIKA BENEVOLENT', 15, 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Last Expense Benevolent Fund', 15, 22);

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('PAYMENT RECEIPT', pageWidth - 15, 18, { align: 'right' });

    doc.setDrawColor(...gold);
    doc.setLineWidth(1.2);
    doc.line(15, 36, pageWidth - 15, 36);

    let y = 48;
    doc.setTextColor(31, 41, 51);

    const receiptNo = lastReceiptData.mpesaReceipt !== '—'
        ? lastReceiptData.mpesaReceipt
        : (lastReceiptData.checkoutRequestId || 'N/A');

    doc.setFontSize(10);
    doc.setTextColor(...grayText);
    doc.text('Receipt No.', 15, y);
    doc.text('Date Issued', pageWidth - 15, y, { align: 'right' });

    y += 6;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(31, 41, 51);
    doc.text(String(receiptNo), 15, y);
    doc.text(
        lastReceiptData.paidAt.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }),
        pageWidth - 15, y, { align: 'right' }
    );

    y += 14;
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.line(15, y, pageWidth - 15, y);
    y += 10;

    const row = (label, value, bold = false) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(...grayText);
        doc.text(label, 15, y);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setTextColor(31, 41, 51);
        doc.text(String(value), pageWidth - 15, y, { align: 'right' });
        y += 9;
    };

    row('Member Name', lastReceiptData.memberName);
    row('Member Number', lastReceiptData.memberNumber);
    row('Plan', lastReceiptData.planName);
    row('Paid From (M-Pesa No.)', lastReceiptData.phone || 'N/A');
    row('Payment Method', 'M-Pesa (Paybill 348127)');
    row('Collected By', 'Admin');

    y += 4;
    doc.setDrawColor(229, 231, 235);
    doc.line(15, y, pageWidth - 15, y);
    y += 14;

    doc.setFillColor(232, 245, 238);
    doc.roundedRect(15, y - 8, pageWidth - 30, 20, 3, 3, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...grayText);
    doc.text('AMOUNT PAID', 22, y + 3);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...green);
    doc.text(formatKES(lastReceiptData.amount), pageWidth - 22, y + 4, { align: 'right' });

    y += 30;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...grayText);
    doc.text(
        'This receipt confirms membership payment only. Coverage begins after the applicable waiting period.',
        15, y, { maxWidth: pageWidth - 30 }
    );

    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.8);
    doc.line(15, pageHeight - 20, pageWidth - 15, pageHeight - 20);
    doc.setFontSize(8);
    doc.setTextColor(...grayText);
    doc.text('Masika Benevolent · Paybill 348127 · Generated automatically at payment confirmation', 15, pageHeight - 14);

    const filenameSafeNumber = String(lastReceiptData.memberNumber).replace(/[^a-zA-Z0-9]/g, '');
    doc.save(`Masika-Receipt-${filenameSafeNumber || 'member'}.pdf`);
}
window.downloadReceipt = downloadReceipt;

// ============================================================
// RESET / COLLECT ANOTHER
// ============================================================

// Back to the form for the SAME member (e.g. after a failed
// attempt) — keeps them selected so the admin doesn't have to
// search again.
function resetPayment() {
    if (pollingInterval) clearInterval(pollingInterval);

    checkoutRequestId = null;
    pollAttempts = 0;
    isProcessing = false;

    paymentForm.style.display = 'block';
    paymentStatus.style.display = 'none';
    payBtn.classList.remove('loading');
    payBtn.disabled = !selectedMemberData;

    clearAlert();
}
window.resetPayment = resetPayment;

// Full reset for a brand-new payment against a different member.
function collectAnotherPayment() {
    if (pollingInterval) clearInterval(pollingInterval);

    checkoutRequestId = null;
    pollAttempts = 0;
    isProcessing = false;
    lastReceiptData = null;

    clearSelectedMember();

    paymentForm.style.display = 'block';
    paymentStatus.style.display = 'none';
    payBtn.classList.remove('loading');

    successCard.style.display = 'none';
    paymentCard.style.display = 'block';

    // Reset the success card's extra receipt row(s) added dynamically.
    document.getElementById('successDetails').innerHTML = `
        <div class="row"><span class="label">Member Name</span><span class="value highlight" id="successName">—</span></div>
        <div class="row"><span class="label">Member Number</span><span class="value highlight" id="successNumber">—</span></div>
        <div class="row"><span class="label">Amount Paid</span><span class="value highlight" id="successAmount">KES 0</span></div>
    `;

    clearAlert();
    memberSearchInput.focus();
}
window.collectAnotherPayment = collectAnotherPayment;
