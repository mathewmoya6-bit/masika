// ============================================================
// MASIKA BENEVOLENT — ADMIN AUTHENTICATION & AUTHORIZATION
// ============================================================
//
// Actual database structure:
//
// staff
//   id
//   auth_user_id
//   employee_number
//   full_name
//   role_id
//
// roles
//   id
//   role_code
//   role_name
//   is_active
//
// Authorized role codes:
//   SUPER_ADMIN
//   BRANCH_MANAGER
//   SALES_AGENT
//   AUDITOR
//
// ============================================================

const AdminAuth = {

    session: null,
    profile: null,

    // --------------------------------------------------------
    // Require authenticated + authorized staff
    // --------------------------------------------------------

    async requireSession() {

        try {

            const {
                data: sessionData,
                error: sessionError
            } = await supabaseClient.auth.getSession();

            if (sessionError) {
                console.error("Session error:", sessionError);
                this.redirectToLogin();
                return null;
            }

            const session = sessionData?.session;

            if (!session) {
                console.warn("No active Supabase session.");
                this.redirectToLogin();
                return null;
            }

            this.session = session;

            // Load staff + role
            const authorized = await this._loadProfile();

            if (!authorized) {
                console.warn("Authenticated user is not an authorized staff member.");

                await supabaseClient.auth.signOut();

                this.redirectToLogin();
                return null;
            }

            // Render admin information
            this._renderProfile();

            // Load sidebar agent count
            await this._loadAgentCount();

            return this.session;

        } catch (error) {

            console.error("Admin authentication error:", error);

            this.redirectToLogin();

            return null;
        }
    },

    // --------------------------------------------------------
    // Load staff profile and role
    // --------------------------------------------------------

    async _loadProfile() {

        if (!this.session?.user?.id) {
            return false;
        }

        const authUserId = this.session.user.id;

        console.log("Checking staff authorization for:", authUserId);

        // ----------------------------------------------------
        // 1. Find staff record
        // ----------------------------------------------------

        const {
            data: staff,
            error: staffError
        } = await supabaseClient
            .from("staff")
            .select(`
                id,
                auth_user_id,
                employee_number,
                full_name,
                role_id
            `)
            .eq("auth_user_id", authUserId)
            .maybeSingle();

        if (staffError) {

            console.error("Could not load staff profile:", staffError);

            return false;
        }

        if (!staff) {

            console.error(
                "No staff record found for auth user:",
                authUserId
            );

            return false;
        }

        console.log("Staff record found:", staff);

        // ----------------------------------------------------
        // 2. Load role
        // ----------------------------------------------------

        const {
            data: role,
            error: roleError
        } = await supabaseClient
            .from("roles")
            .select(`
                id,
                role_code,
                role_name,
                is_active
            `)
            .eq("id", staff.role_id)
            .maybeSingle();

        if (roleError) {

            console.error("Could not load staff role:", roleError);

            return false;
        }

        if (!role) {

            console.error(
                "No role found for role_id:",
                staff.role_id
            );

            return false;
        }

        console.log("Role found:", role);

        // ----------------------------------------------------
        // 3. Role must be active
        // ----------------------------------------------------

        if (role.is_active !== true) {

            console.error(
                "Staff role is inactive:",
                role.role_code
            );

            return false;
        }

        // ----------------------------------------------------
        // 4. Allowed roles
        // ----------------------------------------------------

        const allowedRoles = [
            "SUPER_ADMIN",
            "BRANCH_MANAGER",
            "SALES_AGENT",
            "AUDITOR"
        ];

        const roleCode = String(role.role_code || "")
            .trim()
            .toUpperCase();

        if (!allowedRoles.includes(roleCode)) {

            console.error(
                "Unauthorized role:",
                roleCode
            );

            return false;
        }

        // ----------------------------------------------------
        // 5. Store unified admin profile
        // ----------------------------------------------------

        this.profile = {

            id: staff.id,

            auth_user_id: staff.auth_user_id,

            employee_number: staff.employee_number,

            full_name: staff.full_name,

            email: this.session.user.email,

            role_id: role.id,

            role: roleCode,

            role_code: roleCode,

            role_name: role.role_name,

            role_is_active: role.is_active
        };

        console.log(
            "ADMIN AUTHORIZED:",
            this.profile
        );

        // Store session information
        sessionStorage.setItem(
            "adminLoggedIn",
            "true"
        );

        sessionStorage.setItem(
            "adminId",
            staff.id
        );

        sessionStorage.setItem(
            "adminAuthUserId",
            authUserId
        );

        sessionStorage.setItem(
            "adminRole",
            roleCode
        );

        sessionStorage.setItem(
            "adminName",
            staff.full_name || this.session.user.email
        );

        sessionStorage.setItem(
            "adminEmployeeNumber",
            staff.employee_number || ""
        );

        return true;
    },

    // --------------------------------------------------------
    // Render admin information in sidebar
    // --------------------------------------------------------

    _renderProfile() {

        if (!this.profile) {
            return;
        }

        const nameEl =
            document.getElementById("adminName");

        const roleEl =
            document.getElementById("adminRole");

        const avatarEl =
            document.getElementById("adminAvatar");

        const displayName =
            this.profile.full_name ||
            this.profile.email ||
            "Admin";

        if (nameEl) {

            nameEl.textContent =
                displayName;
        }

        if (roleEl) {

            roleEl.textContent =
                this.profile.role_name ||
                this.profile.role_code ||
                "Administrator";
        }

        if (avatarEl) {

            avatarEl.textContent =
                displayName
                    .trim()
                    .charAt(0)
                    .toUpperCase();
        }
    },

    // --------------------------------------------------------
    // Agent count
    // --------------------------------------------------------

    async _loadAgentCount() {

        const badge =
            document.getElementById("agentCountBadge");

        if (!badge) {
            return;
        }

        try {

            const {
                count,
                error
            } = await supabaseClient
                .from("staff")
                .select("id", {
                    count: "exact",
                    head: true
                });

            if (!error && typeof count === "number") {

                badge.textContent = count;
            }

        } catch (error) {

            console.warn(
                "Could not load staff count:",
                error
            );
        }
    },

    // --------------------------------------------------------
    // Role helpers
    // --------------------------------------------------------

    isAdmin() {

        return (
            this.profile?.role === "SUPER_ADMIN"
        );
    },

    isSuperAdmin() {

        return (
            this.profile?.role === "SUPER_ADMIN"
        );
    },

    hasRole(role) {

        if (!this.profile?.role) {
            return false;
        }

        return (
            this.profile.role ===
            String(role).trim().toUpperCase()
        );
    },

    // --------------------------------------------------------
    // Redirect
    // --------------------------------------------------------

    redirectToLogin() {

        sessionStorage.removeItem("adminLoggedIn");
        sessionStorage.removeItem("adminId");
        sessionStorage.removeItem("adminAuthUserId");
        sessionStorage.removeItem("adminRole");
        sessionStorage.removeItem("adminName");
        sessionStorage.removeItem("adminEmployeeNumber");

        window.location.href =
            "admin-login.html";
    }
};


// ============================================================
// GLOBAL LOGOUT
// ============================================================

async function handleLogout() {

    try {

        await supabaseClient.auth.signOut();

    } catch (error) {

        console.error(
            "Logout error:",
            error
        );

    } finally {

        sessionStorage.clear();

        window.location.href =
            "admin-login.html";
    }
}
