// ============================================================
// ADMIN DASHBOARD - js/admin/dashboard.js
// ============================================================

class AdminDashboard {
    constructor() {
        this.supabase = adminAuth.getSupabase();
        this.data = {
            members: 0,
            agents: 0,
            activeAgents: 0,
            revenue: {
                daily: 0,
                monthly: 0,
                total: 0
            },
            unassigned: 0,
            pending: 0,
            recentPayments: [],
            recentMembers: [],
            recentAgents: []
        };
        this.refreshInterval = null;
        this.chart = null;
    }

    async loadDashboard() {
        try {
            await this.loadStats();
            await this.loadRecentActivity();
            await this.updateUI();
            this.setupRealtime();
            this.setupAutoRefresh();
            return { success: true };
        } catch (error) {
            console.error('Dashboard load error:', error);
            return { success: false, error: error.message };
        }
    }

    async loadStats() {
        try {
            // Get counts
            const [members, agents, payments] = await Promise.all([
                this.supabase.from('members').select('*', { count: 'exact', head: true }),
                this.supabase.from('agents').select('*', { count: 'exact', head: true }),
                this.supabase.from('payments').select('*')
            ]);

            this.data.members = members.count || 0;
            this.data.agents = agents.count || 0;

            // Active agents
            const { data: activeAgents } = await this.supabase
                .from('agents')
                .select('*')
                .eq('status', 'active');

            this.data.activeAgents = activeAgents?.length || 0;

            // Revenue calculations
            const allPayments = payments.data || [];
            const completedPayments = allPayments.filter(p => p.status === 'completed');
            
            this.data.revenue.total = completedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

            // Today
            const today = new Date().toDateString();
            const todayPayments = completedPayments.filter(p => 
                p.created_at && new Date(p.created_at).toDateString() === today
            );
            this.data.revenue.daily = todayPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

            // This month
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthPayments = completedPayments.filter(p => 
                p.created_at && new Date(p.created_at) >= monthStart
            );
            this.data.revenue.monthly = monthPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

            // Unassigned
            const unassigned = allPayments.filter(p => p.status === 'unassigned');
            this.data.unassigned = unassigned.length;
            this.data.unassignedAmount = unassigned.reduce((sum, p) => sum + (p.amount || 0), 0);

            // Pending
            const pending = allPayments.filter(p => p.status === 'pending');
            this.data.pending = pending.length;
            this.data.pendingAmount = pending.reduce((sum, p) => sum + (p.amount || 0), 0);

        } catch (error) {
            console.error('Load stats error:', error);
            throw error;
        }
    }

    async loadRecentActivity() {
        try {
            // Recent members
            const { data: recentMembers } = await this.supabase
                .from('members')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(5);

            this.data.recentMembers = recentMembers || [];

            // Recent agents
            const { data: recentAgents } = await this.supabase
                .from('agents')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(5);

            this.data.recentAgents = recentAgents || [];

            // Recent payments
            const { data: recentPayments } = await this.supabase
                .from('payments')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            this.data.recentPayments = recentPayments || [];

        } catch (error) {
            console.error('Load recent activity error:', error);
            throw error;
        }
    }

    updateUI() {
        // Update stats
        document.getElementById('totalMembers').textContent = this.data.members;
        document.getElementById('totalAgents').textContent = this.data.agents;
        document.getElementById('activeAgents').textContent = this.data.activeAgents;
        document.getElementById('dailyRevenue').textContent = `KES ${this.data.revenue.daily.toLocaleString()}`;
        document.getElementById('monthRevenue').textContent = `KES ${this.data.revenue.monthly.toLocaleString()}`;
        document.getElementById('totalRevenue').textContent = `KES ${this.data.revenue.total.toLocaleString()}`;
        document.getElementById('unassignedCount').textContent = this.data.unassigned;
        document.getElementById('unassignedAmount').textContent = `KES ${this.data.unassignedAmount.toLocaleString()}`;
        document.getElementById('pendingPayments').textContent = this.data.pending;
        document.getElementById('pendingAmount').textContent = `KES ${this.data.pendingAmount.toLocaleString()}`;

        // Update badges
        document.getElementById('memberCountBadge').textContent = this.data.members;
        document.getElementById('pendingAgentsBadge').textContent = this.data.agents - this.data.activeAgents;

        // Update recent tables
        this.renderRecentMembers();
        this.renderRecentAgents();
        this.renderRecentPayments();
    }

