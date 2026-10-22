import { Router } from 'express';
import { HeadlessPaymentController } from '../../controllers/headless/payment.controller';
import { requireScope } from '../../middlewares/scope.middleware';
import { authenticateApiKey } from '../../middlewares/api-key.middleware';

const router = Router();
const controller = new HeadlessPaymentController();

router.get('/available-methods', authenticateApiKey, requireScope('payments:read', 'payments:process'), (req, res) => controller.getAvailableGateways(req, res));
router.get('/gateways', authenticateApiKey, requireScope('payments:read', 'payments:process'), (req, res) => controller.getAvailableGateways(req, res));
router.post('/initiate', authenticateApiKey, requireScope('payments:process'), (req, res) => controller.initiatePayment(req, res));

// Payment Gateway notification callbacks (unauthenticated because gateways call directly with signatures)
router.post('/notify/payhere/:tenantId', (req, res) => controller.handlePayHereNotification(req, res));

export default router;
