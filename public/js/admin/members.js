// ============================================================
// ADMIN MEMBERS - js/admin/members.js
// ============================================================

class AdminMembers {
    constructor() {
        this.supabase = adminAuth.getSupabase();
        this.currentPage = 1;
        this.pageSize = 20;
        this.totalRecords = 0;
        this.filters = {
            search: '',
            status: '',
            plan: ''
        };
        this.selectedMember = null;
    }

    async loadMembers(page = 1) {
        this.currentPage = page;
        const container = document.getElementById('membersList');

        container.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Loading members...</p>
            </div>
        `;

        try {
            let query = this.supabase.from('members').select('*', { count: 'exact' });

            // Apply search
            if (this.filters.search) {
                query = query.or(
                    `first_name.ilike.%${this.filters.search}%,` +
                    `last_name.ilike.%${this.filters.search}%,` +
                    `phone.ilike.%${this.filters.search}%,` +
                    `id_number.ilike.%${this.filters.search}%,` +
                    `membership_number.ilike.%${this.filters.search}%`
                );
            }

            // Apply status filter
            if (this.filters.status) {
                query = query.eq('status', this.filters.status);
            }

            // Apply plan filter
            if (this.filters.plan) {
                query = query.eq('plan_type', this.filters.plan);
            }

            // Pagination
            const from = (page - 1) * this.pageSize;
            const to = from + this.pageSize - 1;

            const { data, error, count } = await query
                .order('created_at', { ascending: false })
                .range(from, to);

            if (error) throw error;

            this.totalRecords = count || 0;
            this.renderMembers(data || []);
            this.renderPagination();

            return { success: true, data };

        } catch (error) {
            console.error('Load members error:', error);
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h4>Unable to load members</h4>
                    <p>${error.message || 'Please try again.'}</p>
                    <br>
                    <button onclick="window.adminMembers.loadMembers()" class="btn btn-primary">
                        <i class="fas fa-sync"></i> Try Again
                    </button>
                </div>
            `;
            return { success: false, error: error.message };
        }
    }

    renderMembers(members) {
        const container = document.getElementById('membersList');

        if (!members || members.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <h4>No members found</h4>
                    <p>Try adjusting your search or filters.</p>
                </div>
            `;
            return;
        }

        let html = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Member #</th>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Plan</th>
                            <th>Status</th>
                            <th>Joined</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        members.forEach(m => {
            const name = `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown';
            const statusClass = m.is_active ? 'active' : 'inactive';
            const statusText = m.is_active ? 'Active' : 'Inactive';
            const planName = m.plan_type ? m.plan_type.charAt(0).toUpperCase() + m.plan_type.slice(1) : '-';
            const joined = m.created_at ? new Date(m.created_at).toLocaleDateString('en-KE') : '-';

            html += `
                <tr>
                    <td><strong>${m.membership_number || '-'}</strong></td>
                    <td>${this.escapeHtml(name)}</td>
                    <td>${this.escapeHtml(m.phone || '-')}</td>
                    <td><span class="status-badge ${m.plan_type || ''}">${planName}</span></td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td>${joined}</td>
                    <td>
                        <div class="member-actions">
                            <button onclick="window.adminMembers.openMemberModal('${m.id}')" class="btn btn-primary btn-sm">
                                <i class="fas fa-eye"></i> View
                            </button>
                            <button onclick="window.adminMembers.toggleStatus('${m.id}', ${!m.is_active})" class="btn btn-sm ${m.is_active ? 'btn-secondary' : 'btn-success'}">
                                ${m.is_active ? '<i class="fas fa-pause"></i> Deactivate' : '<i class="fas fa-play"></i> Activate'}
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
        document.getElementById('resultCount').textContent = `${this.totalRecords} member${this.totalRecords !== 1 ? 's' : ''}`;
    }

    renderPagination() {
        const totalPages = Math.ceil(this.totalRecords / this.pageSize);
        const container = document.getElementById('pagination');

        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = '';
        const maxVisible = 5;
        let startPage = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);

        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        html += `
            <div class="page-item">
                <a href="#" class="page-link ${this.currentPage <= 1 ? 'disabled' : ''}" onclick="event.preventDefault(); if(${this.currentPage > 1}) window.adminMembers.loadMembers(${this.currentPage - 1})">
                    <i class="fas fa-chevron-left"></i>
                </a>
            </div>
        `;

        for (let i = startPage; i <= endPage; i++) {
            html += `
                <div class="page-item">
                    <a href="#" class="page-link ${i === this.currentPage ? 'active' : ''}" onclick="event.preventDefault(); window.adminMembers.loadMembers(${i})">${i}</a>
                </div>
            `;
        }

        html += `
            <div class="page-item">
                <a href="#" class="page-link ${this.currentPage >= totalPages ? 'disabled' : ''}" onclick="event.preventDefault(); if(${this.currentPage < totalPages}) window.adminMembers.loadMembers(${this.currentPage + 1})">
                    <i class="fas fa-chevron-right"></i>
                </a>
            </div>
        `;

        container.innerHTML = html;
    }

    async openMemberModal(memberId) {
        try {
            const { data: member, error } = await this.supabase
                .from('members')
                .select('*')
                .eq('id', memberId)
                .single();

            if (error) throw error;

            this.selectedMember = member;

            // Update modal
            document.getElementById('memberModalName').textContent =
                `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Member';
            document.getElementById('memberStatusSelect').value = member.status || 'PENDING';

            // Render details
            document.getElementById('memberPersonalInfo').innerHTML = `
                <div><span class="label">Full Name</span><div class="value">${this.escapeHtml(member.first_name || '')} ${this.escapeHtml(member.last_name || '')}</div></div>
                <div><span class="label">Date of Birth</span><div class="value">${this.escapeHtml(member.date_of_birth || '-')}</div></div>
                <div><span class="label">Gender</span><div class="value">${this.escapeHtml(member.gender || '-')}</div></div>
                <div><span class="label">ID Number</span><div class="value">${this.escapeHtml(member.id_number || '-')}</div></div>
            `;

            document.getElementById('memberContactInfo').innerHTML = `
                <div><span class="label">Phone</span><div class="value">${this.escapeHtml(member.phone || '-')}</div></div>
                <div><span class="label">Alternative Phone</span><div class="value">${this.escapeHtml(member.alternative_phone || '-')}</div></div>
                <div><span class="label">Email</span><div class="value">${this.escapeHtml(member.email || '-')}</div></div>
                <div><span class="label">County</span><div class="value">${this.escapeHtml(member.county || '-')}</div></div>
                <div><span class="label">Town</span><div class="value">${this.escapeHtml(member.town || '-')}</div></div>
                <div><span class="label">Location</span><div class="value">${this.escapeHtml(member.location || '-')}</div></div>
            `;

            document.getElementById('memberMembershipInfo').innerHTML = `
                <div><span class="label">Membership Number</span><div class="value">${this.escapeHtml(member.membership_number || '-')}</div></div>
                <div><span class="label">Plan Type</span><div class="value">${this.escapeHtml(member.plan_type || '-')}</div></div>
                <div><span class="label">Benefit Option</span><div class="value">${this.escapeHtml(member.benefit_option || '-')}</div></div>
                <div><span class="label">Registration Fee</span><div class="value">KES ${(member.registration_fee || 0).toLocaleString()}</div></div>
                <div><span class="label">Status</span><div class="value"><span class="status-badge ${member.status || 'PENDING'}">${member.status || 'PENDING'}</span></div></div>
                <div><span class="label">Joined</span><div class="value">${member.created_at ? new Date(member.created_at).toLocaleDateString('en-KE') : '-'}</div></div>
            `;

            document.getElementById('memberKinInfo').innerHTML = `
                <div><span class="label">Name</span><div class="value">${this.escapeHtml(member.kin_name || '-')}</div></div>
                <div><span class="label">Relationship</span><div class="value">${this.escapeHtml(member.kin_relationship || '-')}</div></div>
                <div><span class="label">Phone</span><div class="value">${this.escapeHtml(member.kin_phone || '-')}</div></div>
                <div><span class="label">ID Number</span><div class="value">${this.escapeHtml(member.kin_id || '-')}</div></div>
            `;

            document.getElementById('memberModal').classList.add('open');

        } catch (error) {
            console.error('Open member modal error:', error);
            window.showToast('error', 'Failed to load member details');
        }
    }

    closeMemberModal() {
        document.getElementById('memberModal').classList.remove('open');
        this.selectedMember = null;
    }

    async saveMemberStatus() {
        if (!this.selectedMember) {
            window.showToast('error', 'No member selected');
            return;
        }

        const newStatus = document.getElementById('memberStatusSelect').value;

        try {
            const { error } = await this.supabase
                .from('members')
                .update({
                    status: newStatus,
                    updated_at: new Date().toISOString()
                })
                .eq('id', this.selectedMember.id);

            if (error) throw error;

            window.showToast('success', 'Member status updated');
            this.closeMemberModal();
            this.loadMembers(this.currentPage);

        } catch (error) {
            console.error('Save status error:', error);
            window.showToast('error', 'Failed to update status');
        }
    }

    async toggleStatus(memberId, newStatus) {
        if (!confirm(`Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} this member?`)) return;

        try {
            const { error } = await this.supabase
                .from('members')
                .update({
                    is_active: newStatus,
                    updated_at: new Date().toISOString()
                })
                .eq('id', memberId);

            if (error) throw error;

            window.showToast('success', `Member ${newStatus ? 'activated' : 'deactivated'}`);
            this.loadMembers(this.currentPage);

        } catch (error) {
            console.error('Toggle status error:', error);
            window.showToast('error', 'Failed to update status');
        }
    }

    async exportMembers() {
        try {
            const { data, error } = await this.supabase
                .from('members')
                .select('membership_number, first_name, last_name, phone, email, plan_type, status, county, town, created_at')
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (!data || !data.length) {
                window.showToast('warning', 'No members to export');
                return;
            }

            const headers = ['Member Number', 'First Name', 'Last Name', 'Phone', 'Email', 'Plan', 'Status', 'County', 'Town', 'Joined'];
            const rows = data.map(m => [
                m.membership_number || '',
                m.first_name || '',
                m.last_name || '',
                m.phone || '',
                m.email || '',
                m.plan_type || '',
                m.status || '',
                m.county || '',
                m.town || '',
                m.created_at ? new Date(m.created_at).toLocaleDateString('en-KE') : ''
            ]);

            this.downloadCSV(headers, rows, `members_${new Date().toISOString().split('T')[0]}`);
            window.showToast('success', 'Members exported successfully');

        } catch (error) {
            console.error('Export error:', error);
            window.showToast('error', 'Failed to export members');
        }
    }

    downloadCSV(headers, rows, filename) {
        let csv = headers.join(',') + '\n';
        rows.forEach(row => {
            csv += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    setFilters(filters) {
        this.filters = { ...this.filters, ...filters };
        this.currentPage = 1;
        this.loadMembers();
    }

    resetFilters() {
        this.filters = { search: '', status: '', plan: '' };
        document.getElementById('memberSearch').value = '';
        document.getElementById('statusFilter').value = '';
        document.getElementById('planFilter').value = '';
        this.currentPage = 1;
        this.loadMembers();
    }

    escapeHtml(value) {
        if (!value) return '-';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Create singleton
const adminMembers = new AdminMembers();

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = adminMembers;
} else {
    window.adminMembers = adminMembers;
}
