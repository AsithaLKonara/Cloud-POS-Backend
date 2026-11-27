import {
  SupportTicketService,
  CreateTicketDTO,
} from '../services/support-ticket.service';
import {
  TicketCategory,
  TicketPriority,
  TicketStatus,
  TicketSenderType,
} from '@prisma/client';

jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    supportTicket: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    supportTicketMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    supportTicketAttachment: {
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
    supportTicketActivityLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    supportCannedResponse: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (cb) => {
      if (typeof cb === 'function') {
        const tx = {
          supportTicket: {
            create: jest.fn(),
            update: jest.fn(),
          },
          supportTicketMessage: {
            create: jest.fn(),
          },
          supportTicketAttachment: {
            createMany: jest.fn(),
          },
          supportTicketActivityLog: {
            create: jest.fn(),
          },
        };
        return await cb(tx);
      }
      return Promise.all(cb);
    }),
  },
}));

import prisma from '../config/prisma';

const mockPrisma = prisma as any;

describe('Multi-Tenant SaaS Support Ticket System Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. SLA Engine & Priority Due Date Calculations', () => {
    it('accurately computes 30m first response and 4h resolution for CRITICAL_URGENT', () => {
      const now = Date.now();
      const { firstResponseDueAt, resolutionDueAt } =
        SupportTicketService.calculateSlaDueDates(TicketPriority.CRITICAL_URGENT);

      const diffFirstResp = (firstResponseDueAt.getTime() - now) / (60 * 1000);
      const diffResolution = (resolutionDueAt.getTime() - now) / (60 * 60 * 1000);

      expect(Math.round(diffFirstResp)).toBe(30);
      expect(Math.round(diffResolution)).toBe(4);
    });

    it('accurately computes 2h first response and 12h resolution for HIGH', () => {
      const now = Date.now();
      const { firstResponseDueAt, resolutionDueAt } =
        SupportTicketService.calculateSlaDueDates(TicketPriority.HIGH);

      const diffFirstResp = (firstResponseDueAt.getTime() - now) / (60 * 60 * 1000);
      const diffResolution = (resolutionDueAt.getTime() - now) / (60 * 60 * 1000);

      expect(Math.round(diffFirstResp)).toBe(2);
      expect(Math.round(diffResolution)).toBe(12);
    });

    it('accurately computes 6h first response and 24h resolution for MEDIUM', () => {
      const now = Date.now();
      const { firstResponseDueAt, resolutionDueAt } =
        SupportTicketService.calculateSlaDueDates(TicketPriority.MEDIUM);

      const diffFirstResp = (firstResponseDueAt.getTime() - now) / (60 * 60 * 1000);
      const diffResolution = (resolutionDueAt.getTime() - now) / (60 * 60 * 1000);

      expect(Math.round(diffFirstResp)).toBe(6);
      expect(Math.round(diffResolution)).toBe(24);
    });
  });

  describe('2. Ticket Creation & Telemetry Packaging', () => {
    it('creates ticket with automated hardware and environment telemetry snapshot', async () => {
      const tenantId = 'tenant_123';
      const userId = 'user_cashier_1';

      const dto: CreateTicketDTO = {
        subject: 'Thermal printer bridge offline on Register 01',
        description: 'Printer does not kick cash drawer and receipt dialog throws bridge 18181 timeout',
        category: TicketCategory.HARDWARE_PERIPHERAL,
        priority: TicketPriority.CRITICAL_URGENT,
        sourceRoute: '/pos',
        posMetadata: {
          posSessionId: 'pos_sess_99',
          branchName: 'Kandy Flagship',
          hardware: {
            thermalBridge: { status: 'OFFLINE', port: 18181 },
            poleDisplay: { mode: 'PRICE_DISPLAY', baudRate: 2400, connected: true },
          },
        },
      };

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          supportTicket: {
            create: jest.fn().mockResolvedValue({
              id: 'ticket_01',
              ticketNumber: 1001,
              tenantId,
              createdById: userId,
              subject: dto.subject,
              description: dto.description,
              category: dto.category,
              priority: dto.priority,
              status: TicketStatus.OPEN,
              sourceRoute: dto.sourceRoute,
              posMetadata: dto.posMetadata,
            }),
          },
          supportTicketMessage: {
            create: jest.fn().mockResolvedValue({ id: 'msg_01' }),
          },
          supportTicketAttachment: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          supportTicketActivityLog: {
            create: jest.fn().mockResolvedValue({ id: 'log_01' }),
          },
        };
        return await cb(tx);
      });

      const ticket = await SupportTicketService.createTicket(tenantId, userId, dto);

      expect(ticket.id).toBe('ticket_01');
      expect(ticket.ticketNumber).toBe(1001);
      expect(ticket.priority).toBe(TicketPriority.CRITICAL_URGENT);
      expect(ticket.posMetadata).toHaveProperty('hardware.poleDisplay.baudRate', 2400);
    });
  });

  describe('3. Dual-Audience Messaging & Internal Whisper Notes Security', () => {
    it('prevents tenant user from posting an internal whisper note (403 Forbidden)', async () => {
      const tenantId = 'tenant_123';
      const userId = 'user_tenant_1';

      await expect(
        SupportTicketService.addMessage(
          'ticket_01',
          userId,
          { content: 'Attempted whisper note', isInternal: true },
          { tenantId, isSuperAdmin: false }
        )
      ).rejects.toThrow('Only Superadmin agents can post internal whisper notes');
    });

    it('allows Superadmin to post internal whisper notes without altering customer ticket status', async () => {
      const superadminId = 'super_eng_1';

      mockPrisma.supportTicket.findFirst.mockResolvedValue({
        id: 'ticket_01',
        tenantId: 'tenant_123',
        status: TicketStatus.OPEN,
        firstResponseDueAt: new Date(Date.now() + 100000),
        firstRespondedAt: null,
      });

      let updatedData: any = null;
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          supportTicketMessage: {
            create: jest.fn().mockResolvedValue({
              id: 'msg_whisper_1',
              isInternal: true,
              content: 'DB connection deadlock root cause. Patching query now.',
              senderType: TicketSenderType.SUPERADMIN_AGENT,
            }),
          },
          supportTicketAttachment: {
            createMany: jest.fn(),
          },
          supportTicket: {
            update: jest.fn().mockImplementation(({ data }: any) => {
              updatedData = data;
              return { id: 'ticket_01', ...data };
            }),
          },
        };
        return await cb(tx);
      });

      const msg = await SupportTicketService.addMessage(
        'ticket_01',
        superadminId,
        { content: 'DB connection deadlock root cause. Patching query now.', isInternal: true },
        { isSuperAdmin: true }
      );

      expect(msg.isInternal).toBe(true);
      // Whisper notes must NOT move ticket to WAITING_ON_CUSTOMER
      expect(updatedData.status).toBeUndefined();
    });

    it('moves ticket to WAITING_ON_CUSTOMER and sets firstRespondedAt when Superadmin replies publicly', async () => {
      const superadminId = 'super_eng_1';

      mockPrisma.supportTicket.findFirst.mockResolvedValue({
        id: 'ticket_01',
        tenantId: 'tenant_123',
        status: TicketStatus.OPEN,
        firstResponseDueAt: new Date(Date.now() + 100000),
        firstRespondedAt: null,
      });

      let updatedData: any = null;
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          supportTicketMessage: {
            create: jest.fn().mockResolvedValue({
              id: 'msg_pub_1',
              isInternal: false,
              content: 'Please verify node-print service status using `node-print status` in terminal.',
              senderType: TicketSenderType.SUPERADMIN_AGENT,
            }),
          },
          supportTicketAttachment: {
            createMany: jest.fn(),
          },
          supportTicket: {
            update: jest.fn().mockImplementation(({ data }: any) => {
              updatedData = data;
              return { id: 'ticket_01', ...data };
            }),
          },
        };
        return await cb(tx);
      });

      const msg = await SupportTicketService.addMessage(
        'ticket_01',
        superadminId,
        { content: 'Please verify node-print service status using `node-print status` in terminal.', isInternal: false },
        { isSuperAdmin: true }
      );

      expect(msg.isInternal).toBe(false);
      expect(updatedData.status).toBe(TicketStatus.WAITING_ON_CUSTOMER);
      expect(updatedData.firstRespondedAt).toBeInstanceOf(Date);
    });
  });

  describe('4. CSAT Rating & Ticket Resolution', () => {
    it('accepts valid 1-5 star CSAT feedback on resolved tickets', async () => {
      mockPrisma.supportTicket.findFirst.mockResolvedValue({
        id: 'ticket_01',
        tenantId: 'tenant_123',
        status: TicketStatus.RESOLVED,
      });

      mockPrisma.supportTicket.update.mockResolvedValue({
        id: 'ticket_01',
        csatRating: 5,
        csatFeedback: 'Issue was resolved within 15 minutes! Fantastic support.',
        csatRatedAt: new Date(),
      });

      const rated = await SupportTicketService.submitCsat(
        'tenant_123',
        'ticket_01',
        5,
        'Issue was resolved within 15 minutes! Fantastic support.'
      );

      expect(rated.csatRating).toBe(5);
      expect(rated.csatFeedback).toContain('Fantastic support');
    });

    it('rejects invalid rating outside 1..5 range', async () => {
      await expect(
        SupportTicketService.submitCsat('tenant_123', 'ticket_01', 6)
      ).rejects.toThrow('CSAT rating must be an integer between 1 and 5');
    });
  });

  describe('5. Platform Helpdesk Metrics & KPIs', () => {
    it('calculates total counts, SLA adherence %, and average CSAT correctly', async () => {
      mockPrisma.supportTicket.count
        .mockResolvedValueOnce(50) // total
        .mockResolvedValueOnce(5)  // open
        .mockResolvedValueOnce(10) // in_progress
        .mockResolvedValueOnce(5)  // waiting
        .mockResolvedValueOnce(30) // resolved
        .mockResolvedValueOnce(2)  // critical open
        .mockResolvedValueOnce(3); // breached count (3 out of 50 = 6% breach -> 94% adherence)

      mockPrisma.supportTicket.findMany.mockResolvedValue([
        { csatRating: 5 },
        { csatRating: 4 },
        { csatRating: 5 },
      ]);

      mockPrisma.supportTicket.groupBy.mockResolvedValue([
        { category: TicketCategory.HARDWARE_PERIPHERAL, _count: { _all: 25 } },
        { category: TicketCategory.POS_REGISTER, _count: { _all: 15 } },
      ]);

      const metrics = await SupportTicketService.getHelpdeskMetrics();

      expect(metrics.totalCount).toBe(50);
      expect(metrics.adherenceRate).toBe(94);
      expect(metrics.avgCsat).toBe(4.7);
      expect(metrics.categoryBreakdown).toHaveLength(2);
    });
  });
});
