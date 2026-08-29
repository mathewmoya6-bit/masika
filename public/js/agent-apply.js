// ============================================================
// SALES AGENT APPLICATION
// ============================================================

// ============================================================
// SUBMIT APPLICATION
// ============================================================

async function submitApplication(event) {
    event.preventDefault();

    const form = document.getElementById('agentForm');
    const submitBtn = document.getElementById('submitBtn');
    const alertBox = document.getElementById('alertBox');

    // Clear previous alerts
    alertBox.className = 'alert';

    // Get form values
    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const idNumber = document.getElementById('idNumber').value.trim();
    const county = document.getElementById('county').value;
    const location = document.getElementById('location').value.trim();
    const experience = document.getElementById('experience').value.trim();
    const reason = document.getElementById('reason').value.trim();
    const referralCode = document.getElementById('referralCode').value.trim();
    const terms = document.getElementById('terms').checked;

    // Validate
    if (!fullName || fullName.length < 2) {
        showAlert('Please enter your full name.', 'error');
        document.getElementById('fullName').focus();
        return;
    }

    if (!email || !isValidEmail(email)) {
        showAlert('Please enter a valid email address.', 'error');
        document.getElementById('email').focus();
        return;
    }

    if (!phone || phone.length < 9) {
        showAlert('Please enter a valid phone number.', 'error');
        document.getElementById('phone').focus();
        return;
    }

    if (!idNumber || idNumber.length < 5) {
        showAlert('Please enter your ID/Passport number.', 'error');
        document.getElementById('idNumber').focus();
        return;
    }

    if (!county) {
        showAlert('Please select your county.', 'error');
        document.getElementById('county').focus();
        return;
    }

    if (!reason || reason.length < 10) {
        showAlert('Please tell us why you want to become an agent (minimum 10 characters).', 'error');
        document.getElementById('reason').focus();
        return;
    }

    if (!terms) {
        showAlert('Please agree to the Terms and Conditions.', 'error');
        document.getElementById('terms').focus();
        return;
    }

    // Show loading
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        // Check if email already exists
        const { data: existing, error: checkError } = await window.supabaseClient
            .from('agent_applications')
            .select('id, email')
            .eq('email', email)
            .maybeSingle();

        if (checkError) {
            console.error('Check error:', checkError);
        }

        if (existing) {
            showAlert('An application with this email already exists. Please contact support.', 'error');
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
            return;
        }

        // Check if phone already exists
        const { data: existingPhone, error: phoneCheckError } = await window.supabaseClient
            .from('agent_applications')
            .select('id, phone')
            .eq('phone', phone)
            .maybeSingle();

        if (phoneCheckError) {
            console.error('Phone check error:', phoneCheckError);
        }

        if (existingPhone) {
            showAlert('An application with this phone number already exists.', 'error');
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
            return;
        }

        // Submit application
        const { data, error } = await window.supabaseClient
            .from('agent_applications')
            .insert({
                full_name: fullName,
                email: email,
                phone: phone,
                id_number: idNumber,
                county: county,
                location: location || null,
                experience: experience || null,
                reason: reason,
                referral_code: referralCode || null,
                status: 'pending'
            })
            .select()
            .single();

        if (error) {
            console.error('Submit error:', error);
            showAlert('Failed to submit application. Please try again.', 'error');
            return;
        }

        console.log('Application submitted:', data);

        // Show success
        document.getElementById('formContainer').style.display = 'none';
        document.getElementById('successState').classList.add('show');

        // Optional: Send notification email via Supabase Edge Function
        try {
            await window.supabaseClient.functions.invoke('send-agent-notification', {
                body: {
                    application_id: data.id,
                    full_name: fullName,
                    email: email
                }
            });
        } catch (notifyError) {
            console.warn('Notification error:', notifyError);
            // Don't fail the application if notification fails
        }

    } catch (error) {
        console.error('Application error:', error);
        showAlert('An unexpected error occurred. Please try again.', 'error');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function showAlert(message, type = 'error') {
    const alertBox = document.getElementById('alertBox');
    alertBox.textContent = message;
    alertBox.className = `alert show ${type}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================
// AUTO-FILL REFERRAL CODE FROM URL
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    const params = new URLSearchParams(window.location.search);
    const referralCode = params.get('ref');
    if (referralCode) {
        document.getElementById('referralCode').value = referralCode;
    }
});

// ============================================================
// EXPOSE FUNCTIONS
// ============================================================

window.submitApplication = submitApplication;
