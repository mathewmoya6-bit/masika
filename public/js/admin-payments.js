// ============================================================
// MASIKA BENEVOLENT — PAYMENT PAGE
// ============================================================
// Extracted from an inline <script> block in payment.html so it
// follows the same js/ convention as the rest of the site
// (supabase-config.js, admin-auth.js, admin-dashboard.js, etc).
// No logic was changed in this extraction — same behavior as
// the inline version, just moved to its own file.
// ============================================================

// ============================================================
// CONFIGURATION
// ============================================================

// Every request in this file goes to the FastAPI backend, never
// directly to Supabase. The service-role key that can actually
// write to the database lives only on Render; this page never
// needs any Supabase key at all.
const API_BASE_URL = 'https://masika-c921.onrender.com';

// ============================================================
// STATE
// ============================================================

let registrationData = null;
let checkoutRequestId = null;
let pollingInterval = null;
let pollAttempts = 0;
const maxPollAttempts = 60; // 60 * 3 seconds = 3 minutes
let isProcessing = false;

// Filled in by paymentSuccess() and consumed by downloadReceipt().
// Kept separate from registrationData because it carries payment-time
// facts (receipt number, paid-at timestamp) that don't exist until
// M-Pesa actually confirms the transaction.
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
const amountDisplay = document.getElementById('amountDisplay');
const memberNameDisplay = document.getElementById('memberNameDisplay');
const memberNumberDisplay = document.getElementById('memberNumberDisplay');
const accountDisplay = document.getElementById('accountDisplay');
const statusIcon = document.getElementById('statusIcon');
const statusTitle = document.getElementById('statusTitle');
const statusMessage = document.getElementById('statusMessage');
const statusBadge = document.getElementById('statusBadge');
const successName = document.getElementById('successName');
const successNumber = document.getElementById('successNumber');
const successAmount = document.getElementById('successAmount');
const membershipCardLink = document.getElementById('membershipCardLink');

// ============================================================
// API HELPER
// ============================================================

async function apiRequest(path, options = {}) {
    let response;
    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
    } catch (networkError) {
        console.error("Network error calling API:", networkError);
        throw new Error("Unable to reach the server. Please check your connection and try again.");
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
            (typeof detail === "string" && detail) ||
            (detail && detail.message) ||
            (body && body.message) ||
            `Request failed (HTTP ${response.status}).`;
        throw new Error(message);
    }

    return body;
}

// ============================================================
// LOAD PAYMENT DATA
// ============================================================

function loadPaymentData() {
    // register.html stores these individual keys after a successful
    // POST /api/public/register call (see registerMember() there) —
    // NOT a single 'registrationResult' JSON blob, and the values
    // come from the server's response, not client-side guesses.
    const memberId = sessionStorage.getItem('newMemberId');
    const memberNumber = sessionStorage.getItem('newMemberNumber');
    const memberName = sessionStorage.getItem('newMemberName');
    const memberPhone = sessionStorage.getItem('newMemberPhone');
    const memberPlan = sessionStorage.getItem('newMemberPlan');
    const amount = sessionStorage.getItem('registrationAmount');

    if (memberId && amount) {
        registrationData = {
            id: memberId,
            member_number: memberNumber || memberId,
            full_name: memberName || 'Member',
            plan_name: memberPlan || '',
            total_amount: Number(amount)
        };
        displayPaymentData(registrationData);

        // Pre-fill the M-Pesa number with the phone they registered
        // with, since that's almost always the number they'll pay
        // from. They can still edit it.
        if (memberPhone) {
            phoneNumber.value = memberPhone;
        }
        payBtn.disabled = false;
        return;
    }

    // Fallback: someone navigated here directly with a link like
    // payment.html?member_id=...&amount=...&member_number=...&name=...
    // (e.g. a bookmarked/shared link, or sessionStorage was cleared).
    // We deliberately do NOT query the database directly from the
    // browser here — there's no public "look up a member by id"
    // endpoint, and there shouldn't be one, since that would let
    // anyone enumerate member records. We only trust what's in the
    // URL itself.
    const params = new URLSearchParams(window.location.search);
    const urlMemberId = params.get('member_id');
    const urlAmount = params.get('amount');

    if (urlMemberId && urlAmount) {
        registrationData = {
            id: urlMemberId,
            member_number: params.get('member_number') || urlMemberId,
            full_name: params.get('name') || 'Member',
            plan_name: params.get('plan') || '',
            total_amount: Number(urlAmount)
        };
        displayPaymentData(registrationData);
        payBtn.disabled = false;
        return;
    }

    // Try to load from registrationResult (legacy)
    const stored = sessionStorage.getItem('registrationResult');
    if (stored) {
        try {
            const data = JSON.parse(stored);
            registrationData = {
                id: data.id || data.member_id,
                member_number: data.member_number || data.id,
                full_name: data.first_name ? `${data.first_name} ${data.last_name || ''}`.trim() : data.full_name || 'Member',
                plan_name: data.plan_name || '',
                total_amount: data.total_amount || data.registration_amount || data.amount || 0
            };
            displayPaymentData(registrationData);
            payBtn.disabled = false;
            return;
        } catch (e) {
            console.log('Invalid session data');
        }
    }

    showAlert('No payment data found. Please register first.', 'error');
    payBtn.disabled = true;
}

