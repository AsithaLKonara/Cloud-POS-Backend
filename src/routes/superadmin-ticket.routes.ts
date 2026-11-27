import { Router } from 'express';
import { SupportTicketController } from '../controllers/support-ticket.controller';
import { authenticateJWT, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Guard all superadmin helpdesk routes with JWT authentication and SuperAdmin role authorization
router.use(
  authenticateJWT,
  requireRole('Super Admin', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPER_PLATFORM_ADMIN')
);

// Helpdesk Metrics & KPIs
router.get('/metrics', SupportTicketController.getHelpdeskMetrics);

// Canned Responses (Macros)
router.get('/canned', SupportTicketController.getCannedResponses);
router.post('/canned', SupportTicketController.createCannedResponse);

// Global Triage & Ticket Management
router.get('/', SupportTicketController.getSuperadminTickets);
router.get('/:id', SupportTicketController.getSuperadminTicketDetail);
router.post('/:id/messages', SupportTicketController.addSuperadminMessage);
router.patch('/:id/status', SupportTicketController.updateSuperadminStatus);
router.patch('/:id/assign', SupportTicketController.assignTicket);
router.patch('/:id/priority', SupportTicketController.updatePriority);

export default router;
