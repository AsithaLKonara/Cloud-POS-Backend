import prisma from '../config/prisma';
import { WhatsAppService } from '../services/whatsapp.service';
import { TenantIntegrationService } from '../services/tenant-integration.service';

describe('Meta WhatsApp Cloud API Integration & Vault Storage', () => {
  let testTenantId: string;

  beforeAll(async () => {
    // Find or create an active test tenant
    const existing = await (prisma as any).tenant.findFirst({
      where: { status: 'ACTIVE' },
    });
    if (existing) {
      testTenantId = existing.id;
    } else {
      const created = await (prisma as any).tenant.create({
        data: {
          name: 'WhatsApp Test Merchant',
          slug: `wa-test-${Date.now()}`,
          status: 'ACTIVE',
        },
      });
      testTenantId = created.id;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Phone Number Normalization', () => {
    it('should format Sri Lankan local 10-digit numbers to E.164 international', () => {
      expect(WhatsAppService.normalizePhoneNumber('0771234567')).toBe('94771234567');
      expect(WhatsAppService.normalizePhoneNumber('011 234 5678')).toBe('94112345678');
    });

    it('should strip plus, spaces, and hyphens from international numbers', () => {
      expect(WhatsAppService.normalizePhoneNumber('+94 77 123-4567')).toBe('94771234567');
      expect(WhatsAppService.normalizePhoneNumber('+1 (555) 234-5678')).toBe('15552345678');
    });
  });

  describe('Vault Credential Encryption & Retrieval', () => {
    it('should save WhatsApp credentials encrypted with AES-256-GCM', async () => {
      const config = {
        enabled: true,
        wabaId: '1048592019482',
        phoneNumberId: '1029482019482',
        accessToken: 'EAAG_test_system_user_token_long_secret_123456',
        verifyToken: 'xonit_wa_verify_secret_secure',
        isSandbox: true,
        triggers: {
          posReceipts: true,
          orderTracking: true,
          abandonedCart: true,
          creditOverdue: true,
          loyaltyAlerts: true,
          catalogSync: true,
        },
      };

      const result = await TenantIntegrationService.updateMessaging(testTenantId, 'whatsapp', config);
      expect(result.messaging?.whatsapp).toBeDefined();
      expect(result.messaging.whatsapp.enabled).toBe(true);
      expect(result.messaging.whatsapp.wabaId).toBe('1048592019482');
      expect(result.messaging.whatsapp.phoneNumberId).toBe('1029482019482');
      // Secret must be masked in the returned payload
      expect(result.messaging.whatsapp.accessToken).toContain('••••');
      expect(result.messaging.whatsapp.triggers.posReceipts).toBe(true);
    });

    it('should test connection successfully in sandbox mode', async () => {
      const testRes = await TenantIntegrationService.testConnection(testTenantId, 'messaging', 'whatsapp');
      expect(testRes.success).toBe(true);
      expect(testRes.status).toBe('CONNECTED');
      expect(testRes.type).toBe('messaging');
      expect(testRes.latencyMs).toBeGreaterThan(0);
    });

    it('should dispatch a test verification ping message via WhatsAppService', async () => {
      const pingRes = await WhatsAppService.sendTestMessage(testTenantId, '0771234567');
      expect(pingRes.success).toBe(true);
      expect(pingRes.status).toBe('SIMULATED');
      expect(pingRes.messageId).toContain('wamid.sandbox_');
      expect(pingRes.recipient).toBe('94771234567');
    });
  });
});
