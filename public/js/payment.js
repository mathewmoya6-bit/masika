// ============================================================
// PAYMENTS
// ============================================================
// Handles:
// - Payment amount
// - M-Pesa phone number
// - Payment request
// - Payment status
//
// IMPORTANT:
// Actual Daraja credentials must NEVER be placed in this file.
// STK Push goes through the FastAPI backend
// (POST /api/public/payment/stk-push), which holds the Daraja
// credentials server-side and talks to Safaricom directly.
//
// HISTORY:
// This file previously called a Supabase Edge Function
// "mpesa-stk-push" via supabaseClient.functions.invoke(). That
// function didn't exist, so every payment attempt failed silently
// and fell through to a local recordPendingPayment() that wrote a
// "pending" row directly to Supabase and redirected to
// confirmation.html WITHOUT ever calling Safaricom. That's already
// fixed -- this file only ever talks to the FastAPI backend now.
//
// THIS REVISION adds a client-side double-submit guard. The backend
// (initiate_stk_push) now also de-duplicates server-side -- if a
// PENDING payment with a real checkout_request_id already exists for
// this member within the last few minutes, it's reused instead of a
// new row/STK prompt being created (response includes
// data.reused === true). This file's guard exists so a user mashing
// "Pay Now" doesn't even get multiple in-flight requests, which is a
// tighter, faster line of defense than waiting on the server check.
// ============================================================

const API_BASE_URL = 'https://masika-c921.onrender.com';

// True while a payment request is in flight or being monitored, so a
// second click/submit can't start a second attempt.
let paymentInProgress = false;

document.addEventListener("DOMContentLoaded", () => {

    initializePaymentForm();
    loadRegistrationPayment();
});


// ============================================================
// INITIALIZE PAYMENT FORM
// ============================================================

function initializePaymentForm() {

    const form = document.getElementById("paymentForm");

    if (!form) return;

    form.addEventListener("submit", handlePayment);
}


// ============================================================
// LOAD REGISTRATION PAYMENT
// ============================================================

