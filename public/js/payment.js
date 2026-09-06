```javascript
// ============================================================
// MASIKA BENEvolent - PAYMENTS
// ============================================================
//
// Frontend payment flow:
//
// Browser
//   ↓
// FastAPI POST /api/public/payment/stk-push
//   ↓
// Safaricom Daraja STK Push
//   ↓
// FastAPI receives/processes callback
//   ↓
// Browser polls:
// /api/public/payment/status/{checkout_request_id}
//
// IMPORTANT:
// ------------------------------------------------------------
// NEVER put Daraja consumer key, consumer secret, passkey,
// shortcode, or other Safaricom credentials in this file.
//
// All Safaricom communication MUST happen through FastAPI.
//
// ============================================================

const API_BASE_URL = "https://masika-c921.onrender.com";

// Prevent duplicate submissions while payment is being started
// or monitored.
let paymentInProgress = false;

// Current polling timer.
let paymentMonitorTimer = null;

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    initializePaymentForm();
    loadRegistrationPayment();
});


// ============================================================
// INITIALIZE PAYMENT FORM
// ============================================================

function initializePaymentForm() {

    const form = document.getElementById("paymentForm");

    if (!form) {
        console.warn("Payment form #paymentForm was not found.");
        return;
    }

    form.addEventListener("submit", handlePayment);
}


// ============================================================
// LOAD REGISTRATION PAYMENT
// ============================================================

function loadRegistrationPayment() {

    const registration = getStoredRegistration();

    if (!registration) {
        console.warn("No registrationResult found in sessionStorage.");
        return;
    }

    // Support the different names that may exist in the
    // registration response.
    const amount =
        registration.amount ??
        registration.total_amount ??
        registration.registration_amount;

    if (amount !== undefined && amount !== null) {

        const numericAmount = Number(amount);

        if (Number.isFinite(numericAmount) && numericAmount > 0) {

            window.registrationPaymentAmount = numericAmount;

            updatePaymentAmount(numericAmount);
        }
    }

    // --------------------------------------------------------
    // MEMBER NAME
    // --------------------------------------------------------

    const name =
        registration.full_name ||
        [
            registration.first_name,
            registration.last_name
        ]
            .filter(Boolean)
            .join(" ");

    if (name) {

        const nameElement = document.getElementById("memberName");

        if (nameElement) {
            nameElement.textContent = name;
        }
    }

    // --------------------------------------------------------
    // MEMBER NUMBER
    // --------------------------------------------------------

    if (registration.member_number) {

        const numberElement =
            document.getElementById("memberNumber");

        if (numberElement) {
            numberElement.textContent =
                registration.member_number;
        }
    }
}


// ============================================================
// UPDATE PAYMENT AMOUNT
// ============================================================

function updatePaymentAmount(amount) {

    const elements = [
        document.getElementById("paymentAmount"),
        document.getElementById("amountToPay"),
        document.querySelector("[data-payment-amount]")
    ];

    elements.forEach(element => {

        if (element) {
            element.textContent = formatKES(amount);
        }

    });
}


// ============================================================
// HANDLE PAYMENT
// ============================================================

async function handlePayment(event) {

    event.preventDefault();

    // --------------------------------------------------------
    // DOUBLE SUBMIT PROTECTION
    // --------------------------------------------------------

    if (paymentInProgress) {

        console.warn(
            "Payment already in progress. Duplicate submission ignored."
        );

        return;
    }

    const form = event.currentTarget;

    const phoneInput =
        form.querySelector('[name="phone"], #mpesaPhone');

    const rawPhone =
        phoneInput?.value?.trim() || "";

    const amount =
        Number(window.registrationPaymentAmount);

    // --------------------------------------------------------
    // VALIDATE PHONE
    // --------------------------------------------------------

    const phone = normalizeKenyanPhone(rawPhone);

    if (!phone) {

        showPaymentError(
            "Please enter a valid Kenyan M-Pesa phone number."
        );

        return;
    }

    // --------------------------------------------------------
    // VALIDATE AMOUNT
    // --------------------------------------------------------

    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {

        showPaymentError(
            "The registration payment amount is not available."
        );

        return;
    }

    // --------------------------------------------------------
    // GET REGISTRATION
    // --------------------------------------------------------

    const registrationResult =
        getStoredRegistration();

    if (!registrationResult) {

        showPaymentError(
            "Could not find your registration. Please restart registration."
        );

        return;
    }

    const memberId =
        registrationResult.member_id ||
        registrationResult.id;

    if (!memberId) {

        showPaymentError(
            "Your registration does not have a valid member ID. Please contact support."
        );

        return;
    }

    // --------------------------------------------------------
    // LOCK PAYMENT
    // --------------------------------------------------------

    const button =
        form.querySelector('[type="submit"]');

    paymentInProgress = true;

    setPaymentLoading(button, true);

    clearPaymentMessages();

    // --------------------------------------------------------
    // PAYLOAD
    // --------------------------------------------------------

    const payload = {
        member_id: memberId,
        phone: phone,
        amount: amount,
        transaction_desc: "Membership Registration"
    };

    console.log("Starting Masika payment:", {
        member_id: memberId,
        phone: phone,
        amount: amount
    });

    try {

        // ----------------------------------------------------
        // START STK PUSH
        // ----------------------------------------------------

        const response = await fetch(
            `${API_BASE_URL}/api/public/payment/stk-push`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },

                body: JSON.stringify(payload)
            }
        );

        // ----------------------------------------------------
        // READ RESPONSE
        // ----------------------------------------------------

        const result =
            await parseJsonResponse(response);

        // ----------------------------------------------------
        // HTTP ERROR
        // ----------------------------------------------------

        if (!response.ok) {

            const message =
                extractApiError(result) ||
                `Payment request failed (HTTP ${response.status}).`;

            throw new Error(message);
        }

        // ----------------------------------------------------
        // APPLICATION ERROR
        // ----------------------------------------------------

        if (
            !result ||
            result.success === false
        ) {

            const message =
                extractApiError(result) ||
                "Payment could not be initiated.";

            throw new Error(message);
        }

        const data =
            result.data || result;

        // ----------------------------------------------------
        // ALREADY PAID
        // ----------------------------------------------------

        if (data.already_paid === true) {

            showPaymentSuccess(
                "Registration fee has already been paid."
            );

            setTimeout(() => {

                window.location.href =
                    "confirmation.html";

            }, 1200);

            return;
        }

        // ----------------------------------------------------
        // CHECKOUT REQUEST ID
        // ----------------------------------------------------

        const checkoutRequestId =
            data.checkout_request_id ||
            data.CheckoutRequestID ||
            data.checkoutRequestId;

        if (!checkoutRequestId) {

            throw new Error(
                "The payment request was accepted, but no Safaricom checkout reference was returned."
            );
        }

        // ----------------------------------------------------
        // REUSED EXISTING STK REQUEST
        // ----------------------------------------------------

        if (data.reused === true) {

            showPaymentSuccess(
                "A payment request is already in progress. Please check your phone and enter your M-Pesa PIN."
            );

        } else {

            showPaymentSuccess(
                "Payment request sent. Please check your phone and enter your M-Pesa PIN."
            );
        }

        // ----------------------------------------------------
        // MONITOR PAYMENT
        // ----------------------------------------------------

        await monitorPayment(
            checkoutRequestId
        );

    } catch (error) {

        console.error(
            "Masika payment error:",
            error
        );

        showPaymentError(
            error?.message ||
            "Unable to start the M-Pesa payment. Please try again."
        );

        paymentInProgress = false;

        setPaymentLoading(
            button,
            false
        );
    }
}


// ============================================================
// MONITOR PAYMENT
// ============================================================
//
// Polls FastAPI for the payment status.
//
// IMPORTANT:
// We intentionally use recursive setTimeout rather than
// setInterval(async...), preventing overlapping HTTP requests.
//

async function monitorPayment(checkoutRequestId) {

    // Stop an old monitor if one exists.
    stopPaymentMonitor();

    const maxAttempts = 40;
    const pollDelay = 3000;

    let attempts = 0;

    const button =
        document.querySelector(
            "#paymentForm [type='submit']"
        );

    return new Promise(resolve => {

        const poll = async () => {

            attempts++;

            try {

                const response = await fetch(
                    `${API_BASE_URL}/api/public/payment/status/${encodeURIComponent(checkoutRequestId)}`,
                    {
                        method: "GET",
                        headers: {
                            "Accept": "application/json"
                        },
                        cache: "no-store"
                    }
                );

                const result =
                    await parseJsonResponse(response);

                // ------------------------------------------------
                // HTTP ERROR
                // ------------------------------------------------

                if (!response.ok) {

                    console.error(
                        "Payment status HTTP error:",
                        response.status,
                        result
                    );

                    // Allow temporary backend errors to be retried.
                    if (attempts < maxAttempts) {

                        paymentMonitorTimer =
                            setTimeout(
                                poll,
                                pollDelay
                            );

                        return;
                    }

                    finishPaymentMonitoring();

                    showPaymentError(
                        "We could not confirm the payment status. If you completed the M-Pesa prompt, please wait a moment before retrying."
                    );

                    resolve();

                    return;
                }

                const data =
                    result?.data || result;

                if (!data) {

                    if (attempts < maxAttempts) {

                        paymentMonitorTimer =
                            setTimeout(
                                poll,
                                pollDelay
                            );

                        return;
                    }

                    finishPaymentMonitoring();

                    showPaymentError(
                        "Payment confirmation is taking longer than expected."
                    );

                    resolve();

                    return;
                }

                const status =
                    String(
                        data.status ||
                        data.payment_status ||
                        ""
                    )
                        .trim()
                        .toUpperCase();

                console.log(
                    `Payment status attempt ${attempts}:`,
                    status
                );

                // ------------------------------------------------
                // SUCCESS
                // ------------------------------------------------

                if (
                    [
                        "CONFIRMED",
                        "PAID",
                        "SUCCESS",
                        "COMPLETED"
                    ].includes(status)
                ) {

                    stopPaymentMonitor();

                    paymentCompleted(data);

                    resolve();

                    return;
                }

                // ------------------------------------------------
                // FAILURE
                // ------------------------------------------------

                if (
                    [
                        "FAILED",
                        "CANCELLED",
                        "CANCELED",
                        "REJECTED",
                        "EXPIRED"
                    ].includes(status)
                ) {

                    stopPaymentMonitor();

                    showPaymentError(
                        data.result_desc ||
                        data.message ||
                        "The M-Pesa payment was not completed."
                    );

                    paymentInProgress = false;

                    setPaymentLoading(
                        button,
                        false
                    );

                    resolve();

                    return;
                }

                // ------------------------------------------------
                // STILL PENDING
                // ------------------------------------------------

                if (attempts >= maxAttempts) {

                    stopPaymentMonitor();

                    showPaymentError(
                        "Payment confirmation is taking longer than expected. If you completed the M-Pesa prompt, please wait a moment before retrying."
                    );

                    paymentInProgress = false;

                    setPaymentLoading(
                        button,
                        false
                    );

                    resolve();

                    return;
                }

                // ------------------------------------------------
                // CONTINUE POLLING
                // ------------------------------------------------

                paymentMonitorTimer =
                    setTimeout(
                        poll,
                        pollDelay
                    );

            } catch (error) {

                console.error(
                    "Payment monitoring error:",
                    error
                );

                if (attempts >= maxAttempts) {

                    stopPaymentMonitor();

                    showPaymentError(
                        "We could not confirm the payment. Please check your M-Pesa messages and try again if necessary."
                    );

                    paymentInProgress = false;

                    setPaymentLoading(
                        button,
                        false
                    );

                    resolve();

                    return;
                }

                // Temporary network failure:
                // continue polling.
                paymentMonitorTimer =
                    setTimeout(
                        poll,
                        pollDelay
                    );
            }
        };

        poll();
    });
}


// ============================================================
// STOP PAYMENT MONITOR
// ============================================================

function stopPaymentMonitor() {

    if (paymentMonitorTimer) {

        clearTimeout(
            paymentMonitorTimer
        );

        paymentMonitorTimer = null;
    }
}


// ============================================================
// FINISH PAYMENT MONITORING
// ============================================================

function finishPaymentMonitoring() {

    stopPaymentMonitor();

    paymentInProgress = false;

    const button =
        document.querySelector(
            "#paymentForm [type='submit']"
        );

    setPaymentLoading(
        button,
        false
    );
}


// ============================================================
// PAYMENT COMPLETED
// ============================================================

function paymentCompleted(payment) {

    const completedPayment = {

        amount:
            payment.amount ??
            window.registrationPaymentAmount,

        receipt_number:
            payment.receipt ||
            payment.receipt_number ||
            payment.mpesa_receipt ||
            null,

        checkout_request_id:
            payment.checkout_request_id ||
            payment.checkoutRequestId ||
            null,

        created_at:
            new Date().toISOString()
    };

    sessionStorage.setItem(
        "completedPayment",
        JSON.stringify(completedPayment)
    );

    showPaymentSuccess(
        "✅ Payment received successfully!"
    );

    // Do not unlock the button here.
    // We are navigating to confirmation.
    paymentInProgress = true;

    setTimeout(() => {

        window.location.href =
            "confirmation.html";

    }, 1500);
}


// ============================================================
// GET STORED REGISTRATION
// ============================================================

function getStoredRegistration() {

    const stored =
        sessionStorage.getItem(
            "registrationResult"
        );

    if (!stored) {
        return null;
    }

    try {

        return JSON.parse(stored);

    } catch (error) {

        console.error(
            "Invalid registrationResult:",
            error
        );

        return null;
    }
}


// ============================================================
// NORMALIZE KENYAN PHONE
// ============================================================
//
// Accepted examples:
//
// 0712345678
// 0722123456
// +254712345678
// 254712345678
// 712345678
//
// Returned format:
//
// 254712345678
//

function normalizeKenyanPhone(phone) {

    let value =
        String(phone || "")
            .replace(/\s+/g, "")
            .replace(/-/g, "");

    if (!value) {
        return null;
    }

    // +2547XXXXXXXX
    if (value.startsWith("+254")) {
        value = value.substring(1);
    }

    // 07XXXXXXXX / 01XXXXXXXX
    if (
        value.startsWith("07") ||
        value.startsWith("01")
    ) {

        value =
            "254" +
            value.substring(1);
    }

    // 7XXXXXXXX / 1XXXXXXXX
    else if (
        value.startsWith("7") ||
        value.startsWith("1")
    ) {

        value =
            "254" +
            value;
    }

    // Must now be 254 + 9 digits.
    if (
        !/^254[17]\d{8}$/.test(value)
    ) {

        return null;
    }

    return value;
}


// ============================================================
// PARSE JSON RESPONSE
// ============================================================

async function parseJsonResponse(response) {

    const text =
        await response.text();

    if (!text) {
        return null;
    }

    try {

        return JSON.parse(text);

    } catch (error) {

        console.error(
            "Non-JSON API response:",
            text
        );

        return {
            message: text
        };
    }
}


// ============================================================
// EXTRACT API ERROR
// ============================================================

function extractApiError(result) {

    if (!result) {
        return null;
    }

    // Standard API message
    if (
        typeof result.message === "string" &&
        result.message.trim()
    ) {

        return result.message.trim();
    }

    // FastAPI detail
    if (
        typeof result.detail === "string" &&
        result.detail.trim()
    ) {

        return result.detail.trim();
    }

    // FastAPI validation error
    if (Array.isArray(result.detail)) {

        return result.detail
            .map(item => {

                if (
                    typeof item === "string"
                ) {
                    return item;
                }

                if (
                    item?.msg
                ) {
                    return item.msg;
                }

                return null;

            })
            .filter(Boolean)
            .join("; ");
    }

    // Nested data.message
    if (
        typeof result.data?.message === "string" &&
        result.data.message.trim()
    ) {

        return result.data.message.trim();
    }

    return null;
}


// ============================================================
// UI - ERROR
// ============================================================

function showPaymentError(message) {

    const element =
        document.getElementById("paymentError") ||
        document.getElementById("errorMessage");

    if (!element) {

        alert(message);

        return;
    }

    element.textContent =
        message;

    element.style.display =
        "block";

    element.classList.add(
        "show"
    );
}


// ============================================================
// UI - SUCCESS / INFORMATION
// ============================================================

function showPaymentSuccess(message) {

    const element =
        document.getElementById("paymentSuccess") ||
        document.getElementById("successMessage");

    if (!element) {

        alert(message);

        return;
    }

    element.textContent =
        message;

    element.style.display =
        "block";

    element.classList.add(
        "show"
    );
}


// ============================================================
// CLEAR PAYMENT MESSAGES
// ============================================================

function clearPaymentMessages() {

    const error =
        document.getElementById("paymentError") ||
        document.getElementById("errorMessage");

    const success =
        document.getElementById("paymentSuccess") ||
        document.getElementById("successMessage");

    if (error) {

        error.textContent = "";

        error.style.display =
            "none";

        error.classList.remove(
            "show"
        );
    }

    if (success) {

        success.textContent = "";

        success.style.display =
            "none";

        success.classList.remove(
            "show"
        );
    }
}


// ============================================================
// PAYMENT BUTTON LOADING STATE
// ============================================================

function setPaymentLoading(button, loading) {

    if (!button) {
        return;
    }

    if (loading) {

        if (!button.dataset.originalText) {

            button.dataset.originalText =
                button.innerHTML;
        }

        button.disabled = true;

        button.setAttribute(
            "aria-busy",
            "true"
        );

        button.innerHTML =
            "Sending payment request...";

    } else {

        button.disabled = false;

        button.removeAttribute(
            "aria-busy"
        );

        if (
            button.dataset.originalText
        ) {

            button.innerHTML =
                button.dataset.originalText;
        }
    }
}


// ============================================================
// FORMAT KENYAN CURRENCY
// ============================================================

function formatKES(amount) {

    return new Intl.NumberFormat(
        "en-KE",
        {
            style: "currency",
            currency: "KES",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }
    ).format(
        Number(amount) || 0
    );
}


// ============================================================
// PUBLIC API
// ============================================================

window.startPayment =
    handlePayment;

window.monitorPayment =
    monitorPayment;

window.stopPaymentMonitor =
    stopPaymentMonitor;

window.normalizeKenyanPhone =
    normalizeKenyanPhone;
```
