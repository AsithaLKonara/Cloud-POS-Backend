import { Router } from 'express';
import { authenticateApiKey } from '../../middlewares/api-key.middleware';
import catalogRoutes from './catalog.routes';
import customerRoutes from './customer.routes';
import orderRoutes from './order.routes';
import paymentRoutes from './payment.routes';

const router = Router();

// Unauthenticated gateway callbacks (PayHere server-to-server IPN)
router.use('/payments', paymentRoutes);

// Protected Headless endpoints requiring X-Client-Id and X-Api-Key
router.use('/catalog', authenticateApiKey, catalogRoutes);
router.use('/auth', authenticateApiKey, customerRoutes);
router.use('/orders', authenticateApiKey, orderRoutes);
router.use('/checkout', authenticateApiKey, orderRoutes);

export default router;
