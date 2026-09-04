// ============================================================
// ADMIN MEMBERS
// Masika Benevolent - Member search, list & status management
// ============================================================

const PAGE_SIZE = 15;
let currentPage = 0;
let currentSearch = "";
let currentStatusFilter = "";
let totalMemberCount = 0;
let membersCache = [];

document.addEventListener("DOMContentLoaded", () => {
  loadAdminProfileForMembersPage();
  loadSidebarCounts();
  loadMembers();

  document.getElementById("memberSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyFilters();
  });
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
  return {
    ACTIVE: "active",
    DORMANT: "pending",
    SUSPENDED: "inactive",
    CANCELLED: "rejected",
    PENDING: "pending",
  }[status] || "pending";
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

// ------------------------------------------------------------

async function loadAdminProfileForMembersPage() {
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

async function loadSidebarCounts() {
  try {
    const { count: agentCount } = await window.supabaseClient
      .from("staff")
      .select("id, roles!inner(role_code)", { count: "exact", head: true })
      .eq("roles.role_code", "SALES_AGENT");
    document.getElementById("agentCountBadge").textContent = agentCount || 0;
  } catch (err) {
    console.error("Failed to load agent count:", err);
  }
}

// ------------------------------------------------------------

function applyFilters() {
  currentSearch = document.getElementById("memberSearch").value.trim();
  currentStatusFilter = document.getElementById("statusFilter").value;
  currentPage = 0;
  loadMembers();
}

function changePage(delta) {
  currentPage = Math.max(0, currentPage + delta);
  loadMembers();
}

async function loadMembers() {
  const container = document.getElementById("membersList");
  container.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><p>Loading...</p></div>`;
  document.getElementById("membersPagination").style.display = "none";

  try {
    let query = window.supabaseClient
      .from("members")
      .select(
        "id, full_name, member_number, phone, id_number, member_status, plan, registration_date, created_at",
        { count: "exact" }
      )
      .is("deleted_at", null); // hide soft-deleted members from the default list

    if (currentStatusFilter) {
      query = query.eq("member_status", currentStatusFilter);
    }

    if (currentSearch) {
      const term = `%${currentSearch}%`;
      query = query.or(
        `full_name.ilike.${term},member_number.ilike.${term},phone.ilike.${term},id_number.ilike.${term}`
      );
    }

    const from = currentPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    membersCache = data || [];
    totalMemberCount = count || 0;
    document.getElementById("memberCountBadge").textContent = totalMemberCount;

    if (membersCache.length === 0) {
      container.innerHTML = `<div class="loading-spinner"><p style="color:var(--text-light);">No members match your search.</p></div>`;
      return;
    }

    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr><th>Name</th><th>Member #</th><th>Phone</th><th>Plan</th><th>Status</th><th>Registered</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${membersCache.map((m) => `
              <tr data-member-row="${escapeHtml(m.id)}" onclick="openMemberModal('${m.id}')">
                <td>${escapeHtml(m.full_name)}</td>
                <td>${escapeHtml(m.member_number || "—")}</td>
                <td>${escapeHtml(m.phone || "—")}</td>
                <td>${escapeHtml(m.plan || "—")}</td>
                <td><span class="status-badge ${statusBadgeClass(m.member_status)}">${escapeHtml(m.member_status)}</span></td>
                <td>${formatDate(m.registration_date || m.created_at)}</td>
                <td>
                  <button
                    class="btn-sm delete-member-btn"
                    style="background:var(--danger);color:white;"
                    data-id="${escapeHtml(m.id)}"
                    data-name="${escapeHtml(m.full_name)}"
                    title="Delete member"
                  >
                    <i class="fas fa-trash"></i>
                  </button>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    // Delete buttons: stop the click from bubbling up to the row's
    // onclick (which would otherwise open the detail modal instead).
    container.querySelectorAll(".delete-member-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const name = btn.getAttribute("data-name");
        deleteMember(id, name, btn);
      });
    });

    const totalPages = Math.max(1, Math.ceil(totalMemberCount / PAGE_SIZE));
    document.getElementById("paginationInfo").textContent =
      `Page ${currentPage + 1} of ${totalPages} · ${totalMemberCount} members`;
    document.getElementById("prevPageBtn").disabled = currentPage === 0;
    document.getElementById("nextPageBtn").disabled = currentPage + 1 >= totalPages;
    document.getElementById("membersPagination").style.display = "flex";
  } catch (err) {
    console.error("Failed to load members:", err);
    container.innerHTML = `
      <div class="loading-spinner">
        <p style="color:var(--danger);">Couldn't load members.</p>
        <button class="btn-sm primary" onclick="loadMembers()" style="margin-top:10px;">Retry</button>
      </div>`;
  }
}

// ------------------------------------------------------------
// Delete a member (soft delete)
// ------------------------------------------------------------
// Can be called either from the table row's trash icon (triggerBtn
// is passed, gets disabled/spun while the request is in flight) or
// from the detail modal's "Delete Member" button (no triggerBtn).
//
// This does NOT remove the row from the database — members can
// have payment records referencing them (payments_member_id_fkey),
// and hard-deleting would either fail outright or destroy payment
// history. Instead this sets `deleted_at`, and loadMembers() filters
// out any member where deleted_at is not null. Payments are
// untouched and stay linked to the (now-hidden) member.
//
// NOTE: This only succeeds if your Supabase Row Level Security
// policy on `members` allows UPDATE for the signed-in admin/staff
// role — the same policy that already backs saveMemberStatus().
// ------------------------------------------------------------

