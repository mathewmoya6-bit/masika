// ============================================================
// MASIKA BENEVOLENT — ADMIN LOGIN
// ============================================================

(function() {
    'use strict';

    // ------------------------------------------------------------
    // Access control — this panel is restricted to Super Admins.
    // Branch managers, sales agents, and auditors do not get in
    // here, even with valid credentials and an active role.
    // ------------------------------------------------------------
    const ALLOWED_ROLES = ['SUPER_ADMIN'];

    // ------------------------------------------------------------
    // DOM References
    // ------------------------------------------------------------
    const alertBox = document.getElementById('alertBox');
    const loginBtn = document.getElementById('loginBtn');
    const loginForm = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');

    // ------------------------------------------------------------
    // Alert Utilities
    // ------------------------------------------------------------
    function showAlert(message, type = 'error') {
        alertBox.textContent = message;
        alertBox.className = `alert show ${type}`;
    }

    function clearAlert() {
        alertBox.className = 'alert';
    }

    function setInputError(inputId, hasError) {
        const input = document.getElementById(inputId);
        if (input) {
            input.classList.toggle('error', hasError);
        }
    }

    function clearInputErrors() {
        setInputError('email', false);
        setInputError('password', false);
    }

    // ------------------------------------------------------------
    // Loading State
    // ------------------------------------------------------------
    function setLoading(isLoading) {
        if (isLoading) {
            loginBtn.classList.add('loading');
            loginBtn.disabled = true;
            loginBtn.querySelector('.btn-label').textContent = 'Signing In...';
        } else {
            loginBtn.classList.remove('loading');
            loginBtn.disabled = false;
            loginBtn.querySelector('.btn-label').textContent = 'Sign In';
        }
    }

    // ------------------------------------------------------------
    // Validate Email Format
    // ------------------------------------------------------------
    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // ------------------------------------------------------------
    // Login Handler
    // ------------------------------------------------------------
    async function handleLogin(event) {
        event.preventDefault();
        clearAlert();
        clearInputErrors();

        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;

        // --- Validation ---
        if (!email) {
            showAlert('Please enter your email address.');
            setInputError('email', true);
            emailInput.focus();
            return;
        }

        if (!isValidEmail(email)) {
            showAlert('Please enter a valid email address.');
            setInputError('email', true);
            emailInput.focus();
            return;
        }

        if (!password) {
            showAlert('Please enter your password.');
            setInputError('password', true);
            passwordInput.focus();
            return;
        }

        if (password.length < 8) {
            showAlert('Password must be at least 8 characters.');
            setInputError('password', true);
            passwordInput.focus();
            return;
        }

        // --- Show loading ---
        setLoading(true);

        try {
            // 1. Authenticate with Supabase
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) {
                console.error('Supabase login error:', error);

                if (error.message.includes('Invalid login credentials')) {
                    showAlert('Invalid email or password. Please try again.');
                } else if (error.message.includes('Email not confirmed')) {
                    showAlert('Please verify your email address before signing in.');
                } else {
                    showAlert(error.message || 'Login failed. Please try again.');
                }

                setInputError('email', true);
                setInputError('password', true);
                setLoading(false);
                return;
            }

            if (!data?.user) {
                showAlert('Login failed. No user session was created.');
                setLoading(false);
                return;
            }

            console.log('Authentication successful:', data.user.id);

            // 2. Verify staff record
            const { data: staff, error: staffError } = await supabaseClient
                .from('staff')
                .select('id, auth_user_id, employee_number, full_name, role_id')
                .eq('auth_user_id', data.user.id)
                .maybeSingle();

            if (staffError) {
                console.error('Staff lookup error:', staffError);
                await supabaseClient.auth.signOut();
                showAlert('Could not verify your staff account. Please contact support.');
                setLoading(false);
                return;
            }

            if (!staff) {
                console.error('No staff record for:', data.user.id);
                await supabaseClient.auth.signOut();
                showAlert('Access denied. Your account is not registered as staff.');
                setLoading(false);
                return;
            }

            console.log('Staff record found:', staff);

            // 3. Verify role
            const { data: role, error: roleError } = await supabaseClient
                .from('roles')
                .select('id, role_code, role_name, is_active')
                .eq('id', staff.role_id)
                .maybeSingle();

            if (roleError || !role) {
                console.error('Role lookup error:', roleError || 'No role found');
                await supabaseClient.auth.signOut();
                showAlert('Could not verify your staff role. Please contact support.');
                setLoading(false);
                return;
            }

            console.log('Role found:', role);

            // 4. Validate role — Super Admin only
            const roleCode = String(role.role_code || '').trim().toUpperCase();

            if (role.is_active !== true) {
                await supabaseClient.auth.signOut();
                showAlert('Access denied. Your staff role is inactive.');
                setLoading(false);
                return;
            }

            if (!ALLOWED_ROLES.includes(roleCode)) {
                console.error('Unauthorized role:', roleCode);
                await supabaseClient.auth.signOut();
                showAlert('Access denied. This panel is restricted to Super Admins.');
                setLoading(false);
                return;
            }

            // 5. Build profile
            const profile = {
                id: staff.id,
                auth_user_id: staff.auth_user_id,
                employee_number: staff.employee_number || '',
                full_name: staff.full_name || 'Staff Member',
                email: data.user.email || '',
                role: roleCode,
                role_code: roleCode,
                role_name: role.role_name || roleCode,
                role_is_active: role.is_active,
                role_id: role.id
            };

            // 6. Store session
            sessionStorage.setItem('adminLoggedIn', 'true');
            sessionStorage.setItem('adminId', staff.id);
            sessionStorage.setItem('adminAuthUserId', staff.auth_user_id);
            sessionStorage.setItem('adminRole', roleCode);
            sessionStorage.setItem('adminName', staff.full_name || data.user.email);
            sessionStorage.setItem('adminEmployeeNumber', staff.employee_number || '');
            sessionStorage.setItem('adminProfile', JSON.stringify(profile));

            // 7. Show success
            const displayName = staff.full_name || 'Admin';
            showAlert(`Welcome ${displayName}! Redirecting...`, 'success');

            // 8. Redirect
            setTimeout(() => {
                window.location.href = 'admin-dashboard.html';
            }, 600);

        } catch (error) {
            console.error('Unexpected login error:', error);
            showAlert('An unexpected error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    // ------------------------------------------------------------
    // Check Existing Session
    // ------------------------------------------------------------
    async function checkExistingSession() {
        try {
            // Check session storage first
            const loggedIn = sessionStorage.getItem('adminLoggedIn');
            if (loggedIn === 'true') {
                const profileData = sessionStorage.getItem('adminProfile');
                if (profileData) {
                    // Verify with Supabase
                    const { data } = await supabaseClient.auth.getSession();
                    if (data?.session) {
                        window.location.href = 'admin-dashboard.html';
                        return;
                    }
                }
            }

            // Check Supabase session
            const { data } = await supabaseClient.auth.getSession();
            if (!data?.session) return;

            const userId = data.session.user.id;

            // Verify staff record
            const { data: staff } = await supabaseClient
                .from('staff')
                .select('id, auth_user_id, employee_number, full_name, role_id')
                .eq('auth_user_id', userId)
                .maybeSingle();

            if (!staff) return;

            // Verify role
            const { data: role } = await supabaseClient
                .from('roles')
                .select('id, role_code, role_name, is_active')
                .eq('id', staff.role_id)
                .maybeSingle();

            const roleCode = String(role?.role_code || '').trim().toUpperCase();

            if (role?.is_active === true && ALLOWED_ROLES.includes(roleCode)) {
                // Rebuild session
                const profile = {
                    id: staff.id,
                    auth_user_id: staff.auth_user_id,
                    employee_number: staff.employee_number || '',
                    full_name: staff.full_name || 'Staff Member',
                    email: data.session.user.email || '',
                    role: roleCode,
                    role_code: roleCode,
                    role_name: role.role_name || roleCode,
                    role_is_active: role.is_active,
                    role_id: role.id
                };

                sessionStorage.setItem('adminLoggedIn', 'true');
                sessionStorage.setItem('adminId', staff.id);
                sessionStorage.setItem('adminAuthUserId', staff.auth_user_id);
                sessionStorage.setItem('adminRole', roleCode);
                sessionStorage.setItem('adminName', staff.full_name || data.session.user.email);
                sessionStorage.setItem('adminEmployeeNumber', staff.employee_number || '');
                sessionStorage.setItem('adminProfile', JSON.stringify(profile));

                window.location.href = 'admin-dashboard.html';
            }
        } catch (error) {
            console.warn('Session check failed:', error);
        }
    }

    // ------------------------------------------------------------
    // Handle Forgot Password
    // ------------------------------------------------------------
    function handleForgotPassword(event) {
        event.preventDefault();
        const email = emailInput.value.trim();

        if (!email) {
            showAlert('Please enter your email address to reset your password.');
            setInputError('email', true);
            emailInput.focus();
            return;
        }

        if (!isValidEmail(email)) {
            showAlert('Please enter a valid email address.');
            setInputError('email', true);
            emailInput.focus();
            return;
        }

        // Redirect to reset password page with email
        window.location.href = `admin-forgot-password.html?email=${encodeURIComponent(email)}`;
    }

    // ------------------------------------------------------------
    // Auto-dismiss alert on input
    // ------------------------------------------------------------
    function setupAutoClear() {
        const inputs = [emailInput, passwordInput];
        inputs.forEach(input => {
            input.addEventListener('input', function() {
                if (this.classList.contains('error')) {
                    setInputError(this.id, false);
                }
                if (alertBox.classList.contains('show')) {
                    clearAlert();
                }
            });
        });
    }

    // ------------------------------------------------------------
    // Initialize
    // ------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', function() {
        // Check if already logged in
        checkExistingSession();

        // Set up form submission
        loginForm.addEventListener('submit', handleLogin);

        // Set up forgot password link
        const forgotLink = document.querySelector('.form-options a');
        if (forgotLink) {
            forgotLink.addEventListener('click', handleForgotPassword);
        }

        // Set up auto-clear
        setupAutoClear();

        // Auto-focus email if empty
        if (!emailInput.value) {
            setTimeout(() => emailInput.focus(), 100);
        }

        console.log('Admin login page initialized');
    });

    // Expose for debugging
    window.__adminLogin = {
        handleLogin,
        showAlert,
        clearAlert,
        setLoading,
        checkExistingSession,
        isValidEmail
    };

})();
