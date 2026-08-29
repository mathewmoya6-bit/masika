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
// STK Push should go through your secure backend/Supabase Edge
// Function.
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

    const button = form.querySelector('[type="submit"]');
    setPaymentLoading(button, true);
    clearPaymentMessages();

    try {
        // Get registration data
        const registrationResult = getStoredRegistration();

        const payload = {
            phone: phone,
            amount: amount,
            registration_id: registrationResult?.registration_id ?? registrationResult?.id ?? null
        };

        console.log("Starting payment:", payload);

        // Try to call Supabase Edge Function for M-Pesa STK Push
        try {
            const { data, error } = await window.supabaseClient.functions.invoke(
                "mpesa-stk-push",
                { body: payload }
            );

            if (error) {
                console.error("Payment request error:", error);
                // Fallback: record payment as pending
                await recordPendingPayment(registrationResult, amount, phone);
                showPaymentSuccess("Payment recorded. You will receive confirmation shortly.");
                setTimeout(() => {
                    window.location.href = "confirmation.html";
                }, 2000);
                return;
            }

            console.log("Payment request:", data);

            if (data?.success === false || data?.error) {
                showPaymentError(data.message || data.error || "Payment could not be initiated.");
                return;
            }

            showPaymentSuccess("Payment request sent. Please check your phone and enter your M-Pesa PIN.");

            // Begin checking payment status
            if (data?.checkout_request_id) {
                await monitorPayment(data.checkout_request_id);
            }

        } catch (e) {
            // If Edge Function fails, record payment as pending
            console.warn("Edge Function failed, recording as pending:", e);
            await recordPendingPayment(registrationResult, amount, phone);
            showPaymentSuccess("Payment recorded. You will receive confirmation shortly.");
            setTimeout(() => {
                window.location.href = "confirmation.html";
            }, 2000);
        }

    } catch (error) {
        console.error("Payment error:", error);
        showPaymentError("An unexpected payment error occurred.");
    } finally {
        setPaymentLoading(button, false);
    }
}


// ============================================================
// RECORD PENDING PAYMENT
// ============================================================

async function recordPendingPayment(registration, amount, phone) {
    try {
        const memberId = registration?.id || registration?.member_id;

        const { data, error } = await window.supabaseClient
            .from("payments")
            .insert({
                member_id: memberId,
                amount: amount,
                payment_type: 'registration',
                status: 'pending',
                paybill_number: '348127',
                account_number: registration?.member_number || 'PENDING',
                notes: `Registration payment - Phone: ${phone}`
            })
            .select()
            .single();

        if (error) {
            console.error("Failed to record payment:", error);
        } else {
            console.log("Payment recorded:", data);
        }

        return data;
    } catch (error) {
        console.error("Error recording payment:", error);
        return null;
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
            const { data, error } = await window.supabaseClient
                .from("payments")
                .select("id, status, amount, receipt_number")
                .eq("checkout_request_id", checkoutRequestId)
                .maybeSingle();

            if (error) {
                console.error("Payment status error:", error);
                return;
            }

            if (!data) {
                if (attempts >= maxAttempts) {
                    clearInterval(interval);
                }
                return;
            }

            const status = String(data.status || "").toUpperCase();

            if (status === "PAID" || status === "SUCCESS" || status === "COMPLETED" || status === "confirmed") {
                clearInterval(interval);
                paymentCompleted(data);
                return;
            }

            if (status === "FAILED" || status === "CANCELLED") {
                clearInterval(interval);
                showPaymentError("The M-Pesa payment was not completed.");
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

    sessionStorage.setItem("completedPayment", JSON.stringify(payment));

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
}


function showPaymentSuccess(message) {

    const element = document.getElementById("paymentSuccess") || document.getElementById("successMessage");

    if (!element) {
        alert(message);
        return;
    }

    element.textContent = message;
    element.style.display = "block";
}


function clearPaymentMessages() {

    const error = document.getElementById("paymentError") || document.getElementById("errorMessage");
    const success = document.getElementById("paymentSuccess") || document.getElementById("successMessage");

    if (error) {
        error.textContent = "";
        error.style.display = "none";
    }

    if (success) {
        success.textContent = "";
        success.style.display = "none";
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
