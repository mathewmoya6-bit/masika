// ============================================================
// ADMIN AGENTS - js/admin/agents.js
// ============================================================

class AdminAgents {
    constructor() {
        this.supabase = adminAuth.getSupabase();
        this.allAgents = [];
        this.allBranches = [];
        this.editingAgentId = null;
    }

    async loadAgents() {
        const container = document.getElementById('agentsList');

        container.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Loading sales agents...</p>
            </div>
        `;

        try {
            const { data, error } = await this.supabase
                .from('sales_agents')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            this.allAgents = data || [];
            this.renderAgents(this.allAgents);
            this.updateAgentCount();

            return { success: true };

        } catch (error) {
            console.error('Load agents error:', error);
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h4>Unable to load agents</h4>
                    <p>${error.message || 'Please try again.'}</p>
                    <br>
                    <button onclick="window.adminAgents.loadAgents()" class="btn btn-primary">
                        <i class="fas fa-sync"></i> Try Again
                    </button>
                </div>
            `;
            return { success: false, error: error.message
