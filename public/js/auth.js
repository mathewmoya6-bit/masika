// ============================================================
// STAFF AUTHENTICATION
// ============================================================
// Used by login.html and protected staff pages.
//
// Members registering through register.html DO NOT use this.
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {

    const currentPage = window.location.pathname.split("/").pop().toLowerCase();

    if (currentPage === "login.html") {
        initializeLogin();
    }

    if (
        currentPage === "dashboard.html" ||
        currentPage === "members.html" ||
        currentPage === "payments.html" ||
        currentPage === "reports.html"
    ) {
        await protectStaffPage();
    }

    initializeLogoutButtons();
});


// ============================================================
// LOGIN FORM
// ============================================================

function initializeLogin() {
    const form = document.getElementById("loginForm");
    if (!form) return;

    form.addEventListener("submit", handleStaffLogin);
}


// ============================================================
// STAFF LOGIN
// ============================================================

async function handleStaffLogin(event) {

    event.preventDefault();

    const form = event.currentTarget;
    const email = form.querySelector('[name="email"]')?.value?.trim();
    const password = form.querySelector('[name="password"]')?.value;

    if (!email || !password) {
        showAuthError("Please enter your email and password.");
        return;
    }

    const button = form.querySelector('[type="submit"]');
    setAuthLoading(button, true);
    clearAuthMessages();

    try {
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.error("Login error:", error);
            showAuthError("Invalid email or password.");
            return;
        }

        if (!data.session) {
            showAuthError("Login could not be completed.");
            return;
        }

        // Verify that this is an authorized staff user
        const isStaff = await verifyStaffUser(data.user);

        if (!isStaff) {
            await window.supabaseClient.auth.signOut();
            showAuthError("Your account is not authorized for staff access.");
            return;
        }

        // Successful staff login
        const redirect = sessionStorage.getItem("staffRedirect") || "dashboard.html";
        sessionStorage.removeItem("staffRedirect");

        window.location.href = redirect;

    } catch (error) {
        console.error(error);
        showAuthError("Unable to sign in. Please try again.");
    } finally {
        setAuthLoading(button, false);
    }
}


// ============================================================
// VERIFY STAFF USER
// ============================================================

async function verifyStaffUser(user) {

    if (!user) return false;

    try {
        // Check if user exists in staff_profiles table
        const { data, error } = await window.supabaseClient
            .from("staff_profiles")
            .select("id, role, active")
            .eq("user_id", user.id)
            .eq("active", true)
            .maybeSingle();

        if (error) {
            console.error("Staff verification error:", error);
            return false;
        }

        if (!data) {
            return false;
        }

        const allowedRoles = ["admin", "staff", "manager", "super_admin"];
        return allowedRoles.includes(String(data.role).toLowerCase());

    } catch (error) {
        console.error("Staff verification failed:", error);
        return false;
    }
}


// ============================================================
// PROTECT STAFF PAGE
// ============================================================

async function protectStaffPage() {

    try {
        const { data, error } = await window.supabaseClient.auth.getSession();

        if (error || !data || !data.session) {
            redirectToLogin();
            return;
        }

        const user = data.session.user;
        const isStaff = await verifyStaffUser(user);

        if (!isStaff) {
            await window.supabaseClient.auth.signOut();
            redirectToLogin();
            return;
        }

        // Make current staff user globally available
        window.currentStaffUser = user;

    } catch (error) {
        console.error("Authentication check failed:", error);
        redirectToLogin();
    }
}


// ============================================================
// LOGOUT
// ============================================================

function initializeLogoutButtons() {
    const logoutButtons = document.querySelectorAll(
        "[data-action='logout'], #logoutButton, .logout-button"
    );

    logoutButtons.forEach(button => {
        button.addEventListener("click", handleLogout);
    });
}


async function handleLogout(event) {
    event.preventDefault();

    try {
        await window.supabaseClient.auth.signOut();
    } catch (error) {
        console.error("Logout error:", error);
    } finally {
        window.location.href = "login.html";
    }
}


// ============================================================
// REDIRECT
// ============================================================

function redirectToLogin() {
    const current = window.location.pathname;
    sessionStorage.setItem("staffRedirect", current);
    window.location.href = "login.html";
}


// ============================================================
// AUTH UI
// ============================================================

function showAuthError(message) {
    const element = document.getElementById("loginError") || document.getElementById("authError") || document.getElementById("errorMessage");

    if (!element) {
        alert(message);
        return;
    }

    element.textContent = message;
    element.style.display = "block";
}


function clearAuthMessages() {
    const element = document.getElementById("loginError") || document.getElementById("authError") || document.getElementById("errorMessage");

    if (element) {
        element.textContent = "";
        element.style.display = "none";
    }
}


function setAuthLoading(button, loading) {
    if (!button) return;

    if (loading) {
        button.dataset.originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = "Signing in...";
    } else {
        button.disabled = false;
        if (button.dataset.originalText) {
            button.innerHTML = button.dataset.originalText;
        }
    }
}


// ============================================================
// PUBLIC API
// ============================================================

window.staffLogout = handleLogout;
window.verifyStaffUser = verifyStaffUser;
