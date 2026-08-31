// ============================================================
// ADMIN AGENTS
// Masika Benevolent - Agent list & creation
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  loadAdminProfileForAgentsPage();
  loadAgents();
  loadBranchOptions();

  document
    .getElementById("createAgentForm")
    .addEventListener("submit", submitCreateAgent);
});

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusBadgeClass(status) {
  return { ACTIVE: "active", INACTIVE: "inactive", SUSPENDED: "suspended" }[status] || "inactive";
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

// ------------------------------------------------------------

async function loadAdminProfileForAgentsPage() {
  try {
    const {
      data: { session },
    } = await window.supabaseClient.auth.getSession();
    if (!session) return;

    const { data: staffRow } = await window.supabaseClient
      .from("staff")
      .select("full_name, roles(role_name)")
      .eq("auth_user_id", session.user.id)
      .single();

    if (!staffRow) return;
    document.getElementById("adminName").textContent = staffRow.full_name;
    document.getElementById("adminRole").textContent = staffRow.roles?.role_name || "Administrator";
    document.getElementById("adminAvatar").textContent = staffRow.full_name.charAt(0).toUpperCase();
  } catch (err) {
    console.error("Failed to load admin profile:", err);
  }
}

// ------------------------------------------------------------

async function loadAgents() {
  const container = document.getElementById("agentsList");
  container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Loading...</p></div>`;

  try {
    const { data, error } = await window.supabaseClient
      .from("staff")
      .select("id, full_name, employee_number, email, phone, status, created_at, roles!inner(role_code), branches(branch_name)")
      .eq("roles.role_code", "SALES_AGENT")
      .order("created_at", { ascending: false });

    if (error) throw error;

    document.getElementById("agentCountBadge").textContent = data?.length || 0;

    if (!data || data.length === 0) {
      container.innerHTML = `<div class="loading-spinner"><p style="color:var(--text-light);">No agents yet. Add your first one.</p></div>`;
      return;
    }

    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Agent</th><th>Employee #</th><th>Contact</th><th>Branch</th><th>Status</th><th>Joined</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${data.map((a) => `
              <tr>
                <td>${escapeHtml(a.full_name)}</td>
                <td>${escapeHtml(a.employee_number || "—")}</td>
                <td>${escapeHtml(a.email || a.phone || "—")}</td>
                <td>${escapeHtml(a.branches?.branch_name || "—")}</td>
                <td><span class="status-badge ${statusBadgeClass(a.status)}">${escapeHtml(a.status)}</span></td>
                <td>${formatDate(a.created_at)}</td>
                <td>
                  ${a.status === "ACTIVE"
                    ? `<button class="btn-sm danger" onclick="toggleAgentStatus('${a.id}','SUSPENDED')">Suspend</button>`
                    : `<button class="btn-sm success" onclick="toggleAgentStatus('${a.id}','ACTIVE')">Activate</button>`}
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    console.error("Failed to load agents:", err);
    container.innerHTML = `
      <div class="loading-spinner">
        <p style="color:var(--danger);">Couldn't load agents.</p>
        <button class="btn-sm primary" onclick="loadAgents()" style="margin-top:10px;">Retry</button>
      </div>`;
  }
}

async function toggleAgentStatus(staffId, newStatus) {
  try {
    const { error } = await window.supabaseClient
      .from("staff")
      .update({ status: newStatus })
      .eq("id", staffId);
    if (error) throw error;
    loadAgents();
  } catch (err) {
    console.error("Failed to update agent status:", err);
    alert("Couldn't update agent status. " + err.message);
  }
}

// ------------------------------------------------------------

async function loadBranchOptions() {
  const select = document.getElementById("agentBranch");
  try {
    const { data, error } = await window.supabaseClient
      .from("branches")
      .select("id, branch_name")
      .order("branch_name");
    if (error) throw error;
    (data || []).forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.branch_name;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("Failed to load branches:", err);
  }
}

// ------------------------------------------------------------

function openCreateAgentModal() {
  document.getElementById("createAgentModal").classList.add("open");
}

function closeCreateAgentModal() {
  document.getElementById("createAgentModal").classList.remove("open");
  document.getElementById("createAgentForm").reset();
  document.getElementById("createAgentError").style.display = "none";
  document.getElementById("createAgentSuccess").style.display = "none";
}

async function submitCreateAgent(e) {
  e.preventDefault();
  const errorEl = document.getElementById("createAgentError");
  const successEl = document.getElementById("createAgentSuccess");
  const submitBtn = document.getElementById("createAgentSubmitBtn");
  errorEl.style.display = "none";
  successEl.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Sending...`;

  const payload = {
    full_name: document.getElementById("agentFullName").value.trim(),
    email: document.getElementById("agentEmail").value.trim(),
    phone: document.getElementById("agentPhone").value.trim() || null,
    national_id: document.getElementById("agentNationalId").value.trim() || null,
    employee_number: document.getElementById("agentEmployeeNumber").value.trim() || null,
    branch_id: document.getElementById("agentBranch").value || null,
  };

  try {
    const { data, error } = await window.supabaseClient.functions.invoke("create-agent", {
      body: payload,
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    successEl.textContent = `Agent created — an invite email was sent to ${payload.email}.`;
    successEl.style.display = "block";
    loadAgents();
    setTimeout(closeCreateAgentModal, 1800);
  } catch (err) {
    console.error("Failed to create agent:", err);
    errorEl.textContent = err.message || "Something went wrong. Please try again.";
    errorEl.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fas fa-paper-plane"></i> Send Invite`;
  }
}

window.openCreateAgentModal = openCreateAgentModal;
window.closeCreateAgentModal = closeCreateAgentModal;
window.toggleAgentStatus = toggleAgentStatus;
window.loadAgents = loadAgents;

async function handleLogout() {
  try {
    await window.supabaseClient.auth.signOut();
  } finally {
    window.location.href = "login.html";
  }
}
window.handleLogout = handleLogout;
