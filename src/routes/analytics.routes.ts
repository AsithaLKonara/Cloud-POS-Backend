import { Router } from 'express';
import { getBusinessOverview, getExecutiveOverview, getBranchDashboard } from '../controllers/analytics.controller';
import { authenticateJWT, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

router.get('/overview', authenticateJWT, requirePermission("reports:view_dashboard"), getBusinessOverview);
router.get('/executive', authenticateJWT, requirePermission("reports:view_dashboard"), getExecutiveOverview);
router.get('/branch-dashboard', authenticateJWT, getBranchDashboard);

export default router;
