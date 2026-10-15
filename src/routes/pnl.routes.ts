import { Router } from 'express';
import { PnLController } from '../controllers/pnl.controller';
import { authenticateJWT, requireRole } from '../middlewares/auth.middleware';

const router = Router();
const controller = new PnLController();

// Canonical Profit and Loss is restricted to Super Admin and Admin
router.get('/', authenticateJWT, requireRole('SUPER_ADMIN', 'ADMIN'), controller.getStatement.bind(controller));

export default router;
