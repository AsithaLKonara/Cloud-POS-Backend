import { Request, Response, NextFunction } from 'express';
import { SupportTicketService } from '../services/support-ticket.service';
import { TicketStatus, TicketPriority, TicketCategory } from '@prisma/client';

export class SupportTicketController {
  // ==========================================
  // TENANT CONTROLLER HANDLERS
  // ==========================================

  static async createTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
      const userId = (req as any).user?.id;

      const ticket = await SupportTicketService.createTicket(tenantId, userId, req.body);
      res.status(201).json({
        success: true,
        data: ticket,
        message: `Support ticket #${ticket.ticketNumber} created successfully`,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getTenantTickets(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
      const result = await SupportTicketService.getTenantTickets(tenantId, req.query);
      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getTenantTicketDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
      const id = req.params.id as string;
      const ticket = await SupportTicketService.getTenantTicketDetail(tenantId, id);
      res.status(200).json({
        success: true,
        data: ticket,
      });
    } catch (err) {
      next(err);
    }
  }

  static async addTenantMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
      const userId = (req as any).user?.id;
      const id = req.params.id as string;

      const message = await SupportTicketService.addMessage(id, userId, req.body, {
        tenantId,
        isSuperAdmin: false,
      });

      res.status(201).json({
        success: true,
        data: message,
        message: 'Reply sent successfully',
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateTenantTicketStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
      const userId = (req as any).user?.id;
      const id = req.params.id as string;
      const { status, notes } = req.body;

      const updated = await SupportTicketService.updateTicketStatus(id, userId, status as TicketStatus, {
        tenantId,
        isSuperAdmin: false,
        notes,
      });

      res.status(200).json({
        success: true,
        data: updated,
        message: `Ticket status updated to ${status}`,
      });
    } catch (err) {
      next(err);
    }
  }

  static async submitCsat(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
      const id = req.params.id as string;
      const { rating, feedback } = req.body;

      const updated = await SupportTicketService.submitCsat(tenantId, id, rating, feedback);
      res.status(200).json({
        success: true,
        data: updated,
        message: 'Thank you for your rating and feedback!',
      });
    } catch (err) {
      next(err);
    }
  }

  // ==========================================
  // SUPERADMIN HELP DESK HANDLERS
  // ==========================================

  static async getSuperadminTickets(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await SupportTicketService.getSuperadminTickets(req.query);
      res.status(200).json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getSuperadminTicketDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const ticket = await SupportTicketService.getSuperadminTicketDetail(id);
      res.status(200).json({
        success: true,
        data: ticket,
      });
    } catch (err) {
      next(err);
    }
  }

  static async addSuperadminMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const id = req.params.id as string;

      const message = await SupportTicketService.addMessage(id, userId, req.body, {
        isSuperAdmin: true,
      });

      res.status(201).json({
        success: true,
        data: message,
        message: req.body.isInternal ? 'Internal whisper note logged' : 'Public response dispatched to customer',
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateSuperadminStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const id = req.params.id as string;
      const { status, notes } = req.body;

      const updated = await SupportTicketService.updateTicketStatus(id, userId, status as TicketStatus, {
        isSuperAdmin: true,
        notes,
      });

      res.status(200).json({
        success: true,
        data: updated,
        message: `Ticket status updated to ${status}`,
      });
    } catch (err) {
      next(err);
    }
  }

  static async assignTicket(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const id = req.params.id as string;
      const { assignedToId } = req.body;

      const updated = await SupportTicketService.assignTicket(id, userId, assignedToId);
      res.status(200).json({
        success: true,
        data: updated,
        message: assignedToId ? 'Ticket assigned successfully' : 'Ticket unassigned',
      });
    } catch (err) {
      next(err);
    }
  }

  static async updatePriority(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const id = req.params.id as string;
      const { priority } = req.body;

      const updated = await SupportTicketService.updatePriority(id, userId, priority as TicketPriority);
      res.status(200).json({
        success: true,
        data: updated,
        message: `Ticket priority updated to ${priority}`,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getCannedResponses(req: Request, res: Response, next: NextFunction) {
    try {
      const category = req.query.category as TicketCategory | undefined;
      const canned = await SupportTicketService.getCannedResponses(category);
      res.status(200).json({
        success: true,
        data: canned,
      });
    } catch (err) {
      next(err);
    }
  }

  static async createCannedResponse(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req as any).user?.id;
      const canned = await SupportTicketService.createCannedResponse(userId, req.body);
      res.status(201).json({
        success: true,
        data: canned,
        message: 'Canned response template saved',
      });
    } catch (err) {
      next(err);
    }
  }

  static async getHelpdeskMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const metrics = await SupportTicketService.getHelpdeskMetrics();
      res.status(200).json({
        success: true,
        data: metrics,
      });
    } catch (err) {
      next(err);
    }
  }
}
