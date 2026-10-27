import { Router } from 'express';
import {
  getBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  getInventory,
  getStats,
  getTransactions,
  adjustStock,
  getTransfers,
  createTransfer,
  updateTransferStatus,
  createShipment,
  trackShipment,
  reserveStock,
  releaseStock
} from '../controllers/inventory.controller';
import { authenticateJWT, optionalAuth, requirePermission } from '../middlewares/auth.middleware';
import { auditLog } from '../middlewares/audit.middleware';

const router = Router();

router.get('/branches', optionalAuth, getBranches);
router.post('/branches', authenticateJWT, requirePermission("branches:create"), auditLog('Branch', 'CREATE'), createBranch);
router.put('/branches/:id', authenticateJWT, requirePermission("branches:edit"), auditLog('Branch', 'UPDATE'), updateBranch);
router.delete('/branches/:id', authenticateJWT, requirePermission("branches:delete"), auditLog('Branch', 'DELETE'), deleteBranch);

router.get('/', authenticateJWT, requirePermission("inventory:view_stock"), getInventory);
router.get('/stats', authenticateJWT, requirePermission("inventory:view_stock"), getStats);
router.get('/transactions', authenticateJWT, requirePermission("inventory:view_stock"), getTransactions);
router.post('/adjust', authenticateJWT, requirePermission("inventory:adjust_stock"), auditLog('Inventory', 'UPDATE'), adjustStock);
router.post('/reserve', reserveStock);
router.post('/release', releaseStock);
router.get('/transfers', authenticateJWT, requirePermission("inventory:view_stock"), getTransfers);
router.post('/transfers', authenticateJWT, requirePermission("inventory:stock_transfers"), auditLog('Transfer', 'CREATE'), createTransfer);
router.put('/transfers/:id/status', authenticateJWT, requirePermission("inventory:stock_transfers"), auditLog('Transfer', 'UPDATE'), updateTransferStatus);

// Fardar Shipping integration
router.post('/shipping/create', authenticateJWT, requirePermission("shipping:dispatch_fardar"), auditLog('Shipment', 'CREATE'), createShipment);
router.get('/shipping/:trackingNumber', authenticateJWT, requirePermission("shipping:view_queue"), trackShipment);

export default router;