async function deleteMember(id, name, triggerBtn) {
  if (!id) return;

  const confirmed = window.confirm(
    `Delete ${name || "this member"}? They'll be removed from the list, but their payment history is kept.`
  );
  if (!confirmed) return;

  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  }

  try {
    const { error } = await window.supabaseClient
      .from("members")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw error;

    // If the deleted member's modal happens to be open, close it.
    if (openMemberId === id) {
      closeMemberModal();
    }

    // Adjust the current page if this was the last row on it, so
    // we don't land on an empty page after deleting.
    const isLastRowOnPage = membersCache.length === 1 && currentPage > 0;
    if (isLastRowOnPage) currentPage -= 1;

    await Promise.all([loadMembers(), loadSidebarCounts()]);
  } catch (err) {
    console.error("Failed to delete member:", err);
    alert(
      "Couldn't delete this member. " +
        (err?.message || "Please check your permissions and try again.")
    );
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = '<i class="fas fa-trash"></i>';
    }
  }
}

// Called from the "Delete Member" button inside the detail modal.
function deleteOpenMember() {
  if (!openMemberId) return;
  const nameEl = document.getElementById("memberModalName");
  deleteMember(openMemberId, nameEl ? nameEl.textContent : "this member");
}

window.deleteMember = deleteMember;
window.deleteOpenMember = deleteOpenMember;

// ------------------------------------------------------------
// Member detail modal
// ------------------------------------------------------------

let openMemberId = null;

async function openMemberModal(memberId) {
  openMemberId = memberId;
  document.getElementById("memberModalError").style.display = "none";
  document.getElementById("memberModalSuccess").style.display = "none";

  try {
    const { data: m, error } = await window.supabaseClient
      .from("members")
      .select("*")
      .eq("id", memberId)
      .single();

    if (error) throw error;

    document.getElementById("memberModalName").textContent = m.full_name;
    document.getElementById("memberStatusSelect").value = m.member_status;

    document.getElementById("memberPersonalInfo").innerHTML = detailRow([
      ["ID Number", m.id_number || m.national_id],
      ["Passport Number", m.passport_number],
      ["Date of Birth", formatDate(m.date_of_birth)],
      ["Gender", m.gender],
    ]);

    document.getElementById("memberContactInfo").innerHTML = detailRow([
      ["Phone", m.phone],
      ["Alt. Phone", m.alternative_phone],
      ["Email", m.email],
      ["County", m.county],
      ["Sub-County", m.sub_county],
      ["Town", m.town],
      ["Address", m.address],
    ]);

    document.getElementById("memberMembershipInfo").innerHTML = detailRow([
      ["Member #", m.member_number],
      ["Plan", m.plan],
      ["Benefit Option", m.benefit_option],
      ["Registration Date", formatDate(m.registration_date)],
      ["Registration Fee Paid", m.registration_fee_paid ? "Yes" : "No"],
      ["Agent", m.agent_name],
      ["Branch ID", m.branch_id],
    ]);

    document.getElementById("memberKinInfo").innerHTML = detailRow([
      ["Name", m.next_of_kin_name],
      ["Phone", m.next_of_kin_phone],
      ["Relationship", m.next_of_kin_relationship],
    ]);

    document.getElementById("memberModal").classList.add("open");
  } catch (err) {
    console.error("Failed to load member detail:", err);
    alert("Couldn't load member details. " + err.message);
  }
}

function detailRow(pairs) {
  return pairs
    .map(
      ([label, value]) => `
      <div>
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value || "—")}</div>
      </div>`
    )
    .join("");
}

function closeMemberModal() {
  document.getElementById("memberModal").classList.remove("open");
  openMemberId = null;
}

async function saveMemberStatus() {
  if (!openMemberId) return;
  const errorEl = document.getElementById("memberModalError");
  const successEl = document.getElementById("memberModalSuccess");
  errorEl.style.display = "none";
  successEl.style.display = "none";

  const newStatus = document.getElementById("memberStatusSelect").value;

  try {
    const { error } = await window.supabaseClient
      .from("members")
      .update({ member_status: newStatus })
      .eq("id", openMemberId);
    if (error) throw error;

    successEl.textContent = "Status updated.";
    successEl.style.display = "block";
    loadMembers();
  } catch (err) {
    console.error("Failed to update member status:", err);
    errorEl.textContent = err.message || "Couldn't update status.";
    errorEl.style.display = "block";
  }
}

window.applyFilters = applyFilters;
window.changePage = changePage;
window.openMemberModal = openMemberModal;
window.closeMemberModal = closeMemberModal;
window.saveMemberStatus = saveMemberStatus;
window.loadMembers = loadMembers;

async function handleLogout() {
  try {
    await window.supabaseClient.auth.signOut();
  } finally {
    window.location.href = "login.html";
  }
}
window.handleLogout = handleLogout;
