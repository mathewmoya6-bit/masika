// Masika Benevolent — admin auth guard
// Confirms an admin session exists before a protected admin/*.html page
// renders, and exposes the current admin + a shared logout handler.
//
// Expected Supabase surface (adjust to match your schema if it differs):
//   table  admin_users   (id, full_name, email, role, status)
//   table  agents        (used only to populate the sidebar's agent count badge)

const AdminAuth = {
  session: null,
  profile: null, // { id, full_name, email, role, status }

  async requireSession() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error || !data.session) {
      window.location.href = "admin-login.html";
      return null;
    }
    this.session = data.session;
    await this._loadProfile();
    this._renderProfile();
    await this._loadAgentCount();
    return this.session;
  },

  async _loadProfile() {
    const { data, error } = await supabaseClient
      .from("admin_users")
      .select("id, full_name, email, role, status")
      .eq("id", this.session.user.id)
      .single();

    if (error) {
      console.error("Could not load admin profile", error);
      return;
    }
    this.profile = data;
  },

  _renderProfile() {
    if (!this.profile) return;
    const nameEl = document.getElementById("adminName");
    const roleEl = document.getElementById("adminRole");
    const avatarEl = document.getElementById("adminAvatar");
    const displayName = this.profile.full_name || this.profile.email;

    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = this.profile.role === "admin" ? "Administrator" : this.profile.role;
    if (avatarEl) avatarEl.textContent = displayName.trim().charAt(0).toUpperCase();
  },

  async _loadAgentCount() {
    const badge = document.getElementById("agentCountBadge");
    if (!badge) return;
    const { count, error } = await supabaseClient
      .from("agents")
      .select("id", { count: "exact", head: true });
    if (!error && typeof count === "number") {
      badge.textContent = count;
    }
  },

  isAdmin() {
    return this.profile?.role === "admin";
  },
};

async function handleLogout() {
  await supabaseClient.auth.signOut();
  window.location.href = "admin-login.html";
}

// Each admin page's own script (e.g. admin-pricing.js) calls
// AdminAuth.requireSession() on DOMContentLoaded before loading its
// page-specific data, so the guard and the page load resolve in order.
