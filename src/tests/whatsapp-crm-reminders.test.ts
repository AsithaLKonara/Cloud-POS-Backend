import prisma from '../config/prisma';
import { WhatsAppService } from '../services/whatsapp.service';
import { TenantIntegrationService } from '../services/tenant-integration.service';

jest.setTimeout(45000);

describe('Task 3: Automated CRM Sales & Financial Reminders via WhatsApp', () => {
  let testTenantId: string;
  let testCustomerId: string;
  let testCustomerPhone: string;
  let testInvoiceId: string;
  let testProductId: string;

  beforeAll(async () => {
    // 1. Get or create active tenant
    let tenant = await (prisma as any).tenant.findFirst({
      where: { status: 'ACTIVE' },
    });
    if (!tenant) {
      tenant = await (prisma as any).tenant.create({
        data: {
          name: 'CRM WhatsApp Test Store',
          slug: `crm-wa-${Date.now()}`,
          status: 'ACTIVE',
          currencySymbol: 'Rs.',
        },
      });
    }
    testTenantId = tenant.id;

    // 2. Configure WhatsApp in sandbox mode
    await TenantIntegrationService.updateMessaging(testTenantId, 'whatsapp', {
      enabled: true,
      wabaId: '1048592019482',
      phoneNumberId: '1029482019482',
      accessToken: 'EAAG_test_token_crm',
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

    // 3. Create or find test customer
    let customer = await (prisma as any).customer.findFirst({
      where: { tenantId: testTenantId },
    });
    if (!customer) {
      customer = await (prisma as any).customer.create({
        data: {
          tenant: { connect: { id: testTenantId } },
          firstName: 'Kasun',
          lastName: 'Bandara',
          phone: '0779876543',
          email: `kasun-${Date.now()}@example.com`,
          creditLimit: 50000,
          creditBalance: 14500,
        },
      });
    }
    testCustomerId = customer.id;
    testCustomerPhone = customer.phone || '0779876543';

    // 4. Create or find test product
    let product = await (prisma as any).product.findFirst({
      where: { tenantId: testTenantId },
      include: { variants: true },
    });
    if (!product) {
      product = await (prisma as any).product.create({
        data: {
          name: 'Specialty Espresso Roast (500g)',
          slug: `espresso-roast-${Date.now()}`,
          status: 'ACTIVE',
          productType: 'PHYSICAL',
          tenant: { connect: { id: testTenantId } },
          variants: {
            create: {
              name: '500g Bag',
              sku: `ESP-500-${Date.now()}`,
              price: 3200,
              costPrice: 1800,
              quantity: 25,
            },
          },
        },
        include: { variants: true },
      });
    }
    testProductId = product.id;

    // 4.5 Get or create a branch
    let branch = await (prisma as any).branch.findFirst({
      where: { tenantId: testTenantId },
    });
    if (!branch) {
      branch = await (prisma as any).branch.create({
        data: {
          name: 'Main HQ Branch',
          code: `MAIN-${Date.now().toString().slice(-4)}`,
          tenant: { connect: { id: testTenantId } },
        },
      });
    }

    // 5. Create test sales invoice
    const invoice = await (prisma as any).salesInvoice.create({
      data: {
        tenantId: testTenantId,
        customerId: testCustomerId,
        branchId: branch.id,
        invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
        invoiceType: 'COMMERCIAL',
        subtotal: 14000,
        tax: 500,
        total: 14500,
        amountPaid: 0,
        balanceDue: 14500,
        status: 'ISSUED',
        dueDate: new Date(Date.now() - 35 * 86400000), // 35 days overdue
      },
    });
    testInvoiceId = invoice.id;
  });

  afterAll(async () => {
    // Clean up test sales invoice
    if (testInvoiceId) {
      await (prisma as any).salesInvoice.deleteMany({ where: { id: testInvoiceId } }).catch(() => {});
    }
  });

  describe('Overdue Dunning Message Engine', () => {
    it('should format an actionable WhatsApp payment reminder with LankaQR link and buttons', () => {
      const formatted = WhatsAppService.formatOverdueReminderMessage(
        { firstName: 'Kasun', id: testCustomerId },
        { name: 'XONIT Coffee Roasters', currencySymbol: 'Rs.', slug: 'xonit-coffee' },
        { invoiceNumber: 'INV-109283', balanceDue: 14500, overdueDays: 35 }
      );

      expect(formatted.headerText).toContain('Payment Due: XONIT Coffee Roasters');
      expect(formatted.bodyText).toContain('Dear *Kasun*');
      expect(formatted.bodyText).toContain('INV-109283');
      expect(formatted.bodyText).toContain('14,500.00');
      expect(formatted.bodyText).toContain('35 Days Overdue');
      expect(formatted.bodyText).toContain('lankaqr');

      expect(formatted.buttons).toHaveLength(3);
      expect(formatted.buttons?.[0]?.title).toBe('Pay LankaQR 💳');
      expect(formatted.buttons?.[1]?.title).toBe('View Statement 📄');
    });

    it('should successfully dispatch an overdue statement reminder and record audit log', async () => {
      const result = await WhatsAppService.sendOverdueReminder(testTenantId, testInvoiceId);

      expect(result.success).toBe(true);
      expect(result.status).toBe('SIMULATED');
      expect(result.recipient).toContain(WhatsAppService.normalizePhoneNumber(testCustomerPhone));

      // Verify AuditLog
      const audit = await (prisma as any).auditLog.findFirst({
        where: {
          tenantId: testTenantId,
          entity: 'WHATSAPP_DUNNING',
          entityId: testInvoiceId,
        },
      });

      expect(audit).toBeDefined();
      expect(audit.action).toBe('DISPATCH');
      expect((audit.newData as any)?.description).toContain('Dispatched WhatsApp overdue reminder');
    });
  });

  describe('Predictive Reorder Replenishment Engine', () => {
    it('should format an enticing replenishment reminder with product details and quick links', () => {
      const formatted = WhatsAppService.formatReorderNudgeMessage(
        { firstName: 'Kasun' },
        { name: 'XONIT Superstore', currencySymbol: 'Rs.', slug: 'xonit-store' },
        { id: 'prod-123', name: 'Organic Green Tea (100g)' },
        { price: 1250 }
      );

      expect(formatted.headerText).toContain('Reorder Reminder: XONIT Superstore');
      expect(formatted.bodyText).toContain('Hi *Kasun*');
      expect(formatted.bodyText).toContain('Running low on *Organic Green Tea (100g)*?');
      expect(formatted.bodyText).toContain('Rs. 1,250.00');

      expect(formatted.buttons).toHaveLength(3);
      expect(formatted.buttons?.[0]?.title).toBe('Re-order Now 🛒');
    });

    it('should successfully dispatch a reorder nudge and record audit log', async () => {
      const result = await WhatsAppService.sendReorderNudge(testTenantId, testCustomerId, testProductId);

      expect(result.success).toBe(true);
      expect(result.status).toBe('SIMULATED');
      expect(result.recipient).toContain(WhatsAppService.normalizePhoneNumber(testCustomerPhone));

      // Verify AuditLog
      const audit = await (prisma as any).auditLog.findFirst({
        where: {
          tenantId: testTenantId,
          entity: 'WHATSAPP_REORDER',
          entityId: testProductId,
        },
      });

      expect(audit).toBeDefined();
      expect(audit.action).toBe('DISPATCH');
      expect((audit.newData as any)?.description).toContain('Dispatched WhatsApp reorder nudge');
    });
  });
});
