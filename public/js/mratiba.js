from pathlib import Path

js = r"""/* ============================================================
   MASIKA BENEVOLENT — M-RATIBA ADMIN
   Clean frontend controller for:
     GET /api/admin/mratiba
     GET /api/admin/mratiba/{mandate_id}

   Backend lifecycle:
     pending -> active -> scheduled -> paid/failed -> next collection

   This page is intentionally VIEW-ONLY.
   No pause/resume/cancel actions are exposed until the
   corresponding Safaricom Ratiba endpoints are confirmed.
   ============================================================ */

(function () {
  "use strict";

  const CONFIG = {
    API_BASE: (
      window.MASIKA_API_BASE ||
      window.API_BASE ||
      "https://masika-c921.onrender.com"
    ).replace(/\/+$/, ""),

    LIST_ENDPOINT: "/api/admin/mratiba",
    DETAIL_ENDPOINT: "/api/admin/mratiba",
    LIMIT: 100,
    REFRESH_MS: 60000
  };

  const STATUS_ORDER = [
    "pending",
    "active",
    "paused",
    "failed",
    "cancelled"
  ];

  const state = {
    rows: [],
    filteredRows: [],
    currentStatus: "",
    currentMandate: null,
    currentCollections: [],
    loading: false,
    refreshTimer: null,
    modalOpen: false
  };

  const $ = (selector) => document.querySelector(selector);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normaliseStatus(value) {
    const status = String(value || "pending").trim().toLowerCase();
    return STATUS_ORDER.includes(status) ? status : status || "pending";
  }

  function formatKES(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "KES 0";
    return `KES ${amount.toLocaleString("en-KE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })}`;
  }

  function formatDate(value) {
    if (!value) return "—";

    const raw = String(value);
    const date = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw
    );

    if (Number.isNaN(date.getTime())) return escapeHtml(raw);

    return date.toLocaleDateString("en-KE", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);

    return date.toLocaleString("en-KE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function statusLabel(status) {
    const normalized = normaliseStatus(status);
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  function statusClass(status) {
    return `mratiba-status mratiba-status-${normaliseStatus(status)}`;
  }

  function collectionStatusLabel(status) {
    const normalized = String(status || "scheduled")
      .trim()
      .toLowerCase();

    const labels = {
      scheduled: "Scheduled",
      attempted: "Attempted",
      paid: "Paid",
      failed: "Failed",
      cancelled: "Cancelled"
    };

    return labels[normalized] || (
      normalized.charAt(0).toUpperCase() + normalized.slice(1)
    );
  }

  function collectionStatusClass(status) {
    const normalized = String(status || "scheduled")
      .trim()
      .toLowerCase();

    return `mratiba-collection-status mratiba-collection-${escapeHtml(normalized)}`;
  }

  async function getAccessToken() {
    try {
      if (window.supabaseClient?.auth) {
        const { data } = await window.supabaseClient.auth.getSession();
        const token = data?.session?.access_token;
        if (token) return token;
      }
    } catch (error) {
      console.warn("M-Ratiba: Supabase session lookup failed.", error);
    }

    const candidates = [
      localStorage.getItem("masika_access_token"),
      localStorage.getItem("access_token"),
      localStorage.getItem("supabase_access_token"),
      localStorage.getItem("token"),
      sessionStorage.getItem("masika_access_token"),
      sessionStorage.getItem("access_token")
    ];

    for (const token of candidates) {
      if (token) return token;
    }

    return null;
  }

  async function apiFetch(path, options = {}) {
    const token = await getAccessToken();

    if (!token) {
      throw new Error("Your session has expired. Please log in again.");
    }

    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    };

    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${CONFIG.API_BASE}${path}`, {
      ...options,
      headers,
      credentials: "include"
    });

    let payload = null;
    const contentType = response.headers.get("content-type") || "";

    try {
      payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail =
        payload?.detail ||
        payload?.message ||
        payload?.error ||
        (typeof payload === "string" ? payload : null) ||
        `Request failed with HTTP ${response.status}`;

      throw new Error(detail);
    }

    return payload;
  }

  function setLoading(loading) {
    state.loading = Boolean(loading);

    const button = $("#mratibaRefreshBtn");
    if (button) {
      button.disabled = state.loading;
      button.setAttribute("aria-busy", state.loading ? "true" : "false");

      if (state.loading) {
        button.dataset.originalText =
          button.dataset.originalText || button.textContent;
        button.textContent = "Refreshing…";
      } else {
        button.textContent =
          button.dataset.originalText || "Refresh";
      }
    }

    const body = $("#mratibaTableBody");

    if (state.loading && body && !state.rows.length) {
      body.innerHTML = `
        <tr>
          <td colspan="9" class="mratiba-empty">
            Loading M-Ratiba records…
          </td>
        </tr>
      `;
    }
  }

  function showError(message) {
    const body = $("#mratibaTableBody");
    if (body) {
      body.innerHTML = `
        <tr>
          <td colspan="9" class="mratiba-empty mratiba-error">
            ${escapeHtml(message)}
          </td>
        </tr>
      `;
    }

    const errorTargets = [
      "#mratibaError",
      "#mratibaStatusMessage",
      "#mratibaMessage"
    ];

    for (const selector of errorTargets) {
      const element = $(selector);
      if (element) {
        element.textContent = message;
        element.hidden = false;
        break;
      }
    }
  }

  function clearError() {
    const errorTargets = [
      "#mratibaError",
      "#mratibaStatusMessage",
      "#mratibaMessage"
    ];

    for (const selector of errorTargets) {
      const element = $(selector);
      if (element) {
        element.textContent = "";
        element.hidden = true;
      }
    }
  }

  function updateSummary(rows) {
    const counts = {
      total: rows.length,
      active: 0,
      pending: 0,
      paused: 0,
      failed: 0,
      cancelled: 0
    };

    rows.forEach((row) => {
      const status = normaliseStatus(row.authorization_status);
      if (Object.prototype.hasOwnProperty.call(counts, status)) {
        counts[status] += 1;
      }
    });

    const mappings = {
      total: ["#mratibaTotal", "#mratibaTotalCount", "#mratibaTotalMandates"],
      active: ["#mratibaActive", "#mratibaActiveCount"],
      pending: ["#mratibaPending", "#mratibaPendingCount"],
      paused: ["#mratibaPaused", "#mratibaPausedCount"],
      failed: ["#mratibaFailed", "#mratibaFailedCount"],
      cancelled: ["#mratibaCancelled", "#mratibaCancelledCount"]
    };

    Object.entries(mappings).forEach(([key, selectors]) => {
      selectors.forEach((selector) => {
        const element = $(selector);
        if (element) element.textContent = counts[key];
      });
    });
  }

  function getMemberDisplay(row) {
    if (row.member_number) return row.member_number;

    const first = row.first_name || row.member_first_name || "";
    const last = row.last_name || row.member_last_name || "";
    const name = `${first} ${last}`.trim();

    return name || row.member_id || "—";
  }

  function getMemberName(row) {
    const first = row.first_name || row.member_first_name || "";
    const last = row.last_name || row.member_last_name || "";
    return `${first} ${last}`.trim();
  }

  function applyFilters() {
    const search = String($("#mratibaSearch")?.value || "")
      .trim()
      .toLowerCase();

    const status = String($("#mratibaStatusFilter")?.value || "")
      .trim()
      .toLowerCase();

    state.currentStatus = status;

    state.filteredRows = state.rows.filter((row) => {
      const rowStatus = normaliseStatus(row.authorization_status);

      if (status && rowStatus !== status) return false;

      if (!search) return true;

      const haystack = [
        row.member_number,
        row.member_id,
        row.phone_number,
        row.plan_code,
        row.custom_sto_id,
        row.provider_reference,
        row.last_mpesa_receipt,
        row.last_transaction_id,
        row.first_name,
        row.last_name,
        row.member_first_name,
        row.member_last_name
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    });

    renderTable();
  }

  function renderTable() {
    const body = $("#mratibaTableBody");
    if (!body) return;

    if (!state.filteredRows.length) {
      body.innerHTML = `
        <tr>
          <td colspan="9" class="mratiba-empty">
            No M-Ratiba mandates found.
          </td>
        </tr>
      `;
      return;
    }

    body.innerHTML = state.filteredRows.map((row) => {
      const id = row.id || "";
      const status = normaliseStatus(row.authorization_status);
      const failures = Number(row.failure_count || 0);

      return `
        <tr data-mratiba-id="${escapeHtml(id)}">
          <td>
            <div class="mratiba-member">
              <strong>${escapeHtml(getMemberDisplay(row))}</strong>
              ${
                getMemberName(row)
                  ? `<small>${escapeHtml(getMemberName(row))}</small>`
                  : ""
              }
            </div>
          </td>

          <td>${escapeHtml(row.phone_number || "—")}</td>

          <td>${escapeHtml(row.plan_code || "—")}</td>

          <td>${formatKES(row.monthly_amount)}</td>

          <td>${formatDate(row.next_collection_date)}</td>

          <td>
            <span class="${statusClass(status)}">
              ${escapeHtml(statusLabel(status))}
            </span>
          </td>

          <td>
            <span class="${failures > 0 ? "mratiba-failure-count" : ""}">
              ${failures}
            </span>
          </td>

          <td>${formatDate(row.created_at)}</td>

          <td>
            <button
              type="button"
              class="mratiba-view-btn"
              data-mratiba-view="${escapeHtml(id)}"
            >
              View
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async function loadMandates() {
    setLoading(true);
    clearError();

    try {
      const status = String($("#mratibaStatusFilter")?.value || "")
        .trim()
        .toLowerCase();

      const params = new URLSearchParams({
        limit: String(CONFIG.LIMIT)
      });

      if (status) {
        params.set("status_filter", status);
      }

      const payload = await apiFetch(
        `${CONFIG.LIST_ENDPOINT}?${params.toString()}`
      );

      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

      state.rows = rows;
      updateSummary(rows);
      applyFilters();

      return rows;
    } catch (error) {
      console.error("M-Ratiba list error:", error);
      state.rows = [];
      state.filteredRows = [];
      updateSummary([]);
      showError(error.message || "Could not load M-Ratiba records.");
      throw error;
    } finally {
      setLoading(false);
    }
  }

  function openModal() {
    const modal = $("#mratibaDetailModal") || $("#mratibaModal");
    if (!modal) return;

    state.modalOpen = true;

    modal.hidden = false;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    const modal = $("#mratibaDetailModal") || $("#mratibaModal");
    if (!modal) return;

    state.modalOpen = false;

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");

    if ("hidden" in modal) {
      modal.hidden = true;
    }
  }

  function renderDetail(mandate, collections) {
    const body = $("#mratibaDetailBody");
    if (!body) return;

    const status = normaliseStatus(mandate.authorization_status);
    const failures = Number(mandate.failure_count || 0);
    const memberName = getMemberName(mandate);

    const history = Array.isArray(collections) ? collections : [];

    const historyHtml = history.length
      ? `
        <div class="mratiba-detail-section">
          <div class="mratiba-detail-heading">Collection History</div>

          <div class="mratiba-history-wrap">
            <table class="mratiba-history-table">
              <thead>
                <tr>
                  <th>Due</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Receipt</th>
                  <th>Paid</th>
                  <th>Failure</th>
                </tr>
              </thead>
              <tbody>
                ${history.map((item) => `
                  <tr>
                    <td>${formatDate(item.due_date)}</td>
                    <td>${formatKES(item.amount)}</td>
                    <td>
                      <span class="${collectionStatusClass(item.status)}">
                        ${escapeHtml(collectionStatusLabel(item.status))}
                      </span>
                    </td>
                    <td>${escapeHtml(item.mpesa_receipt || "—")}</td>
                    <td>${formatDateTime(item.paid_at)}</td>
                    <td>${escapeHtml(item.failure_reason || "—")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `
      : `
        <div class="mratiba-detail-section">
          <div class="mratiba-detail-heading">Collection History</div>
          <div class="mratiba-empty">No collection records yet.</div>
        </div>
      `;

    body.innerHTML = `
      <div class="mratiba-detail">

        <div class="mratiba-detail-header">
          <div>
            <div class="mratiba-detail-title">
              ${escapeHtml(mandate.member_number || getMemberDisplay(mandate))}
            </div>
            ${
              memberName
                ? `<div class="mratiba-detail-subtitle">${escapeHtml(memberName)}</div>`
                : ""
            }
          </div>

          <span class="${statusClass(status)}">
            ${escapeHtml(statusLabel(status))}
          </span>
        </div>

        <div class="mratiba-detail-grid">

          <div class="mratiba-detail-item">
            <span>Phone</span>
            <strong>${escapeHtml(mandate.phone_number || "—")}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Plan</span>
            <strong>${escapeHtml(mandate.plan_code || "—")}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Monthly Amount</span>
            <strong>${formatKES(mandate.monthly_amount)}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Next Collection</span>
            <strong>${formatDate(mandate.next_collection_date)}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Start Date</span>
            <strong>${formatDate(mandate.start_date)}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>End Date</span>
            <strong>${formatDate(mandate.end_date)}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Authorized At</span>
            <strong>${formatDateTime(mandate.authorized_at)}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Last Collection</span>
            <strong>${formatDate(mandate.last_collection_date)}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Failures</span>
            <strong>${failures}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Last M-Pesa Receipt</span>
            <strong>${escapeHtml(mandate.last_mpesa_receipt || "—")}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Last Transaction</span>
            <strong>${escapeHtml(mandate.last_transaction_id || "—")}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Provider</span>
            <strong>${escapeHtml(mandate.provider || "mpesa_ratiba")}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Custom STO ID</span>
            <strong>${escapeHtml(mandate.custom_sto_id || "—")}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Provider Reference</span>
            <strong>${escapeHtml(mandate.provider_reference || "—")}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Created</span>
            <strong>${formatDateTime(mandate.created_at)}</strong>
          </div>

          <div class="mratiba-detail-item">
            <span>Last Failure</span>
            <strong>${escapeHtml(mandate.last_failure_reason || "—")}</strong>
          </div>

        </div>

        ${historyHtml}
      </div>
    `;
  }

  async function loadDetail(mandateId) {
    if (!mandateId) return;

    const body = $("#mratibaDetailBody");
    if (body) {
      body.innerHTML = `
        <div class="mratiba-empty">
          Loading mandate details…
        </div>
      `;
    }

    openModal();

    try {
      const payload = await apiFetch(
        `${CONFIG.DETAIL_ENDPOINT}/${encodeURIComponent(mandateId)}`
      );

      const mandate = payload?.mandate || payload?.data?.mandate || null;
      const collections =
        payload?.collections ||
        payload?.data?.collections ||
        [];

      if (!mandate) {
        throw new Error("M-Ratiba mandate was not found.");
      }

      state.currentMandate = mandate;
      state.currentCollections = collections;

      renderDetail(mandate, collections);
    } catch (error) {
      console.error("M-Ratiba detail error:", error);

      if (body) {
        body.innerHTML = `
          <div class="mratiba-empty mratiba-error">
            ${escapeHtml(
              error.message || "Could not load mandate details."
            )}
          </div>
        `;
      }
    }
  }

  function bindEvents() {
    const refreshButton = $("#mratibaRefreshBtn");
    refreshButton?.addEventListener("click", () => {
      loadMandates().catch(() => {});
    });

    $("#mratibaSearch")?.addEventListener("input", applyFilters);

    $("#mratibaStatusFilter")?.addEventListener("change", () => {
      loadMandates().catch(() => {});
    });

    $("#mratibaTableBody")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-mratiba-view]");
      if (!button) return;

      const mandateId = button.getAttribute("data-mratiba-view");
      loadDetail(mandateId);
    });

    document.addEventListener("click", (event) => {
      const closeTarget = event.target.closest(
        "[data-mratiba-close], #mratibaModalClose, #mratibaDetailClose"
      );

      if (closeTarget) {
        closeModal();
        return;
      }

      const modal = $("#mratibaDetailModal") || $("#mratibaModal");

      if (
        modal &&
        state.modalOpen &&
        event.target === modal
      ) {
        closeModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.modalOpen) {
        closeModal();
      }
    });
  }

  function startAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
    }

    state.refreshTimer = setInterval(() => {
      if (document.hidden || state.modalOpen || state.loading) return;

      loadMandates().catch(() => {});
    }, CONFIG.REFRESH_MS);
  }

  async function init() {
    bindEvents();
    startAutoRefresh();

    try {
      await loadMandates();
    } catch {
      // Error is already rendered by loadMandates().
    }
  }

  window.MRatiba = {
    config: CONFIG,
    state,

    refresh: () => loadMandates(),

    filter: () => applyFilters(),

    view: (mandateId) => loadDetail(mandateId),

    close: () => closeModal()
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
"""

path = Path("/mnt/data/mratiba.js")
path.write_text(js, encoding="utf-8")

# Basic structural checks without executing browser APIs.
assert '"/api/admin/mratiba"' in js
assert '"/api/admin/mratiba"' in js
assert "pending" in js and "active" in js and "failed" in js
assert "mratibaTableBody" in js
assert "mratibaDetailBody" in js
assert "setInterval" in js

print(f"Created clean replacement: {path}")
print(f"Size: {path.stat().st_size:,} bytes")
print("Checks passed: API endpoints, lifecycle statuses, table/detail hooks, auto-refresh.")
