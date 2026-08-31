// ============================================================
// MASIKA BENEVOLENT — ADMIN LOGIN
// ============================================================

const ALLOWED_ROLES = ['SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_AGENT', 'AUDITOR'];
const DASHBOARD_URL = 'admin-dashboard.html';

// Get DOM elements
const alertBox = document.getElementById('alertBox');
const loginBtn = document.getElementById('loginBtn');
const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

// ------------------------------------------------------------
// Alert utilities
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

// ------------------------------------------------------------
// Build a session profile object from staff + role rows
// ------------------------------------------------------------
function buildProfile(staff, role, authUser) {
    const roleCode = String(role.role_code || '').trim().toUpperCase();
    return {
        id: staff.id,
        auth_user_id: staff.auth_user_id,
        employee_number: staff.employee_number || '',
        full_name: staff.full_name || 'Staff Member',
        email: authUser.email || '',
        role: roleCode,
        role_name: role.role_name || roleCode,
        role_id: role.id,
        role_is_active: role.is_active
    };
}

function persistSession(profile) {
    const sessionValues = {
        adminLoggedIn: 'true',
        adminId: profile.id,
        adminAuthUserId: profile.auth_user_id,
        adminRole: profile.role,
        adminName: profile.full_name || profile.email,
        adminEmployeeNumber: profile.employee_number || '',
        adminProfile: JSON.stringify(profile)
    };

    Object.entries(sessionValues).forEach(([key, value]) => {
        sessionStorage.setItem(key, value);
    });
}

// ------------------------------------------------------------
// Look up the staff record + role for a given auth user.
// Returns { staff, role } or null (and shows an alert) on failure.
// Signs the user out of Supabase on any verification failure.
// ------------------------------------------------------------
async function verifyStaffAccess(authUser) {
    // 1. Staff record
    const { data: staff, error: staffError } = await supabaseClient
        .from('staff')
        .select('id, auth_user_id, employee_number, full_name, role_id')
        .eq('auth_user_id', authUser.id)
        .maybeSingle();

    if (staffError) {
        console.error('Staff lookup error:', staffError);
        await supabaseClient.auth.signOut();
        showAlert('Could not verify your staff account. Please contact support.');
        return null;
    }

    if (!staff) {
        console.error('No staff record for:', authUser.id);
        await supabaseClient.auth.signOut();
        showAlert('Access denied. Your account is not registered as staff.');
        return null;
    }

    // 2. Role record
    const { data: role, error: roleError } = await supabaseClient
        .from('roles')
        .select('id, role_code, role_name, is_active')
        .eq('id', staff.role_id)
        .maybeSingle();

    if (roleError) {
        console.error('Role lookup error:', roleError);
        await supabaseClient.auth.signOut();
        showAlert('Could not verify your staff role. Please contact support.');
        return null;
    }

    if (!role) {
        await supabaseClient.auth.signOut();
        showAlert('Access denied. No staff role is assigned.');
        return null;
    }

    // 3. Validate role
    const roleCode = String(role.role_code || '').trim().toUpperCase();

    if (role.is_active !== true) {
        await supabaseClient.auth.signOut();
        showAlert('Access denied. Your staff role is inactive.');
        return null;
    }

    if (!ALLOWED_ROLES.includes(roleCode)) {
        console.error('Unauthorized role:', roleCode);
        await supabaseClient.auth.signOut();
        showAlert('Access denied. Your role does not have system access.');
        return null;
    }

    return { staff, role };
}

// ------------------------------------------------------------
// Login handler
// ------------------------------------------------------------
async function handleLogin(event) {
    event.preventDefault();
    clearAlert();

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    // Reset previous validation state
    setInputError('email', false);
    setInputError('password', false);

    if (!email) {
        showAlert('Please enter your email address.');
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

    // Show loading state
    loginBtn.classList.add('loading');
    loginBtn.disabled = true;

    try {
        // 1. Authenticate with Supabase
        const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (authError) {
            console.error('Supabase login error:', authError);
            showAlert(authError.message || 'Invalid email or password.');
            setInputError('email', true);
            setInputError('password', true);
            return;
        }

        if (!authData?.user) {
            showAlert('Login failed. No user session was created.');
            return;
        }

        console.log('Authentication successful:', authData.user.id);

        // 2. Verify staff + role
        const access = await verifyStaffAccess(authData.user);
        if (!access) {
            return; // verifyStaffAccess already showed an alert and signed the user out
        }

        const { staff, role } = access;
        console.log('Staff record found:', staff);
        console.log('Role found:', role);

        // 3. Build + persist session
        const profile = buildProfile(staff, role, authData.user);
        persistSession(profile);

        // 4. Show success message
        const displayName = staff.full_name || 'Admin';
        showAlert(`Welcome ${displayName}! Redirecting...`, 'success');

        // 5. Redirect
        setTimeout(() => {
            window.location.href = DASHBOARD_URL;
        }, 500);

    } catch (error) {
        console.error('Unexpected login error:', error);
        showAlert('An unexpected error occurred. Please try again.');
    } finally {
        loginBtn.classList.remove('loading');
        loginBtn.disabled = false;
    }
}

// ------------------------------------------------------------
// Check existing session (sessionStorage first, then Supabase)
// ------------------------------------------------------------
async function checkExistingSession() {
    try {
        // Check session storage first
        const loggedIn = sessionStorage.getItem('adminLoggedIn');
        if (loggedIn === 'true') {
            const storedProfile = sessionStorage.getItem('adminProfile');
            if (storedProfile) {
                try {
                    const parsedProfile = JSON.parse(storedProfile);
                    if (parsedProfile && parsedProfile.id) {
                        window.location.href = DASHBOARD_URL;
                        return;
                    }
                } catch (e) {
                    console.warn('Invalid profile data in session storage, clearing it.');
                    sessionStorage.clear();
                }
            }
        }

        // Fall back to checking Supabase's own session
        const { data: authSessionData } = await supabaseClient.auth.getSession();
        if (!authSessionData?.session) {
            console.log('No active Supabase session found');
            return;
        }

        const authUser = authSessionData.session.user;
        console.log('Found existing Supabase session for user:', authUser.id);

        // Verify staff + role for this existing session
        const access = await verifyStaffAccess(authUser);
        if (!access) {
            return; // already signed out + alerted if invalid
        }

        const { staff, role } = access;
        const profile = buildProfile(staff, role, authUser);
        persistSession(profile);

        window.location.href = DASHBOARD_URL;

    } catch (error) {
        // Non-fatal: just means the user sees the login form
        console.error('Error checking existing session:', error);
    }
}

// ------------------------------------------------------------
// Wire up events
// ------------------------------------------------------------
if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
}

document.addEventListener('DOMContentLoaded', checkExistingSession);
