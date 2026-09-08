// ============================================================
// ADMIN CONFIGURATION - js/admin/config.js
// ============================================================

const ADMIN_CONFIG = {
    // Supabase Configuration
    SUPABASE: {
        URL: 'https://wpxzlcdrirlcyvfiquld.supabase.co',
        ANON_KEY: 'YOUR_SUPABASE_ANON_KEY'
    },
    
    // Backend API
    API: {
        BASE_URL: 'https://masika-backend.onrender.com/api/v1',
        TIMEOUT: 30000
    },
    
    // App Settings
    APP: {
        NAME: 'Masika Benevolent Admin',
        VERSION: '2.0.0'
    },
    
    // Storage Keys
    STORAGE: {
        ADMIN_USER: 'masika_admin_user',
        ADMIN_SESSION: 'masika_admin_session',
        ACCESS_TOKEN: 'masika_admin_token'
    },
    
    // Routes
    ROUTES: {
        LOGIN: 'admin-login.html',
        DASHBOARD: 'admin-dashboard.html',
        MEMBERS: 'admin-members.html',
        AGENTS: 'admin-agents.html',
        PAYMENTS: 'admin-collectpayments.html',
        REVENUE: 'admin-revenue.html',
        REPORTS: 'admin-reports.html',
        PRICING: 'admin-pricing.html',
        SETTINGS: 'admin-settings.html'
    },
    
    // Pagination
    PAGINATION: {
        DEFAULT_PAGE_SIZE: 20,
        MAX_PAGE_SIZE: 100
    },
    
    // Date Formats
    DATE_FORMATS: {
        DISPLAY: 'en-KE',
        DATE: { year: 'numeric', month: 'short', day: 'numeric' },
        DATETIME: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ADMIN_CONFIG;
} else {
    window.ADMIN_CONFIG = ADMIN_CONFIG;
}
