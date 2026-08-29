// ============================================================
// ADMIN AGENTS - COMPLETE
// ============================================================

let currentAgentId = null;

document.addEventListener('DOMContentLoaded', async function() {
    const authenticated = await checkAdminAuth();
    if (authenticated) {
        updateAdminUI();
        loadApplications();
        loadSalesCodes();
        loadAllAgents();
        loadAgentStats();
        loadAgentSelect();
        
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.tab-btn').forEach(b => {
                    b.style.background = 'transparent';
                    b.style.color = '#6b7280';
                    b.style.boxShadow = 'none';
                });
                this.style.background = 'white';
                this.style.color = '#0b5d3b';
                this.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
                
                const tab = this.dataset.tab;
                document.querySelectorAll('.tab-content').forEach(c => {
                    c.style.display = 'none';
                });
                document.getElementById('tab-' + tab).style.display = 'block';
            });
        });
    }
});

// ============================================================
// LOAD AGENT STATS
// ============================================================

async function loadAgentStats() {
    try {
        // Pending count
        const { count: pending } = await window.supabaseClient
            .from('agent_applications')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');
        
        // Active agents
        const { count: active } = await window.supabaseClient
            .from('agent_profiles')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'approved');
        
        document.getElementById('pendingCount').textContent = pending || 0;
        document.getElementById('activeCount').textContent = active || 0;
        document.getElementById('pendingBadge').textContent = pending || 0;
        
    } catch (error) {
        console.error('Stats error:', error);
    }
}

// ============================================================
// LOAD APPLICATIONS
// ============================================================

