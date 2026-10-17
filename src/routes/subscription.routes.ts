import { Router } from 'express';
import { SubscriptionController } from '../controllers/subscription.controller';

const router = Router();
const controller = new SubscriptionController();

// Public / Tenant Plan Querying
router.get('/plans', (req, res) => controller.getPlans(req, res));
router.put('/plans/:planKey', (req, res) => controller.updatePlan(req, res));

// Tenant Subscription & Trial Actions
router.post('/tenants/:tenantId/trial', (req, res) => controller.startTrial(req, res));
router.post('/tenants/:tenantId/subscribe', (req, res) => controller.activateSubscription(req, res));
router.get('/tenants/:tenantId/status', (req, res) => controller.getStatus(req, res));

export default router;
