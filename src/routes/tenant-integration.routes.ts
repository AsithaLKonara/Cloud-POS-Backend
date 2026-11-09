import { Router } from 'express';
import { TenantIntegrationController } from '../controllers/tenant-integration.controller';
import { WhatsAppWebhookController } from '../controllers/whatsapp-webhook.controller';

const router = Router();
const controller = new TenantIntegrationController();
const webhookController = new WhatsAppWebhookController();

// Meta WhatsApp Cloud API Public Webhooks
router.get('/whatsapp/webhook', (req, res) => webhookController.verifyWebhook(req, res));
router.post('/whatsapp/webhook', (req, res) => webhookController.handleIncoming(req, res));

// Query integrations for a tenant
router.get('/:tenantId', (req, res) => controller.getIntegrations(req, res));

// Configure payment gateways (PayHere, Koko, WebXPay, LankaQR, Direct Bank)
router.put('/:tenantId/payments/:gateway', (req, res) => controller.updatePaymentGateway(req, res));

// Configure couriers (Koombiyo, PromptX, Domex)
router.put('/:tenantId/couriers/:courier', (req, res) => controller.updateCourier(req, res));

// Configure messaging (Meta WhatsApp Cloud API)
router.put('/:tenantId/messaging/:provider', (req, res) => controller.updateMessaging(req, res));

// Send test WhatsApp message
router.post('/:tenantId/whatsapp/test-message', (req, res) => controller.sendTestWhatsAppMessage(req, res));

// Test connection / API credentials
router.post('/:tenantId/test', (req, res) => controller.testConnection(req, res));

export default router;