function displayPaymentData(data) {
    const amount = data.total_amount || data.registration_amount || data.amount || 0;
    const name = data.first_name ? `${data.first_name} ${data.last_name || ''}`.trim() : data.full_name || 'Member';
    const memberNumber = data.member_number || data.id || 'PENDING';

    amountDisplay.textContent = formatKES(amount);
    memberNameDisplay.textContent = name || '—';
    memberNumberDisplay.textContent = memberNumber;
    accountDisplay.textContent = memberNumber;

    // Store for success card
    successName.textContent = name || '—';
    successNumber.textContent = memberNumber;
    successAmount.textContent = formatKES(amount);

    // Carry the member number over to the membership card page so it
    // doesn't have to be typed in twice.
    if (membershipCardLink && memberNumber && memberNumber !== 'PENDING') {
        membershipCardLink.href = `membership-card.html?member_number=${encodeURIComponent(memberNumber)}`;
    }

    window.registrationPaymentAmount = amount;
    window.registrationData = data;
}

// ============================================================
// INITIATE PAYMENT
// ============================================================

async function initiatePayment(event) {
    event.preventDefault();

    if (isProcessing) return;

    const phone = phoneNumber.value.trim();

    if (!phone || phone.length < 9) {
        showAlert('Please enter a valid M-Pesa phone number.', 'error');
        phoneNumber.focus();
        return;
    }

    if (!registrationData || !registrationData.id) {
        showAlert('Member data not found. Please register again.', 'error');
        return;
    }

    const amount = window.registrationPaymentAmount || 0;
    if (amount <= 0) {
        showAlert('Invalid payment amount.', 'error');
        return;
    }

    isProcessing = true;
    payBtn.classList.add('loading');
    payBtn.disabled = true;

    try {
        // Call the API — must be the absolute Render URL, since this
        // page is served from a different origin (masikabbs.com) than
        // the API (masika-c921.onrender.com). A relative path here
        // would silently hit masikabbs.com/api/... and 404.
        const result = await apiRequest('/api/public/payment/stk-push', {
            method: 'POST',
            body: JSON.stringify({
                member_id: registrationData.id,
                phone: phone,
                amount: amount,
                transaction_desc: 'Membership Registration'
            })
        });

        if (!result.success) {
            throw new Error(result.message || 'Payment initiation failed');
        }

        const data = result.data;
        checkoutRequestId = data.checkout_request_id;

        // Update UI
        document.getElementById('step1').classList.remove('active');
        document.getElementById('step1').classList.add('done');
        document.getElementById('step2').classList.add('active');

        // Show payment status
        paymentForm.style.display = 'none';
        paymentStatus.style.display = 'block';
        statusIcon.textContent = '⏳';
        statusIcon.className = 'status-icon pending';
        statusTitle.textContent = 'Payment Sent to Phone';
        statusMessage.textContent = 'Please check your phone and enter your M-Pesa PIN to complete payment.';
        statusBadge.textContent = 'Pending';
        statusBadge.className = 'status-badge pending';
        checkStatusBtn.style.display = 'inline-flex';
        retryBtn.style.display = 'none';

        showAlert('📱 Payment request sent to your phone. Please enter your PIN.', 'info');

        // Start polling
        startPolling();

    } catch (error) {
        console.error('Payment error:', error);
        showAlert(error.message || 'Payment initiation failed. Please try again.', 'error');
        payBtn.classList.remove('loading');
        payBtn.disabled = false;
        isProcessing = false;
    }
}

