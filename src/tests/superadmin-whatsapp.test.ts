import { SuperAdminWhatsAppService } from '../services/superadmin-whatsapp.service';
import prisma from '../config/prisma';

describe('SuperAdmin WhatsApp Platform Gateway & Hub', () => {
  it('should retrieve cluster-wide WhatsApp telemetry and message metrics', async () => {
    const telemetry = await SuperAdminWhatsAppService.getClusterTelemetry();

    expect(telemetry).toBeDefined();
    expect(typeof telemetry.totalMessages).toBe('number');
    expect(typeof telemetry.inboundCount).toBe('number');
    expect(typeof telemetry.outboundCount).toBe('number');
    expect(typeof telemetry.deliverySuccessRate).toBe('number');
    expect(typeof telemetry.connectedTenantsCount).toBe('number');
    expect(typeof telemetry.totalTenantsCount).toBe('number');
    expect(Array.isArray(telemetry.recentMessages)).toBe(true);
  });

  it('should list all active tenant integrations with their WhatsApp credentials and volume', async () => {
    const tenants = await SuperAdminWhatsAppService.getTenantIntegrations();

    expect(Array.isArray(tenants)).toBe(true);
    expect(tenants.length).toBeGreaterThan(0);

    const testTenant = tenants.find((t) => t.tenantSlug.includes('test') || t.totalMessages >= 0);
    expect(testTenant).toBeDefined();
    expect(testTenant?.tenantName).toBeDefined();
    expect(testTenant?.subscriptionTier).toBeDefined();
    expect(typeof testTenant?.totalMessages).toBe('number');
  });

  it('should broadcast platform alerts to active tenant admin owners', async () => {
    const broadcastResult = await SuperAdminWhatsAppService.broadcastPlatformNotice({
      title: 'Scheduled System Upgrade',
      message: 'XONIT Cloud will undergo routine performance optimizations tonight at 02:00 AM UTC.',
      targetTier: 'ALL',
    });

    expect(broadcastResult).toBeDefined();
    expect(typeof broadcastResult.dispatchedCount).toBe('number');
    expect(Array.isArray(broadcastResult.recipients)).toBe(true);
  });
});

