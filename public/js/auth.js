// ============================================================
// AUTHENTICATION - js/auth.js
// ============================================================

class AuthManager {
    constructor() {
        this.supabase = supabaseClient;
        this.currentUser = null;
        this.isAuthenticated = false;
        
        this.checkAuth();
        window.addEventListener('auth-change', (e) => this.handleAuthChange(e.detail));
    }

    // ============================================================
    // AUTH METHODS
    // ============================================================

    async register(userData) {
        try {
            // Create auth user
            const authResult = await this.supabase.signUp(
                userData.email,
                userData.password,
                {
                    first_name: userData.first_name,
                    last_name: userData.last_name,
                    role: 'member'
                }
            );
            
            if (!authResult.success) {
                return { success: false, error: authResult.error };
            }
            
            // Create member profile
            const memberData = {
                id: authResult.data.user.id,
                first_name: userData.first_name,
                last_name: userData.last_name,
                email: userData.email,
                phone: userData.phone,
                id_number: userData.id_number,
                date_of_birth: userData.date_of_birth,
                gender: userData.gender,
                plan_type: userData.plan_type,
                branch: userData.branch || 'Nairobi',
                agent_id: userData.agent_id || null,
                registration_fee: userData.registration_fee || 200,
                benefit_option: userData.benefit_option || 'service'
            };
            
            const memberResult = await this.supabase.createMember(memberData);
            
            if (!memberResult.success) {
                return { success: false, error: memberResult.error };
            }
            
            return {
                success: true,
                data: {
                    user: authResult.data.user,
                    member: memberResult.data
                }
            };
            
        } catch (error) {
            console.error('Registration error:', error);
            return { success: false, error: error.message };
        }
    }

    async login(email, password) {
        try {
            const result = await this.supabase.signIn(email, password);
            
            if (!result.success) {
                return { success: false, error: result.error };
            }
            
            // Get member profile
            const memberResult = await this.supabase.getMember(result.data.user.id);
            
            this.currentUser = {
                ...result.data.user,
                member: memberResult.success ? memberResult.data : null
            };
            this.isAuthenticated = true;
            
            localStorage.setItem(CONFIG.STORAGE.USER, JSON.stringify(this.currentUser));
            if (memberResult.success) {
                localStorage.setItem(CONFIG.STORAGE.MEMBER, JSON.stringify(memberResult.data));
            }
            
            return {
                success: true,
                data: {
                    user: this.currentUser,
                    session: result.data.session
                }
            };
            
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: error.message };
        }
    }

    async logout() {
        try {
            const result = await this.supabase.signOut();
            
            this.currentUser = null;
            this.isAuthenticated = false;
            
            localStorage.removeItem(CONFIG.STORAGE.USER);
            localStorage.removeItem(CONFIG.STORAGE.SESSION);
            localStorage.removeItem(CONFIG.STORAGE.MEMBER);
            
            return { success: true };
        } catch (error) {
            console.error('Logout error:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    // STATE MANAGEMENT
    // ============================================================

    checkAuth() {
        try {
            const stored = localStorage.getItem(CONFIG.STORAGE.USER);
            if (stored) {
                this.currentUser = JSON.parse(stored);
                this.isAuthenticated = true;
                return true;
            }
        } catch (error) {
            console.error('Check auth error:', error);
        }
        
        this.currentUser = null;
        this.isAuthenticated = false;
        return false;
    }

    handleAuthChange(detail) {
        if (detail.session) {
            this.currentUser = detail.user;
            this.isAuthenticated = true;
            
            // Fetch member profile
            this.supabase.getMember(detail.user.id).then(result => {
                if (result.success) {
                    this.currentUser.member = result.data;
                    localStorage.setItem(CONFIG.STORAGE.MEMBER, JSON.stringify(result.data));
                }
            });
        } else {
            this.currentUser = null;
            this.isAuthenticated = false;
        }
    }

    // ============================================================
    // GETTERS
    // ============================================================

    getUser() {
        if (!this.currentUser) {
            this.checkAuth();
        }
        return this.currentUser;
    }

    getMember() {
        const user = this.getUser();
        return user?.member || null;
    }

    getMembershipNumber() {
        const member = this.getMember();
        return member?.membership_number || null;
    }

    getRole() {
        const user = this.getUser();
        return user?.user_metadata?.role || user?.role || 'member';
    }

    isAdmin() {
        const role = this.getRole();
        return role === 'admin' || role === 'super_admin';
    }

    requireAuth(redirectUrl = CONFIG.ROUTES.LOGIN) {
        if (!this.isAuthenticated) {
            window.location.href = redirectUrl;
            return false;
        }
        return true;
    }

    redirectIfAuthenticated(redirectUrl = CONFIG.ROUTES.DASHBOARD) {
        if (this.isAuthenticated) {
            window.location.href = redirectUrl;
            return true;
        }
        return false;
    }
}

// Create singleton
const authManager = new AuthManager();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = authManager;
} else {
    window.authManager = authManager;
}
