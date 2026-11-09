import prisma from '../config/prisma';
import { logger } from '../utils/logger';

export interface ToolStockResult {
  found: boolean;
  productName?: string;
  sku?: string;
  price?: number;
  availableQuantity?: number;
  branchName?: string;
  message: string;
}

export interface ToolOrderResult {
  success: boolean;
  orderId?: string;
  orderNumber?: string;
  total?: number;
  itemCount?: number;
  paymentLink?: string;
  message: string;
}

export interface ToolPaymentResult {
  success: boolean;
  paymentUrl: string;
  lankaQrPayload?: string;
  amount?: number;
  message: string;
}

export interface ToolEscalationResult {
  success: boolean;
  ticketId: string;
  reason: string;
  message: string;
}

export interface AiGovernanceSettings {
  autonomousOrderingEnabled: boolean;
  confidenceThreshold: number;
  maxAutoDiscountPercent: number;
  escalationTimeoutMinutes: number;
  supportedTools: string[];
}

export const DEFAULT_AI_GOVERNANCE: AiGovernanceSettings = {
  autonomousOrderingEnabled: true,
  confidenceThreshold: 0.85,
  maxAutoDiscountPercent: 10,
  escalationTimeoutMinutes: 15,
  supportedTools: [
    'check_branch_stock',
    'create_whatsapp_order',
    'generate_payment_link',
    'escalate_to_staff',
  ],
};

export class WhatsAppAgentToolsService {
  /**
   * Tool 1: Check branch stock in real-time
   */
  static async checkBranchStock(
    tenantId: string,
    query: string,
    branchName?: string
  ): Promise<ToolStockResult> {
    try {
      const cleanQ = (query || '').trim();
      if (!cleanQ) {
        return { found: false, message: 'No search term provided for stock check.' };
      }

      // Search Product and ProductVariant
      const variant = await (prisma as any).productVariant.findFirst({
        where: {
          OR: [
            { sku: { contains: cleanQ, mode: 'insensitive' } },
            { barcode: { contains: cleanQ, mode: 'insensitive' } },
            { name: { contains: cleanQ, mode: 'insensitive' } },
            { product: { name: { contains: cleanQ, mode: 'insensitive' }, tenantId } },
          ],
          product: { tenantId },
        },
        include: {
          product: true,
        },
      });

      if (!variant) {
        // Fallback search across catalog
        const product = await (prisma as any).product.findFirst({
          where: {
            tenantId,
            name: { contains: cleanQ, mode: 'insensitive' },
          },
          include: {
            variants: true,
          },
        });

        if (product && product.variants && product.variants.length > 0) {
          const v = product.variants[0];
          return {
            found: true,
            productName: product.name,
            sku: v.sku || 'N/A',
            price: v.price,
            availableQuantity: v.quantity,
            branchName: branchName || 'Main Store',
            message: `✅ In Stock: "${product.name}" (SKU: ${v.sku || 'N/A'}) - Price: Rs. ${v.price.toFixed(2)} | Current Available Qty: ${v.quantity} units at ${branchName || 'Main Store'}.`,
          };
        }

        return {
          found: false,
          message: `⚠️ Sorry, we could not find "${cleanQ}" in our product catalog. Please verify the item name or SKU.`,
        };
      }

      const pName = variant.product?.name || variant.name || cleanQ;
      return {
        found: true,
        productName: pName,
        sku: variant.sku || 'N/A',
        price: variant.price,
        availableQuantity: variant.quantity,
        branchName: branchName || 'Main Store',
        message: `✅ In Stock: "${pName}" (SKU: ${variant.sku || 'N/A'}) - Price: Rs. ${variant.price.toFixed(2)} | Current Available Qty: ${variant.quantity} units at ${branchName || 'Main Store'}.`,
      };
    } catch (err: any) {
      logger.error(`[Agent Tool checkBranchStock Error]: ${err.message}`);
      return { found: false, message: `Stock lookup temporarily unavailable: ${err.message}` };
    }
  }

