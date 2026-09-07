// ============================================================
// SUPABASE CLIENT - js/supabase.js
// ============================================================

const { createClient } = supabase;

class SupabaseClient {
    constructor() {
        this.client = createClient(
            CONFIG.SUPABASE.URL,
            CONFIG.SUPABASE.ANON_KEY
        );
        this.session = null;
        this.user = null;
        this.member = null;
        
        // Listen for auth changes
        this.client.auth.onAuthStateChange((event, session) => {
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
            const { data, error } = await this.client.auth.signUp({
                email,
                password,
                options: { data: metadata }
            });
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Sign up error:', error);
            return { success: false, error: error.message };
        }
    }

    async signIn(email, password) {
        try {
            const { data, error } = await this.client.auth.signInWithPassword({
                email,
                password
            });
            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Sign in error:', error);
            return { success: false, error: error.message };
        }
    }

    async signOut() {
        try {
            const { error } = await this.client.auth.signOut();
            if (error) throw error;
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

    // ============================================================
    // MEMBER METHODS
    // ============================================================

    async createMember(memberData) {
        try {
            const { data, error } = await this.client
                .from('members')
                .insert([memberData])
                .select()
                .single();
            if (error) throw error;
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
}

// Create singleton instance
const supabaseClient = new SupabaseClient();

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = supabaseClient;
} else {
    window.supabaseClient = supabaseClient;
}
