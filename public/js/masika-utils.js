/**
 * masika-utils.js
 * -----------------------------------------------------------------------
 * Shared helpers for the Masika Benevolent public site (register + payment
 * flows). Centralising these avoids the two pages drifting out of sync —
 * e.g. register.html and payment.js previously each had their own,
 * slightly different, phone-number normalizer.
 *
 * Load this BEFORE register.js / payment.js.
 * -----------------------------------------------------------------------
 */

(function (window) {
    "use strict";

    // ------------------------------------------------------------------
    // CONFIG
    // ------------------------------------------------------------------
    // Single source of truth for the API base URL. Update here only.
    const API_BASE_URL = "https://masika-c921.onrender.com";

    // ------------------------------------------------------------------
    // DEBUG LOGGING
    // ------------------------------------------------------------------
    // Verbose step-by-step logs (which are useful in development but can
    // leak member names/phone numbers into the browser console in
    // production) are gated behind a debug flag. Enable with
    // ?debug=1 in the URL, or localStorage.setItem('masika_debug','1').
    // Errors are always logged (with sensitive fields masked).
    const DEBUG = (function detectDebug() {
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get("debug") === "1") {
                return true;
            }
            return window.localStorage.getItem("masika_debug") === "1";
        } catch (_error) {
            return false;
        }
    })();

    function log() {
        if (DEBUG) {
            console.log.apply(console, arguments);
        }
    }

    function warn() {
        console.warn.apply(console, arguments);
    }

    function error() {
        console.error.apply(console, arguments);
    }

    // ------------------------------------------------------------------
    // STRING HELPERS
    // ------------------------------------------------------------------

    function clean(value) {
        return String(value ?? "").trim();
    }

    function optionalString(value) {
        const cleaned = clean(value);
        return cleaned || null;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // ------------------------------------------------------------------
    // PHONE HELPERS (single implementation shared by both pages)
    // ------------------------------------------------------------------
    // Accepts 07XXXXXXXX, 01XXXXXXXX, 7XXXXXXXX, 1XXXXXXXX, +254XXXXXXXXX,
    // and 254XXXXXXXXX and normalizes to 254XXXXXXXXX.

    function normalizePhone(phone) {
        let value = String(phone || "")
            .trim()
            .replace(/\s+/g, "")
            .replace(/-/g, "");

        if (!value) {
            return "";
        }

        if (value.startsWith("+254")) {
            value = value.substring(1);
        } else if (/^0[71]\d{8}$/.test(value)) {
            value = "254" + value.substring(1);
        } else if (/^[71]\d{8}$/.test(value)) {
            value = "254" + value;
        }

        return value;
    }

    function isValidKenyanPhone(phone) {
        return /^254[17]\d{8}$/.test(normalizePhone(phone));
    }

    function optionalPhone(value) {
        const phone = normalizePhone(value);
        return phone || null;
    }

    function maskPhone(value) {
        const s = clean(value);
        if (s.length < 6) {
            return s ? "***" : "";
        }
        return s.slice(0, 6) + "***" + s.slice(-2);
    }

    function maskId(value) {
        const s = clean(value);
        if (!s) {
            return "";
        }
        if (s.length <= 4) {
            return "*".repeat(s.length);
        }
        return s.slice(0, 2) + "*".repeat(Math.max(0, s.length - 4)) + s.slice(-2);
    }

    // ------------------------------------------------------------------
    // MONEY
    // ------------------------------------------------------------------

    function money(value) {
        const number = Number(value || 0);
        return number.toLocaleString("en-KE", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        });
    }

    function formatMoney(value) {
        return "KES " + money(value);
    }

    // ------------------------------------------------------------------
    // MISC
    // ------------------------------------------------------------------

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function firstDefined() {
        for (let i = 0; i < arguments.length; i++) {
            const value = arguments[i];
            if (value !== undefined && value !== null && value !== "") {
                return value;
            }
        }
        return undefined;
    }

    // ------------------------------------------------------------------
    // NETWORKING
    // ------------------------------------------------------------------
    // Shared fetch wrapper: applies a timeout, parses JSON defensively,
    // and turns FastAPI-style error payloads (including 422 validation
    // arrays) into a single readable message.

    async function apiRequest(endpoint, options, timeoutMs) {
        options = options || {};
        timeoutMs = timeoutMs || 60000;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let response;

        try {
            response = await fetch(API_BASE_URL + endpoint, {
                ...options,
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    ...(options.headers || {})
                },
                signal: controller.signal
            });
        } catch (err) {
            clearTimeout(timer);

            if (err.name === "AbortError") {
                throw new Error(
                    "The request took too long to respond. Please try again."
                );
            }

            error(`masika-utils: request to ${endpoint} failed before response:`, err);
            throw err;
        }

        clearTimeout(timer);

        const responseText = await response.text();
        let result = null;

        if (responseText) {
            try {
                result = JSON.parse(responseText);
            } catch (_parseError) {
                result = null;
            }
        }

        if (!response.ok) {
            let message = result?.error || result?.message || result?.detail;

            if (Array.isArray(result?.detail)) {
                message = result.detail
                    .map(item => {
                        const location = Array.isArray(item.loc) ? item.loc : [];
                        const field =
                            location.length > 1 ? location.slice(1).join(".") : "field";
                        const readableField = field
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, ch => ch.toUpperCase());
                        return `${readableField}: ${item.msg}`;
                    })
                    .join(" | ");
            }

            if (typeof message === "object" && message !== null) {
                message = JSON.stringify(message);
            }

            error(`masika-utils: ${endpoint} HTTP ${response.status}:`, result || responseText);

            throw new Error(message || `Server returned HTTP ${response.status}.`);
        }

        return result;
    }

    function friendlyError(err) {
        const message = err?.message || String(err) || "An unexpected error occurred.";
        const lower = message.toLowerCase();

        if (lower.includes("failed to fetch")) {
            return (
                "Unable to connect to the Masika registration server. " +
                "The server may be waking up. Please wait a few seconds and try again."
            );
        }

        if (lower.includes("timed out") || lower.includes("timeout")) {
            return "The server took too long to respond. Please try again.";
        }

        if (lower.includes("sales agent") && lower.includes("branch")) {
            return (
                "The selected sales agent is not available in your branch. " +
                "Please select a different agent or leave the field empty."
            );
        }

        return message;
    }

    // ------------------------------------------------------------------
    // EXPORT
    // ------------------------------------------------------------------

    window.MasikaUtils = {
        API_BASE_URL,
        DEBUG,
        log,
        warn,
        error,
        clean,
        optionalString,
        escapeHtml,
        normalizePhone,
        isValidKenyanPhone,
        optionalPhone,
        maskPhone,
        maskId,
        money,
        formatMoney,
        sleep,
        firstDefined,
        apiRequest,
        friendlyError
    };
})(window);
