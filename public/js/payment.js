// ============================================================
// PAYMENT PAGE LOGIC — MASIKA BENEVOLENT
// ============================================================
// Requires masika-utils.js to be loaded first (provides API_BASE_URL,
// apiRequest, phone/money helpers, and debug-gated logging).
//
// FastAPI payment contract:
//   POST /api/public/payment/stk-push
//   GET  /api/public/payment/status/{checkout_request_id}
//
// Individual registration session (sessionStorage):
//   newMemberId, newMemberNumber, newMemberName, newMemberPhone,
//   registrationAmount, registrationPlan, registrationPlanName,
//   registrationType, isChamaRegistration
//
// Chama session (sessionStorage):
//   newChamaGroupId, newChamaGroupName, newChamaMemberCount, newChamaPhone
//
// IMPORTANT:
// - No Daraja credentials are stored here. M-Pesa STK Push is handled
//   entirely by the FastAPI backend.
// - KNOWN GAP: Chama payment is not yet supported by the backend's
//   StkPushRequest (member_id-only). initiatePayment() blocks it with
//   an explicit message rather than silently failing — see the
//   "Chama not supported" branch below. Remove that guard once the
//   backend accepts group_id.
// ============================================================

(function () {
    "use strict";

    const U = window.MasikaUtils;

    // ============================================================
    // CONFIGURATION
    // ============================================================

    const CONFIG = {
        REQUEST_TIMEOUT: 60000,
        POLL_INTERVAL: 3000,
        MAX_POLL_ATTEMPTS: 60
    };

    U.log("payment.js: script loaded");

    // ============================================================
    // DOM HELPER
    // ============================================================

    const $ = id => document.getElementById(id);

    // ============================================================
    // DOM ELEMENTS
    // ============================================================

    const el = {
        alertBox: null,
        paymentForm: null,
        paymentCard: null,
        processingCard: null,
        successCard: null,
        memberName: null,
        memberNumber: null,
        memberPlan: null,
        registrationType: null,
        paymentAmount: null,
        mpesaPhone: null,
        phoneError: null,
        payNowBtn: null,
        backBtn: null,
        cancelPaymentBtn: null,
        processingTitle: null,
        processingMessage: null,
        successMemberNumber: null,
        successTransactionId: null,
        successAmount: null,
        viewMemberBtn: null,
        year: null,
        step1Circle: null,
        step2Circle: null,
        step3Circle: null,
        step4Circle: null,
        step1Label: null,
        step2Label: null,
        step3Label: null,
        step4Label: null
    };

    // ============================================================
    // STATE
    // ============================================================

    const state = {
        initialized: false,
        memberId: null,
        groupId: null,
        isChama: false,
        amount: 0,
        memberData: null,
        checkoutRequestId: null,
        paymentId: null,
        isProcessing: false,
        pollAttempts: 0,
        paymentCompleted: false
    };

    // ============================================================
    // LOAD DOM REFERENCES
    // ============================================================

    function loadDomReferences() {
        el.alertBox = $("alertBox");
        el.paymentForm = $("paymentForm");
        el.paymentCard = $("paymentCard");
        el.processingCard = $("processingCard");
        el.successCard = $("successCard");
        el.memberName = $("memberName");
        el.memberNumber = $("memberNumber");
        el.memberPlan = $("memberPlan");
        el.registrationType = $("registrationType");
        el.paymentAmount = $("paymentAmount");
        el.mpesaPhone = $("mpesaPhone");
        el.phoneError = $("phoneError");
        el.payNowBtn = $("payNowBtn");
        el.backBtn = $("backBtn");
        el.cancelPaymentBtn = $("cancelPaymentBtn");
        el.processingTitle = $("processingTitle");
        el.processingMessage = $("processingMessage");
        el.successMemberNumber = $("successMemberNumber");
        el.successTransactionId = $("successTransactionId");
        el.successAmount = $("successAmount");
        el.viewMemberBtn = $("viewMemberBtn");
        el.year = $("year");
        el.step1Circle = $("step1Circle");
        el.step2Circle = $("step2Circle");
        el.step3Circle = $("step3Circle");
        el.step4Circle = $("step4Circle");
        el.step1Label = $("step1Label");
        el.step2Label = $("step2Label");
        el.step3Label = $("step3Label");
        el.step4Label = $("step4Label");

        Object.entries(el).forEach(([key, node]) => {
            if (!node) {
                U.warn(`payment.js: element #${key} was not found.`);
            }
        });
    }

    // ============================================================
    // ALERTS
    // ============================================================

    function showAlert(message, type = "info") {
        if (!el.alertBox) return;
        el.alertBox.textContent = message;
        el.alertBox.className = `alert ${type} show`;
    }

    function clearAlert() {
        if (!el.alertBox) return;
        el.alertBox.textContent = "";
        el.alertBox.className = "alert";
    }

    // ============================================================
    // GENERAL HELPERS
    // ============================================================

    function firstDefined(...values) {
        return U.firstDefined(...values);
    }

    function getSession(key) {
        try {
            return sessionStorage.getItem(key);
        } catch (err) {
            U.error("payment.js: unable to read sessionStorage:", err);
            return null;
        }
    }

    // ============================================================
    // PAYMENT RESPONSE HELPERS
    // ============================================================

    function getPaymentData(result) {
        if (result && typeof result.data === "object" && result.data !== null) {
            return result.data;
        }
        return result || {};
    }

    function extractCheckoutRequestId(result) {
        const data = getPaymentData(result);
        return firstDefined(
            data.checkout_request_id,
            data.CheckoutRequestID,
            result?.checkout_request_id,
            result?.CheckoutRequestID
        );
    }

    function extractPaymentStatus(result) {
        const data = getPaymentData(result);
        const raw = firstDefined(
            data.status,
            data.payment_status,
            data.paymentStatus,
            data.state,
            result?.status,
            result?.payment_status,
            result?.paymentStatus,
            result?.state
        );
        return String(raw || "").trim().toLowerCase();
    }

    function extractPaymentMessage(result) {
        const data = getPaymentData(result);
        return firstDefined(
            data.message,
            data.result_desc,
            data.result_description,
            result?.message,
            result?.result_desc,
            result?.result_description,
            "Payment status unavailable."
        );
    }

    function extractReceipt(result) {
        const data = getPaymentData(result);
        return firstDefined(
            data.receipt,
            data.mpesa_receipt_number,
            data.receipt_number,
            data.mpesaReceiptNumber,
            result?.receipt,
            result?.mpesa_receipt_number,
            result?.receipt_number,
            result?.mpesaReceiptNumber
        );
    }

    function extractAmount(result) {
        const data = getPaymentData(result);
        const amount = firstDefined(data.amount, result?.amount, state.amount);
        const numericAmount = Number(amount);
        return Number.isFinite(numericAmount) ? numericAmount : state.amount;
    }

    // ============================================================
    // PAYMENT STATUS
    // ============================================================

    const SUCCESS_STATUSES = new Set([
        "completed",
        "complete",
        "success",
        "successful",
        "paid",
        "confirmed"
    ]);

    const FAILURE_STATUSES = new Set([
        "failed",
        "failure",
        "cancelled",
        "canceled",
        "declined",
        "timeout",
        "expired",
        "error"
    ]);

    // ============================================================
    // PAYMENT STEPS
    // ============================================================

    function updateStep(step, status) {
        const circles = {
            1: el.step1Circle,
            2: el.step2Circle,
            3: el.step3Circle,
            4: el.step4Circle
        };
        const labels = {
            1: el.step1Label,
            2: el.step2Label,
            3: el.step3Label,
            4: el.step4Label
        };

        const circle = circles[step];
        const label = labels[step];

        if (!circle || !label) return;

        circle.className = "circle";
        label.className = "label";

        if (status === "active") {
            circle.classList.add("active");
            label.classList.add("active");
            circle.textContent = String(step);
        } else if (status === "completed") {
            circle.classList.add("completed");
            circle.textContent = "✓";
        } else if (status === "error") {
            circle.classList.add("error");
            circle.textContent = "✗";
        } else {
            circle.textContent = String(step);
        }
    }

    function resetSteps() {
        for (let i = 1; i <= 4; i++) {
            const circle = { 1: el.step1Circle, 2: el.step2Circle, 3: el.step3Circle, 4: el.step4Circle }[i];
            const label = { 1: el.step1Label, 2: el.step2Label, 3: el.step3Label, 4: el.step4Label }[i];

            if (circle) {
                circle.className = "circle";
                circle.textContent = String(i);
            }
            if (label) {
                label.className = "label";
            }
        }

        updateStep(1, "completed");
        updateStep(2, "active");
    }

    // ============================================================
    // API REQUEST (thin wrapper over the shared client so this file
    // keeps its own timeout config without duplicating fetch logic)
    // ============================================================

    async function apiRequest(endpoint, options = {}) {
        return U.apiRequest(endpoint, options, CONFIG.REQUEST_TIMEOUT);
    }

    // ============================================================
    // LOAD PAYMENT DATA
    // ============================================================

    function loadPaymentData() {
        U.log("payment.js: loading payment data...");

        const params = new URLSearchParams(window.location.search);

        state.memberId = params.get("member_id") || getSession("newMemberId");
        state.groupId = params.get("group_id") || getSession("newChamaGroupId");

        const storedChamaFlag = String(getSession("isChamaRegistration") || "").toLowerCase();

        state.isChama =
            storedChamaFlag === "true" ||
            storedChamaFlag === "1" ||
            (!!state.groupId && !state.memberId);

        // --------------------------------------------------------
        // INDIVIDUAL REGISTRATION
        // --------------------------------------------------------

        if (state.memberId) {
            const memberNumber = getSession("newMemberNumber") || "Pending";
            const memberName = getSession("newMemberName") || "Member";
            const memberPhone = getSession("newMemberPhone") || "";
            const planCode = getSession("registrationPlan") || "";
            const planName = getSession("registrationPlanName") || planCode || "—";
            const registrationType = getSession("registrationType") || "Individual";
            const storedAmount = Number(getSession("registrationAmount") || 0);

            state.amount = Number.isFinite(storedAmount) ? storedAmount : 0;

            state.memberData = {
                id: state.memberId,
                member_number: memberNumber,
                full_name: memberName,
                phone: memberPhone,
                plan_code: planCode,
                plan_name: planName
            };

            if (el.memberName) el.memberName.textContent = memberName;
            if (el.memberNumber) el.memberNumber.textContent = memberNumber;
            if (el.registrationType) el.registrationType.textContent = registrationType;
            if (el.memberPlan) el.memberPlan.textContent = planName;

            if (el.mpesaPhone && memberPhone && !el.mpesaPhone.value) {
                el.mpesaPhone.value = memberPhone;
            }

            if (el.paymentAmount) {
                el.paymentAmount.textContent = U.formatMoney(state.amount);
            }
        }

        // --------------------------------------------------------
        // CHAMA REGISTRATION
        // --------------------------------------------------------

        else if (state.isChama && state.groupId) {
            const groupName = getSession("newChamaGroupName") || "Chama Group";
            const groupPhone = getSession("newChamaPhone") || "";
            const storedAmount = Number(getSession("registrationAmount") || 0);

            state.amount = Number.isFinite(storedAmount) ? storedAmount : 0;

            state.memberData = {
                id: state.groupId,
                group_name: groupName,
                group_id: state.groupId
            };

            if (el.memberName) el.memberName.textContent = groupName;
            if (el.memberNumber) el.memberNumber.textContent = state.groupId;
            if (el.registrationType) el.registrationType.textContent = "Chama / Group";
            if (el.memberPlan) el.memberPlan.textContent = "Chama";

            if (el.mpesaPhone && groupPhone && !el.mpesaPhone.value) {
                el.mpesaPhone.value = groupPhone;
            }

            if (el.paymentAmount) {
                el.paymentAmount.textContent = U.formatMoney(state.amount);
            }
        }

        // --------------------------------------------------------
        // NOTHING FOUND — either a stale/incorrect link, or the
        // session data was lost (page refreshed, opened in a new
        // tab, or sessionStorage cleared). Give the person a clear
        // way forward instead of a dead "Loading…" screen.
        // --------------------------------------------------------

        else {
            U.error("payment.js: no member or chama registration found in URL or session.");

            showAlert(
                "We couldn't find your registration details. This can happen if the page " +
                    "was refreshed or opened in a new tab. Please return to the registration " +
                    "form to continue — your details will need to be re-entered.",
                "error"
            );

            if (el.payNowBtn) el.payNowBtn.disabled = true;
            return;
        }

        // --------------------------------------------------------
        // VALIDATE AMOUNT
        // --------------------------------------------------------

        if (state.amount <= 0) {
            U.error("payment.js: invalid registration amount:", state.amount);

            showAlert(
                "We found your registration but not a valid payment amount. This can happen " +
                    "if the session expired. Please return to the registration form and try again.",
                "warning"
            );

            if (el.payNowBtn) el.payNowBtn.disabled = true;
            return;
        }

        // --------------------------------------------------------
        // ENABLE PAYMENT
        // --------------------------------------------------------

        if (el.payNowBtn) el.payNowBtn.disabled = false;

        clearAlert();
        validatePhoneInput();

        U.log("payment.js: payment data loaded", {
            memberId: state.memberId,
            amount: state.amount,
            phone: U.maskPhone(el.mpesaPhone?.value)
        });
    }

    // ============================================================
    // INITIATE PAYMENT
    // ============================================================

    async function initiatePayment() {
        if (state.isProcessing) {
            U.warn("payment.js: payment already processing.");
            return;
        }

        // ========================================================
        // CHAMA NOT SUPPORTED BY CURRENT BACKEND
        // ========================================================
        // The FastAPI StkPushRequest currently only accepts member_id.
        // This guard prevents a Chama group registration from being
        // silently charged against the wrong entity. Remove once the
        // backend adds group_id support to /api/public/payment/stk-push.

        if (state.isChama) {
            showAlert(
                "Chama registration payment is not yet enabled on the current payment API. " +
                    "Please contact support to complete this payment.",
                "warning"
            );
            U.warn(
                "payment.js: Chama payment blocked — backend StkPushRequest requires member_id only."
            );
            return;
        }

        if (!state.memberId) {
            showAlert("Member information is missing. Please restart registration.", "error");
            return;
        }

        if (!el.mpesaPhone) {
            showAlert("M-Pesa phone number field was not found.", "error");
            return;
        }

        const phone = U.normalizePhone(el.mpesaPhone.value);

        if (!U.isValidKenyanPhone(phone)) {
            if (el.phoneError) el.phoneError.classList.add("show");
            el.mpesaPhone.classList.add("input-error");
            showAlert("Please enter a valid Kenyan M-Pesa phone number.", "warning");
            return;
        }

        if (el.phoneError) el.phoneError.classList.remove("show");
        el.mpesaPhone.classList.remove("input-error");

        if (!state.amount || state.amount <= 0) {
            showAlert("Invalid registration payment amount. Please restart registration.", "error");
            return;
        }

        state.isProcessing = true;

        if (el.payNowBtn) {
            el.payNowBtn.disabled = true;
            el.payNowBtn.innerHTML = '<span class="spinner"></span> Processing...';
        }

        clearAlert();
        updateStep(2, "active");

        // ========================================================
        // FASTAPI PAYLOAD
        // ========================================================
        // Current backend StkPushRequest accepts: member_id, phone,
        // amount, transaction_desc. Do NOT send group_id/payment_type.

        const payload = {
            member_id: state.memberId,
            phone: phone,
            amount: state.amount,
            transaction_desc: "Membership Registration"
        };

        U.log("payment.js: initiating STK payment", {
            member_id: state.memberId,
            phone: U.maskPhone(phone),
            amount: state.amount
        });

        try {
            const result = await apiRequest("/api/public/payment/stk-push", {
                method: "POST",
                body: JSON.stringify(payload)
            });

            if (result?.success === false) {
                throw new Error(result?.message || result?.error || "Payment initiation failed.");
            }

            const checkoutRequestId = extractCheckoutRequestId(result);

            if (!checkoutRequestId) {
                U.error("payment.js: no checkout_request_id returned from stk-push.");
                throw new Error(
                    "Payment request was accepted but no M-Pesa checkout ID was returned by the server."
                );
            }

            state.checkoutRequestId = String(checkoutRequestId);

            const paymentData = getPaymentData(result);
            state.paymentId = firstDefined(paymentData.payment_id, result?.payment_id);

            const memberNumberFromResult = firstDefined(
                paymentData.member_number,
                paymentData.member?.member_number,
                result?.member_number,
                result?.member?.member_number
            );

            if (memberNumberFromResult) {
                if (state.memberData) state.memberData.member_number = memberNumberFromResult;
                if (el.memberNumber) el.memberNumber.textContent = memberNumberFromResult;
            }

            if (el.paymentCard) el.paymentCard.style.display = "none";
            if (el.processingCard) el.processingCard.style.display = "block";

            updateStep(2, "completed");
            updateStep(3, "active");

            if (el.processingTitle) el.processingTitle.textContent = "Check Your Phone";
            if (el.processingMessage) {
                el.processingMessage.textContent =
                    "Please enter your M-Pesa PIN on the STK prompt sent to your phone.";
            }

            await pollPaymentStatus();
        } catch (err) {
            U.error("payment.js: payment initiation failed:", err);

            updateStep(2, "error");
            showAlert("Payment initiation failed: " + (err.message || "Unknown error"), "error");

            if (el.payNowBtn) {
                el.payNowBtn.disabled = false;
                el.payNowBtn.textContent = "Pay Now";
            }

            state.isProcessing = false;
        }
    }

    // ============================================================
    // POLL PAYMENT STATUS
    // ============================================================
    // Sequential requests (not setInterval) so requests never overlap.

    async function pollPaymentStatus() {
        state.pollAttempts = 0;

        while (state.pollAttempts < CONFIG.MAX_POLL_ATTEMPTS) {
            state.pollAttempts++;

            try {
                const result = await apiRequest(
                    `/api/public/payment/status/${encodeURIComponent(state.checkoutRequestId)}`,
                    { method: "GET" }
                );

                const paymentStatus = extractPaymentStatus(result);

                if (SUCCESS_STATUSES.has(paymentStatus)) {
                    await handlePaymentSuccess(result);
                    return;
                }

                if (FAILURE_STATUSES.has(paymentStatus)) {
                    await handlePaymentFailed(result);
                    return;
                }

                if (el.processingMessage) {
                    const seconds = Math.floor(
                        (state.pollAttempts * CONFIG.POLL_INTERVAL) / 1000
                    );

                    el.processingMessage.textContent =
                        state.pollAttempts <= 5
                            ? "Waiting for M-Pesa confirmation..."
                            : `Waiting for M-Pesa confirmation... (${seconds}s)`;
                }
            } catch (err) {
                U.warn("payment.js: payment polling error:", err);

                if (state.pollAttempts >= CONFIG.MAX_POLL_ATTEMPTS) {
                    handlePollingTimeout(err);
                    return;
                }
            }

            await U.sleep(CONFIG.POLL_INTERVAL);
        }

        handlePollingTimeout();
    }

    // ============================================================
    // POLLING TIMEOUT
    // ============================================================

    function handlePollingTimeout(err) {
        U.error("payment.js: payment verification timed out.", err || "");

        updateStep(3, "error");

        if (el.processingCard) el.processingCard.style.display = "none";
        if (el.paymentCard) el.paymentCard.style.display = "block";

        if (el.payNowBtn) {
            el.payNowBtn.disabled = false;
            el.payNowBtn.textContent = "Retry Payment";
        }

        state.isProcessing = false;

        showAlert(
            "Payment verification timed out. Please check your M-Pesa messages before trying again.",
            "warning"
        );
    }

    // ============================================================
    // PAYMENT SUCCESS
    // ============================================================

    async function handlePaymentSuccess(result) {
        U.log("payment.js: payment success");

        state.paymentCompleted = true;

        updateStep(3, "completed");
        updateStep(4, "active");

        if (el.processingTitle) el.processingTitle.textContent = "Payment Confirmed!";
        if (el.processingMessage) {
            el.processingMessage.textContent = "Your payment has been successfully processed.";
        }

        await U.sleep(800);

        if (el.processingCard) el.processingCard.style.display = "none";
        if (el.successCard) el.successCard.style.display = "block";

        const paymentData = getPaymentData(result);

        const finalMemberNumber =
            firstDefined(
                paymentData.member_number,
                paymentData.member?.member_number,
                result?.member_number,
                result?.member?.member_number,
                state.memberData?.member_number,
                getSession("newMemberNumber"),
                state.memberId
            ) || "—";

        const receipt = extractReceipt(result);

        const finalTransactionId =
            firstDefined(
                receipt,
                paymentData.transaction_id,
                paymentData.transactionId,
                result?.transaction_id,
                result?.transactionId,
                state.checkoutRequestId
            ) || "—";

        const finalAmount = extractAmount(result);

        if (el.successMemberNumber) el.successMemberNumber.textContent = finalMemberNumber;
        if (el.successTransactionId) el.successTransactionId.textContent = finalTransactionId;
        if (el.successAmount) el.successAmount.textContent = U.formatMoney(finalAmount);

        if (el.viewMemberBtn) {
            el.viewMemberBtn.href = `member-details.html?id=${encodeURIComponent(state.memberId)}`;
            el.viewMemberBtn.textContent = "View Member Details";
        }

        clearRegistrationSession();
        updateStep(4, "completed");

        state.isProcessing = false;
    }

    // ============================================================
    // CLEAR REGISTRATION SESSION
    // ============================================================

    function clearRegistrationSession() {
        const sessionKeys = [
            "newMemberId",
            "newMemberNumber",
            "newMemberName",
            "newMemberPhone",
            "registrationAmount",
            "registrationPlan",
            "registrationPlanName",
            "registrationType",
            "isChamaRegistration",
            "newChamaGroupId",
            "newChamaGroupName",
            "newChamaMemberCount",
            "newChamaPhone"
        ];

        sessionKeys.forEach(key => {
            try {
                sessionStorage.removeItem(key);
            } catch (err) {
                U.warn(`payment.js: unable to remove session key ${key}:`, err);
            }
        });
    }

    // ============================================================
    // PAYMENT FAILED
    // ============================================================

    async function handlePaymentFailed(result) {
        U.error("payment.js: payment failed", result);

        updateStep(3, "error");

        const reason = extractPaymentMessage(result);

        showAlert("Payment failed: " + (reason || "Please try again."), "error");

        await U.sleep(1200);

        if (el.processingCard) el.processingCard.style.display = "none";
        if (el.paymentCard) el.paymentCard.style.display = "block";

        if (el.payNowBtn) {
            el.payNowBtn.disabled = false;
            el.payNowBtn.textContent = "Retry Payment";
        }

        state.isProcessing = false;
    }

    // ============================================================
    // CANCEL PAYMENT
    // ============================================================

    function cancelPayment() {
        if (el.processingCard) el.processingCard.style.display = "none";
        if (el.paymentCard) el.paymentCard.style.display = "block";

        if (el.payNowBtn) {
            el.payNowBtn.disabled = false;
            el.payNowBtn.textContent = "Pay Now";
        }

        state.isProcessing = false;

        updateStep(2, "");
        updateStep(3, "");
        updateStep(1, "completed");

        showAlert(
            "Payment was cancelled. If you already approved the M-Pesa prompt, please wait for confirmation before attempting another payment.",
            "info"
        );
    }

    // ============================================================
    // PHONE VALIDATION UI
    // ============================================================

    function validatePhoneInput() {
        if (!el.mpesaPhone) return false;

        const phone = el.mpesaPhone.value;

        if (!phone) {
            if (el.phoneError) el.phoneError.classList.remove("show");
            el.mpesaPhone.classList.remove("input-error");
            if (el.payNowBtn) el.payNowBtn.disabled = true;
            return false;
        }

        const isValid = U.isValidKenyanPhone(phone);

        if (isValid) {
            if (el.phoneError) el.phoneError.classList.remove("show");
            el.mpesaPhone.classList.remove("input-error");

            if (el.payNowBtn && state.amount > 0 && !state.isProcessing) {
                el.payNowBtn.disabled = false;
            }

            return true;
        }

        if (el.phoneError) el.phoneError.classList.add("show");
        el.mpesaPhone.classList.add("input-error");
        if (el.payNowBtn) el.payNowBtn.disabled = true;

        return false;
    }

    // ============================================================
    // ATTACH EVENT HANDLERS
    // ============================================================

    function attachEventHandlers() {
        if (el.year) el.year.textContent = new Date().getFullYear();

        if (el.mpesaPhone) {
            el.mpesaPhone.addEventListener("input", validatePhoneInput);
            el.mpesaPhone.addEventListener("blur", validatePhoneInput);
        }

        if (el.paymentForm) {
            el.paymentForm.addEventListener("submit", async event => {
                event.preventDefault();
                event.stopPropagation();
                await initiatePayment();
            });
        } else {
            U.warn("payment.js: #paymentForm not found.");
        }

        // payNowBtn is type="submit" inside paymentForm, so the form's
        // submit handler already covers clicks — a second click listener
        // here would double-fire initiatePayment(). state.isProcessing
        // guards against that regardless, but we don't rely on it twice.

        if (el.backBtn) {
            el.backBtn.addEventListener("click", event => {
                event.preventDefault();
                window.location.href = state.isChama
                    ? "register.html?mode=chama"
                    : "register.html";
            });
        }

        if (el.cancelPaymentBtn) {
            el.cancelPaymentBtn.addEventListener("click", event => {
                event.preventDefault();
                cancelPayment();
            });
        }

        window.addEventListener("beforeunload", event => {
            if (state.isProcessing && !state.paymentCompleted) {
                event.preventDefault();
                event.returnValue =
                    "Payment is being processed. Are you sure you want to leave?";
            }
        });
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================
    // Checks document.readyState so this still initializes correctly
    // if the script happens to load after DOMContentLoaded has fired.

    function initializePaymentPage() {
        if (state.initialized) return;
        state.initialized = true;

        loadDomReferences();

        if (el.successCard) el.successCard.style.display = "none";
        if (el.processingCard) el.processingCard.style.display = "none";
        if (el.paymentCard) el.paymentCard.style.display = "block";

        resetSteps();
        attachEventHandlers();

        try {
            loadPaymentData();
        } catch (err) {
            U.error("payment.js: initialization failed:", err);

            showAlert(
                "Could not initialize payment page: " + (err.message || "Unknown error"),
                "error"
            );

            if (el.payNowBtn) el.payNowBtn.disabled = true;
            return;
        }

        U.log("payment.js: initialization complete", {
            memberId: state.memberId,
            groupId: state.groupId,
            isChama: state.isChama,
            amount: state.amount
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializePaymentPage, { once: true });
    } else {
        initializePaymentPage();
    }
})();