async function loadApplications() {
    const container = document.getElementById('applicationsContainer');
    
    try {
        const { data, error } = await window.supabaseClient
            .from('agent_applications')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        document.getElementById('appCount').textContent = `${data?.length || 0} applications`;
        
        if (!data || data.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:#6b7280;">No applications found</div>`;
            return;
        }
        
        container.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Status</th>
                            <th>Date</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(app => `
                            <tr>
                                <td><strong>${app.full_name || 'N/A'}</strong></td>
                                <td>${app.email || '-'}</td>
                                <td>${app.phone || '-'}</td>
                                <td><span class="status-badge ${app.status}">${app.status || 'pending'}</span></td>
                                <td>${app.created_at ? new Date(app.created_at).toLocaleDateString('en-KE') : '-'}</td>
                                <td>
                                    ${app.status === 'pending' ? `
                                        <button onclick="viewApplication('${app.id}')" class="btn-sm primary">Review</button>
                                    ` : `
                                        <span style="color:#6b7280;font-size:12px;">${app.status === 'approved' ? '✅ Approved' : '❌ Rejected'}</span>
                                    `}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
    } catch (error) {
        console.error('Applications error:', error);
        container.innerHTML = `<div style="text-align:center;padding:20px;color:#dc3545;">Error loading applications</div>`;
    }
}

// ============================================================
// VIEW APPLICATION
// ============================================================

async function viewApplication(appId) {
    currentAgentId = appId;
    
    try {
        const { data, error } = await window.supabaseClient
            .from('agent_applications')
            .select('*')
            .eq('id', appId)
            .single();
        
        if (error) throw error;
        
        const modal = document.getElementById('agentModal');
        const body = document.getElementById('modalBody');
        
        document.getElementById('modalTitle').textContent = 'Review Agent Application';
        
        body.innerHTML = `
            <div style="margin-bottom:16px;">
                <p><strong>Full Name:</strong> ${data.full_name || 'N/A'}</p>
                <p><strong>Email:</strong> ${data.email || 'N/A'}</p>
                <p><strong>Phone:</strong> ${data.phone || 'N/A'}</p>
                <p><strong>ID Number:</strong> ${data.id_number || 'N/A'}</p>
                <p><strong>County:</strong> ${data.county || 'N/A'}</p>
                <p><strong>Location:</strong> ${data.location || 'N/A'}</p>
                <p><strong>Experience:</strong> ${data.experience || 'None provided'}</p>
                <p><strong>Referral Code:</strong> ${data.referral_code || 'None'}</p>
                <div style="background:#f3f4f6;padding:12px;border-radius:8px;margin:12px 0;">
                    <p style="font-weight:600;margin-bottom:4px;">Why they want to join:</p>
                    <p style="margin:0;">${data.reason || 'N/A'}</p>
                </div>
                <p><strong>Status:</strong> <span class="status-badge ${data.status}">${data.status || 'pending'}</span></p>
                <p><strong>Applied:</strong> ${data.created_at ? new Date(data.created_at).toLocaleString('en-KE') : '-'}</p>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                ${data.status === 'pending' ? `
                    <button onclick="approveAgent('${appId}')" class="btn-sm success" style="padding:10px 20px;font-size:14px;">
                        <i class="fas fa-check"></i> Approve
                    </button>
                    <button onclick="rejectAgent('${appId}')" class="btn-sm danger" style="padding:10px 20px;font-size:14px;">
                        <i class="fas fa-times"></i> Reject
                    </button>
                ` : `
                    <span style="color:#6b7280;">Application already ${data.status}</span>
                `}
                <button onclick="closeModal()" class="btn-sm gray">Close</button>
            </div>
        `;
        
        modal.classList.add('show');
        
    } catch (error) {
        console.error('View application error:', error);
        showAlert('Error loading application details.', 'error');
    }
}

// ============================================================
// APPROVE AGENT
// ============================================================

async function approveAgent(appId) {
    if (!confirm('Approve this agent application?')) return;
    
    try {
        // Get application data
        const { data: app, error: getError } = await window.supabaseClient
            .from('agent_applications')
            .select('*')
            .eq('id', appId)
            .single();
        
        if (getError) throw getError;
        
        // Update application status
        const { error: updateError } = await window.supabaseClient
            .from('agent_applications')
            .update({ 
                status: 'approved',
                reviewed_at: new Date().toISOString()
            })
            .eq('id', appId);
        
        if (updateError) throw updateError;
        
        // Create agent profile
        const { error: profileError } = await window.supabaseClient
            .from('agent_profiles')
            .insert({
                full_name: app.full_name,
                email: app.email,
                phone: app.phone,
                id_number: app.id_number,
                county: app.county,
                location: app.location,
                status: 'approved',
                commission_rate: 10, // Default 10%
                approved_at: new Date().toISOString()
            });
        
        if (profileError) throw profileError;
        
        // Generate initial sales codes
        await generateInitialSalesCodes(app.email, app.full_name);
        
        closeModal();
        showAlert('Agent approved successfully! Sales codes generated.', 'success');
        loadApplications();
        loadAllAgents();
        loadAgentStats();
        loadAgentSelect();
        
    } catch (error) {
        console.error('Approve error:', error);
        showAlert('Error approving agent: ' + error.message, 'error');
    }
}

// ============================================================
// REJECT AGENT
// ============================================================

async function rejectAgent(appId) {
    const reason = prompt('Please provide a reason for rejection:');
    if (reason === null) return;
    
    try {
        const { error } = await window.supabaseClient
            .from('agent_applications')
            .update({ 
                status: 'rejected',
                rejection_reason: reason,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', appId);
        
        if (error) throw error;
        
        closeModal();
        showAlert('Application rejected.', 'info');
        loadApplications();
        loadAgentStats();
        
    } catch (error) {
        console.error('Reject error:', error);
        showAlert('Error rejecting application.', 'error');
    }
}

// ============================================================
// GENERATE INITIAL SALES CODES
// ============================================================

async function generateInitialSalesCodes(email, fullName) {
    try {
        // Generate 5 initial codes
        const codes = [];
        const prefix = 'MAS';
        const agentCode = email.substring(0, 3).toUpperCase();
        
        for (let i = 0; i < 5; i++) {
            const random = Math.random().toString(36).substring(2, 6).toUpperCase();
            codes.push({
                code: `${prefix}-${agentCode}-${random}`,
                agent_email: email,
                agent_name: fullName,
                status: 'active',
                used: false,
                created_at: new Date().toISOString()
            });
        }
        
        const { error } = await window.supabaseClient
            .from('sales_codes')
            .insert(codes);
        
        if (error) throw error;
        
        console.log('Initial sales codes generated for:', email);
        
    } catch (error) {
        console.error('Generate initial codes error:', error);
        // Don't throw - agent is already approved
    }
}

// ============================================================
// CREATE SALES CODE
// ============================================================

async function createSalesCode(event) {
    event.preventDefault();
    
    const agentSelect = document.getElementById('agentSelect');
    const codePrefix = document.getElementById('codePrefix').value.trim() || 'MASIKA';
    const codeCount = parseInt(document.getElementById('codeCount').value);
    const expiryDate = document.getElementById('codeExpiry').value;
    
    if (!agentSelect.value) {
        showAlert('Please select an agent.', 'error');
        return;
    }
    
    if (!codeCount || codeCount < 1 || codeCount > 100) {
        showAlert('Please enter a valid number of codes (1-100).', 'error');
        return;
    }
    
    try {
        // Get agent details
        const { data: agent, error: agentError } = await window.supabaseClient
            .from('agent_profiles')
            .select('email, full_name')
            .eq('id', agentSelect.value)
            .single();
        
        if (agentError) throw agentError;
        
        // Generate codes
        const codes = [];
        const prefix = codePrefix.toUpperCase().substring(0, 6);
        const agentCode = agent.email.substring(0, 3).toUpperCase();
        
        for (let i = 0; i < codeCount; i++) {
            const random = Math.random().toString(36).substring(2, 6).toUpperCase();
            const code = `${prefix}-${agentCode}-${random}`;
            codes.push({
                code: code,
                agent_email: agent.email,
                agent_name: agent.full_name,
                agent_id: agentSelect.value,
                status: 'active',
                used: false,
                expires_at: expiryDate || null,
                created_at: new Date().toISOString()
            });
        }
        
        const { error } = await window.supabaseClient
            .from('sales_codes')
            .insert(codes);
        
        if (error) throw error;
        
        showAlert(`${codeCount} sales codes generated for ${agent.full_name}!`, 'success');
        document.getElementById('salesCodeForm').reset();
        loadSalesCodes();
        
    } catch (error) {
        console.error('Create sales code error:', error);
        showAlert('Error generating sales codes.', 'error');
    }
}

// ============================================================
// LOAD SALES CODES
// ============================================================

async function loadSalesCodes() {
    const container = document.getElementById('salesCodesContainer');
    
    try {
        const { data, error } = await window.supabaseClient
            .from('sales_codes')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        document.getElementById('codeCountDisplay').textContent = `${data?.length || 0} codes`;
        
        if (!data || data.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:#6b7280;">No sales codes generated yet</div>`;
            return;
        }
        
        container.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Sales Code</th>
                            <th>Agent</th>
                            <th>Status</th>
                            <th>Used</th>
                            <th>Created</th>
                            <th>Expires</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(code => `
                            <tr>
                                <td><strong style="font-family:monospace;">${code.code}</strong></td>
                                <td>${code.agent_name || '-'}</td>
                                <td><span class="status-badge ${code.status}">${code.status || 'active'}</span></td>
                                <td>${code.used ? '✅ Used' : '⬜ Available'}</td>
                                <td>${code.created_at ? new Date(code.created_at).toLocaleDateString('en-KE') : '-'}</td>
                                <td>${code.expires_at ? new Date(code.expires_at).toLocaleDateString('en-KE') : 'Never'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
    } catch (error) {
        console.error('Sales codes error:', error);
        container.innerHTML = `<div style="text-align:center;padding:20px;color:#dc3545;">Error loading sales codes</div>`;
    }
}

// ============================================================
// LOAD ALL AGENTS
// ============================================================

async function loadAllAgents() {
    const container = document.getElementById('allAgentsContainer');
    
    try {
        const { data, error } = await window.supabaseClient
            .from('agent_profiles')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        document.getElementById('agentCountDisplay').textContent = `${data?.length || 0} agents`;
        
        if (!data || data.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:#6b7280;">No agents registered</div>`;
            return;
        }
        
        container.innerHTML = `
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Status</th>
                            <th>Commission</th>
                            <th>Joined</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(agent => `
                            <tr>
                                <td><strong>${agent.full_name || 'N/A'}</strong></td>
                                <td>${agent.email || '-'}</td>
                                <td>${agent.phone || '-'}</td>
                                <td><span class="status-badge ${agent.status}">${agent.status || 'pending'}</span></td>
                                <td>${agent.commission_rate || 10}%</td>
                                <td>${agent.created_at ? new Date(agent.created_at).toLocaleDateString('en-KE') : '-'}</td>
                                <td>
                                    <button onclick="toggleAgentStatus('${agent.id}', '${agent.status}')" class="btn-sm ${agent.status === 'approved' ? 'danger' : 'success'}">
                                        ${agent.status === 'approved' ? 'Deactivate' : 'Activate'}
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
    } catch (error) {
        console.error('All agents error:', error);
        container.innerHTML = `<div style="text-align:center;padding:20px;color:#dc3545;">Error loading agents</div>`;
    }
}

