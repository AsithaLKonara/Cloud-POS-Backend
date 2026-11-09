import prisma from '../config/prisma';
import { WhatsAppService } from '../services/whatsapp.service';
import { TenantIntegrationService } from '../services/tenant-integration.service';

jest.setTimeout(45000);

describe('Task 2: POS Digital e-Receipts & Payment Link Dispatching via WhatsApp', () => {
  let testTenantId: string;
  let testOrderId: string;

  beforeAll(async () => {
    // 1. Get or create active tenant
    let tenant = await (prisma as any).tenant.findFirst({
      where: { status: 'ACTIVE' },
    });
    if (!tenant) {
      tenant = await (prisma as any).tenant.create({
        data: {
          name: 'POS WhatsApp Test Store',
          slug: `pos-wa-${Date.now()}`,
          status: 'ACTIVE',
          currencySymbol: 'Rs.',
        },
      });
    }
    testTenantId = tenant.id;

    // 2. Ensure tenant has WhatsApp config enabled in sandbox
    await TenantIntegrationService.updateMessaging(testTenantId, 'whatsapp', {
      enabled: true,
      wabaId: '1048592019482',
      phoneNumberId: '1029482019482',
      accessToken: 'EAAG_test_token_123',
      isSandbox: true,
      triggers: {
        posReceipts: true,
        orderTracking: true,
        abandonedCart: true,
        creditOverdue: true,
        loyaltyAlerts: true,
        catalogSync: false,
      },
    });

    // 3. Find or create a test customer
    let customer = await (prisma as any).customer.findFirst({
      where: { tenantId: testTenantId },
    });
    if (!customer) {
      customer = await (prisma as any).customer.create({
        data: {
          tenantId: testTenantId,
          firstName: 'Nuwan',
          lastName: 'Perera',
          phone: '0771234567',
          email: `customer-${Date.now()}@test.com`,
        },
      });
    }

    // 4. Find or create a branch
    let branch = await (prisma as any).branch.findFirst({
      where: { tenantId: testTenantId },
    });
    if (!branch) {
      branch = await (prisma as any).branch.create({
        data: {
          tenantId: testTenantId,
          name: 'Colombo Flagship Branch',
          slug: `branch-${Date.now()}`,
        },
      });
    }

    // 5. Create a test POS order
    const order = await (prisma as any).order.create({
      data: {
        tenant: { connect: { id: testTenantId } },
        branch: { connect: { id: branch.id } },
        customer: { connect: { id: customer.id } },
        orderNumber: `INV-${Date.now().toString().slice(-6)}`,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        subtotal: 3500.00,
        total: 3500.00,
        tax: 0,
        discount: 0,
        shippingFee: 0,
      },
    });
    testOrderId = order.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Receipt Formatting Engine', () => {
    it('should format a structured WhatsApp tax invoice with items, totals, and buttons', async () => {
      const order = await (prisma as any).order.findUnique({
        where: { id: testOrderId },
        include: { customer: true, branch: true, items: true },
      });
      const tenant = await (prisma as any).tenant.findUnique({
        where: { id: testTenantId },
      });

      const formatted = WhatsAppService.formatOrderReceiptMessage(order, tenant);

      expect(formatted.headerText).toContain('e-Bill');
      expect(formatted.bodyText).toContain('TAX INVOICE & e-RECEIPT');
      expect(formatted.bodyText).toContain(order.orderNumber);
      expect(formatted.bodyText).toContain('Rs. 3,500.00');
      expect(formatted.bodyText).toContain('CASH (PAID)');
      expect(formatted.buttons.length).toBeGreaterThan(0);
      expect(formatted.buttons.some(b => b.title.includes('e-Bill'))).toBe(true);
    });

    it('should include LankaQR payment action when order payment is pending or credit', async () => {
      const creditOrder = {
        orderNumber: 'INV-CREDIT-999',
        totalAmount: 7500.00,
        subtotal: 7500.00,
        paymentStatus: 'PENDING',
        paymentMethod: 'CREDIT',
        items: [],
      };
      const tenant = { name: 'Test Merchant', currencySymbol: 'Rs.' };

      const formatted = WhatsAppService.formatOrderReceiptMessage(creditOrder, tenant);
      expect(formatted.bodyText).toContain('Balance Outstanding');
      expect(formatted.buttons.some(b => b.title.includes('LankaQR'))).toBe(true);
    });
  });

  describe('Order Receipt Dispatch & Audit Logging', () => {
    it('should successfully dispatch a digital receipt and write an audit log entry', async () => {
      const result = await WhatsAppService.sendOrderReceipt(testOrderId, '0771234567');

      expect(result.success).toBe(true);
      expect(result.status).toBe('SIMULATED');
      expect(result.recipient).toBe('94771234567');
      expect(result.messageId).toContain('wamid.sandbox_');

      // Verify AuditLog was recorded
      const auditEntry = await (prisma as any).auditLog.findFirst({
        where: {
          tenantId: testTenantId,
          entity: 'WHATSAPP_RECEIPT',
          entityId: testOrderId,
        },
      });

      expect(auditEntry).toBeDefined();
      expect(auditEntry.action).toBe('DISPATCH');
      expect((auditEntry.newData as any)?.description).toContain('Dispatched WhatsApp digital e-bill');
    });
  });
});