// ============================================================
// POLL PAYMENT STATUS
// ============================================================

function startPolling() {
    pollAttempts = 0;
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }
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
                // Payment successful
                clearInterval(pollingInterval);
                paymentSuccess(data);
                return;
            } else if (status === 'failed') {
                // Payment failed
                clearInterval(pollingInterval);
                paymentFailed(data);
                return;
            } else if (pollAttempts >= maxPollAttempts) {
                // Timeout
                clearInterval(pollingInterval);
                statusIcon.textContent = '⏰';
                statusIcon.className = 'status-icon warning';
                statusTitle.textContent = 'Payment Taking Too Long';
                statusMessage.textContent = 'Please check your M-Pesa app for the payment status.';
                statusBadge.textContent = 'Pending';
                statusBadge.className = 'status-badge pending';
                checkStatusBtn.style.display = 'none';
                retryBtn.style.display = 'inline-flex';
                showAlert('Payment confirmation taking longer than expected. Please check your M-Pesa app.', 'warning');
            }
        }

    } catch (error) {
        console.error('Status check error:', error);
        if (pollAttempts >= maxPollAttempts) {
            clearInterval(pollingInterval);
        }
    } finally {
        checkStatusBtn.disabled = false;
        checkStatusBtn.innerHTML = '<i class="fas fa-sync"></i> Check Status';
    }
}

// ============================================================
// PAYMENT SUCCESS / FAILED
// ============================================================

function paymentSuccess(data) {
    document.getElementById('step2').classList.remove('active');
    document.getElementById('step2').classList.add('done');
    document.getElementById('step3').classList.add('active');

    statusIcon.textContent = '✅';
    statusIcon.className = 'status-icon success';
    statusTitle.textContent = 'Payment Successful!';
    statusMessage.textContent = 'Your registration is now complete.';
    statusBadge.textContent = 'Confirmed';
    statusBadge.className = 'status-badge confirmed';
    checkStatusBtn.style.display = 'none';
    retryBtn.style.display = 'none';

    // Update success details with actual payment data
    if (data.receipt) {
        // Add receipt to success card
        const details = document.getElementById('successDetails');
        const receiptRow = document.createElement('div');
        receiptRow.className = 'row';
        receiptRow.innerHTML = `
            <span class="label">M-Pesa Receipt</span>
            <span class="value highlight">${data.receipt}</span>
        `;
        details.appendChild(receiptRow);
    }

    // Snapshot everything downloadReceipt() will need. data.paid_at
    // is used when the backend sends it (the actual M-Pesa
    // transaction time); otherwise we fall back to "now" — close
    // enough since confirmation and receipt download happen within
    // the same session.
    lastReceiptData = {
        memberName: registrationData ? (registrationData.full_name || successName.textContent) : successName.textContent,
        memberNumber: registrationData ? (registrationData.member_number || successNumber.textContent) : successNumber.textContent,
        planName: (registrationData && registrationData.plan_name) || 'Masika Benevolent Membership',
        amount: window.registrationPaymentAmount || 0,
        mpesaReceipt: data.receipt || '—',
        phone: phoneNumber.value.trim(),
        paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
        checkoutRequestId: checkoutRequestId
    };

    showAlert('🎉 Payment confirmed successfully!', 'success');

    // Show success card after delay
    setTimeout(() => {
        paymentCard.style.display = 'none';
        successCard.style.display = 'block';
        launchConfetti();
    }, 1500);
}

