// ============================================================
// ADMIN AUTHENTICATION - js/admin/auth.js
// ============================================================

class AdminAuth {
    constructor() {
        this.supabase = null;
        this.currentAdmin = null;
        this.isAuthenticated = false;
        this.initSupabase();
        this.checkSession();
    }

    initSupabase() {
        const { createClient } = supabase;
        this.supabase = createClient(
            ADMIN_CONFIG.SUPABASE.URL,
            ADMIN_CONFIG.SUPABASE.ANON_KEY
        );
    }

    async checkSession() {
        try {
            const { data: { session }, error } = await this.supabase.auth.getSession();
            
            if (error || !session) {
                this.isAuthenticated = false;
                this.currentAdmin = null;
                return;
            }

            // Verify admin
            const { data: admin, error: adminError } = await this.supabase
                .from('admins')
                .select('*')
                .eq('id', session.user.id)
                .single();

            if (adminError || !admin) {
                this.isAuthenticated = false;
                this.currentAdmin = null;
                await this.supabase.auth.signOut();
                return;
            }

            this.currentAdmin = admin;
            this.isAuthenticated = true;
            localStorage.setItem(ADMIN_CONFIG.STORAGE.ADMIN_USER, JSON.stringify(admin));
            localStorage.setItem(ADMIN_CONFIG.STORAGE.ACCESS_TOKEN, session.access_token);

            return admin;

        } catch (error) {
            console.error('Session check error:', error);
            this.isAuthenticated = false;
            this.currentAdmin = null;
        }
    }

    async login(email, password) {
        try {
            const { data, error } = await this.supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) throw error;

            if (!data.user) {
                throw new Error('Invalid credentials');
            }

            // Verify admin
            const { data: admin, error: adminError } = await this.supabase
                .from('admins')
                .select('*')
                .eq('id', data.user.id)
                .single();

            if (adminError || !admin) {
                await this.supabase.auth.signOut();
                throw new Error('Admin access required');
            }

            this.currentAdmin = admin;
            this.isAuthenticated = true;
            localStorage.setItem(ADMIN_CONFIG.STORAGE.ADMIN_USER, JSON.stringify(admin));
            localStorage.setItem(ADMIN_CONFIG.STORAGE.ACCESS_TOKEN, data.session.access_token);

            return { success: true, admin };

        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: error.message };
        }
    }

    async logout() {
        try {
            await this.supabase.auth.signOut();
            this.isAuthenticated = false;
            this.currentAdmin = null;
            localStorage.removeItem(ADMIN_CONFIG.STORAGE.ADMIN_USER);
            localStorage.removeItem(ADMIN_CONFIG.STORAGE.ACCESS_TOKEN);
            localStorage.removeItem(ADMIN_CONFIG.STORAGE.ADMIN_SESSION);
            return { success: true };
        } catch (error) {
            console.error('Logout error:', error);
            return { success: false, error: error.message };
        }
    }

    getAdmin() {
        if (this.currentAdmin) return this.currentAdmin;
        
        try {
            const stored = localStorage.getItem(ADMIN_CONFIG.STORAGE.ADMIN_USER);
            if (stored) {
                this.currentAdmin = JSON.parse(stored);
                this.isAuthenticated = true;
                return this.currentAdmin;
            }
        } catch (error) {
            console.error('Get admin error:', error);
        }
        return null;
    }

    getToken() {
        return localStorage.getItem(ADMIN_CONFIG.STORAGE.ACCESS_TOKEN);
    }

    requireAuth(redirectUrl = ADMIN_CONFIG.ROUTES.LOGIN) {
        if (!this.isAuthenticated) {
            window.location.href = redirectUrl;
            return false;
        }
        return true;
    }

    redirectIfAuthenticated(redirectUrl = ADMIN_CONFIG.ROUTES.DASHBOARD) {
        if (this.isAuthenticated) {
            window.location.href = redirectUrl;
            return true;
        }
        return false;
    }

    // Get Supabase client for admin operations
    getSupabase() {
        return this.supabase;
    }

    // Get service role client for admin operations
    getServiceClient() {
        return this.supabase;
    }
}

// Create singleton
const adminAuth = new AdminAuth();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = adminAuth;
} else {
    window.adminAuth = adminAuth;
}