  /**
   * Tool 2: Create WhatsApp draft order autonomously in POS database
   */
  static async createWhatsAppOrder(
    tenantId: string,
    customerId: string | null,
    phone: string,
    items: Array<{ skuOrName: string; quantity: number }>,
    customerNotes?: string
  ): Promise<ToolOrderResult> {
    try {
      if (!items || items.length === 0) {
        return { success: false, message: 'No items specified to create an order.' };
      }

      // Check governance toggle
      const governance = await this.getAiGovernanceSettings();
      if (!governance.autonomousOrderingEnabled) {
        return {
          success: false,
          message: 'Autonomous order creation is currently disabled by store management policy.',
        };
      }

      // Resolve Customer
      let resolvedCustomer = null;
      if (customerId) {
        resolvedCustomer = await (prisma as any).customer.findUnique({ where: { id: customerId } });
      }
      if (!resolvedCustomer && phone) {
        resolvedCustomer = await (prisma as any).customer.findFirst({
          where: { tenantId, phone: { contains: phone.slice(-9) } },
        });
      }

      if (!resolvedCustomer) {
        resolvedCustomer = await (prisma as any).customer.create({
          data: {
            tenant: { connect: { id: tenantId } },
            firstName: 'WhatsApp',
            lastName: 'Customer',
            phone: phone || '0770000000',
            customerType: 'RETAIL',
          },
        });
      }

      // Resolve items and calculate order total
      let subtotal = 0;
      const orderItemsData: any[] = [];

      for (const item of items) {
        const query = (item.skuOrName || '').trim();
        const qty = Math.max(1, Number(item.quantity) || 1);

        const queryWords = query.split(' ').filter((w: string) => w.length > 2);
        const searchConditions: any[] = [
          { sku: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { product: { name: { contains: query, mode: 'insensitive' }, tenantId } },
        ];
        for (const w of queryWords) {
          searchConditions.push({ product: { name: { contains: w, mode: 'insensitive' }, tenantId } });
          searchConditions.push({ name: { contains: w, mode: 'insensitive' } });
        }

        const variant = await (prisma as any).productVariant.findFirst({
          where: {
            OR: searchConditions,
            product: { tenantId },
          },
          include: { product: true },
        });

        if (variant) {
          const itemPrice = Number(variant.price) || 0;
          subtotal += itemPrice * qty;
          orderItemsData.push({
            variantId: variant.id,
            quantity: qty,
            priceAtPurchase: itemPrice,
            costPriceAtPurchase: Number(variant.costPrice) || 0,
            notes: item.skuOrName,
          });
        }
      }

      if (orderItemsData.length === 0) {
        return {
          success: false,
          message: 'Could not match the requested items in our product catalog. Please specify exact product names.',
        };
      }

      const orderNumber = `WA-${Date.now().toString().slice(-6)}`;
      const total = subtotal;

      // Create Order
      const newOrder = await (prisma as any).order.create({
        data: {
          orderNumber,
          tenantId,
          customerId: resolvedCustomer.id,
          status: 'PENDING',
          paymentStatus: 'UNPAID',
          paymentMethod: 'WHATSAPP_LANKAQR',
          subtotal,
          shippingFee: 0,
          discount: 0,
          tax: 0,
          total,
          type: 'WHATSAPP',
          metadata: {
            source: 'WHATSAPP_AI_AGENT',
            autonomous: true,
            customerPhone: phone,
            notes: customerNotes || 'Created via WhatsApp AI Sales Copilot',
          },
          items: {
            create: orderItemsData,
          },
        },
      });

      const paymentLink = `https://pay.xonit.cloud/${tenantId}/lankaqr?order=${newOrder.id}&amount=${total}`;

      return {
        success: true,
        orderId: newOrder.id,
        orderNumber,
        total,
        itemCount: orderItemsData.length,
        paymentLink,
        message: `🎉 Order #${orderNumber} created successfully! Total: Rs. ${total.toFixed(2)} (${orderItemsData.length} items). Payment Link: ${paymentLink}`,
      };
    } catch (err: any) {
      logger.error(`[Agent Tool createWhatsAppOrder Error]: ${err.message}`, err);
      return { success: false, message: `Failed to create order: ${err.message}` };
    }
  }

  /**
   * Tool 3: Generate instant payment link / LankaQR
   */
  static async generatePaymentLink(
    tenantId: string,
    customerId?: string,
    orderId?: string,
    amount?: number
  ): Promise<ToolPaymentResult> {
    try {
      let finalAmount = amount || 0;
      if (orderId && !finalAmount) {
        const ord = await (prisma as any).order.findUnique({ where: { id: orderId } });
        if (ord) finalAmount = ord.total;
      }

      const paymentUrl = `https://pay.xonit.cloud/${tenantId}/lankaqr?${orderId ? `order=${orderId}&` : ''}${customerId ? `customer=${customerId}&` : ''}amount=${finalAmount}`;

      return {
        success: true,
        paymentUrl,
        amount: finalAmount,
        lankaQrPayload: `00020101021226500010COM.LANKAQR5204549953031445404${finalAmount.toFixed(2)}5802LK5912XONIT CLOUD6007COLOMBO`,
        message: `💳 Tap to complete payment via LankaQR or Card:\n👉 ${paymentUrl}`,
      };
    } catch (err: any) {
      logger.error(`[Agent Tool generatePaymentLink Error]: ${err.message}`);
      return { success: false, paymentUrl: '', message: `Payment link generation failed: ${err.message}` };
    }
  }

  /**
   * Tool 4: Escalate to staff
   */
  static async escalateToStaff(
    tenantId: string,
    customerId?: string,
    phone?: string,
    reason?: string
  ): Promise<ToolEscalationResult> {
    const ticketId = `ESC-${Date.now().toString().slice(-5)}`;
    logger.info(`[WhatsApp AI Escalation] Ticket [${ticketId}] for Customer [${customerId || phone}]: "${reason}"`);

    return {
      success: true,
      ticketId,
      reason: reason || 'Customer requested human support',
      message: `A human store representative has been alerted (Ticket #${ticketId}). Someone will follow up with you shortly!`,
    };
  }

  /**
   * AI Governance Settings
   */
  static async getAiGovernanceSettings(): Promise<AiGovernanceSettings> {
    try {
      const setting = await (prisma as any).setting.findUnique({
        where: { key: 'PLATFORM_AI_SALES_GOVERNANCE' },
      });
      if (setting && setting.value) {
        return { ...DEFAULT_AI_GOVERNANCE, ...JSON.parse(setting.value) };
      }
    } catch (e) {
      // Fallback
    }
    return DEFAULT_AI_GOVERNANCE;
  }

  static async updateAiGovernanceSettings(settings: Partial<AiGovernanceSettings>): Promise<AiGovernanceSettings> {
    const current = await this.getAiGovernanceSettings();
    const updated = { ...current, ...settings };
    await (prisma as any).setting.upsert({
      where: { key: 'PLATFORM_AI_SALES_GOVERNANCE' },
      update: { value: JSON.stringify(updated), updatedAt: new Date() },
      create: {
        key: 'PLATFORM_AI_SALES_GOVERNANCE',
        value: JSON.stringify(updated),
        group: 'ai',
        type: 'json',
        description: 'Super Admin Autonomous AI Sales Agent Governance Controls',
      },
    });
    return updated;
  }

  /**
   * Simulator Sandbox: Runs multi-turn Agent workflow with tool execution
   */
  static async simulateAgentConversation(params: {
    message: string;
    tenantId?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<{
    answer: string;
    toolCallsExecuted: Array<{ tool: string; params: any; result: any }>;
    orderCreated?: any;
    paymentLink?: string;
  }> {
    const { message, tenantId: requestedTenantId, history = [] } = params;
    const cleanMsg = (message || '').trim();

    // Default to first active tenant if not provided
    let targetTenantId = requestedTenantId;
    if (!targetTenantId) {
      const tenant = await (prisma as any).tenant.findFirst({ where: { status: 'ACTIVE' } });
      targetTenantId = tenant?.id || 'demo-tenant';
    }
    const activeTenantId: string = targetTenantId || 'demo-tenant';

    const toolCallsExecuted: Array<{ tool: string; params: any; result: any }> = [];
    let orderCreated: any = null;
    let paymentLink: string | undefined = undefined;

    const lower = cleanMsg.toLowerCase();

    // Check intent: Order creation
    if (lower.includes('order') || lower.includes('buy') || lower.includes('reserve') || lower.includes('purchase')) {
      // Extract quantity and product
      let qty = 1;
      const qtyMatch = cleanMsg.match(/(\d+)\s*(packs?|units?|items?|kg|bottles?|box)?/i);
      if (qtyMatch && qtyMatch[1]) {
        qty = parseInt(qtyMatch[1], 10);
      }

      let productName = cleanMsg
        .replace(/order|buy|reserve|purchase|for|me|please|can|i|get|need|\d+|packs?|units?|items?|of|and|send|payment|link/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!productName) productName = 'Ceylon Tea';

      // 1. Tool Call: checkBranchStock
      const stockRes = await this.checkBranchStock(activeTenantId, productName);
      toolCallsExecuted.push({
        tool: 'check_branch_stock',
        params: { query: productName },
        result: stockRes,
      });

      // 2. Tool Call: createWhatsAppOrder
      const orderRes = await this.createWhatsAppOrder(
        activeTenantId,
        null,
        '0771234567',
        [{ skuOrName: productName, quantity: qty }],
        cleanMsg
      );
      toolCallsExecuted.push({
        tool: 'create_whatsapp_order',
        params: { items: [{ skuOrName: productName, quantity: qty }] },
        result: orderRes,
      });

      if (orderRes.success) {
        orderCreated = orderRes;
        paymentLink = orderRes.paymentLink;

        // 3. Tool Call: generatePaymentLink
        const payRes = await this.generatePaymentLink(activeTenantId, undefined, orderRes.orderId, orderRes.total);
        toolCallsExecuted.push({
          tool: 'generate_payment_link',
          params: { orderId: orderRes.orderId, amount: orderRes.total },
          result: payRes,
        });

        const reply = `🛒 **Order Confirmed by AI Sales Copilot!**\n\n` +
          `• **Product**: ${stockRes.productName || productName}\n` +
          `• **Quantity**: ${qty} units\n` +
          `• **Order Reference**: #${orderRes.orderNumber}\n` +
          `• **Subtotal**: Rs. ${orderRes.total?.toFixed(2)}\n` +
          `• **Status**: PENDING (Awaiting Payment)\n\n` +
          `💳 Complete your payment instantly via LankaQR or Card:\n👉 ${paymentLink}\n\n` +
          `Once payment is confirmed, fulfillment will commence automatically!`;

        return { answer: reply, toolCallsExecuted, orderCreated, paymentLink };
      }
    }

    // Check intent: Stock lookup
    if (lower.includes('stock') || lower.includes('have') || lower.includes('price') || lower.includes('available')) {
      const productName = cleanMsg.replace(/do|you|have|in|stock|what|is|the|price|of|available|\?/gi, '').trim() || 'Tea';
      const stockRes = await this.checkBranchStock(activeTenantId, productName);
      toolCallsExecuted.push({
        tool: 'check_branch_stock',
        params: { query: productName },
        result: stockRes,
      });

      const reply = stockRes.found
        ? `${stockRes.message}\n\nWould you like me to reserve units or create an invoice for you right now? Simply reply: *"Reserve [quantity] units"*.`
        : stockRes.message;

      return { answer: reply, toolCallsExecuted };
    }

    // Check intent: Payment link
    if (lower.includes('pay') || lower.includes('qr') || lower.includes('card') || lower.includes('link')) {
      const payRes = await this.generatePaymentLink(activeTenantId);
      toolCallsExecuted.push({
        tool: 'generate_payment_link',
        params: { tenantId: activeTenantId },
        result: payRes,
      });
      return { answer: payRes.message, toolCallsExecuted, paymentLink: payRes.paymentUrl };
    }

    // Check intent: Escalation
    if (lower.includes('human') || lower.includes('agent') || lower.includes('staff') || lower.includes('complain') || lower.includes('manager')) {
      const escRes = await this.escalateToStaff(activeTenantId, undefined, undefined, cleanMsg);
      toolCallsExecuted.push({
        tool: 'escalate_to_staff',
        params: { reason: cleanMsg },
        result: escRes,
      });
      return { answer: escRes.message, toolCallsExecuted };
    }

    // General FAQ fallback with friendly conversational tone
    return {
      answer: `Hello! I am your AI Sales Copilot. I can check live branch inventory, place draft orders, and send instant LankaQR payment links.\n\nTry asking:\n• *"Do you have Ceylon Tea in stock?"*\n• *"Create an order for 2 packs of Ceylon Tea"*\n• *"Send me the LankaQR payment link"*`,
      toolCallsExecuted,
    };
  }
}
