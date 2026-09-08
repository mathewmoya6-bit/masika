// ============================================================
// ADMIN DASHBOARD - js/admin/dashboard.js
// ============================================================

class AdminDashboard {
    constructor() {
        this.supabase = adminAuth.getSupabase();
        this.data = {
            members: 0,
            activeMembers: 0,
            agents: 0,
            activeAgents: 0,
            payments: {
                total: 0,
                completed: 0,
                revenue: 0,
                unassigned: 0,
                unassignedAmount: 0,
                pending: 0,
                pendingAmount: 0
            },
            revenue: {
                daily: 0,
                monthly: 0,
                total: 0
            },
            recentMembers: [],
            recentAgents: [],
            recentPayments: [],
            unassignedPayments: []
        };
        this.refreshInterval = null;
        this._updateTimeout = null;
    }

    async loadDashboard() {
        try {
            await this.loadStats();
            await this.loadRecentActivity();
            this.updateUI();
            this.setupRealtime();
            this.setupAutoRefresh();

            // Update live indicator
            const indicator = document.getElementById('liveIndicator');
            if (indicator) {
                indicator.classList.add('connected');
                document.getElementById('liveIndicatorLabel').textContent = 'Live';
            }

            return { success: true };
        } catch (error) {
            console.error('Dashboard load error:', error);
            return { success: false, error: error.message };
        }
    }

    async loadStats() {
        try {
            console.log('Loading stats...');

            // ============================================
            // MEMBERS - Using 'members' table
            // ============================================
            const { count: membersCount, error: membersError } = await this.supabase
                .from('members')
                .select('*', { count: 'exact', head: true });

            if (membersError) console.warn('Members error:', membersError);
            this.data.members = membersCount || 0;

            const { count: activeMembers, error: activeError } = await this.supabase
                .from('members')
                .select('*', { count: 'exact', head: true })
                .eq('is_active', true);

            if (activeError) console.warn('Active members error:', activeError);
            this.data.activeMembers = activeMembers || 0;

            console.log('Members:', this.data.members, 'Active:', this.data.activeMembers);

            // ============================================
            // SALES AGENTS - Using 'sales_agents' table
            // ============================================
            const { count: agentsCount, error: agentsError } = await this.supabase
                .from('sales_agents')
                .select('*', { count: 'exact', head: true });

            if (agentsError) console.warn('Agents error:', agentsError);
            this.data.agents = agentsCount || 0;

            const { data: activeAgentsData, error: activeAgentsError } = await this.supabase
                .from('sales_agents')
                .select('*')
                .eq('status', 'active');

            if (activeAgentsError) console.warn('Active agents error:', activeAgentsError);
            this.data.activeAgents = activeAgentsData?.length || 0;

            console.log('Agents:', this.data.agents, 'Active:', this.data.activeAgents);

            // ============================================
            // PAYMENTS - Using 'payments' table
            // ============================================
            const { data: paymentsData, error: paymentsError } = await this.supabase
                .from('payments')
                .select('*');

            if (paymentsError) console.warn('Payments error:', paymentsError);

            const allPayments = paymentsData || [];
            console.log('Total payments:', allPayments.length);

            // Payment stats
            const completedPayments = allPayments.filter(p => 
                p.status === 'completed' || p.status === 'confirmed'
            );
            const unassignedPayments = allPayments.filter(p => p.status === 'unassigned');
            const pendingPayments = allPayments.filter(p => p.status === 'pending');

            this.data.payments = {
                total: allPayments.length,
                completed: completedPayments.length,
                revenue: completedPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
                unassigned: unassignedPayments.length,
                unassignedAmount: unassignedPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
                pending: pendingPayments.length,
                pendingAmount: pendingPayments.reduce((sum, p) => sum + (p.amount || 0), 0)
            };

            this.data.revenue.total = this.data.payments.revenue;

            // Today's Revenue
            const today = new Date().toDateString();
            const todayPayments = completedPayments.filter(p =>
                p.created_at && new Date(p.created_at).toDateString() === today
            );
            this.data.revenue.daily = todayPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

            // This Month's Revenue
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthPayments = completedPayments.filter(p =>
                p.created_at && new Date(p.created_at) >= monthStart
            );
            this.data.revenue.monthly = monthPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

            console.log('Revenue - Today:', this.data.revenue.daily, 'Month:', this.data.revenue.monthly, 'Total:', this.data.revenue.total);

            // Unassigned payments for list
            this.data.unassignedPayments = unassignedPayments;

        } catch (error) {
            console.error('Load stats error:', error);
            throw error;
        }
    }

