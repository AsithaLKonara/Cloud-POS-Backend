import prisma from '../config/prisma';
import { WhatsAppAgentToolsService, DEFAULT_AI_GOVERNANCE } from '../services/whatsapp-agent-tools.service';
import { SuperAdminWhatsAppService } from '../services/superadmin-whatsapp.service';

jest.setTimeout(45000);

describe('Task 2: Highest Automated Sales Agent & Gemini Tool Calling', () => {
  let testTenantId: string;
  let testProductName = 'Artisanal Ceylon Tea';
  let createdOrderId: string | null = null;

  beforeAll(async () => {
    // Find or create test tenant
    let tenant = await (prisma as any).tenant.findFirst({ where: { status: 'ACTIVE' } });
    if (!tenant) {
      tenant = await (prisma as any).tenant.create({
        data: {
          name: 'AI Test Store',
          slug: 'ai-test-store',
          businessType: 'RETAIL',
          status: 'ACTIVE',
        },
      });
    }
    testTenantId = tenant.id;

    // Ensure test product & variant exist for this tenant
    let product = await (prisma as any).product.findFirst({
      where: { tenantId: testTenantId, name: { contains: 'Ceylon Tea', mode: 'insensitive' } },
      include: { variants: true },
    });

    if (!product || !product.variants || product.variants.length === 0) {
      const uniqueSuffix = Date.now().toString().slice(-4);
      product = await (prisma as any).product.create({
        data: {
          tenant: { connect: { id: testTenantId } },
          name: 'Artisanal Ceylon Tea',
          slug: `ceylon-tea-${uniqueSuffix}`,
          variants: {
            create: {
              name: 'Artisanal Ceylon Tea - 250g',
              sku: `TEA-CEY-${uniqueSuffix}`,
              price: 1250.0,
              quantity: 50,
            },
          },
        },
        include: { variants: true },
      });
    }
    testProductName = product.name;
  }, 45000);

  afterAll(async () => {
    if (createdOrderId) {
      await (prisma as any).orderItem.deleteMany({ where: { orderId: createdOrderId } }).catch(() => {});
      await (prisma as any).order.delete({ where: { id: createdOrderId } }).catch(() => {});
    }
  });

  it('1. should execute checkBranchStock tool and return real-time inventory levels', async () => {
    const result = await WhatsAppAgentToolsService.checkBranchStock(testTenantId, testProductName);
    expect(result).toBeDefined();
    expect(result.found).toBe(true);
    expect(result.price).toBeGreaterThan(0);
    expect(result.message).toContain('In Stock');
  });

  it('2. should execute createWhatsAppOrder tool and persist draft order in POS schema', async () => {
    const orderRes = await WhatsAppAgentToolsService.createWhatsAppOrder(
      testTenantId,
      null,
      '0779998888',
      [{ skuOrName: testProductName, quantity: 2 }],
      'Deliver after 5 PM'
    );

    expect(orderRes.success).toBe(true);
    expect(orderRes.orderId).toBeDefined();
    expect(orderRes.orderNumber).toMatch(/^WA-/);
    expect(orderRes.total).toBeGreaterThan(0);
    expect(orderRes.paymentLink).toContain('lankaqr');

    createdOrderId = orderRes.orderId!;

    // Verify in DB
    const dbOrder = await (prisma as any).order.findUnique({
      where: { id: createdOrderId },
      include: { items: true },
    });
    expect(dbOrder).toBeDefined();
    expect(dbOrder.status).toBe('PENDING');
    expect(dbOrder.type).toBe('WHATSAPP');
    expect(dbOrder.items.length).toBeGreaterThan(0);
  });

  it('3. should execute generatePaymentLink tool with LankaQR payload', async () => {
    const payRes = await WhatsAppAgentToolsService.generatePaymentLink(
      testTenantId,
      undefined,
      createdOrderId || undefined,
      2500
    );

    expect(payRes.success).toBe(true);
    expect(payRes.paymentUrl).toContain('pay.xonit.cloud');
    expect(payRes.lankaQrPayload).toContain('LANKAQR');
  });

  it('4. should execute escalateToStaff tool for human handoff', async () => {
    const escRes = await WhatsAppAgentToolsService.escalateToStaff(
      testTenantId,
      undefined,
      '0779998888',
      'Customer has an urgent billing question'
    );

    expect(escRes.success).toBe(true);
    expect(escRes.ticketId).toMatch(/^ESC-/);
  });

  it('5. should execute simulateAgentConversation with multi-turn order placement intent', async () => {
    const simRes = await WhatsAppAgentToolsService.simulateAgentConversation({
      message: `Reserve 2 packs of ${testProductName} and send payment link`,
      tenantId: testTenantId,
      history: [
        { role: 'user', content: `Do you have ${testProductName}?` },
        { role: 'assistant', content: `Yes, ${testProductName} is in stock at Rs. 1,250.00.` },
      ],
    });

    expect(simRes.answer).toBeDefined();
    expect(simRes.toolCallsExecuted.length).toBeGreaterThanOrEqual(2);
    expect(simRes.orderCreated).toBeDefined();
    expect(simRes.paymentLink).toBeDefined();
  });

  it('6. should retrieve and update Super Admin AI Sales Agent governance configuration', async () => {
    const initialGov = await SuperAdminWhatsAppService.getAiSalesGovernance();
    expect(initialGov.settings).toBeDefined();
    expect(initialGov.telemetry).toBeDefined();

    const updated = await SuperAdminWhatsAppService.updateAiSalesGovernance({
      confidenceThreshold: 0.90,
      maxAutoDiscountPercent: 12,
    });

    expect(updated.confidenceThreshold).toBe(0.90);
    expect(updated.maxAutoDiscountPercent).toBe(12);

    // Reset back to standard
    await SuperAdminWhatsAppService.updateAiSalesGovernance({
      confidenceThreshold: DEFAULT_AI_GOVERNANCE.confidenceThreshold,
      maxAutoDiscountPercent: DEFAULT_AI_GOVERNANCE.maxAutoDiscountPercent,
    });
  });
});
