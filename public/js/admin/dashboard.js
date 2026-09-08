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

            // Get members count
            const { count: membersCount, error: membersError } = await this.supabase
                .from('members')
                .select('*', { count: 'exact', head: true });
            
            if (membersError) {
                console.warn('Members count error:', membersError);
            }
            this.data.members = membersCount || 0;
            console.log('Members count:', this.data.members);

            // Get sales agents count
            const { count: agentsCount, error: agentsError } = await this.supabase
                .from('sales_agents')
                .select('*', { count: 'exact', head: true });
            
            if (agentsError) {
                console.warn('Agents count error:', agentsError);
            }
            this.data.agents = agentsCount || 0;
            console.log('Agents count:', this.data.agents);

            // Get active agents
            const { data: activeAgentsData, error: activeError } = await this.supabase
                .from('sales_agents')
                .select('*')
                .eq('status', 'active');
            
            if (activeError) {
                console.warn('Active agents error:', activeError);
            }
            this.data.activeAgents = activeAgentsData?.length || 0;
            console.log('Active agents:', this.data.activeAgents);

            // Get payments
            const { data: paymentsData, error: paymentsError } = await this.supabase
                .from('payments')
                .select('*');
            
            if (paymentsError) {
                console.warn('Payments error:', paymentsError);
            }
            const allPayments = paymentsData || [];
            console.log('Total payments:', allPayments.length);

            // Revenue calculations
            const completedPayments = allPayments.filter(p => p.status === 'completed' || p.status === 'confirmed');
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

            // Unassigned payments
            const unassigned = allPayments.filter(p => p.status === 'unassigned');
            this.data.unassigned = unassigned.length;
            this.data.unassignedAmount = unassigned.reduce((sum, p) => sum + (p.amount || 0), 0);

            // Pending payments
            const pending = allPayments.filter(p => p.status === 'pending');
            this.data.pending = pending.length;
            this.data.pendingAmount = pending.reduce((sum, p) => sum + (p.amount || 0), 0);

            console.log('Stats loaded successfully');

        } catch (error) {
            console.error('Load stats error:', error);
            throw error;
        }
    }

    async loadRecentActivity() {
        try {
            console.log('Loading recent activity...');

            // Recent members
            const { data: recentMembers, error: membersError } = await this.supabase
                .from('members')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(5);

            if (membersError) {
                console.warn('Recent members error:', membersError);
            }
            this.data.recentMembers = recentMembers || [];
            console.log('Recent members:', this.data.recentMembers.length);

            // Recent agents
            const { data: recentAgents, error: agentsError } = await this.supabase
                .from('sales_agents')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(5);

            if (agentsError) {
                console.warn('Recent agents error:', agentsError);
            }
            this.data.recentAgents = recentAgents || [];
            console.log('Recent agents:', this.data.recentAgents.length);

            // Recent payments
            const { data: recentPayments, error: paymentsError } = await this.supabase
                .from('payments')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);

            if (paymentsError) {
                console.warn('Recent payments error:', paymentsError);
            }
            this.data.recentPayments = recentPayments || [];
            console.log('Recent payments:', this.data.recentPayments.length);

        } catch (error) {
            console.error('Load recent activity error:', error);
            throw error;
        }
    }

    updateUI() {
        console.log('Updating UI...');

        // Update stats
        const elements = {
            'totalMembers': this.data.members,
            'totalAgents': this.data.agents,
            'activeAgents': this.data.activeAgents,
            'dailyRevenue': `KES ${this.data.revenue.daily.toLocaleString()}`,
            'monthRevenue': `KES ${this.data.revenue.monthly.toLocaleString()}`,
            'totalRevenue': `KES ${this.data.revenue.total.toLocaleString()}`,
            'unassignedCount': this.data.unassigned,
            'unassignedAmount': `KES ${this.data.unassignedAmount.toLocaleString()}`,
            'pendingPayments': this.data.pending,
            'pendingAmount': `KES ${this.data.pendingAmount.toLocaleString()}`
        };

        Object.entries(elements).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = value;
                console.log(`Updated ${id}: ${value}`);
            }
        });

        // Update badges
        const badge1 = document.getElementById('memberCountBadge');
        if (badge1) badge1.textContent = this.data.members;

        const badge2 = document.getElementById('pendingAgentsBadge');
        if (badge2) badge2.textContent = this.data.agents - this.data.activeAgents;

        // Render recent tables
        this.renderRecentMembers();
        this.renderRecentAgents();
        this.renderRecentPayments();
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
        // Debounce updates
        clearTimeout(this._updateTimeout);
        this._updateTimeout = setTimeout(() => {
            this.loadDashboard();
        }, 1000);
    }

    setupAutoRefresh() {
        // Refresh every 60 seconds
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

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = adminDashboard;
} else {
    window.adminDashboard = adminDashboard;
}
