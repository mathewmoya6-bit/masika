// Masika Benevolent — admin-settings.html logic
//
// Expected Supabase surface (adjust names to match your schema if they differ):
//   table  membership_plans   (id, code, name, monthly_fee, registration_fee,
//                               min_parents, max_parents)
//   rpc    update_plan_pricing(plan_id uuid, monthly_fee numeric, registration_fee numeric)
//
//   table  staff_users        (id, full_name, email, role, status)
//   rpc    invite_staff_member(full_name text, email text, role text)
//   rpc    update_staff_role(staff_id uuid, role text)
//   rpc    set_staff_status(staff_id uuid, status text)
//
//   table  system_settings    (single row: org_name, org_phone, org_email,
//                               org_address, receipt_footer_note, card_issuance_enabled)
//   rpc    update_system_settings(payload jsonb)

document.addEventListener("DOMContentLoaded", async () => {
  const session = await Auth.requireSession();
  if (!session) return;

  if (!Auth.isAdmin()) {
    document.getElementById("settings-root").innerHTML =
      '<div class="card"><p>Settings are only visible to admin accounts. Contact your Masika Benevolent admin if you need a change made here.</p></div>';
    return;
  }

  document.getElementById("staff-name").textContent = Auth.profile.full_name || Auth.profile.email;
  document.getElementById("sign-out").addEventListener("click", () => Auth.signOut());

  initTabs();
  loadPlans();
  loadStaff();
  loadSystemSettings();
  wireStaffModal();
});

// ---------- Tabs ----------

function initTabs() {
  const buttons = document.querySelectorAll(".settings-rail button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.setAttribute("aria-current", "false"));
      btn.setAttribute("aria-current", "true");
      document.querySelectorAll(".settings-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById(btn.dataset.panel).classList.add("active");
    });
  });
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2600);
}

// ---------- Membership plans ----------

async function loadPlans() {
  const grid = document.getElementById("plan-grid");
  const { data, error } = await supabaseClient
    .from("membership_plans")
    .select("*")
    .order("monthly_fee", { ascending: true });

  if (error) {
    grid.innerHTML = `<p class="status-line err">Could not load plans: ${error.message}</p>`;
    return;
  }

  grid.innerHTML = "";
  data.forEach((plan) => grid.appendChild(renderPlanCard(plan)));
}

function renderPlanCard(plan) {
  const el = document.createElement("div");
  el.className = "plan-card";
  const cls = plan.code ? plan.code.toLowerCase() : "";
  const parentsLine =
    plan.min_parents && plan.max_parents
      ? `<p class="plan-meta">Covers ${plan.min_parents}–${plan.max_parents} parents, priced per parent</p>`
      : "";

  el.innerHTML = `
    <div class="plan-name ${cls}">${plan.name}</div>
    <p class="plan-meta">Registration fee: KES ${plan.registration_fee}</p>
    ${parentsLine}
    <div class="plan-fee" data-view>KES ${plan.monthly_fee} <small>/ month</small></div>
    <form data-edit hidden>
      <div class="field-row">
        <div class="field">
          <label for="fee-${plan.id}">Monthly fee (KES)</label>
          <input type="number" min="0" step="1" id="fee-${plan.id}" value="${plan.monthly_fee}" required />
        </div>
        <div class="field">
          <label for="reg-${plan.id}">Registration fee (KES)</label>
          <input type="number" min="0" step="1" id="reg-${plan.id}" value="${plan.registration_fee}" required />
        </div>
      </div>
      <div class="status-line" data-status></div>
      <div class="modal-actions" style="margin-top:4px;">
        <button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
      </div>
    </form>
    <button type="button" class="btn btn-ghost btn-sm" data-edit-toggle>Edit pricing</button>
  `;

  const view = el.querySelector("[data-view]");
  const editToggle = el.querySelector("[data-edit-toggle]");
  const form = el.querySelector("[data-edit]");
  const status = el.querySelector("[data-status]");

  editToggle.addEventListener("click", () => {
    view.hidden = true;
    editToggle.hidden = true;
    form.hidden = false;
  });

  form.querySelector("[data-cancel]").addEventListener("click", () => {
    form.hidden = true;
    view.hidden = false;
    editToggle.hidden = false;
    status.textContent = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const monthly_fee = Number(el.querySelector(`#fee-${plan.id}`).value);
    const registration_fee = Number(el.querySelector(`#reg-${plan.id}`).value);
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    status.textContent = "Saving…";
    status.className = "status-line";

    const { error } = await supabaseClient.rpc("update_plan_pricing", {
      plan_id: plan.id,
      monthly_fee,
      registration_fee,
    });

    submitBtn.disabled = false;
    if (error) {
      status.textContent = error.message;
      status.className = "status-line err";
      return;
    }
    plan.monthly_fee = monthly_fee;
    plan.registration_fee = registration_fee;
    view.innerHTML = `KES ${monthly_fee} <small>/ month</small>`;
    form.hidden = true;
    view.hidden = false;
    editToggle.hidden = false;
    showToast(`${plan.name} pricing updated`);
  });

  return el;
}

// ---------- Staff accounts ----------

