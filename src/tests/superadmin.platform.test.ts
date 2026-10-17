jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    tenant: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    branch: {
      count: jest.fn(),
    },
    user: {
      count: jest.fn(),
    },
    order: {
      aggregate: jest.fn(),
    },
    setting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $queryRaw: jest.fn(),
  },
}));

jest.mock('../config/redis', () => ({
  __esModule: true,
  default: {
    status: 'ready',
    ping: jest.fn().mockResolvedValue('PONG'),
  },
}));

import prisma from '../config/prisma';
import { SuperAdminService } from '../services/superadmin.service';

const mockPrisma = prisma as any;

describe('XONIT SPACE Super Admin Platform Control Center', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Platform KPIs & MRR/ARR in LKR', () => {
    it('aggregates platform MRR, ARR, GMV, and tenant counts accurately', async () => {
      mockPrisma.tenant.findMany.mockResolvedValue([
        { id: 't1', status: 'ACTIVE', subscriptionTier: 'STARTER' }, // Rs. 4,500
        { id: 't2', status: 'ACTIVE', subscriptionTier: 'GROWTH' }, // Rs. 9,500
        { id: 't3', status: 'ACTIVE', subscriptionTier: 'ENTERPRISE' }, // Rs. 18,500
        { id: 't4', status: 'TRIAL', subscriptionTier: 'STARTER' }, // Rs. 4,500 (in trial)
        { id: 't5', status: 'SUSPENDED', subscriptionTier: 'GROWTH' }, // Suspended (0 MRR)
      ]);

      mockPrisma.branch.count.mockResolvedValue(12);
      mockPrisma.user.count.mockResolvedValue(35);
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: { total: 4850000 },
        _count: { id: 1420 },
      });

      const kpis = await SuperAdminService.getPlatformKPIs();

      expect(kpis.totalTenants).toBe(5);
      expect(kpis.activeTenants).toBe(3);
      expect(kpis.trialTenants).toBe(1);
      expect(kpis.suspendedTenants).toBe(1);
      expect(kpis.totalBranches).toBe(12);
      expect(kpis.totalUsers).toBe(35);
      expect(kpis.platformGmvLkr).toBe(4850000);

      // MRR = 4500 (t1) + 9500 (t2) + 18500 (t3) + 4500 (t4) = 37,000 LKR
      expect(kpis.mrrLkr).toBe(37000);
      expect(kpis.arrLkr).toBe(37000 * 12); // 444,000 LKR
    });
  });

  describe('Platform SaaS Financials (Revenue vs. Cloud Costs)', () => {
    it('calculates SaaS net margin comparing inflows to hosting/infra expenses', async () => {
      mockPrisma.tenant.findMany.mockResolvedValue([
        { id: 't1', status: 'ACTIVE', subscriptionTier: 'ENTERPRISE' }, // 18,500
        { id: 't2', status: 'ACTIVE', subscriptionTier: 'GROWTH' }, // 9,500
      ]);
      mockPrisma.branch.count.mockResolvedValue(4);
      mockPrisma.user.count.mockResolvedValue(10);
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: { total: 10000000 }, // Rs. 10M GMV -> 0.5% margin = Rs. 50,000
        _count: { id: 2500 },
      });

      // Mock platform expenses setting
      mockPrisma.setting.findUnique.mockImplementation(({ where }: any) => {
        if (where.key === 'XONIT_PLATFORM_EXPENSES') {
          return Promise.resolve({
            value: JSON.stringify([
              { id: 'e1', category: 'CLOUD_SERVERS', amountLkr: 20000, vendor: 'AWS', description: 'EC2' },
              { id: 'e2', category: 'DATABASE', amountLkr: 15000, vendor: 'AWS RDS', description: 'Postgres' },
            ]),
          });
        }
        return Promise.resolve(null);
      });

      const financials = await SuperAdminService.getPlatformFinancials();

      // MRR = 28,000
      expect(financials.mrrLkr).toBe(28000);
      expect(financials.gatewayMarginRevenueLkr).toBe(50000); // 10M * 0.005
      expect(financials.totalInflowLkr).toBe(78000); // 28000 + 50000
      expect(financials.totalPlatformExpensesLkr).toBe(35000); // 20000 + 15000
      expect(financials.netSaaSProfitLkr).toBe(43000); // 78000 - 35000
      expect(financials.profitMarginPercent).toBe(55.1); // (43000 / 78000) * 100
    });
  });

  describe('Tenant Governance Controls', () => {
    it('allows Super Admin to suspend an overdue tenant', async () => {
      mockPrisma.tenant.update.mockResolvedValue({
        id: 't-bad',
        name: 'Unpaid Store',
        status: 'SUSPENDED',
      });

      const updated = await SuperAdminService.updateTenantStatus('t-bad', 'SUSPENDED');
      expect(updated.status).toBe('SUSPENDED');
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 't-bad' },
        data: { status: 'SUSPENDED' },
      });
    });

    it('extends 14-day free trial duration', async () => {
      const now = new Date('2026-10-18T00:00:00.000Z');
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 't-trial',
        name: 'New Startup',
        settings: {
          subscription: { trialEndsAt: now.toISOString() },
        },
      });
      mockPrisma.tenant.update.mockResolvedValue({ id: 't-trial', status: 'TRIAL' });

      await SuperAdminService.extendTrial('t-trial', 14);

      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't-trial' },
          data: expect.objectContaining({
            status: 'TRIAL',
            settings: expect.objectContaining({
              subscription: expect.objectContaining({
                trialEndsAt: expect.any(String),
              }),
            }),
          }),
        })
      );
    });
  });

  describe('Cluster Telemetry & Health', () => {
    it('reports database and redis latency status', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);

      const telemetry = await SuperAdminService.getClusterTelemetry();

      expect(telemetry.database.status).toBe('HEALTHY');
      expect(telemetry.redis.status).toBe('ONLINE');
      expect(telemetry.schedulers.length).toBeGreaterThan(0);
    });
  });
});
