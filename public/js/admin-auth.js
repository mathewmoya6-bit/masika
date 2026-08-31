// ============================================================
// MASIKA BENEVOLENT — ADMIN AUTHENTICATION & AUTHORIZATION
// ============================================================
// Database schema:
//   staff (id, auth_user_id, employee_number, full_name, role_id)
//   roles (id, role_code, role_name, is_active)
// Authorized roles: SUPER_ADMIN, BRANCH_MANAGER, SALES_AGENT, AUDITOR
// ============================================================

class AdminAuth {
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
        if (!AdminAuth._instance) {
            AdminAuth._instance = new AdminAuth();
        }
        return AdminAuth._instance;
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
    // Require authenticated + authorized staff
    // --------------------------------------------------------
    async requireSession(redirectOnFail = true) {
        try {
            // Check session storage first for performance
            if (this._hasStoredSession()) {
                const profile = this._getStoredProfile();
                if (profile) {
                    this.profile = profile;
                    this._renderProfile();
                    await this._loadAgentCount();
                    return this.session;
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
            await this._loadAgentCount();

            return this.session;

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
    // Render admin information
    // --------------------------------------------------------
    _renderProfile() {
        if (!this.profile) return;

        const displayName = this.profile.full_name || this.profile.email || 'Admin';
        const roleDisplay = this.profile.role_name || this.profile.role_code || 'Administrator';

        // Update UI elements
        const elements = {
            adminName: { text: displayName },
            adminRole: { text: roleDisplay },
            adminAvatar: { text: displayName.trim().charAt(0).toUpperCase() }
        };

        Object.entries(elements).forEach(([id, config]) => {
            const el = document.getElementById(id);
            if (el) {
                if (config.text !== undefined) {
                    el.textContent = config.text;
                }
            }
        });

        // Update avatar background if exists
        const avatarEl = document.getElementById('adminAvatar');
        if (avatarEl) {
            const colors = ['#0b5d3b', '#d4a843', '#06452c', '#1f2933'];
            const hash = displayName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            avatarEl.style.backgroundColor = colors[hash % colors.length];
        }
    }

    // --------------------------------------------------------
    // Load agent count (staff with SALES_AGENT role)
    // --------------------------------------------------------
    async _loadAgentCount() {
        const badge = document.getElementById('agentCountBadge');
        if (!badge) return;

        try {
            // Get the SALES_AGENT role ID first
            const { data: role, error: roleError } = await supabaseClient
                .from('roles')
                .select('id')
                .eq('role_code', 'SALES_AGENT')
                .maybeSingle();

            if (roleError || !role) {
                console.warn('Could not find SALES_AGENT role:', roleError);
                return;
            }

            const { count, error } = await supabaseClient
                .from('staff')
                .select('id', { count: 'exact', head: true })
                .eq('role_id', role.id);

            if (!error && typeof count === 'number') {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            }
        } catch (error) {
            console.warn('Could not load agent count:', error);
        }
    }

    // --------------------------------------------------------
    // Role helpers
    // --------------------------------------------------------
    isAdmin() {
        return this.profile?.role === 'SUPER_ADMIN';
    }

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
    // Initialize auth listener
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
                this._loadProfile().then(() => {
                    this._renderProfile();
                    this._loadAgentCount();
                });
            }
        });
    }
}

// --------------------------------------------------------
// Global instance
// --------------------------------------------------------
const AdminAuth = AdminAuth.getInstance();

// Global logout function for HTML onclick
async function handleLogout() {
    await AdminAuth.logout();
}

// Expose to window
window.AdminAuth = AdminAuth;
window.handleLogout = handleLogout;
