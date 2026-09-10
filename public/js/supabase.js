// ============================================================
// SUPABASE CLIENT - js/supabase.js
// ============================================================

// Use the global CONFIG object
const { createClient } = supabase;

class SupabaseClient {
    constructor() {
        // Get config from window.CONFIG
        const config = window.CONFIG || {
            SUPABASE: {
                URL: 'https://wpxzlcdrirlcyvfiquld.supabase.co',
                ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndweHpsY2RyaXJsY3l2ZmlxdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Mjc4MDcsImV4cCI6MjEwMzUwMzgwN30.OUP9pmPbrML_egpHflZtDfLv1_UDM37_BYjtb842xjg'
            }
        };
        
        console.log('🔐 Initializing Supabase client...');
        console.log('📡 URL:', config.SUPABASE.URL);
        console.log('🔑 ANON_KEY exists:', !!config.SUPABASE.ANON_KEY);
        
        try {
            this.client = createClient(
                config.SUPABASE.URL,
                config.SUPABASE.ANON_KEY
            );
            console.log('✅ Supabase client created successfully');
        } catch (error) {
            console.error('❌ Failed to create Supabase client:', error);
            throw error;
        }
        
        this.session = null;
        this.user = null;
        this.member = null;
        
        // Listen for auth changes
        this.client.auth.onAuthStateChange((event, session) => {
            console.log('🔐 Auth state changed:', event);
            this.session = session;
            this.user = session?.user || null;
            
            if (session) {
                localStorage.setItem(CONFIG.STORAGE.SESSION, JSON.stringify(session));
                localStorage.setItem(CONFIG.STORAGE.USER, JSON.stringify(session.user));
            } else {
                localStorage.removeItem(CONFIG.STORAGE.SESSION);
                localStorage.removeItem(CONFIG.STORAGE.USER);
            }
            
            // Dispatch event
            window.dispatchEvent(new CustomEvent('auth-change', {
                detail: { event, session, user: this.user }
            }));
        });
    }

    // ============================================================
    // AUTH METHODS
    // ============================================================

    async signUp(email, password, metadata = {}) {
        try {
            console.log('📝 Signing up user:', email);
            const { data, error } = await this.client.auth.signUp({
                email,
                password,
                options: { data: metadata }
            });
            if (error) {
                console.error('❌ Sign up error:', error);
                throw error;
            }
            console.log('✅ User signed up:', data.user?.email);
            return { success: true, data };
        } catch (error) {
            console.error('Sign up error:', error);
            return { success: false, error: error.message };
        }
    }

    async signIn(email, password) {
        try {
            console.log('🔐 Signing in user:', email);
            const { data, error } = await this.client.auth.signInWithPassword({
                email,
                password
            });
            if (error) {
                console.error('❌ Sign in error:', error);
                throw error;
            }
            console.log('✅ User signed in:', data.user?.email);
            return { success: true, data };
        } catch (error) {
            console.error('Sign in error:', error);
            return { success: false, error: error.message };
        }
    }

    async signOut() {
        try {
            console.log('🚪 Signing out...');
            const { error } = await this.client.auth.signOut();
            if (error) throw error;
            console.log('✅ Signed out');
            return { success: true };
        } catch (error) {
            console.error('Sign out error:', error);
            return { success: false, error: error.message };
        }
    }

    async getCurrentUser() {
        try {
            const { data, error } = await this.client.auth.getUser();
            if (error) throw error;
            return { success: true, data: data.user };
        } catch (error) {
            console.error('Get user error:', error);
            return { success: false, error: error.message };
        }
    }

