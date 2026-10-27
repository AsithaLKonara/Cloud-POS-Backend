import { Router } from 'express';
import { productController } from '../controllers/product.controller';
import { authenticateJWT, optionalAuth, requirePermission } from '../middlewares/auth.middleware';
import { auditLog } from '../middlewares/audit.middleware';

const router = Router();

router.get('/', optionalAuth, productController.getAllProducts);
router.get('/filters', optionalAuth, productController.getFilters);
router.get('/:id', optionalAuth, productController.getProductById);
router.get('/slug/:slug', optionalAuth, productController.getProductBySlug);
router.get('/sku/:sku', optionalAuth, productController.getProductBySku);
router.post('/', authenticateJWT, requirePermission("products:create"), auditLog('Product', 'CREATE'), productController.createProduct);
router.patch('/bulk-edit', authenticateJWT, requirePermission("products:edit"), auditLog('Product', 'BULK_UPDATE'), productController.bulkEditProducts);
router.put('/:id', authenticateJWT, requirePermission("products:edit"), auditLog('Product', 'UPDATE'), productController.updateProduct);
router.delete('/:id', authenticateJWT, requirePermission("products:delete"), auditLog('Product', 'DELETE'), productController.deleteProduct);

export default router;
