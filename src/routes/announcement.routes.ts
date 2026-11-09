import { Router } from 'express';
import { SuperAdminController } from '../controllers/superadmin.controller';

const router = Router();
const controller = new SuperAdminController();

// Public / Tenant-scoped endpoint to fetch currently active announcements
router.get('/active', (req, res) => controller.getActiveBroadcasts(req, res));

export default router;

