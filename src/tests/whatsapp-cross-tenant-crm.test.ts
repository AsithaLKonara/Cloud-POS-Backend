import { SuperAdminWhatsAppService } from '../services/superadmin-whatsapp.service';
import prisma from '../config/prisma';

describe('SuperAdmin Cross-Tenant CRM & WhatsApp Live Thread Inspector', () => {
  let testTenantId: string;
  const testPhone = '94770009999';

  beforeAll(async () => {
    // Find or create a test tenant
    let tenant = await prisma.tenant.findFirst({
      where: { slug: { contains: 'test' } },
    });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: 'CRM Test Tenant',
          slug: `crm-test-${Date.now()}`,
          businessType: 'RETAIL',
          status: 'ACTIVE',
        },
      });
    }
    testTenantId = tenant.id;

    // Create a customer if none exists
    let customer = await prisma.customer.findFirst({
      where: { tenantId: testTenantId, phone: testPhone },
    });
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          tenant: { connect: { id: testTenantId } },
          firstName: 'Anura',
          lastName: 'Bandara',
          phone: testPhone,
          email: 'anura@example.com',
          creditBalance: 4500,
        },
      });
    }

    // Insert an inbound message
    await (prisma as any).whatsAppMessage.create({
      data: {
        tenantId: testTenantId,
        customerId: customer.id,
        phone: testPhone,
        senderName: 'Anura Bandara',
        direction: 'INBOUND',
        messageType: 'text',
        content: 'Hi, what time does your store close today?',
        status: 'DELIVERED',
      },
    });
  });

  it('should list cross-tenant threads with customer dossier summary', async () => {
    const threads = await SuperAdminWhatsAppService.getCrossTenantThreads(testTenantId);

    expect(Array.isArray(threads)).toBe(true);
    expect(threads.length).toBeGreaterThan(0);

    const thread = threads.find((t) => t.phone === testPhone);
    expect(thread).toBeDefined();
    expect(thread?.tenantId).toBe(testTenantId);
    expect(thread?.customerName).toContain('Anura');
    expect(thread?.customerDossier).toBeDefined();
    expect(thread?.customerDossier?.creditBalance).toBe(4500);
  });

  it('should filter cross-tenant threads by keyword search', async () => {
    const threads = await SuperAdminWhatsAppService.getCrossTenantThreads(undefined, 'close today');

    expect(Array.isArray(threads)).toBe(true);
    expect(threads.length).toBeGreaterThan(0);
    expect(threads.some((t) => t.phone === testPhone)).toBe(true);
  });

  it('should retrieve chronological messages and customer dossier for selected thread', async () => {
    const details = await SuperAdminWhatsAppService.getThreadMessages(testTenantId, testPhone);

    expect(details).toBeDefined();
    expect(Array.isArray(details.messages)).toBe(true);
    expect(details.messages.length).toBeGreaterThan(0);
    expect(details.customerDossier).toBeDefined();
    expect(details.customerDossier?.firstName).toBe('Anura');
    expect(details.customerDossier?.email).toBe('anura@example.com');
  });

  it('should dispatch a Super Admin intervention message and record it in database', async () => {
    const interventionText = 'Hello Anura, Super Admin here from Platform Support. Our store closes at 9:00 PM tonight.';
    const result = await SuperAdminWhatsAppService.sendInterventionMessage(testTenantId, testPhone, interventionText);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Intervention message dispatched');

    // Verify it is persisted in whatsAppMessage
    const latestMsg = await (prisma as any).whatsAppMessage.findFirst({
      where: {
        tenantId: testTenantId,
        phone: testPhone,
        direction: 'OUTBOUND',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(latestMsg).toBeDefined();
    expect(latestMsg?.content).toContain(interventionText);
    expect(latestMsg?.senderName).toBe('Platform Super Admin');
    expect(latestMsg?.metadata?.intervention).toBe(true);
    expect(latestMsg?.metadata?.dispatchedBy).toBe('SUPER_PLATFORM_ADMIN');
  });
});
