jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    tenant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import prisma from '../config/prisma';
import { TenantIntegrationService } from '../services/tenant-integration.service';

const mockPrisma = prisma as any;

describe('Tenant Gateway & Courier API Configuration Hub (Task 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Integration Querying & Masking', () => {
    it('returns default integration configuration if tenant has no configured settings', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        name: 'Colombo Retail Store',
        settings: {},
      });

      const res = await TenantIntegrationService.getTenantIntegrations('tenant-1', true);

      expect(res.paymentGateways.payhere.enabled).toBe(false);
      expect(res.paymentGateways.koko.enabled).toBe(false);
      expect(res.paymentGateways.lankaQr.merchantCategoryCode).toBe('5411');
      expect(res.couriers.koombiyo.enabled).toBe(false);
      expect(res.couriers.promptx.enabled).toBe(false);
      expect(res.couriers.domex.enabled).toBe(false);
    });

    it('masks sensitive API keys and secrets when maskSecrets is true', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-2',
        name: 'Galle Luxury Boutique',
        settings: {
          integrations: {
            paymentGateways: {
              payhere: {
                enabled: true,
                merchantId: '1211222',
                merchantSecret: 'supersecretpayherekey9999',
                isSandbox: false,
              },
              koko: {
                enabled: true,
                merchantId: 'koko_merch_01',
                apiKey: 'koko_api_key_12345678',
                apiSecret: 'koko_secret_87654321',
                isSandbox: true,
              },
            },
            couriers: {
              koombiyo: {
                enabled: true,
                apiKey: 'koombiyo_secret_key_abcdef',
                pickupCode: 'PK-COL-01',
              },
            },
          },
        },
      });

      const masked = await TenantIntegrationService.getTenantIntegrations('tenant-2', true);

      expect(masked.paymentGateways.payhere.merchantSecret).toMatch(/^••••••••9999$/);
      expect(masked.paymentGateways.koko.apiKey).toMatch(/^••••••••5678$/);
      expect(masked.paymentGateways.koko.apiSecret).toMatch(/^••••••••4321$/);
      expect(masked.couriers.koombiyo.apiKey).toMatch(/^••••••••cdef$/);

      // Unmasked mode returns full secrets
      const unmasked = await TenantIntegrationService.getTenantIntegrations('tenant-2', false);
      expect(unmasked.paymentGateways.payhere.merchantSecret).toBe('supersecretpayherekey9999');
      expect(unmasked.couriers.koombiyo.apiKey).toBe('koombiyo_secret_key_abcdef');
    });
  });

  describe('Payment Gateway Configuration', () => {
    it('updates PayHere configuration and preserves existing secret when masked placeholder is submitted', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-3',
        name: 'Kandy Flagship',
        settings: {
          integrations: {
            paymentGateways: {
              payhere: {
                enabled: true,
                merchantId: '1211000',
                merchantSecret: 'original_super_secret_key_1234',
                isSandbox: false,
              },
            },
          },
        },
      });
      mockPrisma.tenant.update.mockResolvedValue({});

      const updated = await TenantIntegrationService.updatePaymentGateway('tenant-3', 'payhere', {
        enabled: true,
        merchantId: '1211999',
        merchantSecret: '••••••••1234', // Unchanged masked secret submitted from frontend
        isSandbox: true,
      });

      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tenant-3' },
          data: expect.objectContaining({
            settings: expect.objectContaining({
              integrations: expect.objectContaining({
                paymentGateways: expect.objectContaining({
                  payhere: expect.objectContaining({
                    merchantId: '1211999',
                    merchantSecret: 'original_super_secret_key_1234', // Retained!
                    isSandbox: true,
                  }),
                }),
              }),
            }),
          }),
        })
      );
    });

    it('updates LankaQR static/dynamic payload parameters', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-4',
        name: 'Matara Supercenter',
        settings: {},
      });
      mockPrisma.tenant.update.mockResolvedValue({});

      await TenantIntegrationService.updatePaymentGateway('tenant-4', 'lankaQr', {
        enabled: true,
        merchantCategoryCode: '5411',
        bankCode: '7010', // Bank of Ceylon
        accountNumber: '000123456789',
        terminalId: 'TRM-01',
        merchantName: 'Matara Supercenter XONIT',
      });

      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            settings: expect.objectContaining({
              integrations: expect.objectContaining({
                paymentGateways: expect.objectContaining({
                  lankaQr: expect.objectContaining({
                    enabled: true,
                    bankCode: '7010',
                    accountNumber: '000123456789',
                  }),
                }),
              }),
            }),
          }),
        })
      );
    });
  });

  describe('Courier API Dispatch Configuration', () => {
    it('updates Koombiyo logistics credentials', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-5',
        name: 'Negombo Express',
        settings: {},
      });
      mockPrisma.tenant.update.mockResolvedValue({});

      await TenantIntegrationService.updateCourier('tenant-5', 'koombiyo', {
        enabled: true,
        apiKey: 'koombiyo-prod-token-xyz',
        pickupCode: 'PK-NEG-99',
      });

      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            settings: expect.objectContaining({
              integrations: expect.objectContaining({
                couriers: expect.objectContaining({
                  koombiyo: expect.objectContaining({
                    enabled: true,
                    apiKey: 'koombiyo-prod-token-xyz',
                    pickupCode: 'PK-NEG-99',
                  }),
                }),
              }),
            }),
          }),
        })
      );
    });
  });

  describe('Simulated Connection Handshakes', () => {
    it('returns successful handshake for enabled payment gateway', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-6',
        name: 'Jaffna Tech Hub',
        settings: {
          integrations: {
            paymentGateways: {
              payhere: { enabled: true, merchantId: '1211', isSandbox: true },
            },
          },
        },
      });

      const res = await TenantIntegrationService.testConnection('tenant-6', 'payment', 'payhere');

      expect(res.success).toBe(true);
      expect(res.status).toBe('CONNECTED');
      expect(res.mode).toBe('SANDBOX');
      expect(res.latencyMs).toBeGreaterThan(0);
    });

    it('throws error when testing a disabled integration', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-7',
        name: 'Kurunegala Depot',
        settings: {
          integrations: {
            couriers: {
              promptx: { enabled: false },
            },
          },
        },
      });

      await expect(
        TenantIntegrationService.testConnection('tenant-7', 'courier', 'promptx')
      ).rejects.toThrow('promptx is currently disabled.');
    });
  });
});
