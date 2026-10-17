import { Router } from 'express';
import { SuperAdminController } from '../controllers/superadmin.controller';

const router = Router();
const controller = new SuperAdminController();

// Platform Executive KPIs & Financials
router.get('/kpis', (req, res) => controller.getKPIs(req, res));
router.get('/financials', (req, res) => controller.getFinancials(req, res));
router.post('/expenses', (req, res) => controller.addExpense(req, res));

// Tenant Governance & Directory
router.get('/tenants', (req, res) => controller.getTenants(req, res));
router.post('/tenants/provision', (req, res) => controller.provisionTurnkeyTenant(req, res));
router.patch('/tenants/:tenantId/status', (req, res) => controller.updateTenantStatus(req, res));
router.patch('/tenants/:tenantId/trial', (req, res) => controller.extendTrial(req, res));

// Infrastructure & Cluster Telemetry
router.get('/cluster', (req, res) => controller.getCluster(req, res));

export default router;
