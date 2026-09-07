// ============================================================
// CONFIGURATION - js/config.js
// ============================================================

const CONFIG = {
    // Supabase Configuration
    SUPABASE: {
        URL: 'https://wpxzlcdrirlcyvfiquld.supabase.co',
        ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndweHpsY2RyaXJsY3l2ZmlxdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Mjc4MDcsImV4cCI6MjEwMzUwMzgwN30.your-anon-key-here'
    },
    
    // Backend API
    API: {
        BASE_URL: 'https://masika-backend.onrender.com/api/v1',
        TIMEOUT: 30000
    },
    
    // App Settings
    APP: {
        NAME: 'Masika Benevolent',
        VERSION: '2.0.0'
    },
    
    // Storage Keys
    STORAGE: {
        USER: 'masika_user',
        SESSION: 'masika_session',
        MEMBER: 'masika_member'
    },
    
    // Routes
    ROUTES: {
        HOME: '/index.html',
        LOGIN: '/login.html',
        REGISTER: '/register.html',
        DASHBOARD: '/dashboard.html',
        PAYMENT: '/payment.html'
    },
    
    // Plans
    PLANS: {
        COMFORT: {
            slug: 'comfort',
            name: 'Comfort Plan',
            monthly_fee: 300,
            registration_fee: 200,
            waiting_period: 4
        },
        DIGNITY: {
            slug: 'dignity',
            name: 'Dignity Plan',
            monthly_fee: 1000,
            registration_fee: 500,
            waiting_period: 6
        },
        WAZAZI: {
            slug: 'wazazi',
            name: 'Wazazi Plan',
            monthly_fee: 350,
            registration_fee: 100,
            waiting_period: 6
        }
    },
    
    // M-PESA
    MPESA: {
        SHORTCODE: '348127',
        PAYBILL: '348127'
    }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
} else {
    window.CONFIG = CONFIG;
}
