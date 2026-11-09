import { Router } from 'express';
import * as erpController from '../controllers/erp.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';
import { requirePlanFeature } from '../middlewares/featureGuard.middleware';

const router = Router();

// General Ledger (GL)
router.post('/gl/accounts/init', authenticateJWT, requirePlanFeature('DOUBLE_ENTRY_GL'), erpController.initChartOfAccounts);
router.get('/gl/accounts', authenticateJWT, requirePlanFeature('DOUBLE_ENTRY_GL'), erpController.getChartOfAccounts);
router.get('/gl/journals', authenticateJWT, requirePlanFeature('DOUBLE_ENTRY_GL'), erpController.getJournalEntries);
router.post('/gl/journals', authenticateJWT, requirePlanFeature('DOUBLE_ENTRY_GL'), erpController.postJournalEntry);
router.get('/gl/trial-balance', authenticateJWT, requirePlanFeature('DOUBLE_ENTRY_GL'), erpController.getTrialBalance);
router.get('/gl/balance-sheet', authenticateJWT, requirePlanFeature('DOUBLE_ENTRY_GL'), erpController.getBalanceSheet);

// Accounts Payable (AP)
router.post('/ap/bills', authenticateJWT, requirePlanFeature('ACCOUNTS_PAYABLE'), erpController.createVendorBill);
router.get('/ap/bills', authenticateJWT, requirePlanFeature('ACCOUNTS_PAYABLE'), erpController.getVendorBills);
router.post('/ap/payments', authenticateJWT, requirePlanFeature('ACCOUNTS_PAYABLE'), erpController.recordVendorPayment);
router.get('/ap/aging', authenticateJWT, requirePlanFeature('ACCOUNTS_PAYABLE'), erpController.getApAgingReport);

// Accounts Receivable (AR)
router.post('/ar/invoices', authenticateJWT, requirePlanFeature('ACCOUNTS_RECEIVABLE'), erpController.createSalesInvoice);
router.get('/ar/invoices', authenticateJWT, requirePlanFeature('ACCOUNTS_RECEIVABLE'), erpController.getSalesInvoices);
router.post('/ar/payments', authenticateJWT, requirePlanFeature('ACCOUNTS_RECEIVABLE'), erpController.recordCustomerPayment);
router.get('/ar/aging', authenticateJWT, requirePlanFeature('ACCOUNTS_RECEIVABLE'), erpController.getArAgingReport);
router.post('/ar/invoices/:invoiceId/whatsapp-reminder', authenticateJWT, requirePlanFeature('ACCOUNTS_RECEIVABLE'), erpController.sendWhatsAppArReminder);

// Bill of Materials (BOM)
router.post('/bom', authenticateJWT, requirePlanFeature('RECIPE_BOM'), erpController.upsertBom);
router.get('/bom/:variantId', authenticateJWT, requirePlanFeature('RECIPE_BOM'), erpController.getBomForVariant);

// Stocktaking / Cycle Counting
router.post('/stocktaking/start', authenticateJWT, requirePlanFeature('CYCLE_COUNT'), erpController.startStocktake);
router.get('/stocktaking', authenticateJWT, requirePlanFeature('CYCLE_COUNT'), erpController.getStocktakeSessions);
router.get('/stocktaking/:id', authenticateJWT, requirePlanFeature('CYCLE_COUNT'), erpController.getStocktakeSession);
router.post('/stocktaking/:id/counts', authenticateJWT, requirePlanFeature('CYCLE_COUNT'), erpController.recordStocktakeCounts);
router.post('/stocktaking/:id/reconcile', authenticateJWT, requirePlanFeature('CYCLE_COUNT'), erpController.reconcileStocktake);

export default router;

