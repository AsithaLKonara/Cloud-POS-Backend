import { Router } from 'express';
import * as posController from '../controllers/pos.controller';
import { authenticateJWT, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

// Sessions
router.post('/sessions/open', authenticateJWT, requirePermission("pos:shift_open_close"), posController.openSession);
router.post('/sessions/close', authenticateJWT, requirePermission("pos:shift_open_close"), posController.closeSession);
router.get('/sessions/current', authenticateJWT, posController.getCurrentSession);
router.get('/sessions/current/expected-closing', authenticateJWT, posController.getExpectedClosing);
router.get('/sessions/summary', authenticateJWT, posController.getSessionSummary);

// Vouchers
router.post('/vouchers/generate', authenticateJWT, requirePermission("pos:sales_mode"), posController.generateVoucher);
router.get('/vouchers/:code', authenticateJWT, posController.validateVoucher);

// Orders & Bill Splitting
router.post('/orders', authenticateJWT, requirePermission("pos:sales_mode"), posController.processPosOrder);
router.post('/orders/:id/split-evenly', authenticateJWT, requirePermission("pos:sales_mode"), posController.splitOrderEvenly);
router.post('/orders/:id/split-items', authenticateJWT, requirePermission("pos:sales_mode"), posController.splitOrderByItems);
router.get('/orders/:id/receipt', authenticateJWT, posController.getOrderReceipt);

// Tables & Service Stations
router.get('/tables', authenticateJWT, posController.getTables);
router.post('/tables', authenticateJWT, requirePermission("pos:sales_mode"), posController.createTable);
router.patch('/tables/:id/status', authenticateJWT, requirePermission("pos:sales_mode"), posController.updateTableStatus);

// Customer Credit & Garage Debt Settlements
router.get('/customers/:id/credit', authenticateJWT, posController.getCustomerCreditLedger);
router.post('/customers/:id/settle-credit', authenticateJWT, requirePermission("pos:sales_mode"), posController.settleCustomerCredit);

export default router;