// ============================================================
// LOAD AGENT SELECT (for sales codes)
// ============================================================

async function loadAgentSelect() {
    const select = document.getElementById('agentSelect');
    
    try {
        const { data, error } = await window.supabaseClient
            .from('agent_profiles')
            .select('id, full_name, email')
            .eq('status', 'approved')
            .order('full_name');
        
        if (error) throw error;
        
        select.innerHTML = `
            <option value="">Select an agent...</option>
            ${data.map(agent => `
                <option value="${agent.id}">${agent.full_name} (${agent.email})</option>
            `).join('')}
        `;
        
    } catch (error) {
        console.error('Load agent select error:', error);
    }
}

// ============================================================
// TOGGLE AGENT STATUS
// ============================================================

async function toggleAgentStatus(agentId, currentStatus) {
    const newStatus = currentStatus === 'approved' ? 'inactive' : 'approved';
    const action = newStatus === 'approved' ? 'activate' : 'deactivate';
    
    if (!confirm(`Are you sure you want to ${action} this agent?`)) return;
    
    try {
        const { error } = await window.supabaseClient
            .from('agent_profiles')
            .update({ status: newStatus })
            .eq('id', agentId);
        
        if (error) throw error;
        
        showAlert(`Agent ${action}d successfully.`, 'success');
        loadAllAgents();
        loadAgentStats();
        
    } catch (error) {
        console.error('Toggle agent error:', error);
        showAlert('Error updating agent status.', 'error');
    }
}

// ============================================================
// MODAL FUNCTIONS
// ============================================================

function closeModal() {
    document.getElementById('agentModal').classList.remove('show');
}

// ============================================================
// ALERT FUNCTIONS
// ============================================================

function showAlert(message, type = 'error') {
    const alertBox = document.getElementById('alertBox');
    alertBox.textContent = message;
    alertBox.className = `alert show ${type}`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    setTimeout(() => {
        alertBox.className = 'alert';
    }, 5000);
}

// ============================================================
// EXPOSE FUNCTIONS
// ============================================================

window.viewApplication = viewApplication;
window.approveAgent = approveAgent;
window.rejectAgent = rejectAgent;
window.createSalesCode = createSalesCode;
window.toggleAgentStatus = toggleAgentStatus;
window.closeModal = closeModal;
window.loadAllAgents = loadAllAgents;
window.loadSalesCodes = loadSalesCodes;