    async getSession() {
        try {
            const { data, error } = await this.client.auth.getSession();
            if (error) throw error;
            return { success: true, data: data.session };
        } catch (error) {
            console.error('Get session error:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    // MEMBER METHODS
    // ============================================================

    async createMember(memberData) {
        try {
            console.log('📝 Creating member:', memberData.email);
            const { data, error } = await this.client
                .from('members')
                .insert([memberData])
                .select()
                .single();
            if (error) {
                console.error('❌ Create member error:', error);
                throw error;
            }
            console.log('✅ Member created:', data.membership_number);
            return { success: true, data };
        } catch (error) {
            console.error('Create member error:', error);
            return { success: false, error: error.message };
        }
    }

    async getMember(userId) {
        try {
            const { data, error } = await this.client
                .from('members')
                .select('*')
                .eq('id', userId)
                .single();
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Get member error:', error);
            return { success: false, error: error.message };
        }
    }

    async getMemberByMembershipNumber(membershipNumber) {
        try {
            const { data, error } = await this.client
                .from('members')
                .select('*')
                .eq('membership_number', membershipNumber)
                .single();
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Get member by membership number error:', error);
            return { success: false, error: error.message };
        }
    }

    async updateMember(userId, updateData) {
        try {
            const { data, error } = await this.client
                .from('members')
                .update(updateData)
                .eq('id', userId)
                .select()
                .single();
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Update member error:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    // DEPENDANT METHODS
    // ============================================================

    async createDependant(dependantData) {
        try {
            const { data, error } = await this.client
                .from('dependants')
                .insert([dependantData])
                .select()
                .single();
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Create dependant error:', error);
            return { success: false, error: error.message };
        }
    }

    async getMemberDependants(memberId) {
        try {
            const { data, error } = await this.client
                .from('dependants')
                .select('*')
                .eq('member_id', memberId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Get dependants error:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    // PAYMENT METHODS
    // ============================================================

    async createPayment(paymentData) {
        try {
            const { data, error } = await this.client
                .from('payments')
                .insert([paymentData])
                .select()
                .single();
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Create payment error:', error);
            return { success: false, error: error.message };
        }
    }

    async getMemberPayments(membershipNumber, limit = 50, offset = 0, status = null) {
        try {
            let query = this.client
                .from('payments')
                .select('*')
                .eq('membership_number', membershipNumber);
            
            if (status) {
                query = query.eq('status', status);
            }
            
            query = query.range(offset, offset + limit - 1);
            query = query.order('created_at', { ascending: false });
            
            const { data, error } = await query;
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Get member payments error:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    // AGENT METHODS
    // ============================================================

    async getAgents() {
        try {
            const { data, error } = await this.client
                .from('sales_agents')
                .select('*')
                .eq('status', 'ACTIVE')
                .order('full_name', { ascending: true });
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Get agents error:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    // PLAN METHODS
    // ============================================================

    async getPlans() {
        try {
            const { data, error } = await this.client
                .from('plans')
                .select('*')
                .eq('is_active', true)
                .order('monthly_fee', { ascending: true });
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Get plans error:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================================
    // UTILITY METHODS
    // ============================================================

    isAuthenticated() {
        return !!this.user || !!localStorage.getItem(CONFIG.STORAGE.USER);
    }

    getCurrentUser() {
        try {
            const user = localStorage.getItem(CONFIG.STORAGE.USER);
            return user ? JSON.parse(user) : null;
        } catch {
            return null;
        }
    }

    getSession() {
        try {
            const session = localStorage.getItem(CONFIG.STORAGE.SESSION);
            return session ? JSON.parse(session) : null;
        } catch {
            return null;
        }
    }

    // Real-time subscriptions
    subscribeToTable(table, callback, filter = null) {
        const subscription = this.client
            .channel('table-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: table,
                    filter: filter
                },
                (payload) => callback(payload)
            )
            .subscribe();
        return subscription;
    }

    unsubscribe(subscription) {
        if (subscription) {
            subscription.unsubscribe();
        }
    }

    // Test connection
    async testConnection() {
        try {
            console.log('🔍 Testing Supabase connection...');
            const { data, error } = await this.client
                .from('members')
                .select('count', { count: 'exact', head: true });
            
            if (error) {
                console.error('❌ Connection test failed:', error);
                return { success: false, error: error.message };
            }
            
            console.log('✅ Supabase connection successful!');
            return { success: true, data };
        } catch (error) {
            console.error('❌ Connection test error:', error);
            return { success: false, error: error.message };
        }
    }
}

// Create singleton instance
const supabaseClient = new SupabaseClient();

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = supabaseClient;
} else {
    window.supabaseClient = supabaseClient;
    console.log('✅ Supabase client initialized');
    
    // Test connection on load
    setTimeout(() => {
        supabaseClient.testConnection();
    }, 1000);
}
