// ============================================================
// ADMIN MEMBERS - js/admin/members.js
// Aligned with admin-members.html (Wazazi parents, audit, STK, ID card)
// ============================================================

class AdminMembers {
    constructor() {
        this.supabase = (typeof adminAuth !== 'undefined' && adminAuth.getSupabase)
            ? adminAuth.getSupabase()
            : window.supabase.createClient(
                'https://wpxzlcdrirlcyvfiquld.supabase.co',
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndweHpsY2RyaXJsY3l2ZmlxdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Mjc4MDcsImV4cCI6MjEwMzUwMzgwN30.OUP9pmPbrML_egpHflZtDfLv1_UDM37_BYjtb842xjg'
            );

        this.MASIKA_API_BASE = 'https://masika-c921.onrender.com';
        this.ORG_PAYBILL = '348127';

        this.currentPage = 1;
        this.pageSize = 20;
        this.totalRecords = 0;
        this.filters = { search: '', status: '', plan: '', renewal: '' };
        this.selectedMember = null;
        this.memberEditMode = false;
        this.memberDependantsCache = [];
        this.memberParentsCache = [];
        this.currentAudit = null;
        this.currentAuditCache = new Map();
        this.paymentRowsCache = null;
        this.paymentRowsCacheAt = 0;
        this.PAYMENT_CACHE_MS = 30000;
        this.currentPlanConfig = null;
        this.parentRowSeq = 0;
        this.dependantRowSeq = 0;

        this.PLAN_FALLBACK_CONFIG = {
            comfort: { label: 'Comfort', amount: 300,  registrationFee: 200,  minParents: 0, maxParents: 0, maxDependants: null, parentMonthly: 0,   parentFee: 0   },
            dignity: { label: 'Dignity', amount: 100,  registrationFee: 2000, minParents: 0, maxParents: 0, maxDependants: null, parentMonthly: 0,   parentFee: 0   },
            wazazi:  { label: 'Wazazi',  amount: 300,  registrationFee: 200,  minParents: 1, maxParents: 4, maxDependants: null, parentMonthly: 350, parentFee: 100 },
            chama:   { label: 'Chama',   amount: 150,  registrationFee: 1200, minParents: 0, maxParents: 0, maxDependants: null, parentMonthly: 0,   parentFee: 0   }
        };

        this.KENYA_COUNTIES = [
            'Mombasa','Kwale','Kilifi','Tana River','Lamu','Taita-Taveta','Garissa','Wajir','Mandera',
            'Marsabit','Isiolo','Meru','Tharaka-Nithi','Embu','Kitui','Machakos','Makueni','Nyandarua',
            'Nyeri','Kirinyaga',"Murang'a",'Kiambu','Turkana','West Pokot','Samburu','Trans-Nzoia',
            'Uasin Gishu','Elgeyo-Marakwet','Nandi','Baringo','Laikipia','Nakuru','Narok','Kajiado',
            'Kericho','Bomet','Kakamega','Vihiga','Bungoma','Busia','Siaya','Kisumu','Homa Bay',
            'Migori','Kisii','Nyamira','Nairobi'
        ];

        this.ADD_MEMBER_CORE_COLUMNS = ['first_name', 'last_name', 'phone', 'plan_type'];
        this.ADD_DEPENDANT_CORE_COLUMNS = ['principal_member_id', 'full_name'];
        this.ADD_PARENT_CORE_COLUMNS = ['member_id', 'full_name'];

        this.planConfigCache = {};
    }

    // ============================================================
    // LIST
    // ============================================================

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

            if (this.filters.search) {
                const s = this.filters.search;
                query = query.or(
                    `first_name.ilike.%${s}%,` +
                    `last_name.ilike.%${s}%,` +
                    `phone.ilike.%${s}%,` +
                    `id_number.ilike.%${s}%,` +
                    `member_number.ilike.%${s}%`
                );
            }
            if (this.filters.status) query = query.eq('status', this.filters.status);
            if (this.filters.plan) query = query.eq('plan_type', this.filters.plan);

            const from = (page - 1) * this.pageSize;
            const to = from + this.pageSize - 1;

            const { data, error, count } = await query
                .order('created_at', { ascending: false })
                .range(from, to);

            if (error) throw error;

            this.totalRecords = count || 0;
            const reconciled = await this.reconcileVisibleMemberStatuses(data || []);

            for (const m of reconciled) {
                m._tenure = this.computeTenure(m.created_at);
                m._renewal = this.computeRenewal(m.created_at);
            }

            let visible = reconciled;
            if (this.filters.renewal) {
                visible = reconciled.filter(m => m._renewal.status === this.filters.renewal);
            }

            this.renderMembers(visible);
            this.renderPagination();

            const { count: total } = await this.supabase
                .from('members').select('*', { count: 'exact', head: true });
            const badge = document.getElementById('memberCountBadge');
            if (badge) badge.textContent = total || 0;

