/**
 * ================================================================
 * MASIKA BENEVOLENT — ADMIN REVENUE
 * ================================================================
 *
 * Powers:
 *   • Today's Revenue
 *   • Monthly Revenue
 *   • Total Revenue
 *   • Unassigned Payments
 *   • Realtime payment updates
 *   • Payment-to-member assignment
 *
 * ================================================================
 * DATABASE
 * ================================================================
 *
 * payments
 * ├── id
 * ├── amount
 * ├── payment_status
 * ├── status
 * ├── verified_at
 * ├── created_at
 * ├── member_id
 * ├── account_reference
 * ├── phone_number
 * ├── mpesa_receipt
 * └── mpesa_receipt_number
 *
 * members
 * ├── id
 * └── member_number
 *
 * IMPORTANT:
 *
 * member_number is the ONE AND ONLY membership-number field.
 *
 * member_id is the UUID foreign key linking payments.member_id
 * to members.id.
 *
 * DO NOT use membership_number anywhere in this file.
 *
 * ================================================================
 */

(function () {

    "use strict";


    // ============================================================
    // CONFIGURATION
    // ============================================================

    const CONFIG = {

        table: "payments",

        membersTable: "members",

        columns: {

            id: "id",

            amount: "amount",

            paymentStatus: "payment_status",

            status: "status",

            verifiedAt: "verified_at",

            createdAt: "created_at",

            memberId: "member_id",

            accountRef: "account_reference",

            phone: "phone_number",

            /*
             * Original M-Pesa receipt field.
             */
            mpesaCode: "mpesa_receipt",

            /*
             * New / additional M-Pesa receipt field.
             */
            mpesaReceiptNumber: "mpesa_receipt_number"

        },


        /*
         * ========================================================
         * SINGLE SOURCE OF TRUTH
         * ========================================================
         *
         * members.member_number
         */
        memberNumberColumn: "member_number",


        /*
         * Kenya timezone
         */
        timezone: "Africa/Nairobi",


        /*
         * Realtime debounce
         */
        realtimeDebounceMs: 600,


        /*
         * Safety refresh
         */
        refreshIntervalMs: 60000,


        /*
         * Maximum successful payment rows fetched
         * for revenue calculations.
         */
        maxRevenueRows: 20000,


        /*
         * Maximum unassigned payments displayed.
         */
        maxUnassignedRows: 200

    };


    // ============================================================
    // STATE
    // ============================================================

    let supabase = null;

    let refreshTimer = null;

    let refreshIntervalTimer = null;

    let realtimeChannel = null;

    let initialized = false;


    // ============================================================
    // SUCCESS STATUS DEFINITIONS
    // ============================================================

    const SUCCESS_STATUSES = new Set([

        "SUCCESS",

        "SUCCESSFUL",

        "COMPLETED",

        "COMPLETE",

        "PAID",

        "VERIFIED",

        "CONFIRMED"

    ]);


    // ============================================================
    // FORMAT KES
    // ============================================================

    function formatKES(value) {

        const amount =
            Number(value) || 0;


        return "KES " +
            amount.toLocaleString(
                "en-KE",
                {
                    maximumFractionDigits: 0
                }
            );

    }


    // ============================================================
    // SAFE DOM TEXT
    // ============================================================

    function setText(id, text) {

        const element =
            document.getElementById(id);


        if (element) {

            element.textContent =
                text;

        }

    }


    // ============================================================
    // FLASH CARD
    // ============================================================

    function flashCard(id) {

        const element =
            document.getElementById(id);


        if (!element) {

            return;

        }


        element.classList.remove(
            "flash"
        );


        /*
         * Force browser reflow so the
         * animation can restart.
         */
        void element.offsetWidth;


        element.classList.add(
            "flash"
        );

    }


    // ============================================================
    // LIVE INDICATOR
    // ============================================================

    function setLiveIndicator(
        state,
        label
    ) {

        const element =
            document.getElementById(
                "liveIndicator"
            );


        const labelElement =
            document.getElementById(
                "liveIndicatorLabel"
            );


        if (!element) {

            return;

        }


        element.classList.remove(

            "connected",

            "error"

        );


        if (
            state ===
            "connected"
        ) {

            element.classList.add(
                "connected"
            );

        }


        if (
            state ===
            "error"
        ) {

            element.classList.add(
                "error"
            );

        }


        if (labelElement) {

            labelElement.textContent =
                label;

        }

    }


    // ============================================================
    // ESCAPE HTML
    // ============================================================

    function escapeHtml(value) {

        if (

            value === null ||

            value === undefined

        ) {

            return "";

        }


        const div =
            document.createElement(
                "div"
            );


        div.textContent =
            String(value);


        return div.innerHTML;

    }


    // ============================================================
    // WAIT FOR SUPABASE CLIENT
    // ============================================================

    async function waitForSupabaseClient(
        timeoutMs = 10000
    ) {

        const start =
            Date.now();


        while (

            typeof window.supabaseClient ===
                "undefined" ||

            !window.supabaseClient

        ) {

            if (

                Date.now() - start >
                timeoutMs

            ) {

                throw new Error(
                    "supabaseClient was never initialized. Check supabase-config.js."
                );

            }


            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        100
                    )
            );

        }


        return window.supabaseClient;

    }


    // ============================================================
    // NORMALIZE STATUS
    // ============================================================

    function normalizeStatus(value) {

        return String(
            value || ""
        )
            .trim()
            .toUpperCase();

    }


    // ============================================================
    // IS SUCCESSFUL PAYMENT?
    // ============================================================

    function isSuccessfulPayment(row) {

        const paymentStatus =
            normalizeStatus(

                row[
                    CONFIG.columns.paymentStatus
                ]

            );


        const status =
            normalizeStatus(

                row[
                    CONFIG.columns.status
                ]

            );


        return (

            SUCCESS_STATUSES.has(
                paymentStatus
            )

            ||

            SUCCESS_STATUSES.has(
                status
            )

        );

    }


    // ============================================================
    // GET KENYA TIME BOUNDS
    // ============================================================
    //
    // Kenya uses UTC+3 and does not observe DST.
    //
    // Returns:
    //   startOfToday
    //   startOfMonth
    //
    // Both are ISO UTC timestamps.
    // ============================================================

    function getEATBounds() {

        const now =
            new Date();


        /*
         * Kenya is UTC+3.
         */
        const eatNow =
            new Date(

                now.getTime() +

                3 * 60 * 60 * 1000

            );


        const year =
            eatNow.getUTCFullYear();


        const month =
            eatNow.getUTCMonth();


        const day =
            eatNow.getUTCDate();


        /*
         * Start of today in Kenya,
         * converted back to UTC.
         */
        const startOfTodayUTC =
            new Date(

                Date.UTC(

                    year,

                    month,

                    day,

                    0,

                    0,

                    0

                )

                -

                3 * 60 * 60 * 1000

            );


        /*
         * Start of current month in Kenya,
         * converted back to UTC.
         */
        const startOfMonthUTC =
            new Date(

                Date.UTC(

                    year,

                    month,

                    1,

                    0,

                    0,

                    0

                )

                -

                3 * 60 * 60 * 1000

            );


        return {

            startOfToday:
                startOfTodayUTC.toISOString(),

            startOfMonth:
                startOfMonthUTC.toISOString()

        };

    }


    // ============================================================
    // GET TRANSACTION DATE
    // ============================================================
    //
    // Prefer verified_at because it represents the time the
    // payment was verified successfully.
    //
    // Fall back to created_at for older records.
    // ============================================================

    function getTransactionDate(row) {

        const c =
            CONFIG.columns;


        return (

            row[c.verifiedAt] ||

            row[c.createdAt] ||

            null

        );

    }


    // ============================================================
    // FETCH REVENUE PAYMENTS
    // ============================================================

    async function fetchAllRevenueRows() {

        const c =
            CONFIG.columns;


        const {

            data,

            error

        } = await supabase

            .from(
                CONFIG.table
            )

            .select(`

                ${c.amount},

                ${c.paymentStatus},

                ${c.status},

                ${c.verifiedAt},

                ${c.createdAt},

                ${c.memberId}

            `)

            .order(

                c.createdAt,

                {
                    ascending: false
                }

            )

            .limit(

                CONFIG.maxRevenueRows

            );


        if (error) {

            throw error;

        }


        return (

            data || []

        ).filter(

            isSuccessfulPayment

        );

    }


    // ============================================================
    // FETCH UNASSIGNED PAYMENTS
    // ============================================================

    async function fetchUnassignedRows() {

        const c =
            CONFIG.columns;


        const {

            data,

            error

        } = await supabase

            .from(
                CONFIG.table
            )

            .select(`

                ${c.id},

                ${c.amount},

                ${c.paymentStatus},

                ${c.status},

                ${c.verifiedAt},

                ${c.createdAt},

                ${c.memberId},

                ${c.accountRef},

                ${c.phone},

                ${c.mpesaCode},

                ${c.mpesaReceiptNumber}

            `)

            .is(

                c.memberId,

                null

            )

            .order(

                c.createdAt,

                {
                    ascending: false
                }

            )

            .limit(

                CONFIG.maxUnassignedRows

            );


        if (error) {

            throw error;

        }


        return (

            data || []

        ).filter(

            isSuccessfulPayment

        );

    }


    // ============================================================
    // COMPUTE REVENUE
    // ============================================================

    function computeRevenue(rows) {

        const c =
            CONFIG.columns;


        const {

            startOfToday,

            startOfMonth

        } = getEATBounds();


        let dailyTotal = 0;

        let dailyCount = 0;

        let monthTotal = 0;

        let monthCount = 0;

        let allTotal = 0;

        let allCount = 0;


        for (
            const row of rows
        ) {

            const amount =
                Number(
                    row[c.amount]
                ) || 0;


            /*
             * Prefer verified_at.
             *
             * Fall back to created_at.
             */
            const transactionDate =
                getTransactionDate(
                    row
                );


            // ----------------------------------------------------
            // ALL-TIME REVENUE
            // ----------------------------------------------------

            allTotal += amount;

            allCount++;


            if (!transactionDate) {

                continue;

            }


            // ----------------------------------------------------
            // CURRENT MONTH
            // ----------------------------------------------------

            if (

                transactionDate >=
                startOfMonth

            ) {

                monthTotal +=
                    amount;

                monthCount++;

            }


            // ----------------------------------------------------
            // TODAY
            // ----------------------------------------------------

            if (

                transactionDate >=
                startOfToday

            ) {

                dailyTotal +=
                    amount;

                dailyCount++;

            }

        }


        return {

            dailyTotal,

            dailyCount,

            monthTotal,

            monthCount,

            allTotal,

            allCount

        };

    }


    // ============================================================
    // RENDER REVENUE
    // ============================================================

    function renderRevenue(stats) {

        // --------------------------------------------------------
        // TODAY
        // --------------------------------------------------------

        setText(

            "dailyRevenue",

            formatKES(
                stats.dailyTotal
            )

        );


        setText(

            "dailyRevenueCount",

            `${stats.dailyCount} payment${
                stats.dailyCount === 1
                    ? ""
                    : "s"
            }`

        );


        // --------------------------------------------------------
        // MONTH
        // --------------------------------------------------------

        const monthLabel =
            new Date().toLocaleString(

                "en-KE",

                {

                    month:
                        "long",

                    timeZone:
                        CONFIG.timezone

                }

            );


        setText(

            "monthRevenueLabel",

            `${monthLabel} Revenue`

        );


        setText(

            "monthRevenue",

            formatKES(
                stats.monthTotal
            )

        );


        setText(

            "monthRevenueCount",

            `${stats.monthCount} payment${
                stats.monthCount === 1
                    ? ""
                    : "s"
            }`

        );


        // --------------------------------------------------------
        // ALL TIME
        // --------------------------------------------------------

        setText(

            "totalRevenue",

            formatKES(
                stats.allTotal
            )

        );


        setText(

            "totalRevenueCount",

            `${stats.allCount} payment${
                stats.allCount === 1
                    ? ""
                    : "s"
            } all-time`

        );


        // --------------------------------------------------------
        // VISUAL UPDATE
        // --------------------------------------------------------

        flashCard(
            "dailyRevenueCard"
        );


        flashCard(
            "monthRevenueCard"
        );


        flashCard(
            "totalRevenueCard"
        );

    }


    // ============================================================
    // RENDER UNASSIGNED PAYMENTS
    // ============================================================

    function renderUnassigned(rows) {

        const c =
            CONFIG.columns;


        const container =
            document.getElementById(
                "unassignedPayments"
            );


        const badge =
            document.getElementById(
                "unassignedBadge"
            );


        const countEl =
            document.getElementById(
                "unassignedCount"
            );


        const amountEl =
            document.getElementById(
                "unassignedAmount"
            );


        // --------------------------------------------------------
        // CALCULATE UNMATCHED AMOUNT
        // --------------------------------------------------------

        const total =
            rows.reduce(

                (sum, row) => {

                    return (

                        sum +

                        (

                            Number(
                                row[c.amount]
                            ) || 0

                        )

                    );

                },

                0

            );


        // --------------------------------------------------------
        // BADGE
        // --------------------------------------------------------

        if (badge) {

            badge.textContent =
                rows.length;

        }


        // --------------------------------------------------------
        // COUNT
        // --------------------------------------------------------

        if (countEl) {

            countEl.textContent =
                rows.length;

        }


        // --------------------------------------------------------
        // AMOUNT
        // --------------------------------------------------------

        if (amountEl) {

            amountEl.textContent =
                `${formatKES(total)} unmatched`;

        }


        flashCard(
            "unassignedRevenueCard"
        );


        if (!container) {

            return;

        }


        // --------------------------------------------------------
        // NO UNMATCHED PAYMENTS
        // --------------------------------------------------------

        if (
            rows.length === 0
        ) {

            container.innerHTML = `

                <div class="empty-state">

                    <i
                        class="fas fa-circle-check"
                        style="
                            color:var(--success);
                            font-size:20px;
                        "
                    ></i>

                    <p style="margin-top:8px;">

                        No unassigned payments —
                        every successful payment
                        is matched to a member.

                    </p>

                </div>

            `;

            return;

        }


        // --------------------------------------------------------
        // BUILD TABLE ROWS
        // --------------------------------------------------------

        const tableRows =

            rows.map(row => {

                // ------------------------------------------------
                // DATE
                // ------------------------------------------------

                const transactionDate =
                    getTransactionDate(
                        row
                    );


                const date =

                    transactionDate

                        ? new Date(

                            transactionDate

                        ).toLocaleString(

                            "en-KE",

                            {

                                day:
                                    "2-digit",

                                month:
                                    "short",

                                year:
                                    "numeric",

                                hour:
                                    "2-digit",

                                minute:
                                    "2-digit",

                                timeZone:
                                    CONFIG.timezone

                            }

                        )

                        : "—";


                // ------------------------------------------------
                // ACCOUNT REFERENCE
                // ------------------------------------------------

                const reference =

                    row[c.accountRef]

                        ? escapeHtml(

                            String(
                                row[c.accountRef]
                            )

                        )

                        : "<em>blank</em>";


                // ------------------------------------------------
                // PHONE
                // ------------------------------------------------

                const phone =

                    row[c.phone]

                        ? escapeHtml(

                            String(
                                row[c.phone]
                            )

                        )

                        : "—";


                // ------------------------------------------------
                // M-PESA RECEIPT
                // ------------------------------------------------
                //
                // Prefer mpesa_receipt_number.
                // Fall back to mpesa_receipt.
                // ------------------------------------------------

                const rawMpesaCode =

                    row[c.mpesaReceiptNumber] ||

                    row[c.mpesaCode] ||

                    null;


                const mpesaCode =

                    rawMpesaCode

                        ? escapeHtml(

                            String(
                                rawMpesaCode
                            )

                        )

                        : "—";


                // ------------------------------------------------
                // AMOUNT
                // ------------------------------------------------

                const amount =
                    formatKES(
                        row[c.amount]
                    );


                // ------------------------------------------------
                // PAYMENT ID
                // ------------------------------------------------

                const paymentId =
                    escapeHtml(
                        row[c.id]
                    );


                return `

                    <tr
                        class="row-mismatch"
                        id="unassigned-row-${paymentId}"
                    >

                        <td>
                            ${date}
                        </td>

                        <td>
                            ${amount}
                        </td>

                        <td>
                            ${reference}
                        </td>

                        <td>
                            ${phone}
                        </td>

                        <td>
                            ${mpesaCode}
                        </td>

                        <td>

                            <button
                                type="button"
                                class="btn-sm gold"
                                onclick="AdminRevenue.assignPayment('${paymentId}')"
                            >

                                <i class="fas fa-link"></i>

                                Assign

                            </button>

                        </td>

                    </tr>

                `;

            })

            .join("");


        // --------------------------------------------------------
        // RENDER TABLE
        // --------------------------------------------------------

        container.innerHTML = `

            <div class="table-wrapper">

                <table>

                    <thead>

                        <tr>

                            <th>Date</th>

                            <th>Amount</th>

                            <th>
                                Reference Entered
                            </th>

                            <th>
                                Phone
                            </th>

                            <th>
                                M-Pesa Code
                            </th>

                            <th>
                                Action
                            </th>

                        </tr>

                    </thead>

                    <tbody>

                        ${tableRows}

                    </tbody>

                </table>

            </div>

        `;

    }


    // ============================================================
    // ASSIGN PAYMENT TO MEMBER
    // ============================================================

    async function assignPayment(
        paymentId
    ) {

        if (!paymentId) {

            return;

        }


        // --------------------------------------------------------
        // ASK FOR MEMBER NUMBER
        // --------------------------------------------------------

        const input =
            window.prompt(

                "Enter the correct member number:"

            );


        if (!input) {

            return;

        }


        const memberNumber =
            input.trim();


        if (!memberNumber) {

            return;

        }


        try {

            // ----------------------------------------------------
            // FIND MEMBER
            // ----------------------------------------------------

            const {

                data: member,

                error: lookupError

            } = await supabase

                .from(
                    CONFIG.membersTable
                )

                .select(`

                    id,

                    member_number

                `)

                .eq(

                    CONFIG.memberNumberColumn,

                    memberNumber

                )

                .maybeSingle();


            if (lookupError) {

                throw lookupError;

            }


            // ----------------------------------------------------
            // MEMBER NOT FOUND
            // ----------------------------------------------------

            if (!member) {

                alert(

                    `No member found with member number "${memberNumber}".`

                );

                return;

            }


            // ----------------------------------------------------
            // UPDATE PAYMENT
            // ----------------------------------------------------

            const {

                error: updateError

            } = await supabase

                .from(
                    CONFIG.table
                )

                .update({

                    [CONFIG.columns.memberId]:
                        member.id

                })

                .eq(

                    CONFIG.columns.id,

                    paymentId

                );


            if (updateError) {

                throw updateError;

            }


            // ----------------------------------------------------
            // REMOVE ROW IMMEDIATELY
            // ----------------------------------------------------

            const row =
                document.getElementById(

                    `unassigned-row-${paymentId}`

                );


            if (row) {

                row.remove();

            }


            // ----------------------------------------------------
            // REFRESH
            // ----------------------------------------------------

            await refreshAll();


            // ----------------------------------------------------
            // SUCCESS
            // ----------------------------------------------------

            alert(

                `Payment successfully assigned to ${member.member_number}.`

            );


        } catch (error) {

            console.error(

                "assignPayment failed:",

                error

            );


            alert(

                "Could not assign this payment.\n\n" +

                (

                    error?.message ||

                    "Please check your permissions and try again."

                )

            );

        }

    }


    // ============================================================
    // REFRESH EVERYTHING
    // ============================================================

    async function refreshAll() {

        if (!supabase) {

            return;

        }


        try {

            const [

                revenueRows,

                unassignedRows

            ] = await Promise.all([

                fetchAllRevenueRows(),

                fetchUnassignedRows()

            ]);


            // ----------------------------------------------------
            // CALCULATE REVENUE
            // ----------------------------------------------------

            const stats =
                computeRevenue(
                    revenueRows
                );


            // ----------------------------------------------------
            // RENDER
            // ----------------------------------------------------

            renderRevenue(
                stats
            );


            renderUnassigned(
                unassignedRows
            );


            // ----------------------------------------------------
            // LIVE STATUS
            // ----------------------------------------------------

            setLiveIndicator(

                "connected",

                "Live"

            );


            // ----------------------------------------------------
            // DEBUG LOG
            // ----------------------------------------------------

            console.log(

                "Masika revenue refreshed:",

                {

                    successfulPayments:
                        revenueRows.length,

                    todayRevenue:
                        stats.dailyTotal,

                    monthRevenue:
                        stats.monthTotal,

                    totalRevenue:
                        stats.allTotal,

                    unassignedPayments:
                        unassignedRows.length

                }

            );


        } catch (error) {

            console.error(

                "AdminRevenue refresh failed:",

                error

            );


            setLiveIndicator(

                "error",

                "Data error"

            );

        }

    }


    // ============================================================
    // DEBOUNCED REFRESH
    // ============================================================

    function scheduleRefresh() {

        clearTimeout(
            refreshTimer
        );


        refreshTimer =

            setTimeout(

                refreshAll,

                CONFIG.realtimeDebounceMs

            );

    }


    // ============================================================
    // REALTIME
    // ============================================================

    function setupRealtime() {

        if (!supabase) {

            return;

        }


        // --------------------------------------------------------
        // REMOVE PREVIOUS CHANNEL
        // --------------------------------------------------------

        if (realtimeChannel) {

            try {

                supabase.removeChannel(
                    realtimeChannel
                );

            } catch (error) {

                console.warn(

                    "Could not remove old realtime channel:",

                    error

                );

            }

        }


        // --------------------------------------------------------
        // CREATE PAYMENT REALTIME CHANNEL
        // --------------------------------------------------------

        realtimeChannel =

            supabase

                .channel(
                    "masika-admin-dashboard-payments"
                )

                .on(

                    "postgres_changes",

                    {

                        event: "*",

                        schema: "public",

                        table:
                            CONFIG.table

                    },

                    payload => {

                        console.log(

                            "Payment database change:",

                            payload.eventType

                        );


                        scheduleRefresh();

                    }

                )

                .subscribe(

                    status => {

                        console.log(

                            "Payment realtime status:",

                            status

                        );


                        // ----------------------------------------
                        // CONNECTED
                        // ----------------------------------------

                        if (

                            status ===
                            "SUBSCRIBED"

                        ) {

                            setLiveIndicator(

                                "connected",

                                "Live"

                            );

                        }


                        // ----------------------------------------
                        // ERROR / TIMEOUT
                        // ----------------------------------------

                        else if (

                            status ===
                                "CHANNEL_ERROR"

                            ||

                            status ===
                                "TIMED_OUT"

                        ) {

                            setLiveIndicator(

                                "error",

                                "Reconnecting…"

                            );

                        }


                        // ----------------------------------------
                        // CLOSED
                        // ----------------------------------------

                        else if (

                            status ===
                            "CLOSED"

                        ) {

                            setLiveIndicator(

                                "error",

                                "Disconnected"

                            );

                        }

                    }

                );


        // --------------------------------------------------------
        // SAFETY REFRESH
        // --------------------------------------------------------
        //
        // Prevent duplicate intervals.
        // --------------------------------------------------------

        if (
            !refreshIntervalTimer
        ) {

            refreshIntervalTimer =

                setInterval(

                    refreshAll,

                    CONFIG.refreshIntervalMs

                );

        }

    }


    // ============================================================
    // INITIALIZATION
    // ============================================================

    async function init() {

        if (initialized) {

            return;

        }


        initialized = true;


        try {

            // ----------------------------------------------------
            // WAIT FOR SUPABASE
            // ----------------------------------------------------

            supabase =

                await waitForSupabaseClient();


            console.log(

                "Masika AdminRevenue initialized."

            );


            // ----------------------------------------------------
            // INITIAL LOAD
            // ----------------------------------------------------

            await refreshAll();


            // ----------------------------------------------------
            // ENABLE REALTIME
            // ----------------------------------------------------

            setupRealtime();


        } catch (error) {

            console.error(

                "AdminRevenue initialization failed:",

                error

            );


            setLiveIndicator(

                "error",

                "Offline"

            );

        }

    }


    // ============================================================
    // PUBLIC API
    // ============================================================

    window.AdminRevenue = {

        refresh:
            refreshAll,

        assignPayment:
            assignPayment

    };


    // ============================================================
    // START
    // ============================================================

    if (

        document.readyState ===
        "loading"

    ) {

        document.addEventListener(

            "DOMContentLoaded",

            init

        );

    }

    else {

        init();

    }


})();
