/**
 * admin-revenue.js
 * -----------------------------------------------------------------------
 * Loaded AFTER supabase-config.js, admin-auth.js and admin-dashboard.js.
 *
 * Scope is intentionally narrow — admin-dashboard.js is the single
 * source of truth for Total Members / Total Agents / Active Agents /
 * Daily / Month / Total Revenue and the three recent-activity tables.
 * This file must never write to any of those same DOM ids — an earlier
 * version did, and having two scripts compute "revenue" two different
 * ways (this one used verified_at, admin-dashboard.js uses
 * payment_status/status) and race to write the same elements is what
 * caused inconsistent numbers on the dashboard.
 *
 * This file owns exactly two things:
 *   1. The "Live" indicator in the topbar.
 *   2. The "Unassigned Payments" card — payments that succeeded but
 *      couldn't be matched to a member (member_id IS NULL), i.e. the
 *      payer typed a wrong/unrecognized account number.
 *
 * It also subscribes to realtime changes on `payments` and, on change,
 * triggers BOTH its own unassigned-payments refresh AND
 * window.loadDashboardData() (admin-dashboard.js's own loader) so the
 * whole page — not just this card — updates live, without this file
 * re-implementing any of that logic itself.
 *
 * ⚠️ The payments table only confirms these columns exist (they're the
 * ones admin-dashboard.js already selects): id, amount, payment_status,
 * status, created_at, verified_at, member_id. There is no confirmed
 * column yet for the raw M-Pesa account reference / phone / receipt
 * code the payer entered, so the unassigned table below only shows
 * amount/date/status/id for now. Tell me the actual column names for
 * those and I'll add them as extra columns.
 * -----------------------------------------------------------------------
 */