            return { success: true, data: reconciled };

        } catch (error) {
            console.error('Load members error:', error);
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h4>Unable to load members</h4>
                    <p>${this.escapeHtml(error.message || 'Please try again.')}</p>
                    <br>
                    <button onclick="adminMembers.loadMembers()" class="btn btn-primary">
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
                            <th>Duration</th>
                            <th>Renewal</th>
                            <th>Payments</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        members.forEach(m => {
            const name = `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown';
            const statusClass = m.status || 'PENDING';
            const planName = m.plan_type ? m.plan_type.charAt(0).toUpperCase() + m.plan_type.slice(1) : '-';
            const memberNo = this.getMembershipNumber(m);
            const tenure = m._tenure || this.computeTenure(m.created_at);
            const renewal = m._renewal || this.computeRenewal(m.created_at);

            const auditEntry = this.currentAuditCache.get(String(m.id));
            const skipped = auditEntry?.missingMonths?.length || 0;
            const payBadge = auditEntry?.manualOverride
                ? `<span class="mini-badge info" title="Manual tracking"><i class="fas fa-user-check"></i> manual</span>`
                : skipped
                    ? `<span class="mini-badge late" title="${skipped} month(s) missing"><i class="fas fa-exclamation-circle"></i> ${skipped} missed</span>`
                    : `<span class="mini-badge ok"><i class="fas fa-check"></i> up to date</span>`;

            html += `
                <tr>
                    <td><strong>${memberNo ? this.escapeHtml(memberNo) : '-'}</strong></td>
                    <td>${this.escapeHtml(name)}</td>
                    <td>${this.escapeHtml(m.phone || '-')}</td>
                    <td><span class="status-badge ${m.plan_type || ''}">${planName}</span></td>
                    <td><span class="status-badge ${statusClass}">${statusClass}</span></td>
                    <td>
                        <div class="duration-cell">
                            <span class="mini-badge info"><i class="fas fa-clock"></i> ${tenure.label}</span>
                            <small>since ${m.created_at ? new Date(m.created_at).toLocaleDateString('en-KE') : '-'}</small>
                        </div>
                    </td>
                    <td>
                        <span class="mini-badge ${renewal.status}">
                            <i class="fas ${renewal.status === 'late' ? 'fa-triangle-exclamation' : renewal.status === 'soon' ? 'fa-bell' : 'fa-calendar-check'}"></i>
                            ${renewal.label}
                        </span>
                    </td>
                    <td>${payBadge}</td>
                    <td>
                        <div class="row-actions">
                            <button class="btn-icon view" title="View" onclick="adminMembers.openMemberModal('${m.id}')">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn-icon idcard" title="ID card" onclick="adminMembers.openIdCardModal('${m.id}')">
                                <i class="fas fa-id-card"></i>
                            </button>
                            <button class="btn-icon stk" title="STK push" onclick="adminMembers.openStkPushModal('${m.id}')">
                                <i class="fas fa-paper-plane"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;

        const rc = document.getElementById('resultCount');
        if (rc) rc.textContent = `${this.totalRecords} member${this.totalRecords !== 1 ? 's' : ''}`;
    }

    renderPagination() {
        const totalPages = Math.ceil(this.totalRecords / this.pageSize);

        // Support both legacy #pagination container and modern prev/next buttons
        const container = document.getElementById('pagination');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        const info = document.getElementById('paginationInfo');
        const modern = document.getElementById('membersPagination');

        if (modern) modern.style.display = totalPages > 1 ? 'flex' : 'none';
        if (info) info.textContent = `Showing ${((this.currentPage - 1) * this.pageSize) + 1}-${Math.min(this.currentPage * this.pageSize, this.totalRecords)} of ${this.totalRecords}`;
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        if (nextBtn) nextBtn.disabled = this.currentPage >= totalPages;

        if (!container) return;
        if (totalPages <= 1) { container.innerHTML = ''; return; }

        let html = '';
        const maxVisible = 5;
        let startPage = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);

        html += `<div class="page-item"><a href="#" class="page-link ${this.currentPage <= 1 ? 'disabled' : ''}" onclick="event.preventDefault(); if(${this.currentPage > 1}) adminMembers.loadMembers(${this.currentPage - 1})"><i class="fas fa-chevron-left"></i></a></div>`;
        for (let i = startPage; i <= endPage; i++) {
            html += `<div class="page-item"><a href="#" class="page-link ${i === this.currentPage ? 'active' : ''}" onclick="event.preventDefault(); adminMembers.loadMembers(${i})">${i}</a></div>`;
        }
        html += `<div class="page-item"><a href="#" class="page-link ${this.currentPage >= totalPages ? 'disabled' : ''}" onclick="event.preventDefault(); if(${this.currentPage < totalPages}) adminMembers.loadMembers(${this.currentPage + 1})"><i class="fas fa-chevron-right"></i></a></div>`;

        container.innerHTML = html;
    }

    changePage(delta) {
        const totalPages = Math.ceil(this.totalRecords / this.pageSize);
        const next = this.currentPage + delta;
        if (next < 1 || next > totalPages) return;
        this.loadMembers(next);
    }

    applyFilters() {
        this.filters.search = (document.getElementById('memberSearch')?.value || '').trim();
        this.filters.status = document.getElementById('statusFilter')?.value || '';
        this.filters.plan = document.getElementById('planFilter')?.value || '';
        this.filters.renewal = document.getElementById('renewalFilter')?.value || '';
        this.loadMembers(1);
    }

    setFilters(filters) {
        this.filters = { ...this.filters, ...filters };
        this.loadMembers(1);
    }

    resetFilters() {
        this.filters = { search: '', status: '', plan: '', renewal: '' };
        const ids = ['memberSearch', 'statusFilter', 'planFilter', 'renewalFilter'];
        ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.loadMembers(1);
    }

    // ============================================================
    // VIEW MEMBER
    // ============================================================

    async openMemberModal(memberId) {
        try {
            const { data: member, error } = await this.supabase
                .from('members').select('*').eq('id', memberId).single();
            if (error) throw error;

            this.selectedMember = member;
            this.memberEditMode = false;
            this.currentAudit = null;

            document.getElementById('memberModalName').textContent =
                `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Member';
            document.getElementById('memberStatusSelect').value = member.status || 'PENDING';

            const planSel = document.getElementById('memberPlanSelect');
            if (planSel) planSel.value = member.plan_type || '';

            const overrideCb = document.getElementById('memberPaymentOverride');
            if (overrideCb) overrideCb.checked = !!member.payment_override;

            // Wazazi: recount parents for accurate monthly amount.
            if (String(member.plan_type || '').toLowerCase() === 'wazazi') {
                member._wazazi_parent_count = await this.countWazaziParents(member.id);
            }

            try {
                this.currentAudit = await this.reconcileMemberPaymentStatus(member, { persist: true, forcePayments: true });
                this.currentAuditCache.set(String(member.id), this.currentAudit);
                document.getElementById('memberStatusSelect').value = member.status || 'PENDING';
            } catch (e) {
                console.warn('Audit failed:', e);
            }

            this.setMemberEditMode(false);
            document.getElementById('memberModal').classList.add('open');
            this.clearModalMessages();
            this.renderMemberViewFields(member);
            this.renderAuditPanel(member, this.currentAudit);

            await this.loadMemberParents(memberId);
            await this.loadMemberDependants(memberId);

        } catch (error) {
            console.error('Open member modal error:', error);
            this.showModalError(`Failed to load member details: ${error.message || 'unknown error'}`);
        }
    }

    closeMemberModal() {
        document.getElementById('memberModal').classList.remove('open');
        this.selectedMember = null;
        this.memberEditMode = false;
        this.memberDependantsCache = [];
        this.memberParentsCache = [];
        this.currentAudit = null;
        this.clearModalMessages();
    }

    renderMemberViewFields(member) {
        const tenure = this.computeTenure(member.created_at);
        const renewal = this.computeRenewal(member.created_at);
        const validUntil = this.computeValidUntil(member);
        const isWazazi = String(member.plan_type || '').toLowerCase() === 'wazazi';
        const parentCount = Number(member._wazazi_parent_count);
        const parentCountText = isWazazi
            ? (Number.isFinite(parentCount)
                ? parentCount + (parentCount === 1 ? ' parent' : ' parents')
                : '<span style="color:var(--warning);">loading…</span>')
            : '—';

        document.getElementById('memberPersonalInfo').innerHTML = `
            <div><span class="label">Full Name</span><div class="value">${this.escapeHtml(member.first_name || '')} ${this.escapeHtml(member.last_name || '')}</div></div>
            <div><span class="label">Date of Birth</span><div class="value">${this.escapeHtml(member.date_of_birth || '-')}</div></div>
            <div><span class="label">Gender</span><div class="value">${this.escapeHtml(member.gender || '-')}</div></div>
            <div><span class="label">ID Number</span><div class="value">${this.escapeHtml(member.id_number || '-')}</div></div>`;

        document.getElementById('memberContactInfo').innerHTML = `
            <div><span class="label">Phone</span><div class="value">${this.escapeHtml(member.phone || '-')}</div></div>
            <div><span class="label">Alternative Phone</span><div class="value">${this.escapeHtml(member.alternative_phone || '-')}</div></div>
            <div><span class="label">Email</span><div class="value">${this.escapeHtml(member.email || '-')}</div></div>
            <div><span class="label">County</span><div class="value">${this.escapeHtml(member.county || '-')}</div></div>
            <div><span class="label">Town</span><div class="value">${this.escapeHtml(member.town || '-')}</div></div>
            <div><span class="label">Location</span><div class="value">${this.escapeHtml(member.location || '-')}</div></div>`;

        document.getElementById('memberMembershipInfo').innerHTML = `
            <div><span class="label">Membership Number</span><div class="value">${this.escapeHtml(this.getMembershipNumber(member) || '-')}</div></div>
            <div><span class="label">Plan Type</span><div class="value">${this.escapeHtml(member.plan_type || '-')}</div></div>
            <div><span class="label">Benefit Option</span><div class="value">${this.escapeHtml(member.benefit_option || '-')}</div></div>
            <div><span class="label">Parents on plan</span><div class="value">${parentCountText}</div></div>
            <div><span class="label">Registration Fee</span><div class="value">KES ${parseFloat(member.registration_fee || 0).toLocaleString()}</div></div>
            <div><span class="label">Status</span><div class="value"><span class="status-badge ${member.status || 'PENDING'}">${member.status || 'PENDING'}</span></div></div>
            <div><span class="label">Joined</span><div class="value">${member.created_at ? new Date(member.created_at).toLocaleDateString('en-KE') : '-'}</div></div>
            <div><span class="label">Duration</span><div class="value">${tenure.label} (${tenure.months} month${tenure.months === 1 ? '' : 's'})</div></div>
            <div><span class="label">Renewal</span><div class="value"><span class="mini-badge ${renewal.status}">${renewal.label}</span></div></div>
            <div><span class="label">Valid Until</span><div class="value">${validUntil.toLocaleDateString('en-KE')}</div></div>`;

        document.getElementById('memberKinInfo').innerHTML = `
            <div><span class="label">Name</span><div class="value">${this.escapeHtml(member.kin_name || '-')}</div></div>
            <div><span class="label">Relationship</span><div class="value">${this.escapeHtml(member.kin_relationship || '-')}</div></div>
            <div><span class="label">Phone</span><div class="value">${this.escapeHtml(member.kin_phone || '-')}</div></div>
            <div><span class="label">ID Number</span><div class="value">${this.escapeHtml(member.kin_id || '-')}</div></div>`;
    }

    renderAuditPanel(member, audit) {
        const el = document.getElementById('memberAuditPanel');
        if (!el) return;
        if (!audit) {
            el.innerHTML = `<div style="font-size:13px;color:var(--text-light);">Payment audit unavailable.</div>`;
            return;
        }
        if (audit.manualOverride) {
            const monthly = audit.monthlyAmount || 0;
            el.innerHTML = `
                <div style="font-size:13px;color:var(--text-light);display:flex;flex-direction:column;gap:6px;">
                    <span class="mini-badge info" style="width:fit-content;"><i class="fas fa-user-check"></i> Manual tracking</span>
                    <span>Payment status is managed manually — automatic monthly reconciliation is disabled.
                    ${monthly ? `Monthly contribution: <b>KES ${monthly.toLocaleString()}</b>.` : ''}</span>
                </div>`;
            return;
        }
        if (audit.skipped || audit.paymentAvailable === false) {
            el.innerHTML = `<div style="font-size:13px;color:var(--text-light);">
                <i class="fas fa-info-circle"></i> Payment history could not be verified. Current status left as <b>${this.escapeHtml(member.status || 'PENDING')}</b>.
            </div>`;
            return;
        }

        const monthly = audit.monthlyAmount || 0;
        const missed = audit.missingMonths?.length || 0;
        const totalDue = (audit.monthDetails?.length || 0) * monthly;
        const totalPaid = Array.from(audit.paidByMonth.values()).reduce((a, b) => a + b, 0);

        const parentCount = Number(member._wazazi_parent_count);
        const isWazazi = String(member.plan_type || '').toLowerCase() === 'wazazi';
        const breakdown = (isWazazi && Number.isFinite(parentCount) && parentCount > 0)
            ? ` <small style="color:var(--text-light);">(300 + ${parentCount}×350)</small>`
            : '';

        const chips = (audit.monthDetails || []).map(m => {
            const cls = m.state === 'paid' ? 'paid' : m.state === 'partial' ? 'partial' : 'missing';
            const cur = m.isCurrent ? ' current' : '';
            const icon = m.state === 'paid' ? 'fa-check' : m.state === 'partial' ? 'fa-circle-half-stroke' : 'fa-times';
            return `<span class="audit-month ${cls}${cur}"><i class="fas ${icon}"></i> ${m.label}</span>`;
        }).join('');

        el.innerHTML = `
            <div class="audit-summary">
                <span class="as-item"><i class="fas fa-coins"></i> Monthly: <b>KES ${monthly.toLocaleString()}</b>${breakdown}</span>
                <span class="as-item"><i class="fas fa-wallet"></i> Total paid: <b>KES ${totalPaid.toLocaleString()}</b></span>
                <span class="as-item"><i class="fas fa-flag-checkered"></i> Due to date: <b>KES ${totalDue.toLocaleString()}</b></span>
                <span class="as-item"><i class="fas fa-triangle-exclamation"></i> Missed/partial months: <b>${missed}</b></span>
            </div>
            <div class="audit-months">${chips}</div>`;

        if (missed > 0) {
            const shortfalls = (audit.monthDetails || [])
                .filter(m => m.state !== 'paid')
                .map(m => `${m.label}: paid KES ${m.paid.toLocaleString()}, due KES ${monthly.toLocaleString()}`);
            el.insertAdjacentHTML('beforeend',
                `<div style="font-size:12.5px;color:var(--danger);">
                    <b>Skipped / short months:</b> ${shortfalls.join(' · ')}
                </div>`);
        }
    }

    // ============================================================
    // VIEW / EDIT MODE
    // ============================================================

    setMemberEditMode(on) {
        this.memberEditMode = on;
        const btn = document.getElementById('memberEditToggleBtn');
        const actions = document.getElementById('memberEditActions');
        if (actions) actions.style.display = on ? 'flex' : 'none';
        if (btn) btn.innerHTML = on ? '<i class="fas fa-eye"></i> View' : '<i class="fas fa-pen"></i> Edit Details';

        if (on) this.renderMemberEditFields(this.selectedMember);
        else this.renderMemberViewFields(this.selectedMember);
    }

    toggleEditMember() {
        if (!this.selectedMember) return;
        this.clearModalMessages();
        this.setMemberEditMode(!this.memberEditMode);
    }

    renderMemberEditFields(member) {
        const dob = member.date_of_birth ? String(member.date_of_birth).slice(0, 10) : '';

        document.getElementById('memberPersonalInfo').innerHTML = `
            <div class="form-group"><label>First Name</label><input type="text" id="emFirstName" maxlength="100" value="${this.escapeAttr(member.first_name)}"></div>
            <div class="form-group"><label>Last Name</label><input type="text" id="emLastName" maxlength="100" value="${this.escapeAttr(member.last_name)}"></div>
            <div class="form-group"><label>Date of Birth</label><input type="date" id="emDob" value="${dob}"></div>
            <div class="form-group"><label>Gender</label>
                <select id="emGender">
                    <option value="" ${!member.gender ? 'selected' : ''}>Not specified</option>
                    <option value="MALE" ${member.gender === 'MALE' ? 'selected' : ''}>Male</option>
                    <option value="FEMALE" ${member.gender === 'FEMALE' ? 'selected' : ''}>Female</option>
                </select>
            </div>
            <div class="form-group full"><label>ID Number</label><input type="text" id="emIdNumber" maxlength="30" value="${this.escapeAttr(member.id_number)}"></div>`;

        document.getElementById('memberContactInfo').innerHTML = `
            <div class="form-group"><label>Phone</label><input type="tel" id="emPhone" value="${this.escapeAttr(member.phone)}"></div>
            <div class="form-group"><label>Alternative Phone</label><input type="tel" id="emAltPhone" value="${this.escapeAttr(member.alternative_phone)}"></div>
            <div class="form-group"><label>Email</label><input type="email" id="emEmail" maxlength="150" value="${this.escapeAttr(member.email)}"></div>
            <div class="form-group"><label>County</label><select id="emCounty"></select></div>
            <div class="form-group"><label>Town</label><input type="text" id="emTown" maxlength="100" value="${this.escapeAttr(member.town)}"></div>
            <div class="form-group full"><label>Location / Area</label><input type="text" id="emLocation" maxlength="150" value="${this.escapeAttr(member.location)}"></div>`;

        const countySelect = document.getElementById('emCounty');
        if (countySelect) {
            countySelect.innerHTML = '<option value="">Select county</option>' +
                this.KENYA_COUNTIES.map(c => `<option value="${this.escapeAttr(c)}" ${member.county === c ? 'selected' : ''}>${this.escapeHtml(c)}</option>`).join('');
        }

        document.getElementById('memberMembershipInfo').innerHTML = `
            <div class="form-group"><label>Benefit Option</label>
                <select id="emBenefit">
                    <option value="" ${!member.benefit_option ? 'selected' : ''}>Not specified</option>
                    <option value="service" ${member.benefit_option === 'service' ? 'selected' : ''}>Service</option>
                    <option value="cash" ${member.benefit_option === 'cash' ? 'selected' : ''}>Cash</option>
                </select>
            </div>
            <div class="form-group"><label>Registration Fee (KES)</label><input type="number" id="emFee" min="0" step="1" value="${this.escapeAttr(member.registration_fee ?? '')}"></div>
            <p class="hint" style="grid-column:1/-1;">Membership Number, Plan Type, Status and Payment tracking are updated using the controls above.</p>`;

        document.getElementById('memberKinInfo').innerHTML = `
            <div class="form-group"><label>Full Name</label><input type="text" id="emKinName" maxlength="150" value="${this.escapeAttr(member.kin_name)}"></div>
            <div class="form-group"><label>Relationship</label><input type="text" id="emKinRelationship" maxlength="50" value="${this.escapeAttr(member.kin_relationship)}"></div>
            <div class="form-group"><label>Phone</label><input type="tel" id="emKinPhone" value="${this.escapeAttr(member.kin_phone)}"></div>
            <div class="form-group"><label>ID Number</label><input type="text" id="emKinId" maxlength="30" value="${this.escapeAttr(member.kin_id)}"></div>`;
    }

    async saveMemberDetails() {
        if (!this.selectedMember) return;

        const val = id => (document.getElementById(id)?.value || '').trim();
        const phonePattern = /^254(7|1)\d{8}$/;

        const first_name = val('emFirstName');
        const last_name = val('emLastName');
        if (!first_name) return this.showModalError('First name is required.');
        if (!last_name) return this.showModalError('Last name is required.');

        const phoneRaw = val('emPhone');
        const phone = phoneRaw ? this.normalizeMsisdn(phoneRaw) : '';
        if (!phone || !phonePattern.test(phone)) return this.showModalError('Enter a valid phone number.');

        const altRaw = val('emAltPhone');
        const alternative_phone = altRaw ? this.normalizeMsisdn(altRaw) : '';
        if (alternative_phone && !phonePattern.test(alternative_phone)) return this.showModalError('Alternative phone not valid.');

        const kinPhoneRaw = val('emKinPhone');
        const kin_phone = kinPhoneRaw ? this.normalizeMsisdn(kinPhoneRaw) : '';
        if (kin_phone && !phonePattern.test(kin_phone)) return this.showModalError('Next of kin phone not valid.');

        const email = val('emEmail');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return this.showModalError('Enter a valid email.');

        const dob = val('emDob');
        const today = new Date();
        if (dob && (isNaN(new Date(dob).getTime()) || new Date(dob) > today)) return this.showModalError('Enter a valid DOB.');

        const feeRaw = val('emFee');
        if (feeRaw !== '' && (!Number.isFinite(Number(feeRaw)) || Number(feeRaw) < 0)) return this.showModalError('Enter a valid fee.');

        const payload = {
            first_name, last_name,
            date_of_birth: dob || null,
            gender: val('emGender') || null,
            id_number: val('emIdNumber') || null,
            phone,
            alternative_phone: alternative_phone || null,
            email: email || null,
            county: val('emCounty') || null,
            town: val('emTown') || null,
            location: val('emLocation') || null,
            benefit_option: val('emBenefit') || null,
            registration_fee: feeRaw !== '' ? Number(feeRaw) : null,
            kin_name: val('emKinName') || null,
            kin_relationship: val('emKinRelationship') || null,
            kin_phone: kin_phone || null,
            kin_id: val('emKinId') || null,
            updated_at: new Date().toISOString()
        };

        const saveBtn = document.getElementById('memberEditSaveBtn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

        try {
            const { data, dropped } = await this.updateResilient('members', this.selectedMember.id, payload, ['first_name', 'last_name']);
            this.selectedMember = data;
            this.setMemberEditMode(false);
            this.renderMemberViewFields(data);
            this.showModalSuccess(dropped.length
                ? `Details updated, but these fields don't exist: ${dropped.join(', ')}.`
                : 'Member details updated.');
            this.loadMembers(this.currentPage);
        } catch (err) {
            console.error('Save member error:', err);
            this.showModalError(`Failed to save: ${err.message || 'unknown error'}`);
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-check"></i> Save Changes'; }
        }
    }

    // ============================================================
    // PARENTS (VIEW MODAL)
    // ============================================================

    async loadMemberParents(memberId) {
        const fieldset = document.getElementById('memberParentsFieldset');
        const c = document.getElementById('memberParentsList');
        if (!fieldset || !c) return;

        this.memberParentsCache = [];
        const isWazazi = String(this.selectedMember?.plan_type || '').toLowerCase() === 'wazazi';
        if (!isWazazi) { fieldset.style.display = 'none'; return; }
        fieldset.style.display = 'block';
        c.innerHTML = '<p style="font-size:13px;color:var(--text-light);">Loading parents…</p>';

        try {
            const { data, error } = await this.supabase
                .from('parents')
                .select('id,member_id,full_name,relationship,phone,date_of_birth,national_id,created_at')
                .eq('member_id', memberId)
                .order('created_at', { ascending: true });
            if (error) throw error;
            this.memberParentsCache = Array.isArray(data) ? data : [];
            this.renderMemberParents();
        } catch (err) {
            console.error('Load parents error:', err);
            c.innerHTML = `
                <div style="font-size:13px;color:var(--danger);">
                    <strong>Failed to load parents.</strong>
                    <div style="margin-top:4px;">${this.escapeHtml(err.message || 'unknown error')}</div>
                </div>`;
        }
    }

    renderMemberParents() {
        const c = document.getElementById('memberParentsList');
        if (!c) return;
        if (!this.memberParentsCache.length) {
            c.innerHTML = '<p style="font-size:13px;color:var(--text-light);">No parents on record.</p>';
            return;
        }
        c.innerHTML = '';
        this.memberParentsCache.forEach(p => c.appendChild(this.buildParentViewRow(p)));
    }

    buildParentViewRow(par) {
        const row = document.createElement('div');
        row.className = 'dependant-row';
        row.dataset.id = par.id;
        const bits = [];
        if (par.relationship) bits.push(this.escapeHtml(par.relationship));
        if (par.date_of_birth) bits.push(new Date(par.date_of_birth).toLocaleDateString('en-KE'));
        if (par.phone) bits.push(this.escapeHtml(par.phone));
        if (par.national_id) bits.push(`ID ${this.escapeHtml(par.national_id)}`);
        row.innerHTML = `
            <div class="dependant-row-header">
                <span style="text-transform:none;font-size:13px;font-weight:700;color:var(--text);">${this.escapeHtml(par.full_name || 'Unnamed')}</span>
                <div class="row-actions">
                    <button type="button" class="btn-icon view" title="Edit" onclick="adminMembers.editMemberParent('${par.id}')"><i class="fas fa-pen"></i></button>
                    <button type="button" class="btn-icon delete" title="Delete" onclick="adminMembers.deleteMemberParent('${par.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            ${bits.length ? `<div style="font-size:12.5px;color:var(--text-light);">${bits.join(' · ')}</div>` : ''}`;
        return row;
    }

    parentEditFormHtml(par) {
        const dob = par.date_of_birth ? String(par.date_of_birth).slice(0, 10) : '';
        return `
            <div class="form-grid">
                <div class="form-group"><label>Full Name</label><input type="text" class="mepar-name" maxlength="150" value="${this.escapeAttr(par.full_name)}"></div>
                <div class="form-group">
                    <label>Relationship</label>
                    <select class="mepar-relationship">
                        <option value="PARENT" ${(!par.relationship || par.relationship === 'PARENT') ? 'selected' : ''}>Parent (default)</option>
                        <option value="Mother" ${par.relationship === 'Mother' ? 'selected' : ''}>Mother</option>
                        <option value="Father" ${par.relationship === 'Father' ? 'selected' : ''}>Father</option>
                        <option value="Guardian" ${par.relationship === 'Guardian' ? 'selected' : ''}>Guardian</option>
                    </select>
                </div>
                <div class="form-group"><label>Phone</label><input type="tel" class="mepar-phone" maxlength="20" value="${this.escapeAttr(par.phone)}"></div>
                <div class="form-group"><label>Date of Birth</label><input type="date" class="mepar-dob" value="${dob}"></div>
                <div class="form-group full"><label>National ID</label><input type="text" class="mepar-id" maxlength="30" value="${this.escapeAttr(par.national_id)}"></div>
            </div>`;
    }

    editMemberParent(id) {
        const par = this.memberParentsCache.find(p => String(p.id) === String(id));
        const row = document.getElementById('memberParentsList').querySelector(`.dependant-row[data-id="${id}"]`);
        if (!par || !row) return;
        row.innerHTML = `
            ${this.parentEditFormHtml(par)}
            <div class="modal-actions" style="margin-top:0;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="adminMembers.renderMemberParents()">Cancel</button>
                <button type="button" class="btn btn-primary btn-sm" onclick="adminMembers.saveMemberParent('${id}')"><i class="fas fa-check"></i> Save</button>
            </div>`;
    }

    async saveMemberParent(id) {
        const row = document.getElementById('memberParentsList').querySelector(`.dependant-row[data-id="${id}"]`);
        if (!row) return;
        const name = row.querySelector('.mepar-name').value.trim();
        if (!name) return window.showToast && window.showToast('error', 'Parent needs a full name.');

        const dob = row.querySelector('.mepar-dob').value;
        const payload = {
            full_name: name,
            relationship: row.querySelector('.mepar-relationship').value || 'PARENT',
            phone: row.querySelector('.mepar-phone').value.trim() || null,
            date_of_birth: dob || null,
            national_id: row.querySelector('.mepar-id').value.trim() || null
        };

        try {
            const { data, dropped } = await this.updateResilient('parents', id, payload, this.ADD_PARENT_CORE_COLUMNS);
            const idx = this.memberParentsCache.findIndex(p => String(p.id) === String(id));
            if (idx > -1) this.memberParentsCache[idx] = data;
            this.renderMemberParents();

            if (this.selectedMember) {
                this.selectedMember._wazazi_parent_count = await this.countWazaziParents(this.selectedMember.id);
                this.renderMemberViewFields(this.selectedMember);
            }
            if (window.showToast) window.showToast('success', dropped.length ? `Parent updated; skipped: ${dropped.join(', ')}` : 'Parent updated.');
        } catch (err) {
            console.error('Save parent error:', err);
            if (window.showToast) window.showToast('error', 'Failed to update parent.');
        }
    }

    async deleteMemberParent(id) {
        if (!confirm('Remove this parent?')) return;
        try {
            const { error } = await this.supabase.from('parents').delete().eq('id', id);
            if (error) throw error;
            this.memberParentsCache = this.memberParentsCache.filter(p => String(p.id) !== String(id));
            this.renderMemberParents();

            if (this.selectedMember) {
                this.selectedMember._wazazi_parent_count = await this.countWazaziParents(this.selectedMember.id);
                this.renderMemberViewFields(this.selectedMember);
            }
            if (window.showToast) window.showToast('success', 'Parent removed.');
        } catch (err) {
            console.error('Delete parent error:', err);
            if (window.showToast) window.showToast('error', 'Failed to remove parent.');
        }
    }

    addMemberParent() {
        if (!this.selectedMember) return;
        const c = document.getElementById('memberParentsList');
        if (!c) return;
        if (c.querySelector('.dependant-row[data-id="new"]')) return;
        if (!this.memberParentsCache.length) c.innerHTML = '';

        const row = document.createElement('div');
        row.className = 'dependant-row';
        row.dataset.id = 'new';
        row.innerHTML = `
            ${this.parentEditFormHtml({ full_name: '', relationship: 'PARENT', phone: '', date_of_birth: '', national_id: '' })}
            <div class="modal-actions" style="margin-top:0;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="adminMembers.renderMemberParents()">Cancel</button>
                <button type="button" class="btn btn-primary btn-sm" onclick="adminMembers.createMemberParent()"><i class="fas fa-check"></i> Save</button>
            </div>`;
        c.appendChild(row);
    }

    async createMemberParent() {
        const row = document.getElementById('memberParentsList').querySelector('.dependant-row[data-id="new"]');
        if (!row || !this.selectedMember) return;
        const name = row.querySelector('.mepar-name').value.trim();
        if (!name) return window.showToast && window.showToast('error', 'Parent needs a full name.');

        const dob = row.querySelector('.mepar-dob').value;
        const payload = {
            member_id: this.selectedMember.id,
            full_name: name,
            relationship: row.querySelector('.mepar-relationship').value || 'PARENT',
            phone: row.querySelector('.mepar-phone').value.trim() || null,
            date_of_birth: dob || null,
            national_id: row.querySelector('.mepar-id').value.trim() || null
        };

        try {
            const { data, dropped } = await this.insertResilient('parents', payload, this.ADD_PARENT_CORE_COLUMNS);
            this.memberParentsCache.push(data);
            this.renderMemberParents();

            this.selectedMember._wazazi_parent_count = await this.countWazaziParents(this.selectedMember.id);
            this.renderMemberViewFields(this.selectedMember);

            if (window.showToast) window.showToast('success', dropped.length ? `Parent added; skipped: ${dropped.join(', ')}` : 'Parent added.');
        } catch (err) {
            console.error('Add parent error:', err);
            if (window.showToast) window.showToast('error', 'Failed to add parent.');
        }
    }

    // ============================================================
    // DEPENDANTS (VIEW MODAL)
    // ============================================================

    async loadMemberDependants(memberId) {
        const c = document.getElementById('memberDependantsList');
        if (!c) return;
        c.innerHTML = '<p style="font-size:13px;color:var(--text-light);">Loading dependants…</p>';
        this.memberDependantsCache = [];
        try {
            const { data, error } = await this.supabase
                .from('dependants')
                .select('id,principal_member_id,full_name,national_id,birth_certificate_number,date_of_birth,relationship,created_at')
                .eq('principal_member_id', memberId)
                .order('created_at', { ascending: true });
            if (error) throw error;
            this.memberDependantsCache = Array.isArray(data) ? data : [];
            this.renderMemberDependants();
        } catch (err) {
            console.error('Load dependants error:', err);
            c.innerHTML = `<div style="font-size:13px;color:var(--danger);">Failed to load dependants: ${this.escapeHtml(err.message || 'unknown')}</div>`;
        }
    }

    renderMemberDependants() {
        const c = document.getElementById('memberDependantsList');
        if (!c) return;
        if (!this.memberDependantsCache.length) {
            c.innerHTML = '<p style="font-size:13px;color:var(--text-light);">No dependants on record.</p>';
            return;
        }
        c.innerHTML = '';
        this.memberDependantsCache.forEach(d => {
            const row = document.createElement('div');
            row.className = 'dependant-row';
            row.dataset.id = d.id;
            const bits = [];
            if (d.relationship) bits.push(this.escapeHtml(d.relationship));
            if (d.date_of_birth) bits.push(new Date(d.date_of_birth).toLocaleDateString('en-KE'));
            if (d.national_id) bits.push(`ID ${this.escapeHtml(d.national_id)}`);
            row.innerHTML = `
                <div class="dependant-row-header">
                    <span style="text-transform:none;font-size:13px;font-weight:700;color:var(--text);">${this.escapeHtml(d.full_name || 'Unnamed')}</span>
                    <div class="row-actions">
                        <button type="button" class="btn-icon delete" onclick="adminMembers.deleteMemberDependant('${d.id}')"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                ${bits.length ? `<div style="font-size:12.5px;color:var(--text-light);">${bits.join(' · ')}</div>` : ''}`;
            c.appendChild(row);
        });
    }

    addMemberDependant() {
        if (!this.selectedMember) return;
        const c = document.getElementById('memberDependantsList');
        if (!c) return;
        if (c.querySelector('.dependant-row[data-id="new"]')) return;
        if (!this.memberDependantsCache.length) c.innerHTML = '';

        const row = document.createElement('div');
        row.className = 'dependant-row';
        row.dataset.id = 'new';
        row.innerHTML = `
            <div class="form-grid">
                <div class="form-group"><label>Full Name</label><input type="text" class="medep-name" maxlength="150"></div>
                <div class="form-group"><label>Relationship</label><input type="text" class="medep-relationship" maxlength="50" placeholder="e.g. Child"></div>
                <div class="form-group"><label>Date of Birth</label><input type="date" class="medep-dob"></div>
                <div class="form-group"><label>National ID</label><input type="text" class="medep-national-id" maxlength="30"></div>
                <div class="form-group full"><label>Birth Certificate Number</label><input type="text" class="medep-birth-cert" maxlength="30"></div>
            </div>
            <div class="modal-actions" style="margin-top:0;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="adminMembers.renderMemberDependants()">Cancel</button>
                <button type="button" class="btn btn-primary btn-sm" onclick="adminMembers.createMemberDependant()"><i class="fas fa-check"></i> Save</button>
            </div>`;
        c.appendChild(row);
    }

    async createMemberDependant() {
        const row = document.getElementById('memberDependantsList').querySelector('.dependant-row[data-id="new"]');
        if (!row || !this.selectedMember) return;
        const name = row.querySelector('.medep-name').value.trim();
        if (!name) return window.showToast && window.showToast('error', 'Dependant needs a full name.');

        const dp = { principal_member_id: this.selectedMember.id, full_name: name };
        const rel = row.querySelector('.medep-relationship').value.trim();
        const dob = row.querySelector('.medep-dob').value;
        const nid = row.querySelector('.medep-national-id').value.trim();
        const bc = row.querySelector('.medep-birth-cert').value.trim();
        if (rel) dp.relationship = rel;
        if (dob) dp.date_of_birth = dob;
        if (nid) dp.national_id = nid;
        if (bc) dp.birth_certificate_number = bc;

        try {
            const { data, dropped } = await this.insertResilient('dependants', dp, this.ADD_DEPENDANT_CORE_COLUMNS);
            this.memberDependantsCache.push(data);
            this.renderMemberDependants();
            if (window.showToast) window.showToast('success', dropped.length ? `Dependant added; skipped: ${dropped.join(', ')}` : 'Dependant added.');
        } catch (err) {
            console.error('Add dependant error:', err);
            if (window.showToast) window.showToast('error', 'Failed to add dependant.');
        }
    }

    async deleteMemberDependant(id) {
        if (!confirm('Remove this dependant?')) return;
        try {
            const { error } = await this.supabase.from('dependants').delete().eq('id', id);
            if (error) throw error;
            this.memberDependantsCache = this.memberDependantsCache.filter(d => String(d.id) !== String(id));
            this.renderMemberDependants();
            if (window.showToast) window.showToast('success', 'Dependant removed.');
        } catch (err) {
            console.error('Delete dependant error:', err);
            if (window.showToast) window.showToast('error', 'Failed to remove dependant.');
        }
    }

    // ============================================================
    // STATUS / PLAN / OVERRIDE
    // ============================================================

    async saveMemberStatus() {
        if (!this.selectedMember) return this.showModalError('No member selected.');
        const ns = document.getElementById('memberStatusSelect').value;
        try {
            const { error } = await this.supabase.from('members')
                .update({ status: ns, updated_at: new Date().toISOString() })
                .eq('id', this.selectedMember.id);
            if (error) throw error;
            this.selectedMember.status = ns;
            this.showModalSuccess(`Status updated to ${ns}.`);
            this.loadMembers(this.currentPage);
        } catch (err) {
            this.showModalError(`Failed to update status: ${err.message || 'unknown'}`);
        }
    }

    async saveMemberPlan() {
        if (!this.selectedMember) return this.showModalError('No member selected.');
        const np = document.getElementById('memberPlanSelect').value;
        try {
            const { error } = await this.supabase.from('members')
                .update({ plan_type: np || null, updated_at: new Date().toISOString() })
                .eq('id', this.selectedMember.id);
            if (error) throw error;
            this.showModalSuccess(np ? `Plan updated to ${np}.` : 'Plan cleared.');
            this.loadMembers(this.currentPage);
        } catch (err) {
            this.showModalError(`Failed to update plan: ${err.message || 'unknown'}`);
        }
    }

    async saveMemberPaymentOverride() {
        if (!this.selectedMember) return this.showModalError('No member selected.');
        const manual = document.getElementById('memberPaymentOverride').checked;
        try {
            const { data, error } = await this.supabase.from('members')
                .update({ payment_override: manual, updated_at: new Date().toISOString() })
                .eq('id', this.selectedMember.id)
                .select('*')
                .single();
            if (error) throw error;
            this.selectedMember = data;
            this.showModalSuccess(manual
                ? 'Payment tracking set to manual.'
                : 'Payment tracking set to automatic.');
            this.loadMembers(this.currentPage);
        } catch (err) {
            this.showModalError(`Failed to update payment tracking: ${err.message || 'unknown'}`);
        }
    }

    async validateMemberPayments(memberId, force = true) {
        try {
            const { data: m, error } = await this.supabase.from('members').select('*').eq('id', memberId).single();
            if (error || !m) throw new Error('Member not found.');
            this.paymentRowsCache = null;
            const audit = await this.reconcileMemberPaymentStatus(m, { persist: true, forcePayments: force });
            this.currentAudit = audit;
            this.currentAuditCache.set(String(memberId), audit);
            if (window.showToast) {
                if (audit.manualOverride) window.showToast('info', 'Manual tracking — audit skipped.');
                else if (audit.skipped) window.showToast('warning', 'Audit skipped (data missing).');
                else if (audit.status === 'ACTIVE') window.showToast('success', 'All dues received.');
                else window.showToast('warning', `${audit.missingMonths.length} month(s) missing.`);
            }
            if (this.selectedMember && String(this.selectedMember.id) === String(memberId)) {
                this.selectedMember.status = audit.status;
                document.getElementById('memberStatusSelect').value = audit.status;
                this.renderAuditPanel(this.selectedMember, audit);
            }
            await this.loadMembers(this.currentPage);
            return audit;
        } catch (err) {
            console.error('Validate error:', err);
            if (window.showToast) window.showToast('error', `Payment validation failed: ${err.message || 'unknown'}`);
            return null;
        }
    }

    async renewMemberNow(memberId) {
        if (!memberId) return;
        if (!confirm('Mark this member as renewed today?')) return;
        try {
            const { data: member, error } = await this.supabase.from('members').select('*').eq('id', memberId).single();
            if (error || !member) throw new Error('Member not found.');
            const base = member.created_at ? new Date(member.created_at) : new Date();
            const next = new Date(base);
            while (next <= new Date()) next.setFullYear(next.getFullYear() + 1);
            const { error: upErr } = await this.supabase.from('members')
                .update({ expiry_date: next.toISOString(), status: 'ACTIVE', updated_at: new Date().toISOString() })
                .eq('id', memberId);
            if (upErr) throw upErr;
            if (window.showToast) window.showToast('success', `Renewed. Next: ${next.toLocaleDateString('en-KE')}`);
            await this.loadMembers(this.currentPage);
            if (this.selectedMember && String(this.selectedMember.id) === String(memberId)) {
                await this.openMemberModal(memberId);
            }
        } catch (err) {
            console.error('Renew error:', err);
            if (window.showToast) window.showToast('error', `Failed to renew: ${err.message || 'unknown'}`);
        }
    }

    async toggleStatus(memberId, newStatus) {
        if (!confirm(`Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} this member?`)) return;
        try {
            const { error } = await this.supabase.from('members')
                .update({ is_active: newStatus, updated_at: new Date().toISOString() })
                .eq('id', memberId);
            if (error) throw error;
            if (window.showToast) window.showToast('success', `Member ${newStatus ? 'activated' : 'deactivated'}`);
            this.loadMembers(this.currentPage);
        } catch (error) {
            console.error('Toggle status error:', error);
            if (window.showToast) window.showToast('error', 'Failed to update status');
        }
    }

    // ============================================================
    // ID CARD
    // ============================================================

    async openIdCardModal(memberId) {
        try {
            const { data: m, error } = await this.supabase.from('members').select('*').eq('id', memberId).single();
            if (error || !m) throw new Error('Member not found.');

            const name = `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown Member';
            const initials = name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '–';
            const planName = m.plan_type ? m.plan_type.charAt(0).toUpperCase() + m.plan_type.slice(1) : '—';
            const joined = m.created_at ? new Date(m.created_at).toLocaleDateString('en-KE') : '—';
            const memberNo = this.getMembershipNumber(m) || 'PENDING';
            const tenure = this.computeTenure(m.created_at);

            document.getElementById('idCardInitials').textContent = initials;
            document.getElementById('idCardName').textContent = name;
            document.getElementById('idCardNumber').textContent = `# ${memberNo}`;
            document.getElementById('idCardPlan').textContent = planName;
            document.getElementById('idCardStatus').textContent = m.status || 'PENDING';
            document.getElementById('idCardPhone').textContent = m.phone || '—';
            document.getElementById('idCardJoined').textContent = joined;
            document.getElementById('idCardDuration').textContent = tenure.label;

            const validUntil = this.computeValidUntil(m);
            const expired = validUntil < new Date();
            const vel = document.getElementById('idCardValidUntil');
            vel.textContent = validUntil.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) + (expired ? ' (expired)' : '');
            vel.classList.toggle('expired', expired);

            document.getElementById('idCardPaybill').textContent = this.ORG_PAYBILL;
            document.getElementById('idCardAccount').textContent = memberNo;
            document.getElementById('idCardAmount').textContent = 'Loading…';
            this.getPlanAmount(m.plan_type, m.id).then(amount => {
                document.getElementById('idCardAmount').textContent = amount
                    ? `KES ${Number(amount).toLocaleString()} / month`
                    : 'Contact office';
            });

            const qrPayload = `MASIKA-BBS|${memberNo}|${m.id}`;
            const qrImg = document.getElementById('idCardQr');
            const qrBox = qrImg.closest('.id-card-qr');
            qrImg.style.display = 'block';
            qrBox.querySelector('.id-card-qr-fallback')?.remove();
            qrImg.onerror = () => {
                qrImg.style.display = 'none';
                if (!qrBox.querySelector('.id-card-qr-fallback')) {
                    const f = document.createElement('i');
                    f.className = 'fas fa-qrcode id-card-qr-fallback';
                    f.style.cssText = 'font-size:28px;color:var(--gray-300);';
                    qrBox.appendChild(f);
                }
            };
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=0&data=${encodeURIComponent(qrPayload)}`;

            document.getElementById('idCardModal').classList.add('open');
        } catch (err) {
            console.error('ID card error:', err);
            if (window.showToast) window.showToast('error', 'Failed to load ID card.');
        }
    }

    closeIdCardModal() { document.getElementById('idCardModal').classList.remove('open'); }
    printIdCard() { window.print(); }

    // ============================================================
    // STK PUSH
    // ============================================================

    async openStkPushModal(memberId) {
        try {
            const { data: m, error } = await this.supabase.from('members').select('*').eq('id', memberId).single();
            if (error || !m) throw new Error('Member not found.');
            this._stkMember = m;

            const name = `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown Member';
            const initials = name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '–';

            document.getElementById('stkAvatar').textContent = initials;
            document.getElementById('stkName').textContent = name;
            document.getElementById('stkSub').textContent = `${this.getMembershipNumber(m) || 'Pending'} · ${m.plan_type ? m.plan_type.charAt(0).toUpperCase() + m.plan_type.slice(1) : '—'}`;
            document.getElementById('stkPhone').value = m.phone || '';
            document.getElementById('stkAmount').value = '';
            document.getElementById('stkAmount').placeholder = 'e.g. 500';

            this.hideStkStatus();
            document.getElementById('stkPushModal').classList.add('open');
            document.getElementById('stkAmount').focus();

            this.getPlanAmount(m.plan_type, m.id).then(amount => {
                const a = document.getElementById('stkAmount');
                if (amount && !a.value) {
                    a.value = amount;
                    a.placeholder = `Default: KES ${amount} (${m.plan_type || 'plan'})`;
                }
            });
        } catch (err) {
            console.error('STK modal error:', err);
            if (window.showToast) window.showToast('error', 'Failed to open STK push.');
        }
    }

    closeStkPushModal() {
        if (this._stkAbort) { this._stkAbort.abort(); this._stkAbort = null; }
        document.getElementById('stkPushModal').classList.remove('open');
        this._stkMember = null;
    }

    setStkStatus(type, msg) {
        const b = document.getElementById('stkStatus');
        const s = document.getElementById('stkStatusSpinner');
        const t = document.getElementById('stkStatusText');
        if (!b) return;
        b.className = `stk-status show ${type}`;
        if (s) s.style.display = type === 'loading' ? 'inline-block' : 'none';
        if (t) t.textContent = msg;
    }

    hideStkStatus() {
        const b = document.getElementById('stkStatus');
        if (b) b.className = 'stk-status';
    }

    async sendStkPush() {
        if (!this._stkMember) return window.showToast && window.showToast('error', 'No member selected.');

        const phoneRaw = document.getElementById('stkPhone').value.trim();
        const amountRaw = document.getElementById('stkAmount').value.trim();
        const phone = this.normalizeMsisdn(phoneRaw);
        const amount = Math.round(Number(amountRaw));

        if (!/^254(7|1)\d{8}$/.test(phone)) return this.setStkStatus('error', 'Enter a valid Safaricom number.');
        if (!amount || amount < 1) return this.setStkStatus('error', 'Enter a valid amount.');

        const planCode = String(this._stkMember.plan_type || this._stkMember.plan || '').trim().toUpperCase();
        if (!planCode) return this.setStkStatus('error', 'Member has no plan set.');

        let parentCount = 0;
        if (planCode === 'WAZAZI') {
            parentCount = await this.countWazaziParents(this._stkMember.id);
            if (parentCount < 1) return this.setStkStatus('error', 'Wazazi requires at least 1 parent.');
        }

        const btn = document.getElementById('stkSendBtn');
        btn.disabled = true;
        this.setStkStatus('loading', 'Sending payment request…');
        this._stkAbort = new AbortController();
        const timeout = setTimeout(() => this._stkAbort.abort(), 30000);

        try {
            const res = await fetch(`${this.MASIKA_API_BASE}/api/public/payment/stk-push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: this._stkAbort.signal,
                body: JSON.stringify({
                    phone, amount,
                    member_id: this._stkMember.id,
                    membership_number: this.getMembershipNumber(this._stkMember) || null,
                    plan: planCode, plan_code: planCode, plan_type: planCode,
                    parent_count: parentCount,
                    payment_type: 'subscription'
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || data.message || data.error || `HTTP ${res.status}`);

            if (data?.checkout_request_id || data?.CheckoutRequestID) {
                this.setStkStatus('success', `Request sent. Ask member to enter PIN on ${phone}.`);
                this.paymentRowsCache = null;
                if (window.showToast) window.showToast('success', 'STK push sent.');
            } else {
                this.setStkStatus('success', 'Request sent.');
            }
        } catch (err) {
            const msg = err.name === 'AbortError' ? 'Request timed out.' : (err.message || 'Failed.');
            this.setStkStatus('error', msg);
        } finally {
            clearTimeout(timeout);
            this._stkAbort = null;
            btn.disabled = false;
        }
    }

    // ============================================================
    // PLAN & WAZAZI HELPERS
    // ============================================================

    async getPlanPricing(planValue) {
        const planCode = String(planValue || '').trim().toUpperCase();
        if (!planCode) throw new Error('Plan is required.');
        const { data, error } = await this.supabase
            .from('plans').select('*').ilike('plan_code', planCode).eq('is_active', true).maybeSingle();
        if (error) throw new Error(`Unable to load pricing for ${planCode}.`);
        if (!data) throw new Error(`Plan '${planCode}' not found.`);
        return data;
    }

    async getPlanConfig(planType) {
        const key = String(planType || '').trim().toLowerCase();
        if (!key) return null;
        if (this.planConfigCache[key]) return this.planConfigCache[key];

        let resolved = null;
        try {
            const row = await this.getPlanPricing(key);
            resolved = {
                label: (row.plan_name || key).trim(),
                amount: Number(row.monthly_premium || row.monthly_amount || 0) || 0,
                registrationFee: Number(row.registration_fee || 0) || 0,
                parentMonthly: Number(row.parent_monthly_premium || 0) || 0,
                parentFee: Number(row.parent_registration_fee || 0) || 0,
                minParents: Number(row.minimum_parents || row.min_parents || 0) || 0,
                maxParents: Number(row.maximum_parents || row.max_parents || 0) || 0,
                maxDependants: (row.max_dependants ?? row.maximum_dependants) != null
                    ? Number(row.max_dependants ?? row.maximum_dependants) : null
            };
        } catch (err) {
            console.warn(`getPlanConfig(${key}) fallback:`, err.message);
        }

        if (!resolved) {
            const fb = this.PLAN_FALLBACK_CONFIG[key];
            resolved = fb ? { ...fb } : {
                label: key, amount: 0, registrationFee: 0,
                parentMonthly: 0, parentFee: 0,
                minParents: 0, maxParents: 0, maxDependants: null
            };
        }

        if (key === 'wazazi') {
            if (!resolved.parentMonthly || resolved.parentMonthly <= 0) resolved.parentMonthly = 350;
            if (!resolved.parentFee || resolved.parentFee <= 0) resolved.parentFee = 100;
            if (!resolved.minParents || resolved.minParents < 1) resolved.minParents = 1;
            if (!resolved.maxParents || resolved.maxParents < 1) resolved.maxParents = 4;
            if (!resolved.amount || resolved.amount <= 0) resolved.amount = 300;
            if (!resolved.registrationFee || resolved.registrationFee <= 0) resolved.registrationFee = 200;
        }

        this.planConfigCache[key] = resolved;
        return resolved;
    }

    async getPlanAmount(planType, memberId = null) {
        const key = String(planType || '').trim().toLowerCase();
        if (!key) return null;
        const config = await this.getPlanConfig(key);
        if (key === 'wazazi') {
            const parentCount = memberId ? await this.countWazaziParents(memberId) : 0;
            const base = Number(config.amount || 300);
            const parentMonthly = Number(config.parentMonthly || 350);
            return parentCount >= 1 ? base + (parentCount * parentMonthly) : base;
        }
        return Number(config.amount || 0) || null;
    }

    async countWazaziParents(memberId) {
        if (!memberId) return 0;
        let parentCount = 0;
        try {
            const { data, error } = await this.supabase.from('parents').select('id').eq('member_id', memberId);
            if (!error && Array.isArray(data)) parentCount += data.length;
        } catch (e) { /* no parents table */ }
        try {
            const { data, error } = await this.supabase
                .from('dependants').select('id,relationship').eq('principal_member_id', memberId);
            if (!error && Array.isArray(data)) {
                parentCount += data.filter(d => {
                    const rel = String(d.relationship || '').trim().toLowerCase();
                    return rel === 'parent' || rel === 'parents';
                }).length;
            }
        } catch (e) { /* ignore */ }
        return parentCount;
    }

    planUsesParents(config) { return !!config && Number(config.maxParents) > 0; }
    planDependantLimit(config) {
        if (!config) return null;
        if (config.maxDependants === null || config.maxDependants === undefined) return null;
        const n = Number(config.maxDependants);
        return Number.isFinite(n) ? n : null;
    }

    // ============================================================
    // PAYMENT RECONCILIATION
    // ============================================================

    async loadPaymentRows(force = false) {
        const now = Date.now();
        if (!force && this.paymentRowsCache && now - this.paymentRowsCacheAt < this.PAYMENT_CACHE_MS) return this.paymentRowsCache;
        try {
            const { data, error } = await this.supabase.from('payments').select('*').limit(10000);
            if (error) { this.paymentRowsCache = null; return null; }
            this.paymentRowsCache = Array.isArray(data) ? data : [];
            this.paymentRowsCacheAt = now;
            return this.paymentRowsCache;
        } catch { this.paymentRowsCache = null; return null; }
    }

    paymentIsSuccessful(row) {
        const success = new Set(['paid','completed','complete','success','successful','confirmed','received','settled','processed','approved']);
        const raw = row.status ?? row.payment_status ?? row.transaction_status ?? row.result_status ?? row.result ?? row.state;
        if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
            return success.has(String(raw).trim().toLowerCase());
        }
        return true;
    }

    paymentMemberMatches(row, member) {
        const memberId = String(member?.id ?? '');
        const memberNo = String(this.getMembershipNumber(member) ?? '').trim();
        const phone = this.normalizeMsisdn(member?.phone || '');
        const ids = [row.member_id, row.membership_id, row.member_uuid].filter(v => v != null).map(String);
        if (memberId && ids.includes(memberId)) return true;
        const nos = [row.member_number, row.membership_number, row.account_number, row.account, row.reference]
            .filter(v => v != null).map(v => String(v).trim());
        if (memberNo && nos.includes(memberNo)) return true;
        const phones = [row.phone, row.msisdn, row.customer_phone].filter(v => v != null).map(this.normalizeMsisdn.bind(this));
        return phone && phones.includes(phone);
    }

    paymentAmount(row) {
        const v = row.amount ?? row.paid_amount ?? row.payment_amount ?? row.received_amount ?? row.total_amount;
        const n = Number(v); return Number.isFinite(n) ? n : 0;
    }

    paymentDate(row) {
        const raw = row.payment_date ?? row.paid_at ?? row.created_at ?? row.date;
        const d = raw ? new Date(raw) : null;
        return d && !Number.isNaN(d.getTime()) ? d : null;
    }

    monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
    monthLabel(key) {
        const [y, m] = key.split('-').map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString('en-KE', { month: 'short', year: '2-digit' });
    }

    requiredMonths(startDate, endDate = new Date()) {
        const months = [];
        const d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
        while (d <= end) { months.push(this.monthKey(d)); d.setMonth(d.getMonth() + 1); }
        return months;
    }

    async reconcileMemberPaymentStatus(member, options = {}) {
        const empty = {
            status: member?.status || 'PENDING',
            paymentAvailable: false,
            missingMonths: [], paidByMonth: new Map(),
            monthlyAmount: null, monthDetails: []
        };
        if (!member?.id || !member?.plan_type) return empty;

        if (member.payment_override) {
            const monthlyAmount = await this.getPlanAmount(member.plan_type, member.id);
            return {
                status: member.status || 'PENDING',
                paymentAvailable: true, manualOverride: true,
                missingMonths: [], paidByMonth: new Map(),
                monthlyAmount: Number.isFinite(Number(monthlyAmount)) ? Number(monthlyAmount) : null,
                monthDetails: []
            };
        }
        if (['SUSPENDED','CANCELLED'].includes(String(member.status || '').toUpperCase())) {
            return { ...empty, status: member.status };
        }
        const rows = await this.loadPaymentRows(Boolean(options.forcePayments));
        if (!rows) return { ...empty, skipped: true };

        const monthlyAmount = Number(await this.getPlanAmount(member.plan_type, member.id));
        if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) return { ...empty, paymentAvailable: true, skipped: true };

        const joined = member.created_at ? new Date(member.created_at) : new Date();
        if (isNaN(joined.getTime())) return { ...empty, paymentAvailable: true, skipped: true };

        const memberPayments = rows
            .filter(r => this.paymentMemberMatches(r, member))
            .filter(this.paymentIsSuccessful.bind(this))
            .map(r => ({ amount: this.paymentAmount(r), date: this.paymentDate(r) }))
            .filter(x => x.amount > 0 && x.date);

        const paidByMonth = new Map();
        memberPayments.forEach(({ amount, date }) => {
            const k = this.monthKey(date);
            paidByMonth.set(k, (paidByMonth.get(k) || 0) + amount);
        });

        const due = this.requiredMonths(joined);
        const currentKey = this.monthKey(new Date());

        const monthDetails = due.map(k => {
            const paid = paidByMonth.get(k) || 0;
            let state = paid >= monthlyAmount ? 'paid' : paid > 0 ? 'partial' : 'missing';
            return { key: k, label: this.monthLabel(k), paid, state, isCurrent: k === currentKey };
        });

        const missingMonths = monthDetails.filter(m => m.state !== 'paid').map(m => m.key);
        const calculatedStatus = missingMonths.length === 0 ? 'ACTIVE' : 'DORMANT';

        if (options.persist !== false && member.status !== calculatedStatus) {
            const { error } = await this.supabase.from('members')
                .update({ status: calculatedStatus, updated_at: new Date().toISOString() })
                .eq('id', member.id);
            if (!error) member.status = calculatedStatus;
        }

        return {
            status: calculatedStatus, paymentAvailable: true,
            missingMonths, paidByMonth, monthlyAmount, monthDetails
        };
    }

    async reconcileVisibleMemberStatuses(members) {
        if (!Array.isArray(members) || !members.length) return members;
        const rows = await this.loadPaymentRows();
        if (!rows) return members;
        for (const m of members) {
            try {
                const audit = await this.reconcileMemberPaymentStatus(m, { persist: true });
                this.currentAuditCache.set(String(m.id), audit);
            } catch (e) { console.warn('Reconcile failed:', m.id, e); }
        }
        return members;
    }

    // ============================================================
    // RESILIENT INSERT/UPDATE
    // ============================================================

    async insertResilient(table, payload, coreColumns) {
        const attempt = { ...payload };
        const dropped = [];
        for (let i = 0; i < 12; i++) {
            const { data, error } = await this.supabase.from(table).insert(attempt).select('*').single();
            if (!error) return { data, dropped };
            const msg = String(error.message || '');
            const match = msg.match(/Could not find the '([^']+)' column/i)
                || new RegExp(`column "?([a-z_0-9]+)"? of relation "?${table}"? does not exist`, 'i').exec(msg);
            const column = match ? match[1] : null;
            if (column && column in attempt && !coreColumns.includes(column)) {
                dropped.push(column); delete attempt[column]; continue;
            }
            throw error;
        }
        throw new Error(`Could not save record in ${table}.`);
    }

    async updateResilient(table, id, payload, coreColumns) {
        const attempt = { ...payload };
        const dropped = [];
        for (let i = 0; i < 12; i++) {
            const { data, error } = await this.supabase.from(table).update(attempt).eq('id', id).select('*').single();
            if (!error) return { data, dropped };
            const msg = String(error.message || '');
            const match = msg.match(/Could not find the '([^']+)' column/i)
                || new RegExp(`column "?([a-z_0-9]+)"? of relation "?${table}"? does not exist`, 'i').exec(msg);
            const column = match ? match[1] : null;
            if (column && column in attempt && !coreColumns.includes(column)) {
                dropped.push(column); delete attempt[column]; continue;
            }
            throw error;
        }
        throw new Error(`Could not update record in ${table}.`);
    }

    // ============================================================
    // EXPORT
    // ============================================================

    async exportMembers() {
        try {
            const { data, error } = await this.supabase.from('members').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            if (!data || !data.length) return window.showToast && window.showToast('warning', 'No members to export');

            const headers = ['Member Number','First Name','Last Name','Phone','Email','Plan','Status','County','Town','Joined','Duration (months)','Renewal Status','Next Renewal'];
            const rows = data.map(m => {
                const t = this.computeTenure(m.created_at);
                const r = this.computeRenewal(m.created_at);
                return [
                    this.getMembershipNumber(m) || '',
                    m.first_name || '', m.last_name || '',
                    m.phone || '', m.email || '',
                    m.plan_type || '', m.status || '',
                    m.county || '', m.town || '',
                    m.created_at ? new Date(m.created_at).toLocaleDateString('en-KE') : '',
                    t.months, r.status,
                    r.dueDate ? r.dueDate.toLocaleDateString('en-KE') : ''
                ];
            });
            this.downloadCSV(headers, rows, `members_${new Date().toISOString().split('T')[0]}`);
            if (window.showToast) window.showToast('success', 'Members exported.');
        } catch (error) {
            console.error('Export error:', error);
            if (window.showToast) window.showToast('error', 'Failed to export.');
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
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ============================================================
    // HELPERS
    // ============================================================

    getMembershipNumber(member) {
        if (!member) return null;
        const keys = ['member_number','membership_number','membership_no','member_no','reg_number','registration_number'];
        for (const k of keys) if (member[k]) return member[k];
        return null;
    }

    computeTenure(joinedDate) {
        if (!joinedDate) return { months: 0, years: 0, remMonths: 0, label: '—' };
        const joined = new Date(joinedDate);
        if (isNaN(joined.getTime())) return { months: 0, years: 0, remMonths: 0, label: '—' };
        const now = new Date();
        let months = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
        if (now.getDate() < joined.getDate()) months -= 1;
        if (months < 0) months = 0;
        const years = Math.floor(months / 12);
        const remMonths = months % 12;
        let label;
        if (years === 0 && remMonths === 0) label = 'New member';
        else if (years === 0) label = `${remMonths} month${remMonths === 1 ? '' : 's'}`;
        else if (remMonths === 0) label = `${years} year${years === 1 ? '' : 's'}`;
        else label = `${years}y ${remMonths}m`;
        return { months, years, remMonths, label };
    }

    computeRenewal(joinedDate) {
        if (!joinedDate) return { status: 'ok', label: '—', dueDate: null, daysLeft: null };
        const joined = new Date(joinedDate);
        if (isNaN(joined.getTime())) return { status: 'ok', label: '—', dueDate: null, daysLeft: null };
        const dueDate = new Date(joined);
        dueDate.setFullYear(dueDate.getFullYear() + 1);
        const now = new Date();
        const daysLeft = Math.round((dueDate - now) / (1000 * 60 * 60 * 24));
        let status, label;
        if (daysLeft < 0) {
            status = 'late';
            const overdue = Math.abs(daysLeft);
            label = overdue < 30 ? `${overdue}d overdue` : `${Math.floor(overdue / 30)}mo overdue`;
        } else if (daysLeft <= 30) {
            status = 'soon';
            label = daysLeft === 0 ? 'Due today' : `${daysLeft}d left`;
        } else {
            status = 'ok';
            const d = Math.floor(daysLeft / 30);
            label = d < 12 ? `${d}mo to renew` : `${Math.floor(d / 12)}y to renew`;
        }
        return { status, label, dueDate, daysLeft };
    }

    computeValidUntil(member) {
        const explicit = member.expiry_date || member.valid_until || member.membership_expiry;
        if (explicit) { const d = new Date(explicit); if (!isNaN(d.getTime())) return d; }
        const base = member.created_at ? new Date(member.created_at) : new Date();
        const d = new Date(base); d.setFullYear(d.getFullYear() + 1); return d;
    }

    normalizeMsisdn(raw) {
        let d = String(raw || '').replace(/\D/g, '');
        if (d.startsWith('0')) d = '254' + d.slice(1);
        else if (d.startsWith('7') || d.startsWith('1')) d = '254' + d;
        return d;
    }

    showModalError(msg) {
        const el = document.getElementById('memberModalError');
        if (!el) return;
        el.textContent = msg; el.style.display = 'block';
        const s = document.getElementById('memberModalSuccess');
        if (s) s.style.display = 'none';
    }

    showModalSuccess(msg) {
        const el = document.getElementById('memberModalSuccess');
        if (!el) return;
        el.textContent = msg; el.style.display = 'block';
        const e = document.getElementById('memberModalError');
        if (e) e.style.display = 'none';
    }

    clearModalMessages() {
        const e = document.getElementById('memberModalError');
        const s = document.getElementById('memberModalSuccess');
        if (e) e.style.display = 'none';
        if (s) s.style.display = 'none';
    }

    escapeHtml(value) {
        if (value === null || value === undefined || value === '') return '-';
        return String(value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    escapeAttr(value) {
        return String(value || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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
