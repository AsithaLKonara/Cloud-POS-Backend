import prisma from '../config/prisma';
import { WhatsAppCampaignEngineService } from '../services/whatsapp-campaign-engine.service';
import { SuperAdminWhatsAppService } from '../services/superadmin-whatsapp.service';

jest.setTimeout(45000);

describe('Task 3: Autonomous Proactive Outbound Campaigns & AR Dunning Engine', () => {
  let testTenantId: string;
  let createdOrderId: string | null = null;
  let testCustomerId: string | null = null;

  beforeAll(async () => {
    let tenant = await (prisma as any).tenant.findFirst({ where: { status: 'ACTIVE' } });
    if (!tenant) {
      tenant = await (prisma as any).tenant.create({
        data: {
          name: 'Campaign Test Store',
          slug: 'campaign-test-store',
          businessType: 'RETAIL',
          status: 'ACTIVE',
        },
      });
    }
    testTenantId = tenant.id;

    // Create a test customer with credit balance & phone for AR Dunning & Cart Abandonment
    const customer = await (prisma as any).customer.create({
      data: {
        tenant: { connect: { id: testTenantId } },
        firstName: 'Dunning',
        lastName: 'Customer',
        phone: '0778889999',
        creditBalance: 15400.0,
        customerType: 'WHOLESALE',
      },
    });
    testCustomerId = customer.id;

    // Create a stalled pending order 3 hours ago for Cart Abandonment scan
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const order = await (prisma as any).order.create({
      data: {
        orderNumber: `WA-CART-${Date.now().toString().slice(-4)}`,
        tenantId: testTenantId,
        customerId: testCustomerId,
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        paymentMethod: 'WHATSAPP_LANKAQR',
        subtotal: 4500.0,
        shippingFee: 0,
        discount: 0,
        tax: 0,
        total: 4500.0,
        type: 'WHATSAPP',
        createdAt: threeHoursAgo,
      },
    });
    createdOrderId = order.id;
  }, 45000);

  afterAll(async () => {
    if (createdOrderId) {
      await (prisma as any).order.delete({ where: { id: createdOrderId } }).catch(() => {});
    }
    if (testCustomerId) {
      await (prisma as any).customer.delete({ where: { id: testCustomerId } }).catch(() => {});
    }
  });

  it('1. should return active campaign schedules and platform telemetry', async () => {
    const telemetry = await WhatsAppCampaignEngineService.getCampaignTelemetry();
    expect(telemetry.activeCampaigns).toBeDefined();
    expect(telemetry.activeCampaigns.length).toBe(3);

    const types = telemetry.activeCampaigns.map((c) => c.type);
    expect(types).toContain('CART_ABANDONMENT');
    expect(types).toContain('PREDICTIVE_REORDER');
    expect(types).toContain('AR_DUNNING');

    expect(telemetry.telemetry).toBeDefined();
  });

  it('2. should execute runCartAbandonmentRecovery and identify stalled carts', async () => {
    const result = await WhatsAppCampaignEngineService.runCartAbandonmentRecovery();
    expect(result.campaignType).toBe('CART_ABANDONMENT');
    expect(result.scannedCount).toBeGreaterThanOrEqual(1);
    expect(result.dispatchedCount).toBeGreaterThanOrEqual(1);
    expect(result.targetedValueLkr).toBeGreaterThan(0);
  });

  it('3. should execute runPredictiveReplenishment scan safely', async () => {
    const result = await WhatsAppCampaignEngineService.runPredictiveReplenishment();
    expect(result.campaignType).toBe('PREDICTIVE_REORDER');
    expect(result.scannedCount).toBeGreaterThanOrEqual(0);
  });

  it('4. should execute runSmartArDunning and identify customers with overdue credit balance', async () => {
    const result = await WhatsAppCampaignEngineService.runSmartArDunning();
    expect(result.campaignType).toBe('AR_DUNNING');
    expect(result.scannedCount).toBeGreaterThanOrEqual(1);
    expect(result.dispatchedCount).toBeGreaterThanOrEqual(1);
    expect(result.targetedValueLkr).toBeGreaterThanOrEqual(15400.0);
  });

  it('5. should execute SuperAdmin triggerCampaign endpoint for on-demand execution', async () => {
    const triggerRes = await SuperAdminWhatsAppService.triggerCampaign('CART_ABANDONMENT');
    expect(triggerRes).toBeDefined();
    expect(triggerRes.campaignType).toBe('CART_ABANDONMENT');
    expect(triggerRes.scannedCount).toBeGreaterThanOrEqual(1);
  });
});

