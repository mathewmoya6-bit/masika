// ============================================================
// PAYMENT - js/payment.js
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    // Check if logged in
    if (!authManager.isAuthenticated) {
        window.location.href = CONFIG.ROUTES.LOGIN;
        return;
    }

    initPayment();
});

function initPayment() {
    const form = document.getElementById('paymentForm');
    const alertBox = document.getElementById('alertBox');
    const loadingBox = document.getElementById('loadingBox');
    const submitBtn = document.getElementById('submitBtn');

    // Load payment details
    loadPaymentDetails();

    // Form submission
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        await handlePayment();
    });

    // Check payment status if checkout ID exists
    const urlParams = new URLSearchParams(window.location.search);
    const checkoutId = urlParams.get('checkout_id');
    if (checkoutId) {
        checkPaymentStatus(checkoutId);
    }
}

async function loadPaymentDetails() {
    try {
        const member = authManager.getMember();
        
        if (!member) {
            showAlert('Member profile not found. Please register first.', 'error');
            return;
        }

        // Update member info
        document.getElementById('memberName').textContent = `${member.first_name} ${member.last_name}`;
        document.getElementById('membershipNumber').textContent = member.membership_number || 'Pending';
        document.getElementById('planName').textContent = CONFIG.PLANS[member.plan_type?.toUpperCase()]?.name || member.plan_type || 'Plan';

        // Get payment summary
        const response = await fetch(`${CONFIG.API.BASE_URL}/payments/summary`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            document.getElementById('totalPaid').textContent = `KES ${(data.total_paid || 0).toLocaleString()}`;
            document.getElementById('paymentCount').textContent = data.total_count || 0;
        }

        // Set amount
        const amount = member.registration_fee || 200;
        document.getElementById('amount').value = amount;
        document.getElementById('amountDisplay').textContent = `KES ${amount.toLocaleString()}`;

        // Set phone
        document.getElementById('phoneNumber').value = member.phone || '';

    } catch (error) {
        console.error('Load payment details error:', error);
        showAlert('Failed to load payment details.', 'error');
    }
}

async function handlePayment() {
    const alertBox = document.getElementById('alertBox');
    const loadingBox = document.getElementById('loadingBox');
    const submitBtn = document.getElementById('submitBtn');

    const phone = document.getElementById('phoneNumber').value;
    const amount = parseFloat(document.getElementById('amount').value);

    // Validate
    if (!phone || phone.length < 10) {
        showAlert('Please enter a valid M-PESA phone number.', 'error');
        return;
    }

    if (!amount || amount <= 0) {
        showAlert('Invalid payment amount.', 'error');
        return;
    }

    // Show loading
    loadingBox.classList.add('show');
    submitBtn.disabled = true;
    clearAlerts();

    try {
        const paymentData = {
            phone_number: phone,
            amount: amount,
            payment_type: 'registration'
        };

        const response = await fetch(`${CONFIG.API.BASE_URL}/payments/mpesa/initiate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            },
            body: JSON.stringify(paymentData)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || 'Payment initiation failed');
        }

        // Show success
        showAlert('STK Push sent! Please check your phone and enter your M-PESA PIN.', 'success');

        // Start polling for status
        if (data.checkout_request_id) {
            pollPaymentStatus(data.checkout_request_id);
        }

    } catch (error) {
        console.error('Payment error:', error);
        showAlert(error.message || 'Payment failed. Please try again.', 'error');
    } finally {
        loadingBox.classList.remove('show');
        submitBtn.disabled = false;
    }
}

async function pollPaymentStatus(checkoutId) {
    let attempts = 0;
    const maxAttempts = 12; // 2 minutes

    const interval = setInterval(async () => {
        attempts++;

        try {
            const response = await fetch(`${CONFIG.API.BASE_URL}/payments/mpesa/status/${checkoutId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                }
            });

            const data = await response.json();

            if (data.status === 'completed') {
                clearInterval(interval);
                showAlert('Payment completed successfully! 🎉', 'success');
                
                // Redirect to dashboard
                setTimeout(() => {
                    window.location.href = CONFIG.ROUTES.DASHBOARD;
                }, 3000);
                
            } else if (data.status === 'failed') {
                clearInterval(interval);
                showAlert('Payment failed. Please try again.', 'error');
                
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                showAlert('Payment is taking longer than expected. Please check your phone or try again.', 'warning');
            }

        } catch (error) {
            console.error('Status check error:', error);
        }
    }, 10000);
}

async function checkPaymentStatus(checkoutId) {
    try {
        const response = await fetch(`${CONFIG.API.BASE_URL}/payments/mpesa/status/${checkoutId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            }
        });

        const data = await response.json();

        if (data.status === 'completed') {
            showAlert('Payment completed successfully! 🎉', 'success');
            setTimeout(() => {
                window.location.href = CONFIG.ROUTES.DASHBOARD;
            }, 3000);
        } else if (data.status === 'pending') {
            showAlert('Payment is pending. Please check your phone for the M-PESA prompt.', 'info');
            pollPaymentStatus(checkoutId);
        } else {
            showAlert('Payment status: ' + data.status, 'warning');
        }

    } catch (error) {
        console.error('Check payment status error:', error);
    }
}

function showAlert(message, type = 'info') {
    const alertBox = document.getElementById('alertBox');
    alertBox.className = `alert show ${type}`;
    alertBox.textContent = message;
    alertBox.style.display = 'block';
}

function clearAlerts() {
    const alertBox = document.getElementById('alertBox');
    alertBox.className = 'alert';
    alertBox.textContent = '';
    alertBox.style.display = 'none';
}
