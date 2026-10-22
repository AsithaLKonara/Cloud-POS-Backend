import { Router } from 'express';
import { HeadlessCustomerController } from '../../controllers/headless/customer.controller';
import { requireScope } from '../../middlewares/scope.middleware';

const router = Router();
const controller = new HeadlessCustomerController();

router.post('/register', requireScope('customers:write'), (req, res) => controller.register(req, res));
router.post('/login', requireScope('customers:read'), (req, res) => controller.login(req, res));
router.get('/me', requireScope('customers:read'), (req, res) => controller.getProfile(req, res));

export default router;