    renderRecentMembers() {
        const tbody = document.getElementById('recentMembersBody');
        const members = this.data.recentMembers;

        if (!members || members.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="empty-state">
                        <i class="fas fa-users"></i>
                        No members registered yet
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = members.map(m => `
            <tr onclick="window.location.href='admin-members.html?id=${m.id}'" style="cursor:pointer;">
                <td><strong>${m.first_name || ''} ${m.last_name || ''}</strong></td>
                <td>${m.phone || 'N/A'}</td>
                <td>${m.created_at ? new Date(m.created_at).toLocaleDateString('en-KE') : 'N/A'}</td>
                <td><span class="status-badge ${m.is_active ? 'active' : 'inactive'}">${m.is_active ? 'Active' : 'Inactive'}</span></td>
            </tr>
        `).join('');
    }

    renderRecentAgents() {
        const tbody = document.getElementById('pendingAgentsBody');
        const agents = this.data.recentAgents;

        if (!agents || agents.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="empty-state">
                        <i class="fas fa-user-tie"></i>
                        No agents registered yet
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = agents.map(a => `
            <tr onclick="window.location.href='admin-agents.html?id=${a.id}'" style="cursor:pointer;">
                <td><strong>${a.full_name || a.first_name || 'N/A'}</strong></td>
                <td>${a.phone || 'N/A'}</td>
                <td>${a.created_at ? new Date(a.created_at).toLocaleDateString('en-KE') : 'N/A'}</td>
                <td><span class="status-badge ${a.status === 'active' ? 'active' : 'pending'}">${a.status || 'Pending'}</span></td>
            </tr>
        `).join('');
    }

    renderRecentPayments() {
        const tbody = document.getElementById('recentPaymentsBody');
        const payments = this.data.recentPayments;

        if (!payments || payments.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state">
                        <i class="fas fa-credit-card"></i>
                        No payments recorded yet
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = payments.map(p => `
            <tr>
                <td>${p.member_name || p.membership_number || 'N/A'}</td>
                <td><strong>KES ${(p.amount || 0).toLocaleString()}</strong></td>
                <td>${p.mpesa_code || 'N/A'}</td>
                <td>${p.created_at ? new Date(p.created_at).toLocaleDateString('en-KE') : 'N/A'}</td>
                <td><span class="status-badge ${p.status || 'pending'}">${p.status || 'Pending'}</span></td>
            </tr>
        `).join('');
    }

    setupRealtime() {
        // Subscribe to changes
        const channel = this.supabase.channel('dashboard-changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'payments' },
                () => this.handleRealtimeUpdate()
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'members' },
                () => this.handleRealtimeUpdate()
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'agents' },
                () => this.handleRealtimeUpdate()
            )
            .subscribe();

        // Update live indicator
        document.getElementById('liveIndicator').classList.add('connected');
        document.getElementById('liveIndicatorLabel').textContent = 'Live';
    }

    handleRealtimeUpdate() {
        // Debounce updates
        clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(() => {
            this.loadDashboard();
        }, 1000);
    }

    setupAutoRefresh() {
        // Refresh every 60 seconds
        this.refreshInterval = setInterval(() => {
            this.loadDashboard();
        }, 60000);
    }

    destroy() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
}

// Create singleton
const adminDashboard = new AdminDashboard();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = adminDashboard;
} else {
    window.adminDashboard = adminDashboard;
}
