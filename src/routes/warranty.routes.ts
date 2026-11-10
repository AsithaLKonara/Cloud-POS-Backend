import { Router } from 'express';
import { WarrantyController } from '../controllers/warranty.controller';
import { authenticateJWT, optionalAuth } from '../middlewares/auth.middleware';

const router = Router();

// Public / Customer / POS Warranty Status Lookup (supports serialNumber, imei, orderNumber, phone)
router.get('/check', optionalAuth, WarrantyController.checkStatus);

// Warranty KPIs & Summary Metrics
router.get('/kpis', authenticateJWT, WarrantyController.getKPIs);

// Serial Numbers Management
router.get('/serials', authenticateJWT, WarrantyController.getSerials);
router.post('/serials', authenticateJWT, WarrantyController.registerSerial);
router.post('/serials/bulk', authenticateJWT, WarrantyController.bulkRegisterSerials);

// Warranty Claims & Service Job Sheets
router.get('/claims', authenticateJWT, WarrantyController.getClaims);
router.post('/claims', optionalAuth, WarrantyController.createClaim);
router.get('/claims/:claimId', authenticateJWT, WarrantyController.getClaimById);
router.put('/claims/:claimId/status', authenticateJWT, WarrantyController.updateClaimStatus);

export default router;
