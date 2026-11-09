import { Router } from 'express';
import * as orderController from '../controllers/order.controller';
import { authenticateJWT, requirePermission } from '../middlewares/auth.middleware';
import { auditLog } from '../middlewares/audit.middleware';

const router = Router();

router.get('/customers/search', authenticateJWT, requirePermission("orders:view"), orderController.searchCustomer);
router.post('/quick-dispatch', authenticateJWT, requirePermission("orders:create"), auditLog('Order', 'CREATE'), orderController.createQuickDispatch);
router.get('/', authenticateJWT, requirePermission("orders:view"), orderController.getOrders);
router.get('/track', orderController.trackOrder);
router.get('/track/phone/:phone', orderController.trackOrdersByPhone);
router.get('/confirmation/:orderNumber', orderController.getOrderConfirmation);
router.get('/:id', authenticateJWT, requirePermission("orders:view"), orderController.getOrderById);
router.patch('/:id/status', authenticateJWT, requirePermission("orders:edit_status"), auditLog('Order', 'UPDATE'), orderController.updateOrderStatus);
router.post('/:id/refund', authenticateJWT, requirePermission("orders:cancel_refund"), auditLog('Order', 'UPDATE'), orderController.refundOrder);
router.post('/:id/refund/partial', authenticateJWT, requirePermission("orders:cancel_refund"), auditLog('Order', 'UPDATE'), orderController.refundPartialOrder);
router.post('/:id/send-whatsapp-receipt', authenticateJWT, orderController.sendWhatsAppReceipt);
router.post('/fardar-webhook', orderController.fardarWebhook);

export default router;
