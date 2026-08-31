// ============================================================
// SUPABASE CONFIGURATION
// ============================================================
// Masika Benevolent - Supabase Configuration
// ============================================================
const SUPABASE_URL = "https://wpxzlcdrirlcyvfiquld.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndweHpsY2RyaXJsY3l2ZmlxdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5Mjc4MDcsImV4cCI6MjEwMzUwMzgwN30.OUP9pmPbrML_egpHflZtDfLv1_UDM37_BYjtb842xjg";
if (typeof window.supabase === "undefined" && typeof supabase === "undefined") {
    console.error(
        "Supabase JS library is not loaded. " +
        "Make sure @supabase/supabase-js is loaded before this file."
    );
}
// Create one shared Supabase client.
const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);
// Make it available globally to the other frontend files.
window.supabaseClient = supabaseClient;
// Backwards-compatible alias.
window.sb = supabaseClient;
console.log("✅ Supabase client initialized.");
console.log("🔗 URL:", SUPABASE_URL);
