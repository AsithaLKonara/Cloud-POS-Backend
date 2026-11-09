import { Router } from 'express';
import { SuperAdminController } from '../controllers/superadmin.controller';
import { authenticateJWT, requireRole } from '../middlewares/auth.middleware';

const router = Router();
const controller = new SuperAdminController();

// Guard all superadmin routes with JWT authentication and SuperAdmin role authorization
router.use(
  authenticateJWT,
  requireRole('Super Admin', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPER_PLATFORM_ADMIN')
);

// Platform Executive KPIs & Financials
router.get('/kpis', (req, res) => controller.getKPIs(req, res));
router.get('/financials', (req, res) => controller.getFinancials(req, res));
router.get('/analytics/monthly', (req, res) => controller.getMonthlyAnalytics(req, res));
router.get('/analytics/breakdown', (req, res) => controller.getRevenueBreakdown(req, res));
router.get('/analytics/top-outlets', (req, res) => controller.getTopOutlets(req, res));
router.post('/expenses', (req, res) => controller.addExpense(req, res));

// Tenant Governance & Directory
router.get('/tenants', (req, res) => controller.getTenants(req, res));
router.post('/tenants/provision', (req, res) => controller.provisionTurnkeyTenant(req, res));
router.put('/tenants/:tenantId', (req, res) => controller.updateTenantSettings(req, res));
router.patch('/tenants/:tenantId/status', (req, res) => controller.updateTenantStatus(req, res));
router.patch('/tenants/:tenantId/trial', (req, res) => controller.extendTrial(req, res));
router.post('/tenants/:tenantId/impersonate', (req, res) => controller.impersonateTenant(req, res));

// Tenant Super Admins Management
router.get('/tenants/:tenantId/admins', (req, res) => controller.getTenantAdmins(req, res));
router.post('/tenants/:tenantId/admins', (req, res) => controller.createTenantAdmin(req, res));
router.patch('/tenants/:tenantId/admins/:adminId/status', (req, res) => controller.updateTenantAdminStatus(req, res));
router.post('/tenants/:tenantId/admins/:adminId/reset-password', (req, res) => controller.resetTenantAdminPassword(req, res));

// Infrastructure & Cluster Telemetry
router.get('/cluster', (req, res) => controller.getCluster(req, res));

// Subscription Plans Pricing, Packages & Platform Invoices
router.get('/plans', (req, res) => controller.getPlans(req, res));
router.post('/plans', (req, res) => controller.createPlan(req, res));
router.put('/plans/:planKey', (req, res) => controller.updatePlan(req, res));
router.delete('/plans/:planKey', (req, res) => controller.deletePlan(req, res));
router.patch('/plans/:tier/price', (req, res) => controller.updatePlanPrice(req, res));
router.post('/tenants/:tenantId/assign-plan', (req, res) => controller.assignPlanToTenant(req, res));
router.post('/invoices', (req, res) => controller.generateInvoice(req, res));
router.patch('/invoices/:invoiceId/status', (req, res) => controller.updateInvoiceStatus(req, res));

// Global Feature Flags & Modular Entitlements
router.get('/features', (req, res) => controller.getFeatureFlags(req, res));
router.patch('/features/global/:key', (req, res) => controller.updateGlobalFeatureFlag(req, res));
router.get('/tenants/:tenantId/entitlements', (req, res) => controller.getTenantEntitlements(req, res));
router.put('/tenants/:tenantId/entitlements', (req, res) => controller.updateTenantEntitlements(req, res));

// Cross-Tenant Security & Global Audit Log
router.get('/audit', (req, res) => controller.getGlobalAuditLogs(req, res));
router.get('/audit/stats', (req, res) => controller.getAuditStats(req, res));

// Automated Dunning, Delinquency & Grace Period Manager
router.get('/dunning', (req, res) => controller.getDelinquencyOverview(req, res));
router.post('/dunning/run', (req, res) => controller.triggerDunningScan(req, res));
router.post('/dunning/tenants/:tenantId/extend-grace', (req, res) => controller.extendGracePeriod(req, res));
router.post('/dunning/tenants/:tenantId/exemption', (req, res) => controller.toggleDunningExemption(req, res));

// Platform Announcements & Broadcasts
router.get('/announcements', (req, res) => controller.getAnnouncements(req, res));
router.post('/announcements', (req, res) => controller.createAnnouncement(req, res));
router.put('/announcements/:id', (req, res) => controller.updateAnnouncement(req, res));
router.patch('/announcements/:id/toggle', (req, res) => controller.toggleAnnouncement(req, res));
router.delete('/announcements/:id', (req, res) => controller.deleteAnnouncement(req, res));

// Database Snapshots, Disaster Recovery & Media Storage Manager
router.get('/backups', (req, res) => controller.getBackups(req, res));
router.post('/backups', (req, res) => controller.createBackup(req, res));
router.delete('/backups/:filename', (req, res) => controller.deleteBackup(req, res));
router.get('/backups/:filename/download', (req, res) => controller.downloadBackup(req, res));
router.get('/storage/stats', (req, res) => controller.getStorageStats(req, res));

// WhatsApp Platform Gateway, Telemetry, Broadcast, AI Sales Agent & Outbound Campaigns
router.get('/whatsapp/telemetry', (req, res) => controller.getWhatsAppTelemetry(req, res));
router.get('/whatsapp/tenants', (req, res) => controller.getWhatsAppTenants(req, res));
router.post('/whatsapp/broadcast', (req, res) => controller.broadcastWhatsAppNotice(req, res));
router.get('/whatsapp/ai-governance', (req, res) => controller.getWhatsAppAiGovernance(req, res));
router.put('/whatsapp/ai-governance', (req, res) => controller.updateWhatsAppAiGovernance(req, res));
router.post('/whatsapp/ai-simulate', (req, res) => controller.simulateWhatsAppAiAgent(req, res));
router.get('/whatsapp/campaigns', (req, res) => controller.getWhatsAppCampaigns(req, res));
router.post('/whatsapp/campaigns/trigger', (req, res) => controller.triggerWhatsAppCampaign(req, res));
router.get('/whatsapp/threads', (req, res) => controller.getWhatsAppThreads(req, res));
router.get('/whatsapp/threads/:tenantId/:phone', (req, res) => controller.getWhatsAppThreadDetails(req, res));
router.post('/whatsapp/threads/reply', (req, res) => controller.sendWhatsAppIntervention(req, res));

export default router;
