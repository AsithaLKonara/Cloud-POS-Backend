import { Router } from 'express';
import { SuperAdminController } from '../controllers/superadmin.controller';

const router = Router();
const controller = new SuperAdminController();

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
router.patch('/tenants/:tenantId/status', (req, res) => controller.updateTenantStatus(req, res));
router.patch('/tenants/:tenantId/trial', (req, res) => controller.extendTrial(req, res));

// Infrastructure & Cluster Telemetry
router.get('/cluster', (req, res) => controller.getCluster(req, res));

// Subscription Plans Pricing & Platform Invoices
router.patch('/plans/:tier/price', (req, res) => controller.updatePlanPrice(req, res));
router.post('/invoices', (req, res) => controller.generateInvoice(req, res));
router.patch('/invoices/:invoiceId/status', (req, res) => controller.updateInvoiceStatus(req, res));

export default router;
