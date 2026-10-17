import { Router } from 'express';
import { TenantIntegrationController } from '../controllers/tenant-integration.controller';

const router = Router();
const controller = new TenantIntegrationController();

// Query integrations for a tenant
router.get('/:tenantId', (req, res) => controller.getIntegrations(req, res));

// Configure payment gateways (PayHere, Koko, WebXPay, LankaQR, Direct Bank)
router.put('/:tenantId/payments/:gateway', (req, res) => controller.updatePaymentGateway(req, res));

// Configure couriers (Koombiyo, PromptX, Domex)
router.put('/:tenantId/couriers/:courier', (req, res) => controller.updateCourier(req, res));

// Test connection / API credentials
router.post('/:tenantId/test', (req, res) => controller.testConnection(req, res));

export default router;