(function () {
    'use strict';

    const CONFIG = {
        paymentsTable: 'payments',
        membersTable: 'members',
        memberNumberColumn: 'member_number',
        columns: {
            id: 'id',
            amount: 'amount',
            paymentStatus: 'payment_status',
            status: 'status',
            createdAt: 'created_at',
            memberId: 'member_id'
        },
        unassignedLimit: 200,
        realtimeDebounceMs: 600
    };

    // Must match admin-dashboard.js's SUCCESS_STATUSES exactly — if you
    // change one, change the other.
    const SUCCESS_STATUSES = new Set([
        'SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'COMPLETE',
        'PAID', 'VERIFIED', 'CONFIRMED'
    ]);

    let supabase = null;
    let refreshTimer = null;

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    function formatKES(value) {
        const n = Number(value) || 0;
        return 'KES ' + n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
    }

    function normalizeStatus(value) {
        return String(value || '').trim().toUpperCase();
    }

    function isSuccessfulPayment(payment) {
        return (
            SUCCESS_STATUSES.has(normalizeStatus(payment.payment_status)) ||
            SUCCESS_STATUSES.has(normalizeStatus(payment.status))
        );
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str ?? '');
        return div.innerHTML;
    }

    function flashCard(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
    }

    function setLiveIndicator(state, label) {
        const el = document.getElementById('liveIndicator');
        const labelEl = document.getElementById('liveIndicatorLabel');
        if (!el) return;
        el.classList.remove('connected', 'error');
        if (state === 'connected') el.classList.add('connected');
        if (state === 'error') el.classList.add('error');
        if (labelEl) labelEl.textContent = label;
    }

    async function waitForSupabaseClient(timeoutMs = 8000) {
        const start = Date.now();
        while (typeof window.supabaseClient === 'undefined' || !window.supabaseClient) {
            if (Date.now() - start > timeoutMs) {
                throw new Error('supabaseClient was never initialized (check supabase-config.js).');
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        return window.supabaseClient;
    }

    // ---------------------------------------------------------------
    // Unassigned payments
    // ---------------------------------------------------------------

    async function fetchUnassignedRows() {
        const c = CONFIG.columns;
        const { data, error } = await supabase
            .from(CONFIG.paymentsTable)
            .select(`${c.id}, ${c.amount}, ${c.paymentStatus}, ${c.status}, ${c.createdAt}`)
            .is(c.memberId, null)
            .order(c.createdAt, { ascending: false })
            .limit(CONFIG.unassignedLimit);

        if (error) throw error;

        // Filter to successful payments client-side, same definition
        // admin-dashboard.js uses for revenue — a pending/failed payment
        // with no member yet isn't "wrong account number", it's just
        // not paid yet.
        return (data || []).filter(isSuccessfulPayment);
    }

    function renderUnassigned(rows) {
        const container = document.getElementById('unassignedPayments');
        const badge = document.getElementById('unassignedBadge');
        const countEl = document.getElementById('unassignedCount');
        const amountEl = document.getElementById('unassignedAmount');
        const c = CONFIG.columns;

        const total = rows.reduce((sum, r) => sum + (Number(r[c.amount]) || 0), 0);

        if (badge) badge.textContent = rows.length;
        if (countEl) countEl.textContent = rows.length;
        if (amountEl) amountEl.textContent = `${formatKES(total)} unmatched`;
        flashCard('unassignedRevenueCard');

        if (!container) return;

        if (rows.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-circle-check" style="color:var(--success);font-size:20px;"></i><p style="margin-top:8px;">No unassigned payments — every successful payment is matched to a member.</p></div>';
            return;
        }

        const tableRows = rows.map((r) => {
            const date = r[c.createdAt] ? new Date(r[c.createdAt]).toLocaleString('en-KE', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                timeZone: 'Africa/Nairobi'
            }) : '—';
            const status = r[c.paymentStatus] || r[c.status] || '—';
            const shortId = String(r[c.id]).slice(0, 8);

            return `
                <tr class="row-mismatch" id="unassigned-row-${escapeHtml(r[c.id])}">
                    <td>${date}</td>
                    <td>${formatKES(r[c.amount])}</td>
                    <td><span class="status-badge paid">${escapeHtml(status)}</span></td>
                    <td><code title="${escapeHtml(r[c.id])}">${escapeHtml(shortId)}…</code></td>
                    <td>
                        <button class="btn-sm gold" onclick="AdminRevenue.assignPayment('${r[c.id]}')">
                            <i class="fas fa-link"></i> Assign
                        </button>
                    </td>
                </tr>`;
        }).join('');

        container.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Payment ID</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>`;
    }

    async function refreshUnassigned() {
        try {
            const rows = await fetchUnassignedRows();
            renderUnassigned(rows);
        } catch (err) {
            console.error('AdminRevenue: failed to load unassigned payments:', err);
            const container = document.getElementById('unassignedPayments');
            if (container) {
                container.innerHTML = `<div class="error-state"><i class="fas fa-triangle-exclamation"></i> Couldn't load unassigned payments. (${escapeHtml(err.message || '')})</div>`;
            }
        }
    }

    // ---------------------------------------------------------------
    // Assign flow — match a stray payment to the correct member
    // ---------------------------------------------------------------

    async function assignPayment(paymentId) {
        const input = window.prompt('Enter the correct member number (e.g. MAS-2026-000123):');
        if (!input) return;
        const memberNumber = input.trim();
        if (!memberNumber) return;

        try {
            const { data: member, error: lookupError } = await supabase
                .from(CONFIG.membersTable)
                .select(`id, ${CONFIG.memberNumberColumn}`)
                .eq(CONFIG.memberNumberColumn, memberNumber)
                .maybeSingle();

            if (lookupError) throw lookupError;

            if (!member) {
                alert(`No member found with number "${memberNumber}". Member numbers exist in a few formats (MAS-YYYY-######, MSK XXXXXX, MSK#####) — double check the exact format on file.`);
                return;
            }

            const { error: updateError } = await supabase
                .from(CONFIG.paymentsTable)
                .update({ [CONFIG.columns.memberId]: member.id })
                .eq(CONFIG.columns.id, paymentId);

            if (updateError) throw updateError;

            const row = document.getElementById(`unassigned-row-${paymentId}`);
            if (row) row.remove();

            await refreshAll();
        } catch (err) {
            console.error('assignPayment failed:', err);
            alert('Could not assign this payment. Check the console for details.');
        }
    }

    // ---------------------------------------------------------------
    // Orchestration
    // ---------------------------------------------------------------

    async function refreshAll() {
        const tasks = [refreshUnassigned()];
        if (typeof window.loadDashboardData === 'function') {
            tasks.push(window.loadDashboardData());
        }
        await Promise.allSettled(tasks);
    }

    function scheduleRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refreshAll, CONFIG.realtimeDebounceMs);
    }

    function setupRealtime() {
        const channel = supabase
            .channel('admin-dashboard-payments')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: CONFIG.paymentsTable },
                () => scheduleRefresh()
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    setLiveIndicator('connected', 'Live');
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    setLiveIndicator('error', 'Reconnecting…');
                } else if (status === 'CLOSED') {
                    setLiveIndicator('error', 'Disconnected');
                }
            });

        // Fallback poll in case the realtime websocket drops silently
        // (flaky mobile networks) — cheap insurance, not the primary path.
        setInterval(refreshAll, 60000);

        return channel;
    }

    async function init() {
        try {
            supabase = await waitForSupabaseClient();
        } catch (err) {
            console.error(err);
            setLiveIndicator('error', 'Offline');
            return;
        }

        await refreshUnassigned();
        setupRealtime();
    }

    // Public surface for the inline onclick handler and for the
    // Refresh button in admin-dashboard.html.
    window.AdminRevenue = {
        refresh: refreshAll,
        assignPayment
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
