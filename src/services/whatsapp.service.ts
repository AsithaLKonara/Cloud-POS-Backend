import axios from 'axios';
import { logger } from '../utils/logger';
import prisma from '../config/prisma';
import { TenantIntegrationService, WhatsAppConfig } from './tenant-integration.service';

export interface WhatsAppSendResult {
  success: boolean;
  messageId: string;
  recipient: string;
  mode: 'SANDBOX' | 'LIVE';
  status: 'SENT' | 'SIMULATED' | 'FAILED';
  error?: string;
  latencyMs?: number;
}

export class WhatsAppService {
  /**
   * Normalizes international phone numbers for WhatsApp Cloud API.
   * Standardizes e.g. "0771234567" -> "94771234567", removes '+', spaces, and dashes.
   */
  static normalizePhoneNumber(rawPhone: string, defaultCountryCode = '94'): string {
    if (!rawPhone) return '';
    let cleaned = rawPhone.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) {
      cleaned = cleaned.substring(1);
    } else if (cleaned.startsWith('0') && cleaned.length === 10) {
      cleaned = defaultCountryCode + cleaned.substring(1);
    }
    return cleaned;
  }

  /**
   * Retrieves active, unmasked WhatsApp configuration for a tenant.
   */
  static async getConfig(tenantId: string): Promise<WhatsAppConfig | null> {
    const integrations = await TenantIntegrationService.getTenantIntegrations(tenantId, false);
    const config = integrations.messaging?.whatsapp;
    if (!config || !config.enabled) return null;
    return config;
  }

  /**
   * Dispatches a raw or structured WhatsApp message via Meta Graph API or local sandbox simulator.
   */
  static async sendMessage(
    tenantId: string,
    toPhone: string,
    messagePayload: Record<string, any>
  ): Promise<WhatsAppSendResult> {
    const startTime = Date.now();
    const normalizedPhone = this.normalizePhoneNumber(toPhone);
    if (!normalizedPhone) {
      throw new Error('Invalid recipient phone number.');
    }

    const config = await this.getConfig(tenantId);
    if (!config) {
      throw new Error(`WhatsApp Business API is not configured or is disabled for tenant [${tenantId}].`);
    }

    const isLive = !config.isSandbox && config.accessToken && !config.accessToken.includes('•••');

    // Live Meta Graph API Dispatch
    if (isLive && config.phoneNumberId && config.accessToken) {
      try {
        const url = `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`;
        const body = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizedPhone,
          ...messagePayload,
        };

        const response = await axios.post(url, body, {
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 12000,
        });

        const messageId = response.data?.messages?.[0]?.id || `wamid.live_${Date.now()}`;
        const latencyMs = Date.now() - startTime;

        logger.info(`[WhatsApp Live] Sent message to [${normalizedPhone}] via PhoneID [${config.phoneNumberId}]. MsgID: ${messageId}`);

        // Persist outbound message to history
        try {
          const customer = await (prisma as any).customer.findFirst({
            where: { tenantId, phone: { contains: normalizedPhone.slice(-9) } },
          });
          const contentText =
            messagePayload?.text?.body ||
            messagePayload?.interactive?.body?.text ||
            messagePayload?.template?.name ||
            'Outbound WhatsApp notification';

          await (prisma as any).whatsAppMessage.create({
            data: {
              tenantId,
              customerId: customer?.id || null,
              phone: normalizedPhone,
              direction: 'OUTBOUND',
              senderName: 'System / Merchant',
              messageType: messagePayload.type || 'text',
              content: contentText,
              waMessageId: messageId,
              status: 'SENT',
              metadata: messagePayload,
            },
          });
        } catch (dbErr: any) {
          logger.warn(`[WhatsApp History] Failed to log outbound live message: ${dbErr.message}`);
        }

        return {
          success: true,
          messageId,
          recipient: normalizedPhone,
          mode: 'LIVE',
          status: 'SENT',
          latencyMs,
        };
      } catch (err: any) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        logger.error(`[WhatsApp Live Error] Failed to send message to [${normalizedPhone}]: ${errorMsg}`);
        throw new Error(`Meta WhatsApp API Error: ${errorMsg}`);
      }
    }

    // Sandbox / Test Simulator Mode
    const simulatedMsgId = `wamid.sandbox_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const latencyMs = Math.floor(45 + Math.random() * 35);

    logger.info(`[WhatsApp Sandbox] Simulated dispatch to [${normalizedPhone}] for tenant [${tenantId}]. Payload type: ${messagePayload.type || 'text'}`);

    // Persist outbound message to history in sandbox mode
    try {
      const customer = await (prisma as any).customer.findFirst({
        where: { tenantId, phone: { contains: normalizedPhone.slice(-9) } },
      });
      const contentText =
        messagePayload?.text?.body ||
        messagePayload?.interactive?.body?.text ||
        messagePayload?.template?.name ||
        'Outbound WhatsApp notification';

      await (prisma as any).whatsAppMessage.create({
        data: {
          tenantId,
          customerId: customer?.id || null,
          phone: normalizedPhone,
          direction: 'OUTBOUND',
          senderName: 'System / Merchant (Sandbox)',
          messageType: messagePayload.type || 'text',
          content: contentText,
          waMessageId: simulatedMsgId,
          status: 'SIMULATED',
          metadata: messagePayload,
        },
      });
    } catch (dbErr: any) {
      logger.warn(`[WhatsApp History] Failed to log outbound sandbox message: ${dbErr.message}`);
    }

    return {
      success: true,
      messageId: simulatedMsgId,
      recipient: normalizedPhone,
      mode: 'SANDBOX',
      status: 'SIMULATED',
      latencyMs,
    };
  }

  /**
   * Sends a standard text message.
   */
  static async sendTextMessage(
    tenantId: string,
    toPhone: string,
    text: string
  ): Promise<WhatsAppSendResult> {
    return this.sendMessage(tenantId, toPhone, {
      type: 'text',
      text: { body: text },
    });
  }

  /**
   * Sends an interactive button message (up to 3 buttons).
   */
  static async sendInteractiveButtons(
    tenantId: string,
    toPhone: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    headerText?: string,
    footerText?: string
  ): Promise<WhatsAppSendResult> {
    const actionButtons = buttons.slice(0, 3).map((btn) => ({
      type: 'reply',
      reply: {
        id: btn.id,
        title: btn.title.substring(0, 20),
      },
    }));

    const interactivePayload: Record<string, any> = {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: actionButtons },
    };

    if (headerText) {
      interactivePayload.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      interactivePayload.footer = { text: footerText };
    }

    return this.sendMessage(tenantId, toPhone, {
      type: 'interactive',
      interactive: interactivePayload,
    });
  }

  /**
   * Sends a document / PDF (e.g. invoice or receipt).
   */
  static async sendDocument(
    tenantId: string,
    toPhone: string,
    documentUrl: string,
    filename: string,
    caption?: string
  ): Promise<WhatsAppSendResult> {
    return this.sendMessage(tenantId, toPhone, {
      type: 'document',
      document: {
        link: documentUrl,
        filename,
        caption: caption || filename,
      },
    });
  }

  /**
   * Sends a test verification message to ensure credentials and webhook readiness.
   */
  static async sendTestMessage(
    tenantId: string,
    testPhone: string
  ): Promise<WhatsAppSendResult> {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const storeName = tenant?.name || 'XONIT Commerce';

    const testBody = `👋 *Greetings from ${storeName}!*\n\n` +
      `Your *Meta WhatsApp Cloud API* integration has been successfully verified and activated.\n\n` +
      `✅ Vault Encryption: Active (AES-256-GCM)\n` +
      `✅ Live Webhooks: Enabled\n` +
      `✅ Automated Triggers: POS Receipts, Order Tracking, Credit Overdue Alerts\n\n` +
      `_Powered by XONIT Conversational Commerce Engine_`;

    return this.sendInteractiveButtons(
      tenantId,
      testPhone,
      testBody,
      [
        { id: 'btn_confirm', title: 'Acknowledge 👍' },
        { id: 'btn_dashboard', title: 'Open Dashboard 📊' },
      ],
      'XONIT Automated Notice',
      'Meta Cloud API Verified'
    );
  }

  /**
   * Formats an order into an interactive, high-clarity WhatsApp receipt message.
   */
  static formatOrderReceiptMessage(order: any, tenant: any): {
    headerText: string;
    bodyText: string;
    footerText: string;
    buttons: Array<{ id: string; title: string }>;
  } {
    const storeName = tenant?.name || 'XONIT Commerce';
    const invoiceNum = order.orderNumber || order.id.slice(0, 8).toUpperCase();
    const branchName = order.branch?.name || 'Main Branch';
    const currency = tenant?.currencySymbol || 'Rs.';

    const itemsSummary = (order.items || [])
      .slice(0, 5)
      .map((item: any) => {
        const title = item.productName || item.variant?.product?.name || item.variant?.name || 'Item';
        const qty = item.quantity || 1;
        const price = Number(item.price || item.unitPrice || 0);
        const total = (qty * price).toLocaleString('en-US', { minimumFractionDigits: 2 });
        return `• ${qty}x ${title} — ${currency} ${total}`;
      })
      .join('\n');

    const extraItemsCount = Math.max(0, (order.items?.length || 0) - 5);
    const extraItemsNote = extraItemsCount > 0 ? `\n_...and ${extraItemsCount} more item(s)_\n` : '';

    const subtotalFormatted = Number(order.subtotal || order.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const grandTotalFormatted = Number(order.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const paymentStatus = (order.paymentStatus || 'PAID').toUpperCase();
    const paymentMethod = (order.paymentMethod || 'CASH').toUpperCase();

    const isCreditPending = paymentStatus === 'PENDING' || paymentStatus === 'UNPAID' || paymentMethod === 'CREDIT';

    const bodyText =
      `🧾 *TAX INVOICE & e-RECEIPT*\n` +
      `*Store:* ${storeName}\n` +
      `*Invoice:* #${invoiceNum}\n` +
      `*Branch:* ${branchName}\n\n` +
      `*Purchased Items:*\n` +
      `${itemsSummary}${extraItemsNote}\n\n` +
      `───────────────────────\n` +
      `*Subtotal:* ${currency} ${subtotalFormatted}\n` +
      `*Grand Total:* *${currency} ${grandTotalFormatted}*\n` +
      `*Payment:* ${paymentMethod} (${paymentStatus})\n` +
      `───────────────────────\n\n` +
      (isCreditPending
        ? `⚠️ *Balance Outstanding:* ${currency} ${grandTotalFormatted}\n_Tap below to complete instant settlement via LankaQR / Online._`
        : `Thank you for choosing ${storeName}! Visit us again soon. 🎉`);

    const buttons: Array<{ id: string; title: string }> = [];

    if (isCreditPending) {
      buttons.push({ id: `pay_qr_${invoiceNum}`, title: 'Pay LankaQR 💳' });
    }
    buttons.push({ id: `view_bill_${invoiceNum}`, title: 'View e-Bill 📄' });
    buttons.push({ id: `support_${invoiceNum}`, title: 'Store Support 💬' });

    return {
      headerText: `${storeName} e-Bill`,
      bodyText,
      footerText: `Ref: #${invoiceNum} • Authorized Receipt`,
      buttons: buttons.slice(0, 3),
    };
  }

  /**
   * Dispatches an interactive WhatsApp digital receipt for a specific order.
   */
  static async sendOrderReceipt(
    orderId: string,
    recipientPhoneOverride?: string,
    initiatorUserId?: string
  ): Promise<WhatsAppSendResult> {
    const order = await (prisma as any).order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        branch: true,
        tenant: true,
        items: {
          include: {
            variant: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new Error(`Order with ID [${orderId}] was not found.`);
    }

    const tenantId = order.tenantId;
    if (!tenantId) {
      throw new Error('Order does not belong to a valid tenant.');
    }

    // Determine destination phone number
    const targetPhone = recipientPhoneOverride || order.customer?.phone || (order.shippingAddress as any)?.phone;
    if (!targetPhone) {
      throw new Error('No recipient phone number found for this order. Please specify a customer phone number.');
    }

    const receiptContent = this.formatOrderReceiptMessage(order, order.tenant);

    const result = await this.sendInteractiveButtons(
      tenantId,
      targetPhone,
      receiptContent.bodyText,
      receiptContent.buttons,
      receiptContent.headerText,
      receiptContent.footerText
    );

    // Record audit event
    try {
      await (prisma as any).auditLog.create({
        data: {
          tenant: tenantId ? { connect: { id: tenantId } } : undefined,
          user: initiatorUserId ? { connect: { id: initiatorUserId } } : undefined,
          action: 'DISPATCH',
          entity: 'WHATSAPP_RECEIPT',
          entityId: order.id,
          newData: {
            description: `Dispatched WhatsApp digital e-bill #${order.orderNumber || order.id.slice(0, 8)} to [${result.recipient}] via ${result.mode} mode (Status: ${result.status})`,
            recipient: result.recipient,
            mode: result.mode,
            messageId: result.messageId,
          },
        },
      });
    } catch (auditErr: any) {
      logger.warn(`Failed to write WhatsApp receipt audit log: ${auditErr.message}`);
    }

    return result;
  }

  /**
   * Formats an Accounts Receivable Overdue Statement & Payment reminder message.
   */
  static formatOverdueReminderMessage(
    customer: any,
    tenant: any,
    invoiceOrSummary: any
  ): {
    headerText: string;
    bodyText: string;
    footerText: string;
    buttons: Array<{ id: string; title: string }>;
  } {
    const storeName = tenant?.name || 'XONIT Store';
    const currency = tenant?.currencySymbol || 'Rs.';
    const customerName = customer?.companyName || customer?.firstName || 'Valued Customer';
    const balanceDue = Number(invoiceOrSummary.balanceDue ?? invoiceOrSummary.totalDue ?? customer.creditBalance ?? 0);
    const invoiceNum = invoiceOrSummary.invoiceNumber || 'STATEMENT';
    const overdueDays = invoiceOrSummary.overdueDays || 0;

    const agingText =
      overdueDays <= 0
        ? 'Current (Due Soon)'
        : overdueDays <= 30
        ? `${overdueDays} Days Overdue (1-30d bucket)`
        : overdueDays <= 60
        ? `${overdueDays} Days Overdue (31-60d bucket)`
        : `${overdueDays} Days Overdue (60+d Critical)`;

    const lankaQrUrl = `https://pay.xonit.cloud/${tenant?.slug || 'store'}/lankaqr?customer=${customer?.id}&ref=${invoiceNum}`;

    let body = `Dear *${customerName}*,\n\n`;
    body += `This is a friendly statement reminder from *${storeName}* regarding your outstanding account balance:\n\n`;
    body += `📄 *Reference:* #${invoiceNum}\n`;
    body += `💳 *Outstanding Balance:* ${currency} ${balanceDue.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`;
    body += `⏳ *Aging Status:* ${agingText}\n`;

    if (invoiceOrSummary.dueDate) {
      body += `📅 *Due Date:* ${new Date(invoiceOrSummary.dueDate).toLocaleDateString()}\n`;
    }

    body += `\nYou can settle your pending balance instantly with LankaQR or Bank Card using the secure link below:\n`;
    body += `👉 ${lankaQrUrl}\n\n`;
    body += `If you have already settled this invoice, please disregard this reminder or reply with your deposit slip.`;

    return {
      headerText: `⚠️ Payment Due: ${storeName}`,
      bodyText: body,
      footerText: 'XONIT Financial Ledger & Settlements',
      buttons: [
        { id: 'btn_pay_lankaqr', title: 'Pay LankaQR 💳' },
        { id: 'btn_view_statement', title: 'View Statement 📄' },
        { id: 'btn_contact_support', title: 'Contact Finance 💬' },
      ],
    };
  }

  /**
   * Dispatches an Overdue Payment Statement reminder to a customer via WhatsApp.
   */
  static async sendOverdueReminder(
    tenantId: string,
    invoiceId: string,
    initiatorUserId?: string,
    targetPhoneOverride?: string
  ): Promise<WhatsAppSendResult> {
    const invoice = await (prisma as any).salesInvoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new Error(`Sales invoice [${invoiceId}] not found.`);
    }

    const effectiveTenantId = invoice.tenantId || tenantId;
    const tenant = await (prisma as any).tenant.findUnique({ where: { id: effectiveTenantId } });
    const customer = await (prisma as any).customer.findUnique({ where: { id: invoice.customerId } });
    if (!customer) {
      throw new Error(`No customer found for invoice [${invoiceId}].`);
    }

    const targetPhone = targetPhoneOverride || customer.phone;
    if (!targetPhone) {
      throw new Error(`Customer [${customer.firstName || customer.companyName}] does not have a phone number on file.`);
    }

    const now = Date.now();
    const dueTime = new Date(invoice.dueDate).getTime();
    const overdueDays = Math.max(0, Math.floor((now - dueTime) / (1000 * 60 * 60 * 24)));

    const formatted = this.formatOverdueReminderMessage(customer, tenant, {
      ...invoice,
      overdueDays,
    });

    const result = await this.sendInteractiveButtons(
      effectiveTenantId,
      targetPhone,
      formatted.bodyText,
      formatted.buttons,
      formatted.headerText,
      formatted.footerText
    );

    // Record audit event
    try {
      await (prisma as any).auditLog.create({
        data: {
          tenant: tenantId ? { connect: { id: tenantId } } : undefined,
          user: initiatorUserId ? { connect: { id: initiatorUserId } } : undefined,
          action: 'DISPATCH',
          entity: 'WHATSAPP_DUNNING',
          entityId: invoice.id,
          newData: {
            description: `Dispatched WhatsApp overdue reminder for invoice #${invoice.invoiceNumber} to [${result.recipient}] (Status: ${result.status})`,
            recipient: result.recipient,
            balanceDue: invoice.balanceDue,
            overdueDays,
            mode: result.mode,
            messageId: result.messageId,
          },
        },
      });
    } catch (auditErr: any) {
      logger.warn(`Failed to write WhatsApp dunning audit log: ${auditErr.message}`);
    }

    return result;
  }

  /**
   * Formats a Predictive Reorder & Replenishment reminder message.
   */
  static formatReorderNudgeMessage(
    customer: any,
    tenant: any,
    product: any,
    variant?: any
  ): {
    headerText: string;
    bodyText: string;
    footerText: string;
    buttons: Array<{ id: string; title: string }>;
  } {
    const storeName = tenant?.name || 'XONIT Store';
    const currency = tenant?.currencySymbol || 'Rs.';
    const customerName = customer?.firstName || 'there';
    const price = variant?.price || product.variants?.[0]?.price || 0;
    const reorderUrl = `https://store.xonit.cloud/${tenant?.slug || 'store'}/product/${product.slug || product.id}`;

    let body = `Hi *${customerName}*! 👋\n\n`;
    body += `Running low on *${product.name}*?\n\n`;
    body += `Based on your previous purchase history at *${storeName}*, it might be time to replenish your stock:\n\n`;
    body += `📦 *Item:* ${product.name}\n`;
    body += `💰 *Price:* ${currency} ${price.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`;
    body += `⚡ *Availability:* In Stock & Ready for Rapid Dispatch\n\n`;
    body += `Order now with 1-click branch pickup or door-to-door express delivery:\n`;
    body += `👉 ${reorderUrl}`;

    return {
      headerText: `🛒 Reorder Reminder: ${storeName}`,
      bodyText: body,
      footerText: 'Quick Replenishment & Concierge Service',
      buttons: [
        { id: 'btn_reorder_now', title: 'Re-order Now 🛒' },
        { id: 'btn_view_catalog', title: 'View Storefront 🛍️' },
        { id: 'btn_chat_branch', title: 'Chat With Store 💬' },
      ],
    };
  }

  /**
   * Dispatches a Predictive Reorder Nudge to a customer via WhatsApp.
   */
  static async sendReorderNudge(
    tenantId: string,
    customerId: string,
    productId: string,
    initiatorUserId?: string,
    targetPhoneOverride?: string
  ): Promise<WhatsAppSendResult> {
    const customer = await (prisma as any).customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new Error(`Customer with ID [${customerId}] not found.`);

    const product = await (prisma as any).product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });
    if (!product) throw new Error(`Product with ID [${productId}] not found.`);

    const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } });

    const targetPhone = targetPhoneOverride || customer.phone;
    if (!targetPhone) {
      throw new Error(`Customer [${customer.firstName || customer.companyName}] does not have a phone number on file.`);
    }

    const formatted = this.formatReorderNudgeMessage(customer, tenant, product, product.variants?.[0]);

    const result = await this.sendInteractiveButtons(
      tenantId,
      targetPhone,
      formatted.bodyText,
      formatted.buttons,
      formatted.headerText,
      formatted.footerText
    );

    // Record audit event
    try {
      await (prisma as any).auditLog.create({
        data: {
          tenant: tenantId ? { connect: { id: tenantId } } : undefined,
          user: initiatorUserId ? { connect: { id: initiatorUserId } } : undefined,
          action: 'DISPATCH',
          entity: 'WHATSAPP_REORDER',
          entityId: product.id,
          newData: {
            description: `Dispatched WhatsApp reorder nudge for [${product.name}] to [${result.recipient}] (Status: ${result.status})`,
            recipient: result.recipient,
            customerId: customer.id,
            productId: product.id,
            mode: result.mode,
            messageId: result.messageId,
          },
        },
      });
    } catch (auditErr: any) {
      logger.warn(`Failed to write WhatsApp reorder audit log: ${auditErr.message}`);
    }

    return result;
  }
}
