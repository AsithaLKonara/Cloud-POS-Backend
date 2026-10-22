import { Router } from 'express';
import { HeadlessOrderController } from '../../controllers/headless/order.controller';
import { requireScope } from '../../middlewares/scope.middleware';

const router = Router();
const controller = new HeadlessOrderController();

router.post('/calculate', requireScope('orders:read', 'checkout:calculate'), (req, res) => controller.calculateCheckout(req, res));
router.post('/', requireScope('orders:write', 'orders:create'), (req, res) => controller.createOrder(req, res));
router.get('/:idOrRef', requireScope('orders:read'), (req, res) => controller.getOrder(req, res));

export default router;