function paymentFailed(data) {
    document.getElementById('step2').classList.remove('active');

    statusIcon.textContent = '❌';
    statusIcon.className = 'status-icon failed';
    statusTitle.textContent = 'Payment Failed';
    // Backend's query_stk_status() returns the failure reason under
    // "message" (e.g. {"status": "failed", "message": "..."}), not
    // "result_desc" — using the wrong key here silently showed the
    // generic fallback text for every failure instead of the real
    // M-Pesa reason (insufficient funds, cancelled, timeout, etc.).
    statusMessage.textContent = data.message || 'Payment was not completed. Please try again.';
    statusBadge.textContent = 'Failed';
    statusBadge.className = 'status-badge failed';
    checkStatusBtn.style.display = 'none';
    retryBtn.style.display = 'inline-flex';

    showAlert('Payment failed. Please try again.', 'error');
    isProcessing = false;

    // Re-enable payment form
    setTimeout(() => {
        paymentForm.style.display = 'block';
        paymentStatus.style.display = 'none';
        payBtn.classList.remove('loading');
        payBtn.disabled = false;
        document.getElementById('step1').classList.add('active');
        document.getElementById('step1').classList.remove('done');
        document.getElementById('step2').classList.remove('active', 'done');
        document.getElementById('step3').classList.remove('active');
        clearAlert();
    }, 3000);
}

// ============================================================
// RECEIPT GENERATION (client-side PDF, no backend round trip)
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
    const green = [11, 93, 59];   // --primary
    const gold = [212, 168, 67];  // --gold
    const grayText = [107, 114, 128];

    // Header band
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

    // Gold accent rule
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
        lastReceiptData.paidAt.toLocaleString('en-KE', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }),
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

    y += 4;
    doc.setDrawColor(229, 231, 235);
    doc.line(15, y, pageWidth - 15, y);
    y += 14;

    // Amount block
    doc.setFillColor(232, 245, 238); // --primary-light
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

    // Footer
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

// ============================================================
// RESET PAYMENT
// ============================================================

function resetPayment() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }

    checkoutRequestId = null;
    pollAttempts = 0;
    isProcessing = false;

    paymentForm.style.display = 'block';
    paymentStatus.style.display = 'none';
    payBtn.classList.remove('loading');
    payBtn.disabled = false;
    phoneNumber.value = '';

    document.getElementById('step1').classList.add('active');
    document.getElementById('step1').classList.remove('done');
    document.getElementById('step2').classList.remove('active', 'done');
    document.getElementById('step3').classList.remove('active');

    clearAlert();
}

// ============================================================
// CONFETTI
// ============================================================

function launchConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    const colors = ['#0b5d3b', '#d4a843', '#198754', '#ffc107', '#dc3545', '#0dcaf0', '#6f42c1'];

    for (let i = 0; i < 120; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.width = Math.random() * 10 + 4 + 'px';
        confetti.style.height = Math.random() * 10 + 4 + 'px';
        confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        confetti.style.animationDuration = Math.random() * 2.5 + 1.5 + 's';
        confetti.style.animationDelay = Math.random() * 1.5 + 's';
        container.appendChild(confetti);
    }

    setTimeout(() => {
        container.remove();
    }, 5000);
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

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

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

document.addEventListener('keydown', function(e) {
    // Ctrl+Enter to submit payment
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!payBtn.disabled) {
            document.getElementById('payBtn').click();
        }
    }
    // Escape to reset
    if (e.key === 'Escape') {
        resetPayment();
    }
});

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    loadPaymentData();

    // Focus on phone number if available, otherwise on the field
    if (phoneNumber.value) {
        phoneNumber.select();
    } else {
        phoneNumber.focus();
    }

    // Enter key to submit
    phoneNumber.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!payBtn.disabled) {
                document.getElementById('payBtn').click();
            }
        }
    });
});
