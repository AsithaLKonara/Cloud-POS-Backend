import prisma from '../config/prisma';
import { logger } from '../utils/logger';
import { WhatsAppService } from './whatsapp.service';
import { TenantIntegrationService } from './tenant-integration.service';
import { AiRagService } from './ai-rag.service';

export interface InboundMessageContext {
  fromPhone: string;
  name?: string;
  messageId: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'button' | 'order' | 'unknown';
  text?: string;
  buttonPayload?: string;
}

export class WhatsAppWebhookService {
  /**
   * Verifies Meta WhatsApp webhook subscription challenge.
   */
  static verifyWebhook(
    mode: string,
    token: string,
    challenge: string,
    configuredVerifyToken = 'xonit_whatsapp_verify_token_2026'
  ): { status: number; body: string } {
    if (mode === 'subscribe' && token === configuredVerifyToken) {
      logger.info('[WhatsApp Webhook] Challenge verified successfully');
      return { status: 200, body: challenge };
    }
    logger.warn('[WhatsApp Webhook] Challenge verification failed: Invalid verify token');
    return { status: 403, body: 'Forbidden' };
  }

  /**
   * Processes inbound webhook payload received from Meta Graph API.
   */
  static async processInboundPayload(payload: any): Promise<void> {
    try {
      const entry = payload?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value) return;

      const metadata = value.metadata;
      const phoneNumberId = metadata?.phone_number_id;

      // Locate tenant by configured phone_number_id
      const tenantCredential = await (prisma as any).tenantIntegrationCredential.findFirst({
        where: {
          category: 'MESSAGING_WHATSAPP',
          accountIdentifier: phoneNumberId,
        },
      });

      const tenantId = tenantCredential?.tenantId;
      if (!tenantId) {
        logger.warn(`[WhatsApp Inbound] Received message for unknown phoneNumberId: [${phoneNumberId}]`);
      }

      // 1. Process delivery statuses (delivered, read, failed)
      if (value.statuses && value.statuses.length > 0) {
        for (const status of value.statuses) {
          logger.info(`[WhatsApp Delivery Status] MsgID [${status.id}] status: ${status.status} to [${status.recipient_id}]`);
        }
      }

      // 2. Process incoming customer messages
      if (value.messages && value.messages.length > 0) {
        for (const msg of value.messages) {
          await this.handleIncomingCustomerMessage(tenantId, value, msg);
        }
      }
    } catch (err: any) {
      logger.error(`[WhatsApp Webhook Error] Failed to process inbound payload: ${err.message}`, err);
    }
  }

  /**
   * Handles an individual incoming customer message (FAQ, product stock check, or button action).
   */
  static async handleIncomingCustomerMessage(
    tenantId: string | null,
    contextValue: any,
    msg: any
  ): Promise<void> {
    const fromPhone = msg.from;
    const contact = contextValue?.contacts?.find((c: any) => c.wa_id === fromPhone);
    const customerName = contact?.profile?.name || 'Customer';

    let incomingText = '';
    let buttonId = '';

    if (msg.type === 'text') {
      incomingText = msg.text?.body || '';
    } else if (msg.type === 'interactive') {
      if (msg.interactive?.type === 'button_reply') {
        buttonId = msg.interactive.button_reply?.id || '';
        incomingText = msg.interactive.button_reply?.title || '';
      }
    } else if (msg.type === 'button') {
      buttonId = msg.button?.payload || '';
      incomingText = msg.button?.text || '';
    }

    logger.info(`[WhatsApp Inbound Message] From: [${fromPhone}] (${customerName}) Text: "${incomingText}" Button: [${buttonId}]`);

    if (!tenantId) return;

    // Check if customer exists or create/update customer record
    let customer = await (prisma as any).customer.findFirst({
      where: {
        tenantId,
        phone: { contains: fromPhone.slice(-9) },
      },
    });

    if (!customer) {
      customer = await (prisma as any).customer.create({
        data: {
          tenant: { connect: { id: tenantId } },
          firstName: customerName.split(' ')[0] || customerName,
          lastName: customerName.split(' ').slice(1).join(' ') || '',
          phone: fromPhone,
          customerType: 'RETAIL',
        },
      });
    }

    // Persist inbound message in WhatsAppMessage history
    try {
      await (prisma as any).whatsAppMessage.create({
        data: {
          tenantId,
          customerId: customer?.id || null,
          phone: fromPhone,
          direction: 'INBOUND',
          senderName: customerName,
          messageType: msg.type || 'text',
          content: incomingText || (buttonId ? `[Tapped button: ${buttonId}]` : '[Interactive Message]'),
          waMessageId: msg.id || null,
          status: 'RECEIVED',
          metadata: { buttonId, msg },
        },
      });
    } catch (saveErr: any) {
      logger.warn(`[WhatsApp Inbound] Failed to persist message record: ${saveErr.message}`);
    }

    // Handle Quick Reply Button actions
    if (buttonId === 'btn_pay_lankaqr') {
      await WhatsAppService.sendMessage(tenantId, fromPhone, {
        type: 'text',
        text: {
          body: `Here is your instant LankaQR & Card payment link:\n👉 https://pay.xonit.cloud/${tenantId}/lankaqr?customer=${customer.id}\n\nOnce paid, your account balance will automatically update.`,
        },
      });
      return;
    }

    if (buttonId === 'btn_reorder_now') {
      await WhatsAppService.sendMessage(tenantId, fromPhone, {
        type: 'text',
        text: {
          body: `Great! Tap here to review your pre-filled cart and checkout with 1 click:\n👉 https://store.xonit.cloud/${tenantId}/cart\n\nNeed help modifying quantities? Just text us here!`,
        },
      });
      return;
    }

    // Conversational Intelligence via Gemini AI Copilot & Knowledge Base
    try {
      const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } });
      const storeName = tenant?.name || 'our store';

      // Use AI RAG to answer stock, branch hours, or order questions
      const aiReply = await AiRagService.answerQuestion({
        tenantId,
        message: incomingText,
        history: [],
      });

      const replyContent = aiReply?.answer || `Thank you for reaching out to ${storeName}! A customer service representative will respond shortly.`;

      await WhatsAppService.sendMessage(tenantId, fromPhone, {
        type: 'text',
        text: {
          body: replyContent,
        },
      });
    } catch (aiErr: any) {
      logger.warn(`[WhatsApp AI Reply Warning] AI responder failed, sending fallback: ${aiErr.message}`);
      await WhatsAppService.sendMessage(tenantId, fromPhone, {
        type: 'text',
        text: {
          body: `Thank you for contacting us! We have received your message and our team will get back to you shortly.`,
        },
      });
    }
  }
}