    async loadRecentActivity() {
        try {
            console.log('Loading recent activity...');

            // ============================================
            // RECENT MEMBERS - Using 'members' table
            // ============================================
            const { data: recentMembers, error: membersError } = await this.supabase
                .from('members')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(5);

            if (membersError) console.warn('Recent members error:', membersError);
            this.data.recentMembers = recentMembers || [];
            console.log('Recent members:', this.data.recentMembers.length);

            // ============================================
            // RECENT AGENTS - Using 'sales_agents' table
            // ============================================
            const { data: recentAgents, error: agentsError } = await this.supabase
                .from('sales_agents')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(5);

            if (agentsError) console.warn('Recent agents error:', agentsError);
            this.data.recentAgents = recentAgents || [];
            console.log('Recent agents:', this.data.recentAgents.length);

            // ============================================
            // RECENT PAYMENTS - Using 'payments' table
            // ============================================
            const { data: recentPayments, error: paymentsError } = await this.supabase
                .from('payments')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            if (paymentsError) console.warn('Recent payments error:', paymentsError);
            this.data.recentPayments = recentPayments || [];
            console.log('Recent payments:', this.data.recentPayments.length);

        } catch (error) {
            console.error('Load recent activity error:', error);
            throw error;
        }
    }

    updateUI() {
        console.log('Updating UI...');

        // Stats
        document.getElementById('totalMembers').textContent = this.data.members;
        document.getElementById('totalAgents').textContent = this.data.agents;
        document.getElementById('activeAgents').textContent = this.data.activeAgents;
        document.getElementById('memberCountBadge').textContent = this.data.members;
        document.getElementById('pendingAgentsBadge').textContent = this.data.agents - this.data.activeAgents;

        // Revenue
        document.getElementById('totalRevenue').textContent = `KES ${this.data.revenue.total.toLocaleString()}`;
        document.getElementById('totalRevenueCount').textContent = `${this.data.payments.completed} payments`;

        document.getElementById('dailyRevenue').textContent = `KES ${this.data.revenue.daily.toLocaleString()}`;
        document.getElementById('dailyRevenueCount').textContent = `Today`;

        document.getElementById('monthRevenue').textContent = `KES ${this.data.revenue.monthly.toLocaleString()}`;
        document.getElementById('monthRevenueCount').textContent = `${this.data.payments.completed} payments`;

        // Unassigned
        document.getElementById('unassignedCount').textContent = this.data.payments.unassigned;
        document.getElementById('unassignedAmount').textContent = `KES ${this.data.payments.unassignedAmount.toLocaleString()} unmatched`;
        document.getElementById('unassignedBadge').textContent = this.data.payments.unassigned;

        // Pending
        document.getElementById('pendingPayments').textContent = this.data.payments.pending;
        document.getElementById('pendingAmount').textContent = `KES ${this.data.payments.pendingAmount.toLocaleString()}`;

        // Render tables
        this.renderRecentMembers();
        this.renderRecentAgents();
        this.renderRecentPayments();
        this.renderUnassignedPayments();
    }

