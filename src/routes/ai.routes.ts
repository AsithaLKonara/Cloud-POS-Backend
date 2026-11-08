import { Router } from 'express';
import * as aiController from '../controllers/ai.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();

// Chat & Q&A AI Support Assistant (Tenant-isolated)
router.post('/chat', authenticateJWT, aiController.chatWithAi);
router.get('/suggested-prompts', authenticateJWT, aiController.getSuggestedPrompts);

// Tenant-specific knowledge base management (isolated per tenant)
router.get('/knowledge', authenticateJWT, aiController.getTenantKnowledge);
router.post('/knowledge', authenticateJWT, aiController.addTenantKnowledge);
router.delete('/knowledge/:id', authenticateJWT, aiController.deleteTenantKnowledge);

// AI Integration & Gemini API Configuration
router.get('/config', authenticateJWT, aiController.getAiConfig);
router.put('/config', authenticateJWT, aiController.updateAiConfig);
router.post('/test', authenticateJWT, aiController.testAiConnection);

export default router;

