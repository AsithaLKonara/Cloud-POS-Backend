import { Router } from 'express';
import { TenantController } from '../controllers/tenant.controller';

const router = Router();
const tenantController = new TenantController();

// Provisioning & Health
router.post('/provision', (req, res) => tenantController.provision(req, res));
router.post('/', (req, res) => tenantController.provision(req, res));
router.get('/overview', (req, res) => tenantController.getPlatformOverview(req, res));

// Querying & Management
router.get('/current', (req, res) => tenantController.getCurrent(req, res));
router.put('/current', (req, res) => tenantController.update(req, res));
router.patch('/current', (req, res) => tenantController.update(req, res));

router.get('/', (req, res) => tenantController.getAll(req, res));
router.get('/:id', (req, res) => tenantController.getById(req, res));
router.put('/:id', (req, res) => tenantController.update(req, res));
router.patch('/:id', (req, res) => tenantController.update(req, res));
router.get('/:id/usage', (req, res) => tenantController.getUsage(req, res));
router.patch('/:id/status', (req, res) => tenantController.updateStatus(req, res));
router.patch('/:id/plan', (req, res) => tenantController.updatePlan(req, res));

export default router;
