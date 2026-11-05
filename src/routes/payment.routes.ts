import { Router } from 'express';
import { handleWebhook, getPaymentTransactions, getPaymentKpis, retryPayment, getPaymentMethods, getPaymentStatus, handlePaymentReturn, handlePaymentCancel } from '../controllers/payment.controller';

const router = Router();

// Endpoint for payment gateway webhooks
router.post('/webhook/:provider', handleWebhook);

// Endpoints for BNPL provider redirects
router.get('/return', handlePaymentReturn);
router.get('/cancel', handlePaymentCancel);

// Endpoint for retrying a failed payment
router.post('/retry/:orderNumber', retryPayment);

router.get('/', getPaymentTransactions);
router.get('', getPaymentTransactions);
router.get('/transactions', getPaymentTransactions);
router.get('/kpis', getPaymentKpis);
router.get('/methods', getPaymentMethods);
router.get('/status/:orderNumber', getPaymentStatus);

export default router;