    renderRecentMembers() {
        const tbody = document.getElementById('recentMembersBody');
        if (!tbody) return;

        const members = this.data.recentMembers;

        if (!members || members.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center;padding:30px;color:var(--text-light);">
                        <i class="fas fa-users" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.3;"></i>
                        No members registered yet
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = members.map(m => `
            <tr onclick="window.location.href='admin-members.html?id=${m.id}'" style="cursor:pointer;">
                <td><strong>${this.escapeHtml(m.first_name || '')} ${this.escapeHtml(m.last_name || '')}</strong></td>
                <td>${this.escapeHtml(m.phone || 'N/A')}</td>
                <td>${m.created_at ? new Date(m.created_at).toLocaleDateString('en-KE') : 'N/A'}</td>
                <td><span class="status-badge ${m.is_active ? 'active' : 'inactive'}">${m.is_active ? 'Active' : 'Inactive'}</span></td>
            </tr>
        `).join('');
    }

    renderRecentAgents() {
        const tbody = document.getElementById('pendingAgentsBody');
        if (!tbody) return;

        const agents = this.data.recentAgents;

        if (!agents || agents.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center;padding:30px;color:var(--text-light);">
                        <i class="fas fa-user-tie" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.3;"></i>
                        No agents registered yet
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = agents.map(a => `
            <tr onclick="window.location.href='admin-agents.html?id=${a.id}'" style="cursor:pointer;">
                <td><strong>${this.escapeHtml(a.full_name || a.first_name || 'N/A')}</strong></td>
                <td>${this.escapeHtml(a.phone || 'N/A')}</td>
                <td>${a.created_at ? new Date(a.created_at).toLocaleDateString('en-KE') : 'N/A'}</td>
                <td><span class="status-badge ${a.status === 'active' ? 'active' : 'pending'}">${a.status || 'Pending'}</span></td>
            </tr>
        `).join('');
    }

    renderRecentPayments() {
        const tbody = document.getElementById('recentPaymentsBody');
        if (!tbody) return;

        const payments = this.data.recentPayments;

        if (!payments || payments.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center;padding:30px;color:var(--text-light);">
                        <i class="fas fa-credit-card" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.3;"></i>
                        No payments recorded yet
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = payments.map(p => `
            <tr>
                <td>${this.escapeHtml(p.member_name || p.membership_number || 'N/A')}</td>
                <td><strong>KES ${(p.amount || 0).toLocaleString()}</strong></td>
                <td>${this.escapeHtml(p.mpesa_code || p.mpesa_receipt || 'N/A')}</td>
                <td>${p.created_at ? new Date(p.created_at).toLocaleDateString('en-KE') : 'N/A'}</td>
                <td><span class="status-badge ${p.status || 'pending'}">${p.status || 'Pending'}</span></td>
            </tr>
        `).join('');
    }

    renderUnassignedPayments() {
        const container = document.getElementById('unassignedPayments');
        if (!container) return;

        const payments = this.data.unassignedPayments;

        if (!payments || payments.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <p>No unassigned payments. All payments matched!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Amount</th>
                            <th>M-Pesa Code</th>
                            <th>Account Number</th>
                            <th>Date</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${payments.map(p => `
                            <tr>
                                <td><strong>KES ${(p.amount || 0).toLocaleString()}</strong></td>
                                <td>${this.escapeHtml(p.mpesa_code || 'N/A')}</td>
                                <td>${this.escapeHtml(p.account_number || 'N/A')}</td>
                                <td>${p.created_at ? new Date(p.created_at).toLocaleDateString('en-KE') : 'N/A'}</td>
                                <td>
                                    <button onclick="window.assignPayment('${p.id}')" class="btn btn-primary btn-sm">
                                        <i class="fas fa-link"></i> Assign
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    setupRealtime() {
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
                { event: '*', schema: 'public', table: 'sales_agents' },
                () => this.handleRealtimeUpdate()
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    const indicator = document.getElementById('liveIndicator');
                    if (indicator) {
                        indicator.classList.add('connected');
                        document.getElementById('liveIndicatorLabel').textContent = 'Live';
                    }
                }
            });
    }

    handleRealtimeUpdate() {
        clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(() => {
            this.loadDashboard();
        }, 1000);
    }

    setupAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => {
            this.loadDashboard();
        }, 60000);
    }

    destroy() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        if (this._updateTimeout) {
            clearTimeout(this._updateTimeout);
            this._updateTimeout = null;
        }
    }

    escapeHtml(value) {
        if (!value) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Create singleton
const adminDashboard = new AdminDashboard();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = adminDashboard;
} else {
    window.adminDashboard = adminDashboard;
}
