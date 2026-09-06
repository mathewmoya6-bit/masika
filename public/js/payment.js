// ============================================================
// PAYMENT PAGE LOGIC — MASIKA BENEVOLENT
// ------------------------------------------------------------
// Single source of truth for payment.html. Loaded via
// <script src="js/payment.js"></script> at the end of the body.
//
// Contract with register.html (must stay in sync):
//   sessionStorage keys written by register.html and read here:
//     newMemberId, newMemberNumber, newMemberName, newMemberPhone,
//     newChamaGroupId, newChamaGroupName, newChamaMemberCount,
//     newChamaPhone, registrationAmount, isChamaRegistration
//
// Backend endpoints used (FastAPI, masika-c921.onrender.com):
//   POST /api/public/initiate-payment
//   GET  /api/public/check-payment/{transaction_id}
//
// NOTE: response field names below are read defensively (several
// aliases checked per field) because the backend's payments-table
// column names have drifted before (status/confirmed_at/notes vs
// the actual payment_status/verified_at columns) and a single
// exact-match read silently breaks the whole polling flow when
// that happens again.
// ============================================================

(function () {
    'use strict';

    // ===== CONFIGURATION =====
    const API_BASE_URL = "https://masika-c921.onrender.com";
    const CONFIG = {
        API: API_BASE_URL,
        REQUEST_TIMEOUT: 60000,
        POLL_INTERVAL: 2000,
        MAX_POLL_ATTEMPTS: 60,
    };

    // ===== DOM REFS =====
    // IMPORTANT: every element the script touches must have a key
    // here. A missing key silently becomes `undefined`, and calling
    // a method on it (e.g. .addEventListener) throws and aborts the
    // rest of whatever function it's in — that's what previously
    // broke the "Pay Now" button (paymentForm was missing here).
    const $ = id => document.getElementById(id);
    const el = {
        alertBox: $('alertBox'),
        paymentForm: $('paymentForm'),
        paymentCard: $('paymentCard'),
        processingCard: $('processingCard'),
        successCard: $('successCard'),
        memberName: $('memberName'),
        memberNumber: $('memberNumber'),
        memberPlan: $('memberPlan'),
        registrationType: $('registrationType'),
        paymentAmount: $('paymentAmount'),
        mpesaPhone: $('mpesaPhone'),
        phoneError: $('phoneError'),
        payNowBtn: $('payNowBtn'),
        backBtn: $('backBtn'),
        cancelPaymentBtn: $('cancelPaymentBtn'),
        processingTitle: $('processingTitle'),
        processingMessage: $('processingMessage'),
        successMemberNumber: $('successMemberNumber'),
        successTransactionId: $('successTransactionId'),
        successAmount: $('successAmount'),
        viewMemberBtn: $('viewMemberBtn'),
        year: $('year'),
        step1Circle: $('step1Circle'),
        step2Circle: $('step2Circle'),
        step3Circle: $('step3Circle'),
        step4Circle: $('step4Circle'),
        step1Label: $('step1Label'),
        step2Label: $('step2Label'),
        step3Label: $('step3Label'),
        step4Label: $('step4Label'),
    };

    // Fail loudly (in console) instead of silently, if the HTML and
    // this script ever drift apart again — cheaper to catch here
    // than to debug a dead button a week later.
    Object.entries(el).forEach(([key, node]) => {
        if (!node) console.error(`payment.js: expected element #${key} was not found in the DOM.`);
    });

    // ===== STATE =====
    const state = {
        memberId: null,
        groupId: null,
        isChama: false,
        amount: 0,
        memberData: null,
        transactionId: null,
        isProcessing: false,
        pollInterval: null,
        pollAttempts: 0,
    };

    // ===== UTILITY =====
    function showAlert(message, type = 'info') {
        el.alertBox.textContent = message;
        el.alertBox.className = `alert ${type} show`;
    }

    function clearAlert() {
        el.alertBox.textContent = '';
        el.alertBox.className = 'alert';
    }

    function normalizePhone(phone) {
        let value = String(phone || '').replace(/\s+/g, '').replace(/-/g, '');
        if (!value) return '';
        if (value.startsWith('+254')) value = value.substring(1);
        if (value.startsWith('0')) value = '254' + value.substring(1);
        // Bare 9-digit local number with no leading 0 (e.g. "712345678")
        // — treat as a Kenyan mobile number missing its leading zero.
        if (/^[71]\d{8}$/.test(value)) value = '254' + value;
        return value;
    }

    function validatePhone(phone) {
        const normalized = normalizePhone(phone);
        return /^254\d{9}$/.test(normalized);
    }

    function formatMoney(amount) {
        const num = Number(amount || 0);
        return 'KES ' + num.toLocaleString('en-KE', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Reads the first defined/non-null value out of a list of
    // (object, key) style lookups. Used everywhere we read a field
    // from a backend response whose exact column/key name has
    // drifted before.
    function firstDefined(...values) {
        for (const value of values) {
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return undefined;
    }

    // Normalizes a variety of possible "success" / "failure" status
    // strings the backend might send for a payment (different casing,
    // different field names — status vs payment_status vs result).
    function extractPaymentStatus(result) {
        const raw = firstDefined(
            result?.status,
            result?.payment_status,
            result?.paymentStatus,
            result?.result,
            result?.state
        );
        return String(raw || '').trim().toLowerCase();
    }

    const SUCCESS_STATUSES = new Set(['completed', 'complete', 'success', 'successful', 'paid', 'confirmed']);
    const FAILURE_STATUSES = new Set(['failed', 'failure', 'cancelled', 'canceled', 'declined', 'timeout', 'expired', 'error']);

    const CIRCLES = { 1: el.step1Circle, 2: el.step2Circle, 3: el.step3Circle, 4: el.step4Circle };
    const LABELS = { 1: el.step1Label, 2: el.step2Label, 3: el.step3Label, 4: el.step4Label };

    function updateStep(step, status) {
        const circle = CIRCLES[step];
        const label = LABELS[step];
        if (!circle || !label) return;

        circle.className = 'circle';
        label.className = 'label';

        if (status === 'active') {
            circle.classList.add('active');
            label.classList.add('active');
        } else if (status === 'completed') {
            circle.classList.add('completed');
            circle.textContent = '✓';
        } else if (status === 'error') {
            circle.classList.add('error');
            circle.textContent = '✗';
        }
    }

    function resetSteps() {
        for (let i = 1; i <= 4; i++) {
            const circle = CIRCLES[i];
            const label = LABELS[i];
            if (circle) {
                circle.className = 'circle';
                circle.textContent = i;
            }
            if (label) {
                label.className = 'label';
            }
        }
        updateStep(1, 'active');
    }

    // ===== API =====
    async function apiRequest(endpoint, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

        try {
            const response = await fetch(`${CONFIG.API}${endpoint}`, {
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                signal: controller.signal,
                ...options
            });

            clearTimeout(timer);

            let result = null;
            const responseText = await response.text();
            if (responseText) {
                try { result = JSON.parse(responseText); } catch { result = null; }
            }

            if (!response.ok) {
                let message = result?.error || result?.message || result?.detail;
                if (Array.isArray(result?.detail)) {
                    message = result.detail.map(item => {
                        const location = Array.isArray(item.loc) ? item.loc : [];
                        const field = location.length > 1 ? location.slice(1).join('.') : 'field';
                        const readableField = field.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
                        return `${readableField}: ${item.msg}`;
                    }).join(' | ');
                }
                if (typeof message === 'object' && message !== null) message = JSON.stringify(message);
                console.error(`payment.js: ${endpoint} returned HTTP ${response.status}:`, result || responseText);
                throw new Error(message || `Server returned HTTP ${response.status}.`);
            }

            return result;
        } catch (error) {
            clearTimeout(timer);
            if (error.name === 'AbortError') {
                throw new Error('The request took too long to respond. Please try again.');
            }
            console.error(`payment.js: request to ${endpoint} failed:`, error);
            throw error;
        }
    }

    // ===== LOAD PAYMENT DATA =====
    // Reads exactly the sessionStorage keys register.html writes.
    async function loadPaymentData() {
        const params = new URLSearchParams(window.location.search);

        state.memberId = params.get('member_id') || sessionStorage.getItem('newMemberId');
        state.groupId = params.get('group_id') || sessionStorage.getItem('newChamaGroupId');
        state.isChama = !!state.groupId && !state.memberId;

        if (!state.memberId && !state.groupId) {
            showAlert('No registration specified. Please restart the registration process.', 'error');
            el.payNowBtn.disabled = true;
            return;
        }

        try {
            const storedAmount = Number(sessionStorage.getItem('registrationAmount') || 0);
            const storedMemberNumber = sessionStorage.getItem('newMemberNumber') || '';
            const storedMemberName = sessionStorage.getItem('newMemberName') || '';
            const storedMemberPhone = sessionStorage.getItem('newMemberPhone') || '';
            const storedGroupName = sessionStorage.getItem('newChamaGroupName') || '';
            const storedGroupPhone = sessionStorage.getItem('newChamaPhone') || '';

            state.amount = storedAmount;
            state.memberData = {
                id: state.memberId || state.groupId,
                member_number: storedMemberNumber,
                full_name: storedMemberName,
                group_name: storedGroupName
            };

            if (state.isChama) {
                el.memberName.textContent = storedGroupName || 'Chama Group';
                el.memberNumber.textContent = state.groupId || '—';
                el.registrationType.textContent = 'Chama / Group';
                el.memberPlan.textContent = 'Chama';
                if (storedGroupPhone && !el.mpesaPhone.value) {
                    el.mpesaPhone.value = storedGroupPhone;
                }
            } else {
                el.memberName.textContent = storedMemberName || 'Member';
                el.memberNumber.textContent = storedMemberNumber || 'Pending';
                el.registrationType.textContent = 'Individual / Family';
                el.memberPlan.textContent = 'Registration';
                if (storedMemberPhone && !el.mpesaPhone.value) {
                    el.mpesaPhone.value = storedMemberPhone;
                }
            }

            el.paymentAmount.textContent = formatMoney(state.amount);

            if (state.amount <= 0) {
                console.warn('payment.js: registrationAmount was 0 or missing from sessionStorage. ' +
                    'This happens if the page was opened directly, in a new tab, or sessionStorage was cleared ' +
                    'between register.html and payment.html — reload from register.html to restore it.');
                showAlert('No registration payment amount was found. Please restart registration.', 'warning');
                el.payNowBtn.disabled = true;
                return;
            }

            el.payNowBtn.disabled = false;
            clearAlert();
            validatePhoneInput();
        } catch (error) {
            console.error('Failed to load payment data:', error);
            showAlert('Could not load payment details: ' + (error.message || 'Unknown error'), 'error');
            el.payNowBtn.disabled = true;
        }
    }

    // ===== INITIATE PAYMENT =====
    async function initiatePayment() {
        const phone = normalizePhone(el.mpesaPhone.value);

        if (!validatePhone(phone)) {
            el.phoneError.classList.add('show');
            el.mpesaPhone.classList.add('input-error');
            return;
        }

        el.phoneError.classList.remove('show');
        el.mpesaPhone.classList.remove('input-error');

        if (state.isProcessing) return;
        state.isProcessing = true;

        el.payNowBtn.disabled = true;
        el.payNowBtn.innerHTML = '<span class="spinner"></span> Processing...';
        clearAlert();
        updateStep(2, 'active');

        try {
            const payload = {
                amount: state.amount,
                phone: phone,
            };

            if (state.isChama) {
                payload.group_id = state.groupId;
                payload.payment_type = 'chama_registration';
            } else {
                payload.member_id = state.memberId;
                payload.payment_type = 'registration';
            }

            const result = await apiRequest('/api/public/initiate-payment', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            const transactionId = firstDefined(
                result?.transaction_id,
                result?.transactionId,
                result?.checkout_request_id,
                result?.CheckoutRequestID,
                result?.id
            );

            if (result?.success === false || (!transactionId && result?.error)) {
                throw new Error(result?.error || result?.message || 'Payment initiation failed.');
            }

            state.transactionId = transactionId;
            if (!state.transactionId) {
                console.error('payment.js: /api/public/initiate-payment response had no usable transaction id:', result);
                throw new Error('Payment request was accepted but no transaction ID was returned.');
            }

            const memberNumberFromResult = firstDefined(
                result?.member_number,
                result?.member?.member_number
            );
            if (memberNumberFromResult) {
                state.memberData = {
                    ...(state.memberData || {}),
                    member_number: memberNumberFromResult
                };
            }

            el.paymentCard.style.display = 'none';
            el.processingCard.style.display = 'block';
            updateStep(2, 'completed');
            updateStep(3, 'active');

            await pollPaymentStatus();

        } catch (error) {
            console.error('Payment initiation failed:', error);
            updateStep(2, 'error');
            showAlert('Payment initiation failed: ' + (error.message || 'Unknown error'), 'error');
            el.payNowBtn.disabled = false;
            el.payNowBtn.textContent = 'Pay Now';
            state.isProcessing = false;
        }
    }

    // ===== POLL PAYMENT STATUS =====
    function pollPaymentStatus() {
        state.pollAttempts = 0;

        return new Promise((resolve, reject) => {
            state.pollInterval = setInterval(async () => {
                state.pollAttempts++;

                try {
                    const result = await apiRequest(`/api/public/check-payment/${state.transactionId}`, {
                        method: 'GET'
                    });

                    const status = extractPaymentStatus(result);

                    if (SUCCESS_STATUSES.has(status)) {
                        clearInterval(state.pollInterval);
                        await handlePaymentSuccess(result);
                        resolve();
                        return;
                    }

                    if (FAILURE_STATUSES.has(status)) {
                        clearInterval(state.pollInterval);
                        await handlePaymentFailed(result);
                        reject(new Error('Payment failed or was cancelled.'));
                        return;
                    }

                    if (!status) {
                        // No recognizable status field at all — log the raw
                        // shape once so a real backend field-name change is
                        // visible in the console instead of just spinning
                        // forever with no clue why.
                        console.warn('payment.js: check-payment response had no recognizable status field:', result);
                    }

                    if (state.pollAttempts > 10) {
                        el.processingMessage.textContent =
                            `Still waiting for M-Pesa confirmation... (${Math.floor(state.pollAttempts * CONFIG.POLL_INTERVAL / 1000)}s)`;
                    }

                    if (state.pollAttempts >= CONFIG.MAX_POLL_ATTEMPTS) {
                        clearInterval(state.pollInterval);
                        showAlert('Payment verification timed out. Please check your M-Pesa messages.', 'warning');
                        el.processingCard.style.display = 'none';
                        el.paymentCard.style.display = 'block';
                        el.payNowBtn.disabled = false;
                        el.payNowBtn.textContent = 'Retry';
                        state.isProcessing = false;
                        updateStep(3, 'error');
                        reject(new Error('Payment verification timed out.'));
                    }

                } catch (error) {
                    console.warn('Polling error:', error);
                }
            }, CONFIG.POLL_INTERVAL);
        });
    }

    // ===== HANDLE PAYMENT SUCCESS =====
    async function handlePaymentSuccess(result) {
        updateStep(3, 'completed');
        updateStep(4, 'active');

        el.processingTitle.textContent = 'Payment Confirmed!';
        el.processingMessage.textContent = 'Your payment has been successfully processed.';

        await sleep(1000);
        el.processingCard.style.display = 'none';
        el.successCard.style.display = 'block';

        const finalMemberNumber = firstDefined(
            result?.member_number,
            result?.member?.member_number,
            state.memberData?.member_number,
            sessionStorage.getItem('newMemberNumber'),
            state.isChama ? state.groupId : state.memberId
        ) || '—';

        const finalTransactionId = firstDefined(
            result?.transaction_id,
            result?.transactionId,
            result?.mpesa_receipt_number,
            result?.receipt_number,
            state.transactionId
        ) || '—';

        el.successMemberNumber.textContent = finalMemberNumber;
        el.successTransactionId.textContent = finalTransactionId;
        el.successAmount.textContent = formatMoney(firstDefined(result?.amount, state.amount));

        // Clear session data — registration is fully complete now.
        sessionStorage.removeItem('newMemberId');
        sessionStorage.removeItem('newMemberNumber');
        sessionStorage.removeItem('newMemberName');
        sessionStorage.removeItem('newMemberPhone');
        sessionStorage.removeItem('newChamaGroupId');
        sessionStorage.removeItem('newChamaGroupName');
        sessionStorage.removeItem('newChamaMemberCount');
        sessionStorage.removeItem('newChamaPhone');
        sessionStorage.removeItem('registrationAmount');
        sessionStorage.removeItem('isChamaRegistration');

        if (state.isChama) {
            el.viewMemberBtn.href = `chama-details.html?id=${state.groupId}`;
            el.viewMemberBtn.textContent = 'View Chama Details';
        } else {
            el.viewMemberBtn.href = `member-details.html?id=${state.memberId}`;
            el.viewMemberBtn.textContent = 'View Member Details';
        }

        updateStep(4, 'completed');
        state.isProcessing = false;
    }

    // ===== HANDLE PAYMENT FAILED =====
    async function handlePaymentFailed(result) {
        updateStep(3, 'error');
        const reason = firstDefined(result?.message, result?.error, result?.reason);
        showAlert('Payment failed: ' + (reason || 'Please try again.'), 'error');

        await sleep(1500);
        el.processingCard.style.display = 'none';
        el.paymentCard.style.display = 'block';
        el.payNowBtn.disabled = false;
        el.payNowBtn.textContent = 'Retry Payment';
        state.isProcessing = false;
    }

    // ===== CANCEL PAYMENT =====
    function cancelPayment() {
        if (state.pollInterval) {
            clearInterval(state.pollInterval);
            state.pollInterval = null;
        }

        el.processingCard.style.display = 'none';
        el.paymentCard.style.display = 'block';
        el.payNowBtn.disabled = false;
        el.payNowBtn.textContent = 'Pay Now';
        state.isProcessing = false;
        updateStep(2, '');
        updateStep(1, 'active');
        showAlert('Payment was cancelled.', 'info');
    }

    // ===== VALIDATE PHONE =====
    function validatePhoneInput() {
        const phone = el.mpesaPhone.value;
        if (phone.length >= 9) {
            const isValid = validatePhone(phone);
            if (isValid) {
                el.phoneError.classList.remove('show');
                el.mpesaPhone.classList.remove('input-error');
                el.payNowBtn.disabled = false;
            } else {
                el.phoneError.classList.add('show');
                el.mpesaPhone.classList.add('input-error');
                el.payNowBtn.disabled = true;
            }
        } else {
            el.phoneError.classList.remove('show');
            el.mpesaPhone.classList.remove('input-error');
            el.payNowBtn.disabled = true;
        }
    }

    // ===== INIT =====
    document.addEventListener('DOMContentLoaded', async () => {
        if (el.year) el.year.textContent = new Date().getFullYear();
        resetSteps();
        await loadPaymentData();

        el.mpesaPhone.addEventListener('input', validatePhoneInput);
        el.mpesaPhone.addEventListener('blur', validatePhoneInput);

        el.paymentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await initiatePayment();
        });

        el.backBtn.addEventListener('click', () => {
            if (state.isChama) {
                window.location.href = 'register.html?mode=chama';
            } else {
                window.location.href = 'register.html';
            }
        });

        el.cancelPaymentBtn.addEventListener('click', cancelPayment);

        window.addEventListener('beforeunload', (e) => {
            if (state.isProcessing) {
                e.preventDefault();
                e.returnValue = 'Payment is being processed. Are you sure you want to leave?';
            }
        });
    });

})();