async function loadStaff() {
  const tbody = document.getElementById("staff-table-body");
  const { data, error } = await supabaseClient
    .from("staff_users")
    .select("id, full_name, email, role, status")
    .order("full_name", { ascending: true });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4" class="status-line err">Could not load staff: ${error.message}</td></tr>`;
    return;
  }

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="4">No staff accounts yet. Invite the first one above.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  data.forEach((staff) => tbody.appendChild(renderStaffRow(staff)));
}

function renderStaffRow(staff) {
  const tr = document.createElement("tr");
  const isActive = staff.status === "active";

  tr.innerHTML = `
    <td>
      <div>${staff.full_name}</div>
      <div class="hint">${staff.email}</div>
    </td>
    <td>
      <select data-role>
        <option value="admin" ${staff.role === "admin" ? "selected" : ""}>Admin</option>
        <option value="registrar" ${staff.role === "registrar" ? "selected" : ""}>Registrar</option>
        <option value="cashier" ${staff.role === "cashier" ? "selected" : ""}>Cashier</option>
      </select>
    </td>
    <td><span class="badge ${isActive ? "active" : "inactive"}">${isActive ? "Active" : "Deactivated"}</span></td>
    <td style="text-align:right;">
      <button type="button" class="btn btn-ghost btn-sm" data-toggle-status>${isActive ? "Deactivate" : "Reactivate"}</button>
    </td>
  `;

  const roleSelect = tr.querySelector("[data-role]");
  roleSelect.addEventListener("change", async () => {
    const newRole = roleSelect.value;
    const previous = staff.role;
    const { error } = await supabaseClient.rpc("update_staff_role", {
      staff_id: staff.id,
      role: newRole,
    });
    if (error) {
      showToast(`Could not update role: ${error.message}`);
      roleSelect.value = previous;
      return;
    }
    staff.role = newRole;
    showToast(`${staff.full_name}'s role updated to ${newRole}`);
  });

  tr.querySelector("[data-toggle-status]").addEventListener("click", async (e) => {
    const nextStatus = isActive ? "inactive" : "active";
    e.target.disabled = true;
    const { error } = await supabaseClient.rpc("set_staff_status", {
      staff_id: staff.id,
      status: nextStatus,
    });
    e.target.disabled = false;
    if (error) {
      showToast(`Could not update status: ${error.message}`);
      return;
    }
    staff.status = nextStatus;
    tr.replaceWith(renderStaffRow(staff));
    showToast(`${staff.full_name} ${nextStatus === "active" ? "reactivated" : "deactivated"}`);
  });

  return tr;
}

function wireStaffModal() {
  const backdrop = document.getElementById("invite-modal");
  const openBtn = document.getElementById("invite-staff-btn");
  const cancelBtn = document.getElementById("invite-cancel");
  const form = document.getElementById("invite-form");
  const status = document.getElementById("invite-status");

  openBtn.addEventListener("click", () => {
    form.reset();
    status.textContent = "";
    backdrop.classList.add("show");
    form.querySelector("input").focus();
  });

  cancelBtn.addEventListener("click", () => backdrop.classList.remove("show"));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.classList.remove("show");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const full_name = document.getElementById("invite-name").value.trim();
    const email = document.getElementById("invite-email").value.trim();
    const role = document.getElementById("invite-role").value;
    const submitBtn = form.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    status.textContent = "Sending invite…";
    status.className = "status-line";

    const { error } = await supabaseClient.rpc("invite_staff_member", {
      full_name,
      email,
      role,
    });

    submitBtn.disabled = false;
    if (error) {
      status.textContent = error.message;
      status.className = "status-line err";
      return;
    }
    backdrop.classList.remove("show");
    showToast(`Invite sent to ${email}`);
    loadStaff();
  });
}

// ---------- General system settings ----------

async function loadSystemSettings() {
  const form = document.getElementById("system-settings-form");
  const { data, error } = await supabaseClient.from("system_settings").select("*").single();

  if (error) {
    document.getElementById("system-status").textContent = `Could not load settings: ${error.message}`;
    document.getElementById("system-status").className = "status-line err";
    return;
  }

  form.org_name.value = data.org_name || "";
  form.org_phone.value = data.org_phone || "";
  form.org_email.value = data.org_email || "";
  form.org_address.value = data.org_address || "";
  form.receipt_footer_note.value = data.receipt_footer_note || "";
  form.card_issuance_enabled.checked = !!data.card_issuance_enabled;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("system-status");
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    status.textContent = "Saving…";
    status.className = "status-line";

    const payload = {
      org_name: form.org_name.value.trim(),
      org_phone: form.org_phone.value.trim(),
      org_email: form.org_email.value.trim(),
      org_address: form.org_address.value.trim(),
      receipt_footer_note: form.receipt_footer_note.value.trim(),
      card_issuance_enabled: form.card_issuance_enabled.checked,
    };

    const { error: saveError } = await supabaseClient.rpc("update_system_settings", { payload });

    submitBtn.disabled = false;
    if (saveError) {
      status.textContent = saveError.message;
      status.className = "status-line err";
      return;
    }
    status.textContent = "Saved";
    status.className = "status-line ok";
    showToast("System settings updated");
  });
}
