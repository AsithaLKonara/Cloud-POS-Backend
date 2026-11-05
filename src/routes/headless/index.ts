import { Router } from 'express';
import { authenticateApiKey } from '../../middlewares/api-key.middleware';
import catalogRoutes from './catalog.routes';
import customerRoutes from './customer.routes';
import orderRoutes from './order.routes';
import paymentRoutes from './payment.routes';

const router = Router();

// Middleware to ensure all Developer / Headless API responses include the HTTP Status Code in payload
router.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    if (body && typeof body === 'object') {
      if (Array.isArray(body)) {
        body = {
          statusCode: res.statusCode,
          success: res.statusCode >= 200 && res.statusCode < 400,
          data: body,
        };
      } else if (body.statusCode === undefined) {
        body = {
          statusCode: res.statusCode,
          ...body,
        };
      }
    }
    return originalJson(body);
  };
  next();
});

// Unauthenticated gateway callbacks (PayHere server-to-server IPN)
router.use('/payments', paymentRoutes);

// Protected Headless endpoints requiring X-Client-Id and X-Api-Key
router.use('/catalog', authenticateApiKey, catalogRoutes);
router.use('/auth', authenticateApiKey, customerRoutes);
router.use('/orders', authenticateApiKey, orderRoutes);
router.use('/checkout', authenticateApiKey, orderRoutes);

export default router;
