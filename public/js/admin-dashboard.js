// ============================================================
// MASIKA BENEVOLENT — ADMIN DASHBOARD
// ============================================================
//
// Loads dashboard data directly from the actual database.
//
// DATABASE
// ------------------------------------------------------------
// MEMBERS
//   public.members
//
// SALES AGENTS
//   public.staff
//   public.roles
//   roles.role_code = SALES_AGENT
//
// REVENUE
//   public.payments
//
// MEMBERSHIP NUMBER
//   members.member_number
//
// IMPORTANT
// ------------------------------------------------------------
// `member_number` is the ONE AND ONLY membership-number field.
//
// DO NOT reference:
//     membership_number
//
// Use ONLY:
//     member_number
//
// `member_id` remains the UUID foreign key used by payments.
//
// SOFT DELETE
// ------------------------------------------------------------
// admin-members.js soft-deletes members by setting `deleted_at`
// instead of removing the row (payments reference members via
// payments.member_id, RESTRICT). Every query here that counts or
// lists members MUST filter `.is("deleted_at", null)` or deleted
// members will keep showing up / keep being counted here even
// though admin-members.js already hides them.
//
// ============================================================

(function () {

    "use strict";

    // ========================================================
    // CONFIGURATION
    // ========================================================

    const CONFIG = {

        timezone: "Africa/Nairobi",

        membersTable: "members",

        // Agents live in their own dedicated table — NOT `staff`
        // (staff is for internal admin/branch-manager accounts only,
        // e.g. Mathew's SUPER_ADMIN row). Confirmed columns: id,
        // auth_user_id, sales_code, full_name, email, phone,
        // branch_id, status, created_at, updated_at, national_id.
        salesAgentsTable: "sales_agents",

        paymentsTable: "payments",

        members: {
            id: "id",
            fullName: "full_name",

            // CANONICAL MEMBERSHIP NUMBER
            membershipNumber: "member_number",

            status: "member_status",
            registrationDate: "registration_date",
            createdAt: "created_at"
        },

        staff: {
            id: "id",
            fullName: "full_name",
            employeeNumber: "employee_number",
            status: "status",
            salesCode: "sales_code",
            roleId: "role_id",
            createdAt: "created_at"
        },

        payments: {
            id: "id",
            amount: "amount",
            paymentStatus: "payment_status",
            status: "status",
            createdAt: "created_at",
            verifiedAt: "verified_at",

            // UUID foreign key — DO NOT rename
            memberId: "member_id"
        },

        maxPayments: 20000,

        recentLimit: 5,

        dateRefreshMs: 60 * 1000,

        dashboardRefreshMs: 60 * 1000,

        // How long to wait for supabaseClient / admin auth to
        // become available before giving up and showing an error
        // instead of hanging on "Loading..." forever.
        bootTimeoutMs: 15 * 1000,

        bootPollIntervalMs: 150
    };


    // ========================================================
    // STATE
    // ========================================================

    let dateTimer = null;

    let dashboardTimer = null;

    let initialized = false;

    let loading = false;

    // Toggled by the "Show all agents" button in the Recently Added
    // Agents card. false = only the CONFIG.recentLimit most recent.
    let showAllAgents = false;


    // ========================================================
    // SUCCESSFUL PAYMENT STATUSES
    // ========================================================

    const SUCCESS_STATUSES = new Set([
        "SUCCESS",
        "SUCCESSFUL",
        "COMPLETED",
        "COMPLETE",
        "PAID",
        "VERIFIED",
        "CONFIRMED"
    ]);


    // ========================================================
    // BOOTSTRAP
    // ------------------------------------------------------------
    // Previously this only ran off a single 'admin:authorized'
    // custom event dispatched by admin-auth.js. If that event was
    // missed for any reason (script order, an error thrown before
    // it fires, this listener attaching after the event already
    // fired, etc.) the dashboard would sit on its default HTML
    // ("Loading...", stat cards at 0) forever with zero indication
    // anything was wrong.
    //
    // This version:
    //   1. Still listens for 'admin:authorized' (fast path).
    //   2. ALSO polls for supabaseClient + an authorized profile
    //      on DOMContentLoaded, so a missed event can't cause a
    //      silent hang.
    //   3. Times out loudly (visible error + retry button) instead
    //      of failing silently if neither path succeeds.
    // ========================================================

    document.addEventListener(
        "admin:authorized",
        initializeDashboard
    );

    document.addEventListener(
        "DOMContentLoaded",
        bootWithPolling
    );


    function bootWithPolling() {

        const startedAt = Date.now();

        // Give AdminAuth a short head start to populate .profile (used
        // elsewhere for the sidebar name/avatar), but don't block the
        // dashboard's own data queries on it — those are already
        // protected by Supabase RLS on the authenticated session, and
        // AdminAuth.profile not being set (e.g. a different property
        // name, or it populating slightly later) was previously enough
        // to stall every stat card and table at 0/"Loading..." forever
        // with no visible error.
        const profileGraceMs = 2000;

        const poll = setInterval(() => {

            if (initialized) {
                clearInterval(poll);
                return;
            }

            const hasClient =
                typeof supabaseClient !== "undefined" &&
                !!supabaseClient;

            const hasProfile =
                !!(window.AdminAuth && window.AdminAuth.profile);

            const elapsed = Date.now() - startedAt;

            if (hasClient && (hasProfile || elapsed > profileGraceMs)) {
                clearInterval(poll);

                if (hasClient && !hasProfile) {
                    console.warn(
                        "Masika dashboard: proceeding without " +
                        "window.AdminAuth.profile (not set after " +
                        profileGraceMs + "ms). Data queries still run " +
                        "under the authenticated session; only " +
                        "profile-dependent UI (name/avatar) may be " +
                        "affected."
                    );
                }

                initializeDashboard();
                return;
            }

            if (elapsed > CONFIG.bootTimeoutMs) {

                clearInterval(poll);

                if (!initialized) {

                    console.error(
                        "Masika dashboard: gave up waiting for " +
                        "supabaseClient after " +
                        CONFIG.bootTimeoutMs + "ms.",
                        {
                            hasSupabaseClient: hasClient,
                            hasAdminAuthProfile: hasProfile
                        }
                    );

                    showBootFailure();

                }

            }

        }, CONFIG.bootPollIntervalMs);

    }


    function showBootFailure() {

        const message =
            "Couldn't connect to the database. This usually " +
            "means supabase-config.js failed to load, or your " +
            "session isn't authorized. Check the browser console " +
            "for details.";

        [
            "recentMembers",
            "pendingAgents",
            "recentPayments"
        ].forEach(id => {

            const container = document.getElementById(id);

            if (container) {
                renderError(container, message, () => {
                    initialized = false;
                    bootWithPolling();
                });
            }

        });

    }


    async function initializeDashboard() {

        if (initialized) {
            return;
        }

        initialized = true;

        updateDateTime();


        if (!dateTimer) {

            dateTimer = setInterval(
                updateDateTime,
                CONFIG.dateRefreshMs
            );

        }


        await loadDashboardData();


        if (!dashboardTimer) {

            dashboardTimer = setInterval(
                loadDashboardData,
                CONFIG.dashboardRefreshMs
            );

        }

    }


    // ========================================================
    // DATE / TIME
    // ========================================================

    function updateDateTime() {

        const el =
            document.getElementById(
                "currentDateTime"
            );

        if (!el) {
            return;
        }

        const now =
            new Date();

        el.textContent =
            now.toLocaleString(
                "en-KE",
                {
                    weekday: "short",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: CONFIG.timezone
                }
            );
    }


    // ========================================================
    // FORMATTING
    // ========================================================

    function formatKES(amount) {

        const value =
            Number(amount) || 0;

        return (
            "KES " +
            value.toLocaleString(
                "en-KE",
                {
                    maximumFractionDigits: 0
                }
            )
        );
    }


    function formatDate(dateStr) {

        if (!dateStr) {
            return "—";
        }

        const date =
            new Date(dateStr);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "—";
        }

        return date.toLocaleDateString(
            "en-KE",
            {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: CONFIG.timezone
            }
        );
    }


    function timeAgo(dateStr) {

        if (!dateStr) {
            return "—";
        }

        const date =
            new Date(dateStr);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "—";
        }

        const diffMs =
            Date.now() -
            date.getTime();

        const mins =
            Math.floor(
                diffMs / 60000
            );

        if (mins < 1) {
            return "just now";
        }

        if (mins < 60) {
            return `${mins}m ago`;
        }

        const hours =
            Math.floor(
                mins / 60
            );

        if (hours < 24) {
            return `${hours}h ago`;
        }

        const days =
            Math.floor(
                hours / 24
            );

        if (days < 30) {
            return `${days}d ago`;
        }

        return formatDate(dateStr);
    }


    // ========================================================
    // PAYMENT STATUS
    // ========================================================

    function normalizeStatus(value) {

        return String(value || "")
            .trim()
            .toUpperCase();

    }


    function isSuccessfulPayment(payment) {

        const paymentStatus =
            normalizeStatus(
                payment?.payment_status
            );

        const status =
            normalizeStatus(
                payment?.status
            );

        return (
            SUCCESS_STATUSES.has(
                paymentStatus
            ) ||
            SUCCESS_STATUSES.has(
                status
            )
        );
    }


    function statusBadgeClass(status) {

        const value =
            normalizeStatus(status);

        const map = {

            ACTIVE: "active",

            INACTIVE: "inactive",

            SUSPENDED: "inactive",

            DORMANT: "pending",

            CANCELLED: "rejected",

            PENDING: "pending",

            SUCCESSFUL: "paid",

            SUCCESS: "paid",

            COMPLETED: "paid",

            COMPLETE: "paid",

            PAID: "paid",

            VERIFIED: "paid",

            CONFIRMED: "paid",

            FAILED: "rejected",

            REVERSED: "rejected",

            PARTIAL: "pending"

        };

        return (
            map[value] ||
            "pending"
        );
    }


    // ========================================================
    // SECURITY / HTML
    // ========================================================

    function escapeHtml(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        return String(value)
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }


    // ========================================================
    // UI HELPERS
    // ========================================================

    function renderLoading(container) {

        if (!container) {
            return;
        }

        container.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Loading...</p>
            </div>
        `;
    }


    function renderEmpty(
        container,
        message
    ) {

        if (!container) {
            return;
        }

        container.innerHTML = `
            <div class="loading-spinner">
                <p style="color:var(--text-light);">
                    ${escapeHtml(message)}
                </p>
            </div>
        `;
    }


    function renderError(
        container,
        message,
        retryFn
    ) {

        if (!container) {
            return;
        }

        container.innerHTML = `
            <div class="loading-spinner">

                <p
                    style="
                        color:var(--danger);
                        margin-bottom:12px;
                    "
                >
                    <i class="fas fa-triangle-exclamation"></i>
                    ${escapeHtml(message)}
                </p>

                <button
                    class="btn-sm primary"
                    id="retryBtn"
                    type="button"
                >
                    <i class="fas fa-rotate-right"></i>
                    Retry
                </button>

            </div>
        `;

        const btn =
            container.querySelector(
                "#retryBtn"
            );

        if (btn && retryFn) {

            btn.addEventListener(
                "click",
                retryFn
            );

        }
    }


    // ========================================================
    // DASHBOARD STATISTICS
    // ========================================================

    async function loadStats() {

        // ----------------------------------------------------
        // MEMBERS
        // (excludes soft-deleted rows — see SOFT DELETE note
        // at the top of this file)
        // ----------------------------------------------------

        const membersResult =
            await supabaseClient
                .from(
                    CONFIG.membersTable
                )
                .select(
                    "id",
                    {
                        count: "exact",
                        head: true
                    }
                )
                .is("deleted_at", null);

        if (membersResult.error) {

            throw new Error(
                "Members query failed: " +
                membersResult.error.message
            );
        }

        const totalMembers =
            Number(
                membersResult.count
            ) || 0;


        // ----------------------------------------------------
        // SALES AGENTS (public.sales_agents — a dedicated table,
        // NOT staff. staff is for internal admin accounts only.)
        // ----------------------------------------------------

        const agentsResult =
            await supabaseClient
                .from(
                    CONFIG.salesAgentsTable
                )
                .select(
                    "id, full_name, status, sales_code, created_at"
                );

        if (agentsResult.error) {

            throw new Error(
                "Sales agents query failed: " +
                agentsResult.error.message
            );
        }

        const agents =
            agentsResult.data || [];

        const totalAgents =
            agents.length;

        const activeAgents =
            agents.filter(
                agent =>
                    normalizeStatus(
                        agent.status
                    ) === "ACTIVE"
            ).length;


        // ----------------------------------------------------
        // PAYMENTS
        // ----------------------------------------------------

        const paymentsResult =
            await supabaseClient
                .from(
                    CONFIG.paymentsTable
                )
                .select(
                    `
                        id,
                        amount,
                        payment_status,
                        status,
                        created_at,
                        verified_at,
                        member_id
                    `
                )
                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                )
                .limit(
                    CONFIG.maxPayments
                );

        if (paymentsResult.error) {

            throw new Error(
                "Payments query failed: " +
                paymentsResult.error.message
            );
        }

        const payments =
            paymentsResult.data || [];


        // ----------------------------------------------------
        // SUCCESSFUL PAYMENTS
        // ----------------------------------------------------

        const successfulPayments =
            payments.filter(
                isSuccessfulPayment
            );


        // ----------------------------------------------------
        // TOTAL REVENUE
        // ----------------------------------------------------

        let totalRevenue = 0;

        for (
            const payment
            of successfulPayments
        ) {

            totalRevenue +=
                Number(
                    payment.amount
                ) || 0;

        }


        // ----------------------------------------------------
        // CURRENT KENYA DATE
        // ----------------------------------------------------

        const now =
            new Date();

        const today =
            now.toLocaleDateString(
                "en-CA",
                {
                    timeZone:
                        CONFIG.timezone
                }
            );

        const currentMonth =
            today.substring(
                0,
                7
            );


        // ----------------------------------------------------
        // TODAY / MONTH
        // ----------------------------------------------------

        let todayRevenue = 0;

        let todayCount = 0;

        let monthRevenue = 0;

        let monthCount = 0;


        for (
            const payment
            of successfulPayments
        ) {

            if (
                !payment.created_at
            ) {
                continue;
            }

            const paymentDate =
                new Date(
                    payment.created_at
                );

            if (
                Number.isNaN(
                    paymentDate.getTime()
                )
            ) {
                continue;
            }

            const localDate =
                paymentDate.toLocaleDateString(
                    "en-CA",
                    {
                        timeZone:
                            CONFIG.timezone
                    }
                );

            const localMonth =
                localDate.substring(
                    0,
                    7
                );

            const amount =
                Number(
                    payment.amount
                ) || 0;


            if (
                localDate ===
                today
            ) {

                todayRevenue +=
                    amount;

                todayCount++;

            }


            if (
                localMonth ===
                currentMonth
            ) {

                monthRevenue +=
                    amount;

                monthCount++;

            }

        }


        // ----------------------------------------------------
        // RENDER
        // ----------------------------------------------------

        setText(
            "totalMembers",
            totalMembers.toLocaleString()
        );

        setText(
            "totalAgents",
            totalAgents.toLocaleString()
        );

        setText(
            "activeAgents",
            activeAgents.toLocaleString()
        );

        setText(
            "totalRevenue",
            formatKES(
                totalRevenue
            )
        );


        // ----------------------------------------------------
        // TODAY
        // ----------------------------------------------------

        setText(
            "dailyRevenue",
            formatKES(
                todayRevenue
            )
        );

        setText(
            "dailyRevenueCount",
            `${todayCount} payment${
                todayCount === 1
                    ? ""
                    : "s"
            }`
        );


        // ----------------------------------------------------
        // MONTH
        // ----------------------------------------------------

        const monthName =
            now.toLocaleString(
                "en-KE",
                {
                    month: "long",
                    timeZone:
                        CONFIG.timezone
                }
            );

        setText(
            "monthRevenueLabel",
            `${monthName} Revenue`
        );

        setText(
            "monthRevenue",
            formatKES(
                monthRevenue
            )
        );

        setText(
            "monthRevenueCount",
            `${monthCount} payment${
                monthCount === 1
                    ? ""
                    : "s"
            }`
        );


        // ----------------------------------------------------
        // TOTAL REVENUE COUNT (shown under the Total Revenue card)
        // ----------------------------------------------------

        setText(
            "totalRevenueCount",
            `${successfulPayments.length} payment${
                successfulPayments.length === 1
                    ? ""
                    : "s"
            } all-time`
        );


        // ----------------------------------------------------
        // SIDEBAR BADGES
        // ----------------------------------------------------

        setText(
            "pendingAgentsBadge",
            totalAgents.toLocaleString()
        );

        setText(
            "memberCountBadge",
            totalMembers.toLocaleString()
        );


        console.log(
            "Masika dashboard statistics:",
            {
                totalMembers,
                totalAgents,
                activeAgents,
                todayRevenue,
                todayCount,
                monthRevenue,
                monthCount,
                totalRevenue,
                successfulPayments:
                    successfulPayments.length
            }
        );

    }


    // ========================================================
    // RECENT MEMBERS
    // ========================================================

    async function loadRecentRegistrations() {

        const container =
            document.getElementById(
                "recentMembers"
            );

        if (!container) {
            return;
        }

        renderLoading(
            container
        );


        try {

            const {
                data,
                error
            } =
                await supabaseClient
                    .from(
                        CONFIG.membersTable
                    )
                    .select(
                        `
                            id,
                            full_name,
                            member_number,
                            member_status,
                            registration_date,
                            created_at
                        `
                    )
                    .is("deleted_at", null)
                    .order(
                        "created_at",
                        {
                            ascending: false
                        }
                    )
                    .limit(
                        CONFIG.recentLimit
                    );


            if (error) {
                throw error;
            }


            if (
                !data ||
                data.length === 0
            ) {

                renderEmpty(
                    container,
                    "No members registered yet."
                );

                return;
            }


            container.innerHTML = `
                <div class="table-wrapper">

                    <table>

                        <thead>

                            <tr>
                                <th>Member</th>
                                <th>Membership #</th>
                                <th>Status</th>
                                <th>Registered</th>
                                <th>Actions</th>
                            </tr>

                        </thead>

                        <tbody>

                            ${data.map(
                                member => {

                                    const memberId =
                                        escapeHtml(
                                            member.id
                                        );

                                    const memberName =
                                        escapeHtml(
                                            member.full_name ||
                                            "—"
                                        );

                                    const membershipNumber =
                                        escapeHtml(
                                            member.member_number ||
                                            "—"
                                        );

                                    const status =
                                        member.member_status ||
                                        "—";

                                    return `

                                        <tr
                                            data-member-row="${memberId}"
                                        >

                                            <td>
                                                ${memberName}
                                            </td>

                                            <td>
                                                <strong>
                                                    ${membershipNumber}
                                                </strong>
                                            </td>

                                            <td>

                                                <span
                                                    class="status-badge ${statusBadgeClass(status)}"
                                                >
                                                    ${escapeHtml(status)}
                                                </span>

                                            </td>

                                            <td>
                                                ${formatDate(
                                                    member.registration_date ||
                                                    member.created_at
                                                )}
                                            </td>

                                            <td>

                                                <button
                                                    type="button"
                                                    class="btn-sm danger delete-member-btn"
                                                    data-id="${memberId}"
                                                    data-name="${memberName}"
                                                    title="Delete member"
                                                >
                                                    <i class="fas fa-trash"></i>
                                                </button>

                                            </td>

                                        </tr>

                                    `;

                                }
                            ).join("")}

                        </tbody>

                    </table>

                </div>
            `;


            container
                .querySelectorAll(
                    ".delete-member-btn"
                )
                .forEach(
                    btn => {

                        btn.addEventListener(
                            "click",
                            () => {

                                const id =
                                    btn.getAttribute(
                                        "data-id"
                                    );

                                const name =
                                    btn.getAttribute(
                                        "data-name"
                                    );

                                deleteMember(
                                    id,
                                    name,
                                    btn
                                );

                            }
                        );

                    }
                );


        } catch (error) {

            console.error(
                "Failed to load recent registrations:",
                error
            );

            renderError(
                container,
                "Couldn't load recent registrations. " +
                (error?.message ? `(${error.message})` : ""),
                loadRecentRegistrations
            );

        }

    }


    // ========================================================
    // DELETE MEMBER (soft delete — sets deleted_at)
    // ------------------------------------------------------------
    // Matches admin-members.js: members can have payment records
    // referencing them (payments.member_id -> members.id, RESTRICT),
    // so we never hard-delete from here. Setting deleted_at keeps
    // payment history intact and is what loadStats() /
    // loadRecentRegistrations() now filter on.
    //
    // Previously this called a `delete_member` RPC that hard-deleted
    // the row. That was inconsistent with admin-members.js's soft
    // delete and is why counts/lists could disagree between the two
    // pages. Now both pages agree on one mechanism.
    // ========================================================

    async function deleteMember(
        id,
        name,
        triggerBtn
    ) {

        if (!id) {
            return;
        }


        const confirmed =
            window.confirm(
                `Delete ${
                    name ||
                    "this member"
                }? They'll be removed from the list, but their ` +
                `payment history is kept.`
            );


        if (!confirmed) {
            return;
        }


        if (triggerBtn) {

            triggerBtn.disabled = true;

            triggerBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i>';

        }


        try {

            const {
                error
            } =
                await supabaseClient
                    .from(
                        CONFIG.membersTable
                    )
                    .update({
                        deleted_at: new Date().toISOString()
                    })
                    .eq(
                        "id",
                        id
                    );


            if (error) {
                throw error;
            }


            await Promise.all([
                loadRecentRegistrations(),
                loadStats()
            ]);


        } catch (error) {

            console.error(
                "Failed to delete member:",
                error
            );


            alert(
                "Couldn't delete this member.\n\n" +
                (
                    error?.message ||
                    "Please check your permissions."
                )
            );


            if (triggerBtn) {

                triggerBtn.disabled =
                    false;

                triggerBtn.innerHTML =
                    '<i class="fas fa-trash"></i>';

            }

        }

    }


    window.deleteMember =
        deleteMember;


    // ========================================================
    // RECENT SALES AGENTS (public.sales_agents)
    // ========================================================

    async function loadRecentAgents() {

        const container =
            document.getElementById(
                "pendingAgents"
            );

        if (!container) {
            return;
        }

        renderLoading(
            container
        );


        try {

            let agentsQuery =
                supabaseClient
                    .from(
                        CONFIG.salesAgentsTable
                    )
                    .select(
                        `
                            id,
                            full_name,
                            sales_code,
                            status,
                            created_at,
                            branches(
                                branch_name
                            )
                        `
                    )
                    .order(
                        "created_at",
                        {
                            ascending: false
                        }
                    );

            if (!showAllAgents) {
                agentsQuery =
                    agentsQuery.limit(
                        CONFIG.recentLimit
                    );
            }

            const {
                data,
                error
            } =
                await agentsQuery;


            if (error) {
                throw error;
            }


            if (
                !data ||
                data.length === 0
            ) {

                renderEmpty(
                    container,
                    "No sales agents added yet."
                );

                return;
            }


            container.innerHTML = `
                <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
                    <button
                        type="button"
                        class="btn-sm gray"
                        id="toggleAllAgentsBtn"
                    >
                        <i class="fas ${showAllAgents ? 'fa-compress' : 'fa-list'}"></i>
                        ${showAllAgents ? 'Show recent only' : 'Show all agents'}
                    </button>
                </div>
                <div class="table-wrapper" ${showAllAgents ? 'style="max-height:420px;overflow-y:auto;"' : ''}>

                    <table>

                        <thead>

                            <tr>
                                <th>Agent</th>
                                <th>Sales Code</th>
                                <th>Branch</th>
                                <th>Status</th>
                                <th>Added</th>
                            </tr>

                        </thead>

                        <tbody>

                            ${data.map(
                                agent => {

                                    const branch =
                                        Array.isArray(
                                            agent.branches
                                        )
                                            ? agent.branches[0]
                                            : agent.branches;

                                    return `

                                        <tr>

                                            <td>
                                                ${escapeHtml(
                                                    agent.full_name ||
                                                    "—"
                                                )}
                                            </td>

                                            <td>
                                                <strong>
                                                    ${escapeHtml(
                                                        agent.sales_code ||
                                                        "—"
                                                    )}
                                                </strong>
                                            </td>

                                            <td>
                                                ${escapeHtml(
                                                    branch?.branch_name ||
                                                    "—"
                                                )}
                                            </td>

                                            <td>

                                                <span
                                                    class="status-badge ${statusBadgeClass(agent.status)}"
                                                >
                                                    ${escapeHtml(
                                                        agent.status ||
                                                        "—"
                                                    )}
                                                </span>

                                            </td>

                                            <td>
                                                ${timeAgo(
                                                    agent.created_at
                                                )}
                                            </td>

                                        </tr>

                                    `;

                                }
                            ).join("")}

                        </tbody>

                    </table>

                </div>
            `;

            const toggleBtn =
                document.getElementById(
                    "toggleAllAgentsBtn"
                );

            if (toggleBtn) {
                toggleBtn.addEventListener(
                    "click",
                    () => {
                        showAllAgents = !showAllAgents;
                        loadRecentAgents();
                    }
                );
            }


        } catch (error) {

            console.error(
                "Failed to load recent agents:",
                error
            );

            renderError(
                container,
                "Couldn't load recent agents. " +
                (error?.message ? `(${error.message})` : ""),
                loadRecentAgents
            );

        }

    }


    // ========================================================
    // RECENT PAYMENTS
    // ========================================================

    async function loadRecentPayments() {

        const container =
            document.getElementById(
                "recentPayments"
            );

        if (!container) {
            return;
        }

        renderLoading(
            container
        );


        try {

            const {
                data,
                error
            } =
                await supabaseClient
                    .from(
                        CONFIG.paymentsTable
                    )
                    .select(
                        `
                            id,
                            amount,
                            payment_status,
                            status,
                            created_at,
                            members(
                                full_name,
                                member_number
                            )
                        `
                    )
                    .order(
                        "created_at",
                        {
                            ascending: false
                        }
                    )
                    .limit(
                        CONFIG.recentLimit
                    );


            if (error) {
                throw error;
            }


            if (
                !data ||
                data.length === 0
            ) {

                renderEmpty(
                    container,
                    "No payments recorded yet."
                );

                return;
            }


            container.innerHTML = `
                <div class="table-wrapper">

                    <table>

                        <thead>

                            <tr>
                                <th>Member</th>
                                <th>Membership #</th>
                                <th>Amount</th>
                                <th>Status</th>
                                <th>Date</th>
                            </tr>

                        </thead>

                        <tbody>

                            ${data.map(
                                payment => {

                                    const status =
                                        payment.payment_status ||
                                        payment.status ||
                                        "—";

                                    const member =
                                        payment.members?.full_name ||
                                        "Unassigned";

                                    const membershipNumber =
                                        payment.members?.member_number ||
                                        "—";

                                    return `

                                        <tr>

                                            <td>
                                                ${escapeHtml(
                                                    member
                                                )}
                                            </td>

                                            <td>
                                                <strong>
                                                    ${escapeHtml(
                                                        membershipNumber
                                                    )}
                                                </strong>
                                            </td>

                                            <td>
                                                <strong>
                                                    ${formatKES(
                                                        payment.amount
                                                    )}
                                                </strong>
                                            </td>

                                            <td>

                                                <span
                                                    class="status-badge ${statusBadgeClass(status)}"
                                                >
                                                    ${escapeHtml(
                                                        status
                                                    )}
                                                </span>

                                            </td>

                                            <td>
                                                ${timeAgo(
                                                    payment.created_at
                                                )}
                                            </td>

                                        </tr>

                                    `;

                                }
                            ).join("")}

                        </tbody>

                    </table>

                </div>
            `;


        } catch (error) {

            console.error(
                "Failed to load recent payments:",
                error
            );

            renderError(
                container,
                "Couldn't load recent payments. " +
                (error?.message ? `(${error.message})` : ""),
                loadRecentPayments
            );

        }

    }


    // ========================================================
    // SMALL DOM HELPER
    // ========================================================

    function setText(
        id,
        value
    ) {

        const element =
            document.getElementById(id);

        if (element) {

            element.textContent =
                value;

        }

    }


    // ========================================================
    // MASTER DASHBOARD LOADER
    // ========================================================

    async function loadDashboardData() {

        if (loading) {
            return;
        }

        if (
            typeof supabaseClient === "undefined" ||
            !supabaseClient
        ) {

            console.error(
                "Masika dashboard: supabaseClient is not " +
                "available. Check that supabase-config.js loaded " +
                "successfully and runs before admin-dashboard.js."
            );

            showBootFailure();

            return;
        }


        loading = true;


        try {

            const results = await Promise.allSettled([
                loadStats(),
                loadRecentRegistrations(),
                loadRecentAgents(),
                loadRecentPayments()
            ]);


            const failed = results.filter(
                r => r.status === "rejected"
            );

            if (failed.length > 0) {

                console.error(
                    "Masika dashboard: one or more sections " +
                    "failed to load:",
                    failed.map(f => f.reason)
                );

            } else {

                console.log(
                    "Masika dashboard loaded successfully."
                );

            }


        } catch (error) {

            console.error(
                "Dashboard loading failed:",
                error
            );

        } finally {

            loading = false;

        }

    }


    // ========================================================
    // PUBLIC API
    // ========================================================

    window.loadDashboardData =
        loadDashboardData;


    window.MasikaAdminDashboard = {

        refresh:
            loadDashboardData,

        updateDateTime:
            updateDateTime

    };


})();
