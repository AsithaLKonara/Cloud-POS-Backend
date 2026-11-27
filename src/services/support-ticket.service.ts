import prisma from '../config/prisma';
import { requestContext } from '../context/RequestContext';
import { logger } from '../utils/logger';
import { AppError } from '../middlewares/errorHandler';
import {
  TicketCategory,
  TicketPriority,
  TicketStatus,
  TicketSenderType,
} from '@prisma/client';

export interface CreateTicketDTO {
  subject: string;
  description: string;
  category?: TicketCategory;
  priority?: TicketPriority;
  branchId?: string;
  sourceRoute?: string;
  posMetadata?: any;
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileType: string;
    fileSize: number;
  }>;
}

export interface AddMessageDTO {
  content: string;
  isInternal?: boolean;
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileType: string;
    fileSize: number;
  }>;
}

export interface TicketFilterOptions {
  status?: TicketStatus | string;
  category?: TicketCategory | string;
  priority?: TicketPriority | string;
  assignedToId?: string;
  search?: string;
  branchId?: string;
  tenantId?: string;
  slaBreached?: boolean;
  page?: number;
  limit?: number;
}

export class SupportTicketService {
  /**
   * Calculates SLA due dates based on priority:
   * CRITICAL_URGENT: 30m first response, 4h resolution
   * HIGH: 2h first response, 12h resolution
   * MEDIUM: 6h first response, 24h resolution
   * LOW: 12h first response, 48h resolution
   */
  static calculateSlaDueDates(priority: TicketPriority = TicketPriority.MEDIUM): {
    firstResponseDueAt: Date;
    resolutionDueAt: Date;
  } {
    const now = new Date();
    let firstResponseMinutes = 360; // 6h default
    let resolutionHours = 24;       // 24h default

    switch (priority) {
      case TicketPriority.CRITICAL_URGENT:
        firstResponseMinutes = 30;
        resolutionHours = 4;
        break;
      case TicketPriority.HIGH:
        firstResponseMinutes = 120;
        resolutionHours = 12;
        break;
      case TicketPriority.MEDIUM:
        firstResponseMinutes = 360;
        resolutionHours = 24;
        break;
      case TicketPriority.LOW:
        firstResponseMinutes = 720;
        resolutionHours = 48;
        break;
    }

    const firstResponseDueAt = new Date(now.getTime() + firstResponseMinutes * 60 * 1000);
    const resolutionDueAt = new Date(now.getTime() + resolutionHours * 60 * 60 * 1000);

    return { firstResponseDueAt, resolutionDueAt };
  }

