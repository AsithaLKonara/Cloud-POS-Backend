import { Router } from 'express';
import { ApiKeyController } from '../controllers/api-key.controller';
import { authenticateJWT, requirePermission } from '../middlewares/auth.middleware';

const router = Router();
const controller = new ApiKeyController();

// All management routes require authenticated tenant admin
router.use(authenticateJWT);

router.get('/:tenantId', (req, res) => controller.listKeys(req, res));
router.post('/:tenantId', (req, res) => controller.createKey(req, res));
router.delete('/:tenantId/:id', (req, res) => controller.revokeKey(req, res));

export default router;
