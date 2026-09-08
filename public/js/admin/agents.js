// ============================================================
// ADMIN AGENTS - js/admin/agents.js
// ============================================================

class AdminAgents {
    constructor() {
        this.supabase = adminAuth.getSupabase();
        this.allAgents = [];
        this.allBranches = [];
        this.editingAgentId = null;
    }

    async loadAgents() {
        const container = document.getElementById('agentsList');

        container.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Loading sales agents...</p>
            </div>
        `;

        try {
            const { data, error } = await this.supabase
                .from('sales_agents')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            this.allAgents = data || [];
            this.renderAgents(this.allAgents);
            this.updateAgentCount();

            return { success: true };

        } catch (error) {
            console.error('Load agents error:', error);
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h4>Unable to load agents</h4>
                    <p>${error.message || 'Please try again.'}</p>
                    <br>
                    <button onclick="window.adminAgents.loadAgents()" class="btn btn-primary">
                        <i class="fas fa-sync"></i> Try Again
                    </button>
                </div>
            `;
            return { success: false, error: error.message };
        }
    }

    renderAgents(agents) {
        const container = document.getElementById('agentsList');

        if (!agents || agents.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-user-tie"></i>
                    <h4>No sales agents found</h4>
                    <p>Add your first Masika Benevolent sales agent.</p>
                    <br>
                    <button onclick="window.adminAgents.openCreateModal()" class="btn btn-primary">
                        <i class="fas fa-user-plus"></i> Add New Agent
                    </button>
                </div>
            `;
            return;
        }

        let html = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Sales Code</th>
                            <th>Agent</th>
                            <th>Phone</th>
                            <th>Branch</th>
                            <th>Status</th>
                            <th>Joined</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        agents.forEach(a => {
            const statusClass = a.status || 'active';
            const branchName = this.getBranchName(a.branch_id);

            html += `
                <tr>
                    <td>
                        <span class="sales-code">
                            <i class="fas fa-id-badge"></i>
                            ${this.escapeHtml(a.sales_code || '—')}
                        </span>
                    </td>
                    <td>
                        <div class="agent-name">${this.escapeHtml(a.full_name || '—')}</div>
                        <div class="agent-email">${this.escapeHtml(a.email || '—')}</div>
                    </td>
                    <td>${this.escapeHtml(a.phone || '—')}</td>
                    <td>
                        <i class="fas fa-building" style="color:var(--gold);"></i>
                        ${this.escapeHtml(branchName)}
                    </td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            ${this.capitalize(statusClass)}
                        </span>
                    </td>
                    <td>${this.formatDate(a.created_at)}</td>
                    <td>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            ${statusClass === 'active' ? `
                                <button onclick="window.adminAgents.changeStatus('${a.id}', 'suspended')" class="btn btn-warning btn-sm" title="Suspend agent">
                                    <i class="fas fa-pause"></i>
                                </button>
                            ` : `
                                <button onclick="window.adminAgents.changeStatus('${a.id}', 'active')" class="btn btn-success btn-sm" title="Activate agent">
                                    <i class="fas fa-play"></i>
                                </button>
                            `}
                            <button onclick="window.adminAgents.changeStatus('${a.id}', 'inactive')" class="btn btn-danger btn-sm" title="Deactivate agent">
                                <i class="fas fa-user-slash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;
    }

    filterAgents(search) {
        if (!search) {
            this.renderAgents(this.allAgents);
            return;
        }

        const filtered = this.allAgents.filter(a => {
            const searchable = [
                a.full_name,
                a.email,
                a.phone,
                a.sales_code,
                this.getBranchName(a.branch_id),
                a.status
            ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

            return searchable.includes(search.toLowerCase());
        });

        this.renderAgents(filtered);
    }

    async loadBranches() {
        const select = document.getElementById('agentBranch');
        const refreshIcon = document.getElementById('refreshBranchesIcon');

        if (!select) return;

        select.disabled = true;
        select.innerHTML = `<option value="">— Loading branches... —</option>`;
        if (refreshIcon) refreshIcon.classList.add('fa-spin');

        try {
            const { data, error } = await this.supabase
                .from('branches')
                .select('id, branch_name, branch_code, is_active')
                .order('branch_name', { ascending: true });

            if (error) throw error;

            this.allBranches = data || [];
            const activeBranches = this.allBranches.filter(b => b.is_active !== false);

            select.innerHTML = `<option value="">— Select branch —</option>`;

            if (activeBranches.length === 0) {
                select.innerHTML = `<option value="">— No active branches available —</option>`;
                select.disabled = true;
                window.showToast('warning', 'No active branches available');
                return;
            }

            activeBranches.forEach(b => {
                const option = document.createElement('option');
                option.value = b.id;
                const code = b.branch_code ? ` (${b.branch_code})` : '';
                option.textContent = b.branch_name + code;
                select.appendChild(option);
            });

            select.disabled = false;

        } catch (error) {
            console.error('Load branches error:', error);
            select.innerHTML = `<option value="">— Unable to load branches —</option>`;
            select.disabled = true;
            window.showToast('error', 'Failed to load branches');
        } finally {
            if (refreshIcon) refreshIcon.classList.remove('fa-spin');
        }
    }

    getBranchName(branchId) {
        if (!branchId) return '—';
        const branch = this.allBranches.find(b => String(b.id) === String(branchId));
        return branch ? (branch.branch_name || `Branch ${branchId}`) : '—';
    }

    async createAgent(data) {
        try {
            const { data: result, error } = await this.supabase
                .from('sales_agents')
                .insert({
                    full_name: data.full_name,
                    email: data.email,
                    phone: data.phone || null,
                    national_id: data.national_id || null,
                    branch_id: data.branch_id,
                    status: 'active'
                })
                .select()
                .single();

            if (error) throw error;

            await this.loadAgents();
            return { success: true, data: result };

        } catch (error) {
            console.error('Create agent error:', error);
            return { success: false, error: error.message };
        }
    }

    async changeStatus(agentId, newStatus) {
        if (!confirm(`Are you sure you want to change this agent's status to ${newStatus}?`)) return;

        try {
            const { error } = await this.supabase
                .from('sales_agents')
                .update({
                    status: newStatus,
                    updated_at: new Date().toISOString()
                })
                .eq('id', agentId);

            if (error) throw error;

            window.showToast('success', `Agent status updated to ${newStatus}`);
            await this.loadAgents();

        } catch (error) {
            console.error('Change status error:', error);
            window.showToast('error', 'Failed to update status');
        }
    }

    updateAgentCount() {
        const badge = document.getElementById('agentCountBadge');
        if (badge) badge.textContent = this.allAgents.length;
    }

    openCreateModal() {
        document.getElementById('createAgentModal').classList.add('open');
        document.getElementById('agentSalesCode').value = 'Will be generated automatically';
        document.getElementById('createAgentForm').reset();
        this.hideFormMessages();
        this.loadBranches();
    }

    closeCreateModal() {
        document.getElementById('createAgentModal').classList.remove('open');
        this.hideFormMessages();
    }

    hideFormMessages() {
        document.getElementById('createAgentError').style.display = 'none';
        document.getElementById('createAgentSuccess').style.display = 'none';
        document.getElementById('createAgentError').textContent = '';
        document.getElementById('createAgentSuccess').textContent = '';
    }

    showFormError(message) {
        const el = document.getElementById('createAgentError');
        el.textContent = message;
        el.style.display = 'block';
    }

    showFormSuccess(message) {
        const el = document.getElementById('createAgentSuccess');
        el.textContent = message;
        el.style.display = 'block';
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

    capitalize(value) {
        if (!value) return '';
        return String(value).charAt(0).toUpperCase() + String(value).slice(1).toLowerCase();
    }

    formatDate(value) {
        if (!value) return '—';
        try {
            return new Date(value).toLocaleDateString('en-KE', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
        } catch {
            return '—';
        }
    }
}

// Create singleton
const adminAgents = new AdminAgents();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = adminAgents;
} else {
    window.adminAgents = adminAgents;
}
