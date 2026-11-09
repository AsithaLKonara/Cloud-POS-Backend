import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { WhatsAppService } from '../services/whatsapp.service';
import { logger } from '../utils/logger';

export class CrmInboxController {
  /**
   * Retrieves conversation threads grouped by customer phone.
   */
  async getThreads(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = (req as any).tenantId || req.headers['x-tenant-id'] as string;
      if (!tenantId) {
        res.status(400).json({ success: false, message: 'Tenant ID is required.' });
        return;
      }

      // Fetch distinct phone numbers that have WhatsApp messages for this tenant
      const rawMessages = await (prisma as any).whatsAppMessage.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });

      const threadMap = new Map<string, any>();

      for (const msg of rawMessages) {
        if (!threadMap.has(msg.phone)) {
          threadMap.set(msg.phone, {
            phone: msg.phone,
            customerId: msg.customerId,
            senderName: msg.senderName || 'Customer',
            lastMessage: msg.content,
            lastDirection: msg.direction,
            lastStatus: msg.status,
            lastTimestamp: msg.createdAt,
            messageCount: 1,
            unreadCount: msg.direction === 'INBOUND' && msg.status === 'RECEIVED' ? 1 : 0,
          });
        } else {
          const thread = threadMap.get(msg.phone);
          thread.messageCount += 1;
        }
      }

      const threads = Array.from(threadMap.values());

      // Enrich threads with Customer info if available
      for (const t of threads) {
        const customer = await (prisma as any).customer.findFirst({
          where: {
            tenantId,
            phone: { contains: t.phone.slice(-9) },
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            customerType: true,
            creditBalance: true,
          },
        });

        if (customer) {
          t.customerId = customer.id;
          t.customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || t.senderName;
          t.customerType = customer.customerType;
          t.creditBalance = customer.creditBalance;
        } else {
          t.customerName = t.senderName;
        }
      }

      res.status(200).json({ success: true, data: threads });
    } catch (err: any) {
      logger.error(`[CRM Inbox] Failed to fetch threads: ${err.message}`, err);
      res.status(500).json({ success: false, message: 'Failed to fetch conversation threads.' });
    }
  }

  /**
   * Retrieves full chat history and customer 360 dossier for a specific phone number.
   */
  async getThreadMessages(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = (req as any).tenantId || req.headers['x-tenant-id'] as string;
      const phone = req.params.phone as string;

      if (!tenantId || !phone) {
        res.status(400).json({ success: false, message: 'Tenant ID and phone are required.' });
        return;
      }

      // Fetch messages for this phone number
      const messages = await (prisma as any).whatsAppMessage.findMany({
        where: {
          tenantId,
          phone: { contains: phone.slice(-9) },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Fetch Customer Dossier
      const customer = await (prisma as any).customer.findFirst({
        where: {
          tenantId,
          phone: { contains: phone.slice(-9) },
        },
        include: {
          loyaltyAccount: true,
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              orderNumber: true,
              total: true,
              status: true,
              paymentStatus: true,
              createdAt: true,
            },
          },
        },
      });

      // Calculate total customer spend & order count
      const ordersSummary = customer?.id
        ? await (prisma as any).order.aggregate({
            where: { customerId: customer.id, tenantId },
            _sum: { total: true },
            _count: { id: true },
          })
        : null;

      const dossier = {
        customer: customer
          ? {
              id: customer.id,
              name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Valued Customer',
              phone: customer.phone,
              email: customer.email || 'N/A',
              customerType: customer.customerType || 'RETAIL',
              creditLimit: customer.creditLimit || 0,
              creditBalance: customer.creditBalance || 0,
              loyaltyPoints: customer.loyaltyAccount?.points || 0,
              loyaltyTier: customer.loyaltyAccount?.tier || 'BRONZE',
              totalSpent: ordersSummary?._sum?.total || 0,
              totalOrders: ordersSummary?._count?.id || 0,
              recentOrders: customer.orders || [],
            }
          : {
              id: null,
              name: 'Customer ' + phone,
              phone,
              email: 'N/A',
              customerType: 'PROSPECT',
              creditLimit: 0,
              creditBalance: 0,
              loyaltyPoints: 0,
              loyaltyTier: 'STANDARD',
              totalSpent: 0,
              totalOrders: 0,
              recentOrders: [],
            },
      };

      res.status(200).json({
        success: true,
        data: {
          phone,
          messages,
          dossier,
        },
      });
    } catch (err: any) {
      logger.error(`[CRM Inbox] Failed to fetch thread messages: ${err.message}`, err);
      res.status(500).json({ success: false, message: 'Failed to fetch thread messages.' });
    }
  }

  /**
   * Dispatches a direct reply from merchant support/cashier to the customer.
   */
  async sendReply(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = (req as any).tenantId || req.headers['x-tenant-id'] as string;
      const phone = req.params.phone as string;
      const { text, actionType } = req.body;

      if (!tenantId || !phone) {
        res.status(400).json({ success: false, message: 'Tenant ID and phone are required.' });
        return;
      }

      let outgoingText = text;

      if (actionType === 'lankaqr') {
        const customer = await (prisma as any).customer.findFirst({
          where: { tenantId, phone: { contains: phone.slice(-9) } },
        });
        const customerId = customer?.id || 'guest';
        outgoingText = `Here is your instant LankaQR & Card payment link:\n👉 https://pay.xonit.cloud/${tenantId}/lankaqr?customer=${customerId}\n\nOnce paid, your account balance will automatically update.`;
      } else if (actionType === 'catalog') {
        outgoingText = `Browse our live catalog and order online with fast delivery:\n👉 https://store.xonit.cloud/${tenantId}\n\nNeed assistance with product selection? We are here to help!`;
      } else if (actionType === 'statement') {
        const customer = await (prisma as any).customer.findFirst({
          where: { tenantId, phone: { contains: phone.slice(-9) } },
        });
        const balance = customer?.creditBalance || 0;
        outgoingText = `Statement Update for ${customer?.firstName || 'Customer'}:\nOutstanding Balance: Rs. ${Number(balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n\nTo settle via LankaQR or Bank Transfer, tap here: https://pay.xonit.cloud/${tenantId}/lankaqr?customer=${customer?.id || ''}`;
      }

      if (!outgoingText || !outgoingText.trim()) {
        res.status(400).json({ success: false, message: 'Message content cannot be empty.' });
        return;
      }

      const result = await WhatsAppService.sendTextMessage(tenantId, phone, outgoingText.trim());

      // Fetch the newly logged message
      const savedMsg = await (prisma as any).whatsAppMessage.findFirst({
        where: { tenantId, phone: { contains: phone.slice(-9) }, direction: 'OUTBOUND' },
        orderBy: { createdAt: 'desc' },
      });

      res.status(200).json({
        success: true,
        message: 'Reply dispatched successfully.',
        data: {
          result,
          message: savedMsg,
        },
      });
    } catch (err: any) {
      logger.error(`[CRM Inbox] Failed to send reply: ${err.message}`, err);
      res.status(500).json({ success: false, message: err.message || 'Failed to send reply.' });
    }
  }
}
