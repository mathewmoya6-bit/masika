// js/config.js
// ============================================================
// MASIKA BENEVOLENT - Shared Configuration
// ============================================================

const CONFIG = {
    // Supabase Configuration
    SUPABASE_URL: "https://your-project-id.supabase.co", // Replace with your actual Supabase URL
    SUPABASE_ANON_KEY: "your-anon-key", // Replace with your actual Supabase anon key
    
    // API Configuration
    API: {
        BASE_URL: "https://masika-c921.onrender.com/api"
    },
    
    // Plan Configuration
    PLANS: {
        COMFORT: {
            slug: "comfort",
            name: "Comfort Plan",
            description: "Affordable individual membership protection for you and your family.",
            registration_fee: 200,
            monthly_fee: 300,
            waiting_period_months: 4
        },
        DIGNITY: {
            slug: "dignity",
            name: "Dignity Plan",
            description: "Enhanced membership protection with premium benefits for your entire family.",
            registration_fee: 500,
            monthly_fee: 1000,
            waiting_period_months: 6
        },
        WAZAZI: {
            slug: "wazazi",
            name: "Wazazi Plan",
            description: "Membership protection specifically designed for parents and elders.",
            registration_fee: 200,
            monthly_fee: 650,
            waiting_period_months: 6
        }
    },
    
    // Fees
    WAZAZI_PARENT_FEE: 100,
    CHAMA_REGISTRATION_RATE: 100,
    MIN_CHAMA_MEMBERS: 30,
    MAX_DEPENDANTS: 10,
    
    // Routes
    ROUTES: {
        LOGIN: 'login.html',
        DASHBOARD: 'dashboard.html',
        PAYMENT: 'payment.html',
        REGISTER: 'register.html'
    },
    
    // Fallback plans (used if API is unreachable)
    FALLBACK_PLANS: [
        {
            slug: "comfort",
            name: "Comfort Plan",
            description: "Affordable individual membership protection.",
            registration_fee: 200,
            monthly_fee: 300,
            waiting_period_months: 4
        },
        {
            slug: "dignity",
            name: "Dignity Plan",
            description: "Enhanced membership protection with premium benefits.",
            registration_fee: 500,
            monthly_fee: 1000,
            waiting_period_months: 6
        },
        {
            slug: "wazazi",
            name: "Wazazi Plan",
            description: "Membership protection designed for parents and elders.",
            registration_fee: 200,
            monthly_fee: 650,
            waiting_period_months: 6
        }
    ]
};

// Make CONFIG globally available
window.CONFIG = CONFIG;
