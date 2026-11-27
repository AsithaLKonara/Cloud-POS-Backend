import { Router } from 'express';
import { SupportTicketController } from '../controllers/support-ticket.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();

// Guard all tenant support routes with JWT authentication
router.use(authenticateJWT);

// Tenant Support Ticket Management
router.get('/', SupportTicketController.getTenantTickets);
router.post('/', SupportTicketController.createTicket);
router.get('/:id', SupportTicketController.getTenantTicketDetail);
router.post('/:id/messages', SupportTicketController.addTenantMessage);
router.patch('/:id/status', SupportTicketController.updateTenantTicketStatus);
router.post('/:id/csat', SupportTicketController.submitCsat);

export default router;
