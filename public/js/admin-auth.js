// ============================================================
// MASIKA BENEVOLENT — ADMIN AUTHENTICATION & AUTHORIZATION
// ============================================================
// Database schema:
//   staff (id, auth_user_id, employee_number, full_name, role_id)
//   roles (id, role_code, role_name, is_active)
// Authorized roles: SUPER_ADMIN, BRANCH_MANAGER, SALES_AGENT, AUDITOR
// ============================================================

class AdminAuthService {
    constructor() {
        this.session = null;
        this.profile = null;
        this._initialized = false;
        this._authListeners = [];
    }

    // --------------------------------------------------------
    // Singleton instance
    // --------------------------------------------------------
    static getInstance() {
        if (!AdminAuthService._instance) {
            AdminAuthService._instance = new AdminAuthService();
        }
        return AdminAuthService._instance;
    }

    // --------------------------------------------------------
    // Allowed roles configuration
    // --------------------------------------------------------
    get ALLOWED_ROLES() {
        return ['SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_AGENT', 'AUDITOR'];
    }

    get SESSION_KEYS() {
        return {
            LOGGED_IN: 'adminLoggedIn',
            ID: 'adminId',
            AUTH_USER_ID: 'adminAuthUserId',
            ROLE: 'adminRole',
            NAME: 'adminName',
            EMPLOYEE_NUMBER: 'adminEmployeeNumber',
            PROFILE: 'adminProfile'
        };
    }

    // --------------------------------------------------------
    // Require authenticated + authorized staff.
    // Call this once per protected page; it renders the sidebar
    // profile and redirects unauthenticated/unauthorized users
    // to the login page.
    // --------------------------------------------------------
    async requireSession(redirectOnFail = true) {
        try {
            // Check session storage first for performance
            if (this._hasStoredSession()) {
                const profile = this._getStoredProfile();
                if (profile) {
                    this.profile = profile;
                    this._renderProfile();
                    return this.profile;
                }
            }

            // Fall back to Supabase session
            const { data: sessionData, error: sessionError } =
                await supabaseClient.auth.getSession();

            if (sessionError) {
                throw new Error(`Session error: ${sessionError.message}`);
            }

            const session = sessionData?.session;
            if (!session) {
                if (redirectOnFail) this.redirectToLogin();
                return null;
            }

            this.session = session;

            // Load and verify staff profile
            const authorized = await this._loadProfile();
            if (!authorized) {
                await supabaseClient.auth.signOut();
                if (redirectOnFail) this.redirectToLogin();
                return null;
            }

            // Render admin information
            this._renderProfile();

            return this.profile;

        } catch (error) {
            console.error('Admin authentication error:', error);
            if (redirectOnFail) this.redirectToLogin();
            return null;
        }
    }

    // --------------------------------------------------------
    // Check stored session
    // --------------------------------------------------------
    _hasStoredSession() {
        return sessionStorage.getItem(this.SESSION_KEYS.LOGGED_IN) === 'true';
    }

