/* ============================================================
   MASIKA BENEVOLENT
   M-RATIBA ADMIN JAVASCRIPT
   ============================================================ */

(() => {
    "use strict";

    /* ----------------------------------------------------------
       CONFIGURATION
       ---------------------------------------------------------- */

    const CONFIG = {
        API_BASE:
            window.MASIKA_API_BASE ||
            window.API_BASE ||
            "https://masika-c921.onrender.com",

        LIST_ENDPOINT: "/api/admin/mratiba",

        DEFAULT_LIMIT: 100,

        REFRESH_INTERVAL: 60000
    };


    /* ----------------------------------------------------------
       STATE
       ---------------------------------------------------------- */

    const state = {
        mandates: [],
        filtered: [],
        selectedMandate: null,
        loading: false,
        filter: "all",
        search: "",
        refreshTimer: null
    };


    /* ----------------------------------------------------------
       DOM HELPERS
       ---------------------------------------------------------- */

    function $(selector) {
        return document.querySelector(selector);
    }

    function $all(selector) {
        return Array.from(document.querySelectorAll(selector));
    }


    /* ----------------------------------------------------------
       AUTH / SESSION
       ---------------------------------------------------------- */

    async function getAccessToken() {
        /*
         * Prefer the existing Supabase client if the admin page
         * has already initialized it.
         */

        try {
            if (
                window.supabaseClient &&
                window.supabaseClient.auth &&
                typeof window.supabaseClient.auth.getSession === "function"
            ) {
                const { data, error } =
                    await window.supabaseClient.auth.getSession();

                if (!error && data && data.session) {
                    return data.session.access_token;
                }
            }
        } catch (error) {
            console.warn("Supabase session lookup failed:", error);
        }

        /*
         * Some existing Masika pages expose a Supabase client
         * as `supabase`.
         */

        try {
            if (
                window.supabase &&
                window.supabase.auth &&
                typeof window.supabase.auth.getSession === "function"
            ) {
                const { data, error } =
                    await window.supabase.auth.getSession();

                if (!error && data && data.session) {
                    return data.session.access_token;
                }
            }
        } catch (error) {
            console.warn("Supabase session lookup failed:", error);
        }

        /*
         * Fallback for pages which store the token directly.
         */

        const possibleKeys = [
            "masika_access_token",
            "access_token",
            "supabase_access_token",
            "token"
        ];

        for (const key of possibleKeys) {
            const token = localStorage.getItem(key);

            if (token) {
                return token;
            }
        }

        /*
         * Some pages store the complete session object.
         */

        const sessionKeys = [
            "masika_session",
            "supabase_session",
            "session"
        ];

        for (const key of sessionKeys) {
            const stored = localStorage.getItem(key);

            if (!stored) continue;

            try {
                const parsed = JSON.parse(stored);

                if (parsed?.access_token) {
                    return parsed.access_token;
                }

                if (parsed?.session?.access_token) {
                    return parsed.session.access_token;
                }
            } catch (_) {
                // Ignore malformed local storage values.
            }
        }

        return null;
    }


    /* ----------------------------------------------------------
       API REQUEST
       ---------------------------------------------------------- */

    async function apiRequest(endpoint, options = {}) {
        const token = await getAccessToken();

        const headers = {
            Accept: "application/json",
            ...(options.body
                ? { "Content-Type": "application/json" }
                : {}),
            ...(options.headers || {})
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch(
            `${CONFIG.API_BASE}${endpoint}`,
            {
                ...options,
                headers,
                credentials: "include"
            }
        );

        /*
         * Try to read JSON regardless of HTTP status.
         */

        let payload = null;

        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }

        if (!response.ok) {
            const message =
                payload?.detail ||
                payload?.message ||
                payload?.error ||
                `Request failed with HTTP ${response.status}`;

            const error = new Error(message);
            error.status = response.status;
            error.payload = payload;

            throw error;
        }

        return payload;
    }


    /* ----------------------------------------------------------
       UI NOTIFICATIONS
       ---------------------------------------------------------- */

    function notify(message, type = "info") {
        /*
         * Use an existing toast system if the admin page already
         * provides one.
         */

        if (typeof window.showToast === "function") {
            window.showToast(message, type);
            return;
        }

        if (typeof window.toast === "function") {
            window.toast(message, type);
            return;
        }

        /*
         * Otherwise create a lightweight notification.
         */

        let container = document.getElementById(
            "mratibaToastContainer"
        );

        if (!container) {
            container = document.createElement("div");
            container.id = "mratibaToastContainer";

            Object.assign(container.style, {
                position: "fixed",
                top: "20px",
                right: "20px",
                zIndex: "99999",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                maxWidth: "380px"
            });

            document.body.appendChild(container);
        }

        const toast = document.createElement("div");

        Object.assign(toast.style, {
            padding: "12px 16px",
            borderRadius: "10px",
            background:
                type === "error"
                    ? "#7f1d1d"
                    : type === "success"
                    ? "#166534"
                    : "#12304f",
            color: "#fff",
            boxShadow: "0 8px 25px rgba(0,0,0,.25)",
            fontSize: "14px",
            lineHeight: "1.4"
        });

        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 4500);
    }


    /* ----------------------------------------------------------
       FORMATTING
       ---------------------------------------------------------- */

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }


    function formatMoney(value) {
        const amount = Number(value || 0);

        return new Intl.NumberFormat("en-KE", {
            style: "currency",
            currency: "KES",
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(amount);
    }


    function formatDate(value) {
        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return escapeHtml(value);
        }

        return new Intl.DateTimeFormat("en-KE", {
            year: "numeric",
            month: "short",
            day: "2-digit"
        }).format(date);
    }


    function formatDateTime(value) {
        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return escapeHtml(value);
        }

        return new Intl.DateTimeFormat("en-KE", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }


    function titleCase(value) {
        return String(value || "")
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, char => char.toUpperCase());
    }


    /* ----------------------------------------------------------
       STATUS
       ---------------------------------------------------------- */

    function statusLabel(status) {
        return titleCase(status || "unknown");
    }


    function statusClass(status) {
        switch (String(status || "").toLowerCase()) {
            case "active":
                return "active";

            case "pending":
                return "pending";

            case "paused":
                return "paused";

            case "cancelled":
                return "cancelled";

            case "failed":
                return "failed";

            default:
                return "unknown";
        }
    }


    function collectionStatusClass(status) {
        switch (String(status || "").toLowerCase()) {
            case "paid":
                return "paid";

            case "processing":
                return "processing";

            case "scheduled":
                return "scheduled";

            case "failed":
                return "failed";

            case "cancelled":
                return "cancelled";

            case "skipped":
                return "skipped";

            default:
                return "unknown";
        }
    }


    function statusBadge(status, collection = false) {
        const cls = collection
            ? collectionStatusClass(status)
            : statusClass(status);

        return `
            <span class="mratiba-status mratiba-status-${cls}">
                ${escapeHtml(
                    collection
                        ? titleCase(status)
                        : statusLabel(status)
                )}
            </span>
        `;
    }


    /* ----------------------------------------------------------
       LOAD MANDATES
       ---------------------------------------------------------- */

    async function loadMandates() {
        if (state.loading) {
            return;
        }

        state.loading = true;

        setLoadingState(true);

        try {
            const params = new URLSearchParams();

            params.set(
                "limit",
                String(CONFIG.DEFAULT_LIMIT)
            );

            if (
                state.filter &&
                state.filter !== "all"
            ) {
                params.set(
                    "status_filter",
                    state.filter
                );
            }

            const result = await apiRequest(
                `${CONFIG.LIST_ENDPOINT}?${params.toString()}`
            );

            state.mandates = Array.isArray(result?.data)
                ? result.data
                : [];

            applyFilters();

            updateSummary();

            updateLastRefresh();

        } catch (error) {
            console.error(
                "Failed to load M-Ratiba mandates:",
                error
            );

            if (error.status === 401) {
                notify(
                    "Your session has expired. Please sign in again.",
                    "error"
                );
            } else if (error.status === 403) {
                notify(
                    "You are not authorized to access M-Ratiba.",
                    "error"
                );
            } else {
                notify(
                    error.message ||
                    "Could not load M-Ratiba records.",
                    "error"
                );
            }

            renderError(error.message);

        } finally {
            state.loading = false;
            setLoadingState(false);
        }
    }


    /* ----------------------------------------------------------
       FILTERING
       ---------------------------------------------------------- */

    function applyFilters() {
        const search = state.search.trim().toLowerCase();

        state.filtered = state.mandates.filter(mandate => {
            if (
                state.filter !== "all" &&
                String(
                    mandate.authorization_status || ""
                ).toLowerCase() !== state.filter
            ) {
                return false;
            }

            if (!search) {
                return true;
            }

            const haystack = [
                mandate.member_number,
                mandate.phone_number,
                mandate.plan_code,
                mandate.custom_sto_id,
                mandate.provider_reference,
                mandate.last_mpesa_receipt,
                mandate.authorization_status
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return haystack.includes(search);
        });

        renderMandates();
    }


    /* ----------------------------------------------------------
       SUMMARY
       ---------------------------------------------------------- */

    function updateSummary() {
        const records = state.mandates;

        const counts = {
            total: records.length,
            active: 0,
            pending: 0,
            paused: 0,
            failed: 0,
            cancelled: 0
        };

        records.forEach(item => {
            const status = String(
                item.authorization_status || ""
            ).toLowerCase();

            if (Object.prototype.hasOwnProperty.call(counts, status)) {
                counts[status]++;
            }
        });

        setText(
            [
                "#mratibaTotal",
                "#mratibaTotalCount",
                "[data-mratiba-count='total']"
            ],
            counts.total
        );

        setText(
            [
                "#mratibaActive",
                "#mratibaActiveCount",
                "[data-mratiba-count='active']"
            ],
            counts.active
        );

        setText(
            [
                "#mratibaPending",
                "#mratibaPendingCount",
                "[data-mratiba-count='pending']"
            ],
            counts.pending
        );

        setText(
            [
                "#mratibaPaused",
                "#mratibaPausedCount",
                "[data-mratiba-count='paused']"
            ],
            counts.paused
        );

        setText(
            [
                "#mratibaFailed",
                "#mratibaFailedCount",
                "[data-mratiba-count='failed']"
            ],
            counts.failed
        );

        setText(
            [
                "#mratibaCancelled",
                "#mratibaCancelledCount",
                "[data-mratiba-count='cancelled']"
            ],
            counts.cancelled
        );
    }


    function setText(selectors, value) {
        for (const selector of selectors) {
            const element = $(selector);

            if (element) {
                element.textContent = String(value);
            }
        }
    }


    /* ----------------------------------------------------------
       RENDER TABLE
       ---------------------------------------------------------- */

    function renderMandates() {
        const tbody =
            $("#mratibaTableBody") ||
            $("#mratibaBody") ||
            document.querySelector(
                "[data-mratiba-table-body]"
            );

        if (!tbody) {
            console.warn(
                "M-Ratiba table body not found."
            );
            return;
        }

        if (!state.filtered.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="mratiba-empty">
                        <div class="mratiba-empty-state">
                            <div class="mratiba-empty-icon">₿</div>
                            <strong>No M-Ratiba records found</strong>
                            <span>
                                There are no records matching the
                                current filter.
                            </span>
                        </div>
                    </td>
                </tr>
            `;

            updateVisibleCount(0);

            return;
        }

        tbody.innerHTML = state.filtered
            .map((mandate, index) => {
                const memberNumber =
                    mandate.member_number ||
                    "—";

                const amount =
                    mandate.monthly_amount ||
                    0;

                const nextDate =
                    mandate.next_collection_date;

                const status =
                    mandate.authorization_status ||
                    "unknown";

                const failureCount =
                    Number(
                        mandate.failure_count || 0
                    );

                return `
                    <tr
                        data-mratiba-row="${escapeHtml(
                            mandate.id
                        )}"
                    >
                        <td>
                            <strong>
                                ${escapeHtml(memberNumber)}
                            </strong>
                        </td>

                        <td>
                            ${escapeHtml(
                                mandate.phone_number || "—"
                            )}
                        </td>

                        <td>
                            ${escapeHtml(
                                mandate.plan_code || "—"
                            )}
                        </td>

                        <td>
                            <strong>
                                ${formatMoney(amount)}
                            </strong>
                        </td>

                        <td>
                            ${nextDate
                                ? formatDate(nextDate)
                                : "—"}
                        </td>

                        <td>
                            ${statusBadge(status)}
                        </td>

                        <td>
                            ${
                                failureCount > 0
                                    ? `
                                        <span
                                            class="mratiba-failure-count"
                                            title="Failed collection attempts"
                                        >
                                            ${failureCount}
                                        </span>
                                    `
                                    : "0"
                            }
                        </td>

                        <td>
                            ${formatDate(
                                mandate.created_at
                            )}
                        </td>

                        <td class="mratiba-actions">
                            <button
                                type="button"
                                class="mratiba-btn mratiba-btn-view"
                                data-action="view"
                                data-id="${escapeHtml(
                                    mandate.id
                                )}"
                            >
                                View
                            </button>
                        </td>
                    </tr>
                `;
            })
            .join("");

        updateVisibleCount(
            state.filtered.length
        );
    }


    function updateVisibleCount(count) {
        setText(
            [
                "#mratibaVisibleCount",
                "[data-mratiba-visible-count]"
            ],
            count
        );
    }


    /* ----------------------------------------------------------
       MANDATE DETAIL
       ---------------------------------------------------------- */

    async function viewMandate(mandateId) {
        if (!mandateId) return;

        openDetailLoading();

        try {
            const result = await apiRequest(
                `${CONFIG.LIST_ENDPOINT}/${encodeURIComponent(
                    mandateId
                )}`
            );

            state.selectedMandate =
                result?.mandate || null;

            renderMandateDetail(
                result?.mandate || {},
                Array.isArray(result?.collections)
                    ? result.collections
                    : []
            );

            openDetailModal();

        } catch (error) {
            console.error(
                "Failed to load M-Ratiba detail:",
                error
            );

            notify(
                error.message ||
                "Could not load M-Ratiba details.",
                "error"
            );

            closeDetailModal();
        }
    }


    function openDetailLoading() {
        const modal =
            $("#mratibaDetailModal") ||
            $("#mratibaModal");

        if (!modal) return;

        modal.classList.add("open");
        modal.classList.add("active");
        modal.removeAttribute("hidden");

        const body =
            modal.querySelector(
                "[data-mratiba-detail-body]"
            ) ||
            $("#mratibaDetailBody");

        if (body) {
            body.innerHTML = `
                <div class="mratiba-loading">
                    Loading M-Ratiba details...
                </div>
            `;
        }
    }


    function openDetailModal() {
        const modal =
            $("#mratibaDetailModal") ||
            $("#mratibaModal");

        if (!modal) return;

        modal.classList.add("open");
        modal.classList.add("active");
        modal.removeAttribute("hidden");

        document.body.classList.add(
            "mratiba-modal-open"
        );
    }


    function closeDetailModal() {
        const modal =
            $("#mratibaDetailModal") ||
            $("#mratibaModal");

        if (!modal) return;

        modal.classList.remove("open");
        modal.classList.remove("active");
        modal.setAttribute("hidden", "hidden");

        document.body.classList.remove(
            "mratiba-modal-open"
        );
    }


    /* ----------------------------------------------------------
       DETAIL RENDERING
       ---------------------------------------------------------- */

    function renderMandateDetail(
        mandate,
        collections
    ) {
        const body =
            document.querySelector(
                "[data-mratiba-detail-body]"
            ) ||
            $("#mratibaDetailBody");

        if (!body) {
            return;
        }

        const status =
            mandate.authorization_status ||
            "unknown";

        const memberNumber =
            mandate.member_number ||
            findMemberNumber(mandate.member_id) ||
            "—";

        body.innerHTML = `
            <div class="mratiba-detail">

                <div class="mratiba-detail-header">

                    <div>
                        <div class="mratiba-detail-kicker">
                            M-Ratiba Standing Order
                        </div>

                        <h2>
                            ${escapeHtml(memberNumber)}
                        </h2>

                        <p>
                            ${escapeHtml(
                                mandate.phone_number || "No phone number"
                            )}
                        </p>
                    </div>

                    <div>
                        ${statusBadge(status)}
                    </div>

                </div>


                <div class="mratiba-detail-grid">

                    <div class="mratiba-detail-card">
                        <span>Monthly Amount</span>
                        <strong>
                            ${formatMoney(
                                mandate.monthly_amount
                            )}
                        </strong>
                    </div>

                    <div class="mratiba-detail-card">
                        <span>Plan</span>
                        <strong>
                            ${escapeHtml(
                                mandate.plan_code || "—"
                            )}
                        </strong>
                    </div>

                    <div class="mratiba-detail-card">
                        <span>Next Collection</span>
                        <strong>
                            ${
                                mandate.next_collection_date
                                    ? formatDate(
                                        mandate.next_collection_date
                                    )
                                    : "—"
                            }
                        </strong>
                    </div>

                    <div class="mratiba-detail-card">
                        <span>Last Collection</span>
                        <strong>
                            ${
                                mandate.last_collection_date
                                    ? formatDate(
                                        mandate.last_collection_date
                                    )
                                    : "—"
                            }
                        </strong>
                    </div>

                </div>


                <div class="mratiba-detail-section">

                    <h3>Authorization</h3>

                    <dl class="mratiba-meta">

                        <div>
                            <dt>Mandate ID</dt>
                            <dd>
                                ${escapeHtml(
                                    mandate.id || "—"
                                )}
                            </dd>
                        </div>

                        <div>
                            <dt>Custom STO ID</dt>
                            <dd>
                                ${escapeHtml(
                                    mandate.custom_sto_id || "—"
                                )}
                            </dd>
                        </div>

                        <div>
                            <dt>Provider Reference</dt>
                            <dd>
                                ${escapeHtml(
                                    mandate.provider_reference || "—"
                                )}
                            </dd>
                        </div>

                        <div>
                            <dt>Provider</dt>
                            <dd>
                                ${escapeHtml(
                                    mandate.provider || "mpesa"
                                )}
                            </dd>
                        </div>

                        <div>
                            <dt>Start Date</dt>
                            <dd>
                                ${
                                    mandate.start_date
                                        ? formatDate(
                                            mandate.start_date
                                        )
                                        : "—"
                                }
                            </dd>
                        </div>

                        <div>
                            <dt>End Date</dt>
                            <dd>
                                ${
                                    mandate.end_date
                                        ? formatDate(
                                            mandate.end_date
                                        )
                                        : "—"
                                }
                            </dd>
                        </div>

                        <div>
                            <dt>Authorized At</dt>
                            <dd>
                                ${
                                    mandate.authorized_at
                                        ? formatDateTime(
                                            mandate.authorized_at
                                        )
                                        : "—"
                                }
                            </dd>
                        </div>

                        <div>
                            <dt>Created</dt>
                            <dd>
                                ${
                                    mandate.created_at
                                        ? formatDateTime(
                                            mandate.created_at
                                        )
                                        : "—"
                                }
                            </dd>
                        </div>

                    </dl>

                </div>


                <div class="mratiba-detail-section">

                    <h3>Collection History</h3>

                    ${renderCollections(
                        collections
                    )}

                </div>


                <div class="mratiba-detail-section">

                    <h3>Failure Information</h3>

                    <dl class="mratiba-meta">

                        <div>
                            <dt>Failure Count</dt>
                            <dd>
                                ${Number(
                                    mandate.failure_count || 0
                                )}
                            </dd>
                        </div>

                        <div>
                            <dt>Last Failure</dt>
                            <dd>
                                ${escapeHtml(
                                    mandate.last_failure_reason ||
                                    "No recorded failure"
                                )}
                            </dd>
                        </div>

                        <div>
                            <dt>Last M-Pesa Receipt</dt>
                            <dd>
                                ${escapeHtml(
                                    mandate.last_mpesa_receipt ||
                                    "—"
                                )}
                            </dd>
                        </div>

                        <div>
                            <dt>Last Transaction</dt>
                            <dd>
                                ${escapeHtml(
                                    mandate.last_transaction_id ||
                                    "—"
                                )}
                            </dd>
                        </div>

                    </dl>

                </div>

            </div>
        `;
    }


    function findMemberNumber(memberId) {
        if (!memberId) return null;

        const found =
            state.mandates.find(
                item =>
                    String(item.member_id) ===
                    String(memberId)
            );

        return found?.member_number || null;
    }


    /* ----------------------------------------------------------
       COLLECTION HISTORY
       ---------------------------------------------------------- */

    function renderCollections(collections) {
        if (!collections.length) {
            return `
                <div class="mratiba-empty-state small">
                    <strong>No collections yet</strong>
                    <span>
                        No M-Ratiba collection records have
                        been created for this mandate.
                    </span>
                </div>
            `;
        }

        const sorted = [...collections].sort(
            (a, b) =>
                new Date(
                    b.due_date || b.created_at || 0
                ) -
                new Date(
                    a.due_date || a.created_at || 0
                )
        );

        return `
            <div class="mratiba-collections-wrap">

                <table class="mratiba-collections-table">

                    <thead>
                        <tr>
                            <th>Due Date</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Attempted</th>
                            <th>Paid</th>
                            <th>M-Pesa Receipt</th>
                            <th>Failure</th>
                        </tr>
                    </thead>

                    <tbody>

                        ${sorted
                            .map(item => `
                                <tr>

                                    <td>
                                        ${formatDate(
                                            item.due_date
                                        )}
                                    </td>

                                    <td>
                                        <strong>
                                            ${formatMoney(
                                                item.amount
                                            )}
                                        </strong>
                                    </td>

                                    <td>
                                        ${statusBadge(
                                            item.status,
                                            true
                                        )}
                                    </td>

                                    <td>
                                        ${
                                            item.attempted_at
                                                ? formatDateTime(
                                                    item.attempted_at
                                                )
                                                : "—"
                                        }
                                    </td>

                                    <td>
                                        ${
                                            item.paid_at
                                                ? formatDateTime(
                                                    item.paid_at
                                                )
                                                : "—"
                                        }
                                    </td>

                                    <td>
                                        ${escapeHtml(
                                            item.mpesa_receipt ||
                                            "—"
                                        )}
                                    </td>

                                    <td>
                                        ${
                                            item.failure_reason
                                                ? escapeHtml(
                                                    item.failure_reason
                                                )
                                                : "—"
                                        }
                                    </td>

                                </tr>
                            `)
                            .join("")}

                    </tbody>

                </table>

            </div>
        `;
    }


    /* ----------------------------------------------------------
       LOADING STATE
       ---------------------------------------------------------- */

    function setLoadingState(loading) {
        const buttons = $all(
            "[data-mratiba-refresh], #mratibaRefreshBtn"
        );

        buttons.forEach(button => {
            button.disabled = loading;

            const original =
                button.dataset.originalText ||
                button.textContent.trim();

            if (!button.dataset.originalText) {
                button.dataset.originalText =
                    original;
            }

            button.textContent = loading
                ? "Loading..."
                : button.dataset.originalText;
        });

        const table =
            $("#mratibaTableBody") ||
            $("#mratibaBody");

        if (
            loading &&
            table &&
            !state.filtered.length
        ) {
            table.innerHTML = `
                <tr>
                    <td colspan="9">
                        <div class="mratiba-loading">
                            Loading M-Ratiba records...
                        </div>
                    </td>
                </tr>
            `;
        }
    }


    function renderError(message) {
        const tbody =
            $("#mratibaTableBody") ||
            $("#mratibaBody");

        if (!tbody) return;

        tbody.innerHTML = `
            <tr>
                <td colspan="9">
                    <div class="mratiba-empty-state error">
                        <strong>
                            Unable to load M-Ratiba
                        </strong>

                        <span>
                            ${escapeHtml(
                                message ||
                                "Please try again."
                            )}
                        </span>

                        <button
                            type="button"
                            class="mratiba-btn"
                            data-mratiba-refresh
                        >
                            Try Again
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }


    /* ----------------------------------------------------------
       REFRESH INFORMATION
       ---------------------------------------------------------- */

    function updateLastRefresh() {
        const elements = [
            "#mratibaLastRefresh",
            "[data-mratiba-last-refresh]"
        ];

        const value =
            new Intl.DateTimeFormat("en-KE", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            }).format(new Date());

        elements.forEach(selector => {
            const element = $(selector);

            if (element) {
                element.textContent =
                    `Last updated ${value}`;
            }
        });
    }


    /* ----------------------------------------------------------
       SEARCH
       ---------------------------------------------------------- */

    function handleSearch(event) {
        state.search =
            event.target.value || "";

        applyFilters();
    }


    /* ----------------------------------------------------------
       STATUS FILTER
       ---------------------------------------------------------- */

    function handleStatusFilter(event) {
        state.filter =
            String(
                event.target.value || "all"
            ).toLowerCase();

        loadMandates();
    }


    /* ----------------------------------------------------------
       EVENT DELEGATION
       ---------------------------------------------------------- */

    function handleDocumentClick(event) {
        const viewButton =
            event.target.closest(
                "[data-action='view']"
            );

        if (viewButton) {
            event.preventDefault();

            const id =
                viewButton.dataset.id;

            viewMandate(id);

            return;
        }

        const refreshButton =
            event.target.closest(
                "[data-mratiba-refresh], #mratibaRefreshBtn"
            );

        if (refreshButton) {
            event.preventDefault();

            loadMandates();

            return;
        }

        const closeButton =
            event.target.closest(
                "[data-mratiba-close], #mratibaCloseBtn"
            );

        if (closeButton) {
            event.preventDefault();

            closeDetailModal();

            return;
        }

        const modal =
            $("#mratibaDetailModal") ||
            $("#mratibaModal");

        if (
            modal &&
            event.target === modal
        ) {
            closeDetailModal();
        }
    }


    /* ----------------------------------------------------------
       KEYBOARD
       ---------------------------------------------------------- */

    function handleKeyboard(event) {
        if (event.key === "Escape") {
            closeDetailModal();
        }
    }


    /* ----------------------------------------------------------
       INITIALIZE CONTROLS
       ---------------------------------------------------------- */

    function bindControls() {
        const searchInput =
            $("#mratibaSearch") ||
            document.querySelector(
                "[data-mratiba-search]"
            );

        if (searchInput) {
            searchInput.addEventListener(
                "input",
                handleSearch
            );
        }

        const statusFilter =
            $("#mratibaStatusFilter") ||
            document.querySelector(
                "[data-mratiba-status-filter]"
            );

        if (statusFilter) {
            statusFilter.addEventListener(
                "change",
                handleStatusFilter
            );
        }

        document.addEventListener(
            "click",
            handleDocumentClick
        );

        document.addEventListener(
            "keydown",
            handleKeyboard
        );
    }


    /* ----------------------------------------------------------
       AUTO REFRESH
       ---------------------------------------------------------- */

    function startAutoRefresh() {
        if (state.refreshTimer) {
            clearInterval(
                state.refreshTimer
            );
        }

        state.refreshTimer =
            setInterval(
                () => {
                    /*
                     * Do not interrupt the user while viewing
                     * a detail modal.
                     */

                    const modal =
                        $("#mratibaDetailModal") ||
                        $("#mratibaModal");

                    const modalOpen =
                        modal &&
                        (
                            modal.classList.contains("open") ||
                            modal.classList.contains("active")
                        );

                    if (!modalOpen) {
                        loadMandates();
                    }
                },
                CONFIG.REFRESH_INTERVAL
            );
    }


    /* ----------------------------------------------------------
       PUBLIC API
       ---------------------------------------------------------- */

    window.MRatiba = {
        load: loadMandates,

        refresh: loadMandates,

        view: viewMandate,

        close: closeDetailModal,

        getState: () => ({
            ...state,
            mandates: [...state.mandates],
            filtered: [...state.filtered]
        })
    };


    /* ----------------------------------------------------------
       INITIALIZATION
       ---------------------------------------------------------- */

    async function init() {
        /*
         * Only initialize if this page actually contains an
         * M-Ratiba interface.
         */

        const hasRatibaUI =
            document.querySelector(
                "#mratibaTableBody, #mratibaBody, [data-mratiba-table-body]"
            );

        if (!hasRatibaUI) {
            return;
        }

        bindControls();

        await loadMandates();

        startAutoRefresh();

        console.log(
            "✅ Masika M-Ratiba module initialized"
        );
    }


    if (
        document.readyState === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            init,
            { once: true }
        );
    } else {
        init();
    }

})();