function loadRegistrationPayment() {

    const stored = sessionStorage.getItem("registrationResult");

    if (!stored) return;

    try {
        const registration = JSON.parse(stored);
        const amount = registration.amount ?? registration.total_amount ?? registration.registration_amount;

        if (amount !== undefined) {
            window.registrationPaymentAmount = Number(amount);
            updatePaymentAmount(window.registrationPaymentAmount);
        }

        // Also display member name if available
        const name = registration.first_name ? `${registration.first_name} ${registration.last_name || ''}` : registration.full_name;
        if (name) {
            const nameElement = document.getElementById("memberName");
            if (nameElement) nameElement.textContent = name;
        }

        const memberNumber = registration.member_number;
        if (memberNumber) {
            const numberElement = document.getElementById("memberNumber");
            if (numberElement) numberElement.textContent = memberNumber;
        }

    } catch (error) {
        console.error("Could not load registration payment:", error);
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

    // Client-side double-submit guard. Blocks a second click while
    // the first request is still in flight or being monitored --
    // separate from, and faster than, the backend's own de-dup check.
    if (paymentInProgress) {
        console.warn("Payment already in progress; ignoring extra submit.");
        return;
    }

    const form = event.currentTarget;
    const phone = form.querySelector('[name="phone"], #mpesaPhone')?.value?.trim();
    const amount = window.registrationPaymentAmount;

    if (!phone) {
        showPaymentError("Please enter the M-Pesa phone number.");
        return;
    }

    if (!amount || amount <= 0) {
        showPaymentError("The payment amount is not available.");
        return;
    }

    const registrationResult = getStoredRegistration();
    const memberId = registrationResult?.member_id || registrationResult?.id;

    if (!memberId) {
        showPaymentError("Could not find your registration. Please restart registration.");
        return;
    }

    const button = form.querySelector('[type="submit"]');
    paymentInProgress = true;
    setPaymentLoading(button, true);
    clearPaymentMessages();

    try {
        const payload = {
            member_id: memberId,
            phone: phone,
            amount: amount,
            transaction_desc: "Membership Registration"
        };

        console.log("Starting payment:", payload);

        const response = await fetch(`${API_BASE_URL}/api/public/payment/stk-push`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        let result = null;
        try {
            result = await response.json();
        } catch (parseError) {
            // non-JSON response, fall through with result = null
        }

        if (!response.ok) {
            const detail = result && (result.detail || result.message);
            throw new Error(
                (typeof detail === "string" && detail) ||
                `STK push request failed (HTTP ${response.status}).`
            );
        }

        if (!result || result.success === false) {
            showPaymentError((result && result.message) || "Payment could not be initiated.");
            paymentInProgress = false;
            setPaymentLoading(button, false);
            return;
        }

        if (result.data && result.data.already_paid) {
            showPaymentSuccess("Registration fee already paid.");
            setTimeout(() => {
                window.location.href = "confirmation.html";
            }, 1500);
            return;
        }

        if (result.data && result.data.reused) {
            // Backend found an existing in-flight STK push for this
            // member instead of starting a new one -- same prompt the
            // user already got, so message it as a resume, not a new
            // request.
            showPaymentSuccess("A payment request for this registration is already in progress. Please check your phone and enter your M-Pesa PIN.");
        } else {
            showPaymentSuccess("Payment request sent. Please check your phone and enter your M-Pesa PIN.");
        }

        const checkoutRequestId = result.data && result.data.checkout_request_id;
        if (checkoutRequestId) {
            await monitorPayment(checkoutRequestId);
        } else {
            // No checkout ID at all means nothing was actually sent to
            // Safaricom -- don't leave the button disabled forever, and
            // don't silently pretend this succeeded.
            showPaymentError("Payment could not be started. Please try again or contact support.");
            paymentInProgress = false;
            setPaymentLoading(button, false);
        }

    } catch (error) {
        console.error("Payment error:", error);
        showPaymentError(error.message || "An unexpected payment error occurred.");
        paymentInProgress = false;
        setPaymentLoading(button, false);
    }
}


// ============================================================
// MONITOR PAYMENT
// ============================================================

async function monitorPayment(checkoutRequestId) {

    const maxAttempts = 30;
    let attempts = 0;

    const button = document.querySelector('#paymentForm [type="submit"]');

    const interval = setInterval(async () => {

        attempts++;

        try {
            const response = await fetch(
                `${API_BASE_URL}/api/public/payment/status/${encodeURIComponent(checkoutRequestId)}`
            );

            if (!response.ok) {
                console.error("Payment status error: HTTP", response.status);
                return;
            }

            const result = await response.json();
            const data = result && result.data;

            if (!data) {
                if (attempts >= maxAttempts) {
                    clearInterval(interval);
                    paymentInProgress = false;
                    setPaymentLoading(button, false);
                }
                return;
            }

            const status = String(data.status || "").toUpperCase();

            if (status === "CONFIRMED" || status === "PAID" || status === "SUCCESS" || status === "COMPLETED") {
                clearInterval(interval);
                paymentCompleted(data);
                return;
            }

            if (status === "FAILED" || status === "CANCELLED") {
                clearInterval(interval);
                showPaymentError("The M-Pesa payment was not completed.");
                paymentInProgress = false;
                setPaymentLoading(button, false);
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(interval);
                // Deliberately re-enable the button rather than leaving
                // it stuck: the backend's own de-dup guard (reused STK
                // push within 5 minutes for the same member/amount) means
                // a retry here won't create a duplicate payments row --
                // it'll resume this same attempt if it's still live on
                // Safaricom's side, or start a fresh one if it's truly
                // expired.
                showPaymentError("Payment confirmation is taking longer than expected. If you completed the M-Pesa prompt, please wait a moment and try again; otherwise you can retry.");
                paymentInProgress = false;
                setPaymentLoading(button, false);
            }

        } catch (error) {
            console.error("Payment monitoring error:", error);
        }

    }, 3000);
}


// ============================================================
// PAYMENT COMPLETED
// ============================================================

function paymentCompleted(payment) {

    sessionStorage.setItem("completedPayment", JSON.stringify({
        amount: payment.amount,
        receipt_number: payment.receipt,
        created_at: new Date().toISOString()
    }));

    showPaymentSuccess("✅ Payment received successfully!");

    // Intentionally leave paymentInProgress = true / button disabled
    // here -- we're navigating away momentarily, and re-enabling would
    // just invite a stray extra click before the redirect fires.
    setTimeout(() => {
        window.location.href = "confirmation.html";
    }, 1500);
}


// ============================================================
// GET REGISTRATION
// ============================================================

function getStoredRegistration() {

    const stored = sessionStorage.getItem("registrationResult");

    if (!stored) return null;

    try {
        return JSON.parse(stored);
    } catch (error) {
        console.error(error);
        return null;
    }
}


// ============================================================
// UI
// ============================================================

function showPaymentError(message) {

    const element = document.getElementById("paymentError") || document.getElementById("errorMessage");

    if (!element) {
        alert(message);
        return;
    }

    element.textContent = message;
    element.style.display = "block";
    element.classList.add("show");
}


function showPaymentSuccess(message) {

    const element = document.getElementById("paymentSuccess") || document.getElementById("successMessage");

    if (!element) {
        alert(message);
        return;
    }

    element.textContent = message;
    element.style.display = "block";
    element.classList.add("show");
}


function clearPaymentMessages() {

    const error = document.getElementById("paymentError") || document.getElementById("errorMessage");
    const success = document.getElementById("paymentSuccess") || document.getElementById("successMessage");

    if (error) {
        error.textContent = "";
        error.style.display = "none";
        error.classList.remove("show");
    }

    if (success) {
        success.textContent = "";
        success.style.display = "none";
        success.classList.remove("show");
    }
}


function setPaymentLoading(button, loading) {

    if (!button) return;

    if (loading) {
        button.dataset.originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = "Sending payment request...";
    } else {
        button.disabled = false;
        if (button.dataset.originalText) {
            button.innerHTML = button.dataset.originalText;
        }
    }
}


// ============================================================
// FORMAT MONEY
// ============================================================

function formatKES(amount) {
    return new Intl.NumberFormat("en-KE", {
        style: "currency",
        currency: "KES",
        minimumFractionDigits: 0
    }).format(Number(amount) || 0);
}


// ============================================================
// PUBLIC API
// ============================================================

window.startPayment = handlePayment;
window.monitorPayment = monitorPayment;
