/**
 * admin-revenue.js
 * -----------------------------------------------------------------------
 * Powers the "Today / Month / Total revenue" stat cards and the
 * "Unassigned Payments" (wrong account/reference number) card on
 * admin-dashboard.html.
 *
 * Loaded AFTER supabase-config.js and admin-auth.js, alongside
 * admin-dashboard.js. It does not touch any globals owned by
 * admin-dashboard.js (members/agents stats) — it only writes to the
 * DOM ids listed in CONFIG.dom below.
 *
 * ⚠️ VERIFY THESE COLUMN NAMES AGAINST YOUR ACTUAL `payments` SCHEMA
 * before deploying. Based on prior context the real "payment confirmed"
 * column is `verified_at` (NOT `confirmed_at` — that was the bug that
 * caused silent confirmation failures). If your schema differs, this
 * is the only block you need to edit.
 * -----------------------------------------------------------------------
 */

(function () {
    'use strict';

    const CONFIG = {
        table: 'payments',
        columns: {
            amount: 'amount',                 // numeric, KES
            verifiedAt: 'verified_at',         // timestamptz, null = not yet confirmed
            createdAt: 'created_at',           // timestamptz, when the payment record was created
            memberId: 'member_id',             // FK to members.id — null = could not be matched
            accountRef: 'account_reference',   // raw M-Pesa BillRefNumber / account no. the payer typed in
            phone: 'phone_number',
            mpesaCode: 'mpesa_receipt_number'
        },
        membersTable: 'members',
        memberNumberColumn: 'member_number',
        timezone: 'Africa/Nairobi', // UTC+3, no DST — used for "today" / "this month" boundaries
        realtimeDebounceMs: 600
    };

    let supabase = null;
    let refreshTimer = null;

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    function formatKES(value) {
        const n = Number(value) || 0;
        return 'KES ' + n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function flashCard(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('flash');
        // force reflow so the animation can restart on rapid updates
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

    // Returns [startOfTodayUTCISOString, startOfMonthUTCISOString] computed
    // in the Africa/Nairobi timezone (UTC+3, fixed offset, no DST).
    function getEATBounds() {
        const now = new Date();
        // Shift "now" into EAT by adding 3 hours, then read Y/M/D off the UTC getters.
        const eatNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
        const y = eatNow.getUTCFullYear();
        const m = eatNow.getUTCMonth();
        const d = eatNow.getUTCDate();

        // Midnight EAT expressed back as a real UTC instant (subtract the 3h offset).
        const startOfTodayUTC = new Date(Date.UTC(y, m, d, 0, 0, 0) - 3 * 60 * 60 * 1000);
        const startOfMonthUTC = new Date(Date.UTC(y, m, 1, 0, 0, 0) - 3 * 60 * 60 * 1000);

        return {
            startOfToday: startOfTodayUTC.toISOString(),
            startOfMonth: startOfMonthUTC.toISOString()
        };
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
    // Data fetch + compute
    // ---------------------------------------------------------------

    async function fetchAllRevenueRows() {
        const c = CONFIG.columns;
        // Pull only verified payments — unverified/pending ones shouldn't count as revenue.
        const { data, error } = await supabase
            .from(CONFIG.table)
            .select(`${c.amount}, ${c.verifiedAt}, ${c.createdAt}, ${c.memberId}`)
            .not(c.verifiedAt, 'is', null)
            .order(c.createdAt, { ascending: false })
            .limit(20000); // sane upper bound; move to a DB view/RPC if you outgrow this

        if (error) throw error;
        return data || [];
    }

    async function fetchUnassignedRows() {
        const c = CONFIG.columns;
        // Verified payment, but no member matched -> wrong/unrecognized account number.
        const { data, error } = await supabase
            .from(CONFIG.table)
            .select(`id, ${c.amount}, ${c.verifiedAt}, ${c.createdAt}, ${c.accountRef}, ${c.phone}, ${c.mpesaCode}`)
            .not(c.verifiedAt, 'is', null)
            .is(c.memberId, null)
            .order(c.createdAt, { ascending: false })
            .limit(200);

        if (error) throw error;
        return data || [];
    }

    function computeRevenue(rows) {
        const c = CONFIG.columns;
        const { startOfToday, startOfMonth } = getEATBounds();

        let dailyTotal = 0, dailyCount = 0;
        let monthTotal = 0, monthCount = 0;
        let allTotal = 0, allCount = 0;

        for (const row of rows) {
            const amt = Number(row[c.amount]) || 0;
            const createdAt = row[c.createdAt];

            allTotal += amt;
            allCount += 1;

            if (createdAt >= startOfMonth) {
                monthTotal += amt;
                monthCount += 1;
            }
            if (createdAt >= startOfToday) {
                dailyTotal += amt;
                dailyCount += 1;
            }
        }

        return { dailyTotal, dailyCount, monthTotal, monthCount, allTotal, allCount };
    }

    function renderRevenue(stats) {
        setText('dailyRevenue', formatKES(stats.dailyTotal));
        setText('dailyRevenueCount', `${stats.dailyCount} payment${stats.dailyCount === 1 ? '' : 's'}`);

        const monthLabel = new Date().toLocaleString('en-KE', { month: 'long', timeZone: 'Africa/Nairobi' });
        setText('monthRevenueLabel', `${monthLabel} Revenue`);
        setText('monthRevenue', formatKES(stats.monthTotal));
        setText('monthRevenueCount', `${stats.monthCount} payment${stats.monthCount === 1 ? '' : 's'}`);

        setText('totalRevenue', formatKES(stats.allTotal));
        setText('totalRevenueCount', `${stats.allCount} payment${stats.allCount === 1 ? '' : 's'} all-time`);

        flashCard('dailyRevenueCard');
        flashCard('monthRevenueCard');
        flashCard('totalRevenueCard');
    }

    function renderUnassigned(rows) {
        const c = CONFIG.columns;
        const container = document.getElementById('unassignedPayments');
        const badge = document.getElementById('unassignedBadge');
        const countEl = document.getElementById('unassignedCount');
        const amountEl = document.getElementById('unassignedAmount');

        const total = rows.reduce((sum, r) => sum + (Number(r[c.amount]) || 0), 0);

        if (badge) badge.textContent = rows.length;
        if (countEl) countEl.textContent = rows.length;
        if (amountEl) amountEl.textContent = `${formatKES(total)} unmatched`;
        flashCard('unassignedRevenueCard');

        if (!container) return;

        if (rows.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-circle-check" style="color:var(--success);font-size:20px;"></i><p style="margin-top:8px;">No unassigned payments — every verified payment is matched to a member.</p></div>';
            return;
        }

        const tableRows = rows.map((r) => {
            const date = r[c.createdAt] ? new Date(r[c.createdAt]).toLocaleString('en-KE', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
            }) : '—';
            const ref = r[c.accountRef] ? escapeHtml(String(r[c.accountRef])) : '<em>blank</em>';
            const phone = r[c.phone] ? escapeHtml(String(r[c.phone])) : '—';
            const code = r[c.mpesaCode] ? escapeHtml(String(r[c.mpesaCode])) : '—';

            return `
                <tr class="row-mismatch" id="unassigned-row-${r.id}">
                    <td>${date}</td>
                    <td>${formatKES(r[c.amount])}</td>
                    <td>${ref}</td>
                    <td>${phone}</td>
                    <td>${code}</td>
                    <td>
                        <button class="btn-sm gold" onclick="AdminRevenue.assignPayment('${r.id}')">
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
                            <th>Reference Entered</th>
                            <th>Phone</th>
                            <th>M-Pesa Code</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>`;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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
                alert(`No member found with number "${memberNumber}". Note: member numbers exist in a few different formats (MAS-YYYY-######, MSK XXXXXX, MSK#####) — double check the exact format on file.`);
                return;
            }

            const { error: updateError } = await supabase
                .from(CONFIG.table)
                .update({ [CONFIG.columns.memberId]: member.id })
                .eq('id', paymentId);

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
        try {
            const [revenueRows, unassignedRows] = await Promise.all([
                fetchAllRevenueRows(),
                fetchUnassignedRows()
            ]);
            renderRevenue(computeRevenue(revenueRows));
            renderUnassigned(unassignedRows);
        } catch (err) {
            console.error('AdminRevenue refresh failed:', err);
            setLiveIndicator('error', 'Data error');
        }
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
                { event: '*', schema: 'public', table: CONFIG.table },
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

        await refreshAll();
        setupRealtime();
    }

    // Expose a small public surface for the inline onclick handler and
    // for admin-dashboard.js / refreshData() to hook into if useful.
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