    _getStoredProfile() {
        try {
            const data = sessionStorage.getItem(this.SESSION_KEYS.PROFILE);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    }

    // --------------------------------------------------------
    // Load staff profile and role
    // --------------------------------------------------------
    async _loadProfile() {
        if (!this.session?.user?.id) {
            console.warn('No user ID in session');
            return false;
        }

        const authUserId = this.session.user.id;
        console.log('Checking staff authorization for:', authUserId);

        try {
            // 1. Find staff record
            const { data: staff, error: staffError } = await supabaseClient
                .from('staff')
                .select('id, auth_user_id, employee_number, full_name, role_id')
                .eq('auth_user_id', authUserId)
                .maybeSingle();

            if (staffError) {
                console.error('Staff lookup error:', staffError);
                return false;
            }

            if (!staff) {
                console.error('No staff record found for auth user:', authUserId);
                return false;
            }

            console.log('Staff record found:', staff);

            // 2. Load role
            const { data: role, error: roleError } = await supabaseClient
                .from('roles')
                .select('id, role_code, role_name, is_active')
                .eq('id', staff.role_id)
                .maybeSingle();

            if (roleError) {
                console.error('Role lookup error:', roleError);
                return false;
            }

            if (!role) {
                console.error('No role found for role_id:', staff.role_id);
                return false;
            }

            console.log('Role found:', role);

            // 3. Validate role
            const roleCode = this._normalizeRoleCode(role.role_code);

            if (role.is_active !== true) {
                console.error('Staff role is inactive:', roleCode);
                return false;
            }

            if (!this.ALLOWED_ROLES.includes(roleCode)) {
                console.error('Unauthorized role:', roleCode);
                return false;
            }

            // 4. Build and store profile
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

            // 5. Store in session
            this._storeProfile();

            console.log('ADMIN AUTHORIZED:', this.profile);
            return true;

        } catch (error) {
            console.error('Profile loading error:', error);
            return false;
        }
    }

    // --------------------------------------------------------
    // Store profile in session storage
    // --------------------------------------------------------
    _storeProfile() {
        if (!this.profile) return;

        const keys = this.SESSION_KEYS;
        sessionStorage.setItem(keys.LOGGED_IN, 'true');
        sessionStorage.setItem(keys.ID, this.profile.id);
        sessionStorage.setItem(keys.AUTH_USER_ID, this.profile.auth_user_id);
        sessionStorage.setItem(keys.ROLE, this.profile.role);
        sessionStorage.setItem(keys.NAME, this.profile.full_name || this.profile.email);
        sessionStorage.setItem(keys.EMPLOYEE_NUMBER, this.profile.employee_number || '');
        sessionStorage.setItem(keys.PROFILE, JSON.stringify(this.profile));
    }

    // --------------------------------------------------------
    // Clear stored session
    // --------------------------------------------------------
    _clearStoredSession() {
        const keys = this.SESSION_KEYS;
        Object.values(keys).forEach(key => {
            sessionStorage.removeItem(key);
        });
    }

    // --------------------------------------------------------
    // Normalize role code
    // --------------------------------------------------------
    _normalizeRoleCode(code) {
        return String(code || '').trim().toUpperCase();
    }

    // --------------------------------------------------------
    // Render admin information (sidebar footer + topbar greeting)
    // --------------------------------------------------------
    _renderProfile() {
        if (!this.profile) return;

        const displayName = this.profile.full_name || this.profile.email || 'Admin';
        const firstName = displayName.trim().split(' ')[0] || displayName;
        const roleDisplay = this.profile.role_name || this.profile.role_code || 'Administrator';

        const elements = {
            adminName: displayName,
            welcomeName: firstName,
            adminRole: roleDisplay,
            adminAvatar: displayName.trim().charAt(0).toUpperCase()
        };

        Object.entries(elements).forEach(([id, text]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        });

        // Give the avatar a stable color derived from the name
        const avatarEl = document.getElementById('adminAvatar');
        if (avatarEl) {
            const colors = ['#0b5d3b', '#d4a843', '#06452c', '#1f2933'];
            const hash = displayName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            avatarEl.style.backgroundColor = colors[hash % colors.length];
        }
    }

    // --------------------------------------------------------
    // Role helpers
    // --------------------------------------------------------
    isSuperAdmin() {
        return this.profile?.role === 'SUPER_ADMIN';
    }

    isBranchManager() {
        return this.profile?.role === 'BRANCH_MANAGER';
    }

    isSalesAgent() {
        return this.profile?.role === 'SALES_AGENT';
    }

    isAuditor() {
        return this.profile?.role === 'AUDITOR';
    }

    hasRole(role) {
        if (!this.profile?.role) return false;
        return this.profile.role === this._normalizeRoleCode(role);
    }

    hasAnyRole(roles) {
        if (!Array.isArray(roles)) roles = [roles];
        return roles.some(role => this.hasRole(role));
    }

    canAccess(requiredRoles) {
        if (!this.profile) return false;
        if (!requiredRoles) return true;
        if (!Array.isArray(requiredRoles)) requiredRoles = [requiredRoles];
        return requiredRoles.some(role => this.hasRole(role));
    }

    // --------------------------------------------------------
    // Redirect to login
    // --------------------------------------------------------
    redirectToLogin() {
        this._clearStoredSession();
        window.location.href = 'admin-login.html';
    }

    // --------------------------------------------------------
    // Logout
    // --------------------------------------------------------
    async logout() {
        try {
            await supabaseClient.auth.signOut();
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            this._clearStoredSession();
            this.session = null;
            this.profile = null;
            window.location.href = 'admin-login.html';
        }
    }

    // --------------------------------------------------------
    // Get current user info
    // --------------------------------------------------------
    getUserInfo() {
        return {
            ...this.profile,
            session: this.session
        };
    }

    // --------------------------------------------------------
    // Live auth state listener (e.g. token expiry / sign-out
    // in another tab)
    // --------------------------------------------------------
    initAuthListener() {
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                this._clearStoredSession();
                this.session = null;
                this.profile = null;
                window.location.href = 'admin-login.html';
            } else if (event === 'SIGNED_IN' && session) {
                this.session = session;
                this._loadProfile().then((authorized) => {
                    if (authorized) this._renderProfile();
                });
            }
        });
    }
}

// --------------------------------------------------------
// Global singleton instance
// --------------------------------------------------------
const AdminAuth = AdminAuthService.getInstance();

// Global logout function for HTML onclick="handleLogout()"
async function handleLogout() {
    await AdminAuth.logout();
}

// Expose to window
window.AdminAuth = AdminAuth;
window.handleLogout = handleLogout;

// --------------------------------------------------------
// Auto-guard: run on every page that includes this script.
// Redirects unauthenticated/unauthorized visitors to login,
// and tells the rest of the page (e.g. admin-dashboard.js)
// once it's safe to start loading data.
// --------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    const profile = await AdminAuth.requireSession();
    if (profile) {
        AdminAuth.initAuthListener();
        document.dispatchEvent(new CustomEvent('admin:authorized', { detail: profile }));
    }
    // If profile is null, requireSession() already redirected to login.
});