  /**
   * Opens a new support ticket under the active tenant
   */
  static async createTicket(
    tenantId: string,
    createdById: string,
    dto: CreateTicketDTO
  ) {
    if (!tenantId) throw new AppError('Tenant context is required', 400);
    if (!dto.subject || !dto.description) {
      throw new AppError('Subject and description are required', 400);
    }

    const priority = dto.priority || TicketPriority.MEDIUM;
    const category = dto.category || TicketCategory.GENERAL_INQUIRY;
    const { firstResponseDueAt, resolutionDueAt } = this.calculateSlaDueDates(priority);

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          tenantId,
          createdById,
          branchId: dto.branchId || null,
          subject: dto.subject.trim(),
          description: dto.description.trim(),
          category,
          priority,
          status: TicketStatus.OPEN,
          sourceRoute: dto.sourceRoute || null,
          posMetadata: dto.posMetadata || undefined,
          firstResponseDueAt,
          resolutionDueAt,
        },
      });

      // Initial message from the creator
      const initialMessage = await tx.supportTicketMessage.create({
        data: {
          ticketId: created.id,
          senderId: createdById,
          senderType: TicketSenderType.TENANT_USER,
          content: dto.description.trim(),
          isInternal: false,
        },
      });

      // Attachments if any
      if (dto.attachments && dto.attachments.length > 0) {
        await tx.supportTicketAttachment.createMany({
          data: dto.attachments.map((att) => ({
            ticketId: created.id,
            messageId: initialMessage.id,
            fileName: att.fileName,
            fileUrl: att.fileUrl,
            fileType: att.fileType,
            fileSize: att.fileSize,
          })),
        });
      }

      // Initial audit log
      await tx.supportTicketActivityLog.create({
        data: {
          ticketId: created.id,
          actorId: createdById,
          action: 'TICKET_CREATED',
          toValue: TicketStatus.OPEN,
          notes: `Ticket created with priority ${priority}`,
        },
      });

      return created;
    });

    logger.info(`[SupportTicket] Created ticket #${ticket.ticketNumber} for tenant ${tenantId}`);
    return ticket;
  }

  /**
   * Retrieves tenant-scoped tickets with filtering & pagination
   */
  static async getTenantTickets(tenantId: string, options: TicketFilterOptions = {}) {
    if (!tenantId) throw new AppError('Tenant context is required', 400);

    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 15));
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (options.status && options.status !== 'ALL') {
      where.status = options.status as TicketStatus;
    }
    if (options.category && options.category !== 'ALL') {
      where.category = options.category as TicketCategory;
    }
    if (options.priority && options.priority !== 'ALL') {
      where.priority = options.priority as TicketPriority;
    }
    if (options.branchId) {
      where.branchId = options.branchId;
    }

    if (options.search) {
      const q = options.search.trim();
      const num = parseInt(q.replace('#', ''), 10);
      where.OR = [
        { subject: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        ...(!isNaN(num) ? [{ ticketNumber: num }] : []),
      ];
    }

    const [tickets, totalCount] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
          branch: { select: { id: true, name: true, code: true } },
          _count: {
            select: {
              messages: { where: { isInternal: false } },
              attachments: true,
            },
          },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    return {
      tickets,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  /**
   * Retrieves single ticket detail for tenant (whisper notes strictly hidden)
   */
  static async getTenantTicketDetail(tenantId: string, ticketId: string) {
    if (!tenantId) throw new AppError('Tenant context is required', 400);

    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, tenantId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        branch: { select: { id: true, name: true, code: true } },
        messages: {
          where: { isInternal: false }, // Strict isolation: hide whisper notes from tenant
          orderBy: { createdAt: 'asc' },
          include: {
            sender: { select: { id: true, name: true, email: true } },
            attachments: true,
          },
        },
        attachments: {
          orderBy: { createdAt: 'asc' },
        },
        activityLogs: {
          orderBy: { createdAt: 'asc' },
          include: {
            actor: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!ticket) throw new AppError('Ticket not found or access denied', 404);
    return ticket;
  }

  /**
   * Adds a reply message or internal whisper note
   */
  static async addMessage(
    ticketId: string,
    senderId: string,
    dto: AddMessageDTO,
    options: { tenantId?: string; isSuperAdmin?: boolean } = {}
  ) {
    const isSuperAdmin = Boolean(options.isSuperAdmin);
    const content = dto.content?.trim();
    if (!content) throw new AppError('Message content is required', 400);

    // If whisper note is flagged, user MUST be a Superadmin
    const isInternal = Boolean(dto.isInternal);
    if (isInternal && !isSuperAdmin) {
      throw new AppError('Only Superadmin agents can post internal whisper notes', 403);
    }

    const where: any = { id: ticketId };
    if (!isSuperAdmin) {
      if (!options.tenantId) throw new AppError('Tenant context required', 400);
      where.tenantId = options.tenantId;
    }

    const ticket = await prisma.supportTicket.findFirst({ where });
    if (!ticket) throw new AppError('Ticket not found or access denied', 404);

    const senderType = isSuperAdmin
      ? TicketSenderType.SUPERADMIN_AGENT
      : TicketSenderType.TENANT_USER;

    const message = await prisma.$transaction(async (tx) => {
      const msg = await tx.supportTicketMessage.create({
        data: {
          ticketId,
          senderId,
          senderType,
          content,
          isInternal,
        },
        include: {
          sender: { select: { id: true, name: true, email: true } },
        },
      });

      if (dto.attachments && dto.attachments.length > 0) {
        await tx.supportTicketAttachment.createMany({
          data: dto.attachments.map((att) => ({
            ticketId,
            messageId: msg.id,
            fileName: att.fileName,
            fileUrl: att.fileUrl,
            fileType: att.fileType,
            fileSize: att.fileSize,
          })),
        });
      }

      // Ticket State Transitions:
      const updates: any = { updatedAt: new Date() };

      // If Superadmin public reply:
      if (isSuperAdmin && !isInternal) {
        if (!ticket.firstRespondedAt) {
          updates.firstRespondedAt = new Date();
          if (new Date() > ticket.firstResponseDueAt) {
            updates.slaFirstResponseBreached = true;
          }
        }
        // When agent replies publicly, put ticket in WAITING_ON_CUSTOMER
        if (ticket.status === TicketStatus.OPEN || ticket.status === TicketStatus.IN_PROGRESS) {
          updates.status = TicketStatus.WAITING_ON_CUSTOMER;
        }
      }

      // If Tenant reply while WAITING_ON_CUSTOMER, move back to IN_PROGRESS
      if (!isSuperAdmin && ticket.status === TicketStatus.WAITING_ON_CUSTOMER) {
        updates.status = TicketStatus.IN_PROGRESS;
      }

      await tx.supportTicket.update({
        where: { id: ticketId },
        data: updates,
      });

      return msg;
    });

    return message;
  }

  /**
   * Updates ticket status (e.g. RESOLVED, CLOSED, REOPENED)
   */
  static async updateTicketStatus(
    ticketId: string,
    actorId: string,
    newStatus: TicketStatus,
    options: { tenantId?: string; isSuperAdmin?: boolean; notes?: string } = {}
  ) {
    const isSuperAdmin = Boolean(options.isSuperAdmin);
    const where: any = { id: ticketId };
    if (!isSuperAdmin) {
      if (!options.tenantId) throw new AppError('Tenant context required', 400);
      where.tenantId = options.tenantId;
    }

    const ticket = await prisma.supportTicket.findFirst({ where });
    if (!ticket) throw new AppError('Ticket not found or access denied', 404);

    // Tenant permission rules:
    if (!isSuperAdmin) {
      // Tenant can only resolve their ticket or reopen a resolved ticket
      if (newStatus !== TicketStatus.RESOLVED && newStatus !== TicketStatus.IN_PROGRESS) {
        throw new AppError('Tenant users can only mark tickets as resolved or reopen them', 403);
      }
      if (newStatus === TicketStatus.IN_PROGRESS && ticket.status !== TicketStatus.RESOLVED) {
        throw new AppError('Can only reopen previously resolved tickets', 400);
      }
    }

    const updates: any = {
      status: newStatus,
      updatedAt: new Date(),
    };

    if (newStatus === TicketStatus.RESOLVED) {
      updates.resolvedAt = new Date();
      if (new Date() > ticket.resolutionDueAt) {
        updates.slaResolutionBreached = true;
      }
    } else if (newStatus === TicketStatus.CLOSED) {
      updates.closedAt = new Date();
    } else if (newStatus === TicketStatus.IN_PROGRESS && ticket.status === TicketStatus.RESOLVED) {
      // Reopened
      updates.resolvedAt = null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.supportTicket.update({
        where: { id: ticketId },
        data: updates,
      });

      await tx.supportTicketActivityLog.create({
        data: {
          ticketId,
          actorId,
          action: 'STATUS_CHANGED',
          fromValue: ticket.status,
          toValue: newStatus,
          notes: options.notes || `Status changed from ${ticket.status} to ${newStatus}`,
        },
      });

      return res;
    });

    return updated;
  }

  /**
   * Submits Customer Satisfaction (CSAT) rating upon ticket resolution
   */
  static async submitCsat(
    tenantId: string,
    ticketId: string,
    rating: number,
    feedback?: string
  ) {
    if (!tenantId) throw new AppError('Tenant context is required', 400);
    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      throw new AppError('CSAT rating must be an integer between 1 and 5', 400);
    }

    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new AppError('Ticket not found or access denied', 404);
    if (ticket.status !== TicketStatus.RESOLVED && ticket.status !== TicketStatus.CLOSED) {
      throw new AppError('CSAT feedback can only be submitted for resolved or closed tickets', 400);
    }

    const updated = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        csatRating: numRating,
        csatFeedback: feedback?.trim() || null,
        csatRatedAt: new Date(),
      },
    });

    return updated;
  }

  // ==========================================
  // SUPERADMIN SAAS OPERATOR WORKFLOWS
  // ==========================================

  /**
   * Cross-tenant global helpdesk queue for Superadmin operators
   */
  static async getSuperadminTickets(options: TicketFilterOptions = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (options.tenantId && options.tenantId !== 'ALL') {
      where.tenantId = options.tenantId;
    }
    if (options.status && options.status !== 'ALL') {
      where.status = options.status as TicketStatus;
    }
    if (options.category && options.category !== 'ALL') {
      where.category = options.category as TicketCategory;
    }
    if (options.priority && options.priority !== 'ALL') {
      where.priority = options.priority as TicketPriority;
    }
    if (options.assignedToId) {
      where.assignedToId = options.assignedToId === 'UNASSIGNED' ? null : options.assignedToId;
    }
    if (options.slaBreached) {
      where.OR = [
        { slaFirstResponseBreached: true },
        { slaResolutionBreached: true },
      ];
    }

    if (options.search) {
      const q = options.search.trim();
      const num = parseInt(q.replace('#', ''), 10);
      where.OR = [
        { subject: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { tenant: { name: { contains: q, mode: 'insensitive' } } },
        ...(!isNaN(num) ? [{ ticketNumber: num }] : []),
      ];
    }

    const [tickets, totalCount] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        include: {
          tenant: { select: { id: true, name: true, slug: true, subscriptionTier: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
          branch: { select: { id: true, name: true, code: true } },
          _count: {
            select: {
              messages: true,
              attachments: true,
            },
          },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    return {
      tickets,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  /**
   * Superadmin detail view including ALL messages (Public + Whisper Notes)
   * and Tenant 360 Diagnostic Snapshot
   */
  static async getSuperadminTicketDetail(ticketId: string) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            businessType: true,
            subscriptionTier: true,
            createdAt: true,
            _count: {
              select: {
                branches: true,
                users: true,
                orders: true,
                posSessions: true,
              },
            },
          },
        },
        createdBy: { select: { id: true, name: true, email: true, phone: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        branch: { select: { id: true, name: true, code: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: { select: { id: true, name: true, email: true } },
            attachments: true,
          },
        },
        attachments: {
          orderBy: { createdAt: 'asc' },
        },
        activityLogs: {
          orderBy: { createdAt: 'asc' },
          include: {
            actor: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!ticket) throw new AppError('Ticket not found', 404);
    return ticket;
  }

  /**
   * Assigns ticket to a specific support engineer
   */
  static async assignTicket(ticketId: string, actorId: string, assignedToId: string | null) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new AppError('Ticket not found', 404);

    let assignedUser = null;
    if (assignedToId) {
      assignedUser = await prisma.user.findUnique({ where: { id: assignedToId } });
      if (!assignedUser) throw new AppError('Assigned user not found', 404);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          assignedToId,
          // If unassigned and status is OPEN, mark as IN_PROGRESS
          status: ticket.status === TicketStatus.OPEN && assignedToId ? TicketStatus.IN_PROGRESS : ticket.status,
          updatedAt: new Date(),
        },
      });

      await tx.supportTicketActivityLog.create({
        data: {
          ticketId,
          actorId,
          action: 'ASSIGNED_AGENT',
          fromValue: ticket.assignedToId,
          toValue: assignedToId,
          notes: assignedUser ? `Assigned to ${assignedUser.name || assignedUser.email}` : 'Unassigned',
        },
      });

      return res;
    });

    return updated;
  }

  /**
   * Updates ticket priority and recalculates SLA due dates
   */
  static async updatePriority(ticketId: string, actorId: string, newPriority: TicketPriority) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new AppError('Ticket not found', 404);

    const { firstResponseDueAt, resolutionDueAt } = this.calculateSlaDueDates(newPriority);

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          priority: newPriority,
          firstResponseDueAt,
          resolutionDueAt,
          updatedAt: new Date(),
        },
      });

      await tx.supportTicketActivityLog.create({
        data: {
          ticketId,
          actorId,
          action: 'PRIORITY_UPDATED',
          fromValue: ticket.priority,
          toValue: newPriority,
          notes: `Priority adjusted to ${newPriority}`,
        },
      });

      return res;
    });

    return updated;
  }

  /**
   * Canned Responses (Macros) management
   */
  static async getCannedResponses(category?: TicketCategory) {
    const where: any = {};
    if (category) where.category = category;

    return await prisma.supportCannedResponse.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  static async createCannedResponse(
    createdById: string,
    dto: { title: string; category?: TicketCategory; shortcutCode: string; content: string }
  ) {
    if (!dto.title || !dto.shortcutCode || !dto.content) {
      throw new AppError('Title, shortcut code, and content are required', 400);
    }

    const shortcut = dto.shortcutCode.startsWith('/') ? dto.shortcutCode : `/${dto.shortcutCode}`;

    return await prisma.supportCannedResponse.create({
      data: {
        createdById,
        title: dto.title.trim(),
        category: dto.category || TicketCategory.HARDWARE_PERIPHERAL,
        shortcutCode: shortcut.trim().toLowerCase(),
        content: dto.content.trim(),
      },
    });
  }

  /**
   * Platform Helpdesk Metrics & KPIs
   */
  static async getHelpdeskMetrics() {
    const [
      totalCount,
      openCount,
      inProgressCount,
      waitingCount,
      resolvedCount,
      criticalCount,
      breachedCount,
      ratedTickets,
      categoryCounts,
    ] = await Promise.all([
      prisma.supportTicket.count(),
      prisma.supportTicket.count({ where: { status: TicketStatus.OPEN } }),
      prisma.supportTicket.count({ where: { status: TicketStatus.IN_PROGRESS } }),
      prisma.supportTicket.count({ where: { status: TicketStatus.WAITING_ON_CUSTOMER } }),
      prisma.supportTicket.count({ where: { status: { in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] } } }),
      prisma.supportTicket.count({ where: { priority: TicketPriority.CRITICAL_URGENT, status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] } } }),
      prisma.supportTicket.count({
        where: {
          OR: [{ slaFirstResponseBreached: true }, { slaResolutionBreached: true }],
        },
      }),
      prisma.supportTicket.findMany({
        where: { csatRating: { not: null } },
        select: { csatRating: true },
      }),
      prisma.supportTicket.groupBy({
        by: ['category'],
        _count: { _all: true },
      }),
    ]);

    // Average CSAT calculation
    const avgCsat = ratedTickets.length > 0
      ? Number((ratedTickets.reduce((sum, t) => sum + (t.csatRating || 0), 0) / ratedTickets.length).toFixed(1))
      : 5.0;

    // SLA Adherence %
    const adherenceRate = totalCount > 0
      ? Number((((totalCount - breachedCount) / totalCount) * 100).toFixed(1))
      : 100.0;

    return {
      totalCount,
      openCount,
      inProgressCount,
      waitingCount,
      resolvedCount,
      criticalCount,
      breachedCount,
      adherenceRate,
      avgCsat,
      csatResponsesCount: ratedTickets.length,
      categoryBreakdown: categoryCounts.map((c) => ({
        category: c.category,
        count: c._count._all,
      })),
    };
  }
}
