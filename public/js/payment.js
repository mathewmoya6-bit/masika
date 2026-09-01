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
// FIX (was): this file previously called a Supabase Edge Function
// "mpesa-stk-push" via supabaseClient.functions.invoke(). That
// function does not exist in this project, so every payment attempt
// failed silently, was swallowed by the catch block, and fell
// through to recordPendingPayment() -- which just writes a "pending"
// row directly to Supabase and redirects to confirmation.html
// WITHOUT ever calling Safaricom. That's why no STK prompt was ever
// sent and the Network tab showed only a `payments` insert, no
// backend call at all.
// ============================================================

const API_BASE_URL = 'https://masika-c921.onrender.com';

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
            return;
        }

        if (result.data && result.data.already_paid) {
            showPaymentSuccess("Registration fee already paid.");
            setTimeout(() => {
                window.location.href = "confirmation.html";
            }, 1500);
            return;
        }

        showPaymentSuccess("Payment request sent. Please check your phone and enter your M-Pesa PIN.");

        const checkoutRequestId = result.data && result.data.checkout_request_id;
        if (checkoutRequestId) {
            await monitorPayment(checkoutRequestId);
        }

    } catch (error) {
        console.error("Payment error:", error);
        showPaymentError(error.message || "An unexpected payment error occurred.");
    } finally {
        setPaymentLoading(button, false);
    }
}


// ============================================================
// MONITOR PAYMENT
// ============================================================

async function monitorPayment(checkoutRequestId) {

    const maxAttempts = 30;
    let attempts = 0;

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
                return;
            }

            if (attempts >= maxAttempts) {
                clearInterval(interval);
                showPaymentError("Payment confirmation is taking longer than expected. Please check your payment status later.");
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
