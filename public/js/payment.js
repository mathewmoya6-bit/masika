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
        MAX_POLL_ATTEMPTS: 60, // 60 x 3s = 3 minutes for the initial automatic poll
        MANUAL_RECHECK_ATTEMPTS: 5 // 5 x 3s = 15s per manual "Check Status Again" click
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
        timeoutActions: null,
        recheckStatusBtn: null,
        newPaymentBtn: null,
        timeoutReference: null,
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
        el.timeoutActions = $("timeoutActions");
        el.recheckStatusBtn = $("recheckStatusBtn");
        el.newPaymentBtn = $("newPaymentBtn");
        el.timeoutReference = $("timeoutReference");
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

    // "pending"/"processing"/etc are explicitly NOT failures — anything
    // not recognized as success or failure is treated as still-pending,
    // which is the safe default (see interpretPaymentResult below).

    // ------------------------------------------------------------------
    // interpretPaymentResult()
    // ------------------------------------------------------------------
    // extractPaymentStatus() only understands a "status"-style string
    // field. Some backends instead relay the raw Safaricom Daraja
    // callback shape, where the outcome lives in a numeric ResultCode
    // (0 = success, anything else = failure) with no "status" field at
    // all. If that's what's happening, the string-based check never
    // matches either SUCCESS_STATUSES or FAILURE_STATUSES, the poll
    // loop sits there until it times out, and the person is told
    // "verification timed out" even though the callback already came
    // in as a success. This adds that fallback so it isn't missed.
    //
    // Returns "success", "failure", or "pending".
    function interpretPaymentResult(result) {
        const data = getPaymentData(result);
        const status = extractPaymentStatus(result);

        if (SUCCESS_STATUSES.has(status)) return "success";
        if (FAILURE_STATUSES.has(status)) return "failure";

        const resultCode = firstDefined(
            data.ResultCode,
            data.resultCode,
            data.result_code,
            result?.ResultCode,
            result?.resultCode,
            result?.result_code
        );

        if (resultCode !== undefined) {
            const code = Number(resultCode);
            if (Number.isFinite(code)) {
                return code === 0 ? "success" : "failure";
            }
        }

        return "pending";
    }

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
    // runStatusChecks() is shared by the automatic post-STK-push poll
    // and the manual "Check Status Again" button, so both go through
    // the exact same success/failure handling.

    async function pollPaymentStatus() {
        state.pollAttempts = 0;
        await runStatusChecks(CONFIG.MAX_POLL_ATTEMPTS);
    }

    async function runStatusChecks(maxAttempts) {
        const startAttempt = state.pollAttempts;

        while (state.pollAttempts - startAttempt < maxAttempts) {
            state.pollAttempts++;

            try {
                const result = await apiRequest(
                    `/api/public/payment/status/${encodeURIComponent(state.checkoutRequestId)}`,
                    { method: "GET" }
                );

                state.lastStatusResult = result;
                U.log("payment.js: status poll result", result);

                const outcome = interpretPaymentResult(result);

                if (outcome === "success") {
                    await handlePaymentSuccess(result);
                    return;
                }

                if (outcome === "failure") {
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
                state.lastStatusError = err;
            }

            if (state.pollAttempts - startAttempt >= maxAttempts) {
                break;
            }

            await U.sleep(CONFIG.POLL_INTERVAL);
        }

        handlePollingTimeout();
    }

    // ============================================================
    // POLLING TIMEOUT — outcome still unknown
    // ============================================================
    // IMPORTANT: we do NOT know at this point whether the STK push
    // succeeded or failed — only that the status endpoint hasn't told
    // us either way yet. The old behavior reverted to the payment form
    // with a button labeled "Retry Payment", which re-calls the STK
    // push endpoint. If the original payment actually went through,
    // that charges the member a second time. Instead we stay on the
    // processing card and offer:
    //   - "Check Status Again" — re-polls the SAME checkout request,
    //     never sends a new STK push.
    //   - "Start New Payment" — explicit, confirmed opt-in, for when
    //     the person is sure the first attempt did not go through.

    function handlePollingTimeout() {
        U.error(
            "payment.js: payment verification inconclusive after polling.",
            "checkout_request_id:",
            state.checkoutRequestId,
            "last error:",
            state.lastStatusError || "none"
        );

        if (el.processingTitle) {
            el.processingTitle.textContent = "Still Confirming Your Payment";
        }

        if (el.processingMessage) {
            el.processingMessage.textContent =
                "We haven't received confirmation yet. If M-Pesa already deducted the " +
                "amount from your phone, do not start a new payment — tap \"Check Status " +
                "Again\" instead. This can take a few minutes.";
        }

        if (el.cancelPaymentBtn) el.cancelPaymentBtn.style.display = "none";
        if (el.timeoutActions) el.timeoutActions.style.display = "block";
        if (el.timeoutReference && state.checkoutRequestId) {
            el.timeoutReference.textContent = state.checkoutRequestId;
        }

        // Keep isProcessing true and the beforeunload warning active —
        // the person should not casually navigate away while we still
        // don't know if money moved.
    }

    // ============================================================
    // MANUAL STATUS RECHECK (safe — never sends a new STK push)
    // ============================================================

    async function manualStatusCheck() {
        if (!state.checkoutRequestId) {
            showAlert("No payment reference is available to check.", "error");
            return;
        }

        if (el.recheckStatusBtn) {
            el.recheckStatusBtn.disabled = true;
            el.recheckStatusBtn.innerHTML = '<span class="spinner"></span> Checking...';
        }
        if (el.newPaymentBtn) el.newPaymentBtn.disabled = true;
        if (el.timeoutActions) el.timeoutActions.style.display = "none";

        if (el.processingTitle) el.processingTitle.textContent = "Checking Payment Status";
        if (el.processingMessage) el.processingMessage.textContent = "Please wait...";

        try {
            await runStatusChecks(CONFIG.MANUAL_RECHECK_ATTEMPTS);
        } finally {
            if (el.recheckStatusBtn) {
                el.recheckStatusBtn.disabled = false;
                el.recheckStatusBtn.textContent = "Check Status Again";
            }
            if (el.newPaymentBtn) el.newPaymentBtn.disabled = false;
        }
    }

    // ============================================================
    // START A NEW PAYMENT (explicit opt-in, after timeout only)
    // ============================================================
    // This is the only path, after a timeout, that returns to the
    // payment form and re-enables the Pay Now button — and therefore
    // the only path that can trigger a second STK push. It requires an
    // explicit confirmation naming that risk.

    function startNewPaymentAfterTimeout() {
        const confirmed = confirm(
            "Only continue if you're sure the previous M-Pesa payment did NOT go " +
                "through. Starting a new payment will send another STK push and, if the " +
                "first one also succeeds, may charge you twice. Continue?"
        );

        if (!confirmed) return;

        resetToPaymentForm(
            "Starting a new payment. If the earlier attempt also went through, please " +
                "contact support with both M-Pesa messages so we can reconcile it.",
            "warning"
        );
    }

    // ============================================================
    // Shared reset back to the payment form
    // ============================================================

    function resetToPaymentForm(message, type) {
        if (el.processingCard) el.processingCard.style.display = "none";
        if (el.timeoutActions) el.timeoutActions.style.display = "none";
        if (el.cancelPaymentBtn) el.cancelPaymentBtn.style.display = "";
        if (el.paymentCard) el.paymentCard.style.display = "block";

        if (el.payNowBtn) {
            el.payNowBtn.disabled = false;
            el.payNowBtn.textContent = "Pay Now";
        }

        state.isProcessing = false;
        state.checkoutRequestId = null;
        state.paymentId = null;
        state.lastStatusResult = null;
        state.lastStatusError = null;

        updateStep(2, "");
        updateStep(3, "");
        updateStep(1, "completed");

        if (message) showAlert(message, type || "info");
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
        if (el.timeoutActions) el.timeoutActions.style.display = "none";
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
        // This path only runs when the backend explicitly confirmed
        // failure (a recognized failure status, or ResultCode !== 0) —
        // i.e. Safaricom told us no money moved. "Retry Payment" here
        // is a legitimate fresh attempt, unlike the timeout case above
        // where the outcome is unknown.
        U.error("payment.js: payment failed", result);

        updateStep(3, "error");

        const reason = extractPaymentMessage(result);

        await U.sleep(400);

        resetToPaymentForm("Payment failed: " + (reason || "Please try again."), "error");

        if (el.payNowBtn) el.payNowBtn.textContent = "Retry Payment";
    }

    // ============================================================
    // CANCEL PAYMENT
    // ============================================================
    // Only reachable before we've heard back either way (the button is
    // hidden once handlePollingTimeout shows the recheck actions), so
    // it's still accurate to call this a "cancel" rather than an
    // unknown outcome.

    function cancelPayment() {
        resetToPaymentForm(
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

        if (el.recheckStatusBtn) {
            el.recheckStatusBtn.addEventListener("click", event => {
                event.preventDefault();
                manualStatusCheck();
            });
        }

        if (el.newPaymentBtn) {
            el.newPaymentBtn.addEventListener("click", event => {
                event.preventDefault();
                startNewPaymentAfterTimeout();
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
        if (el.timeoutActions) el.timeoutActions.style.display = "none";
        if (el.cancelPaymentBtn) el.cancelPaymentBtn.style.display = "";
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
