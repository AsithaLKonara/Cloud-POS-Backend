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
      findMany: jest.fn(),
    },
    user: {
      count: jest.fn(),
    },
    order: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
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
      expect(['ONLINE', 'OFFLINE']).toContain(telemetry.redis.status);
      expect(telemetry.schedulers.length).toBeGreaterThan(0);
    });
  });

  describe('Real Historical Analytics & MoM Growth Metrics', () => {
    it('returns 12 continuous months of series data and calculated MoM growth rates', async () => {
      const now = new Date();
      mockPrisma.tenant.findMany.mockResolvedValue([
        { id: 't1', createdAt: new Date(now.getFullYear(), now.getMonth() - 2, 1), status: 'ACTIVE', subscriptionTier: 'STARTER' },
        { id: 't2', createdAt: new Date(now.getFullYear(), now.getMonth(), 1), status: 'ACTIVE', subscriptionTier: 'ENTERPRISE' },
      ]);

      mockPrisma.order.findMany.mockResolvedValue([
        { id: 'o1', total: 150000, createdAt: new Date() },
        { id: 'o2', total: 50000, createdAt: new Date(now.getFullYear(), now.getMonth() - 1, 15) },
      ]);

      const analytics = await SuperAdminService.getMonthlyAnalytics();

      expect(analytics.series).toHaveLength(12);
      expect(analytics.series[11]?.month).toBeDefined();
      expect(typeof analytics.series[11]?.revenueLkr).toBe('number');
      expect(analytics.momGrowth).toBeDefined();
      expect(typeof analytics.momGrowth.mrrGrowthPct).toBe('number');
      expect(typeof analytics.momGrowth.gmvGrowthPct).toBe('number');
      expect(typeof analytics.momGrowth.ordersGrowthPct).toBe('number');
    });
  });

  describe('Real Platform Revenue Streams Breakdown', () => {
    it('accurately computes subscriptions, 0.5% gateway margin, and branch addon streams', async () => {
      mockPrisma.tenant.findMany.mockImplementation((args: any) => {
        if (args?.where?.status === 'ACTIVE' && args?.include?._count) {
          return Promise.resolve([
            { id: 't1', status: 'ACTIVE', subscriptionTier: 'STARTER', _count: { branches: 3 } }, // 2 extra branches
            { id: 't2', status: 'ACTIVE', subscriptionTier: 'PRO', _count: { branches: 1 } },
          ]);
        }
        return Promise.resolve([
          { id: 't1', status: 'ACTIVE', subscriptionTier: 'STARTER' },
          { id: 't2', status: 'ACTIVE', subscriptionTier: 'PRO' },
        ]);
      });

      mockPrisma.branch.count.mockResolvedValue(4);
      mockPrisma.user.count.mockResolvedValue(8);
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: { total: 1000000 }, // GMV Rs. 1,000,000 -> 0.5% gateway = Rs. 5,000
        _count: { id: 25 },
      });
      mockPrisma.setting.findUnique.mockResolvedValue({
        value: JSON.stringify([{ type: 'PROFESSIONAL_SERVICES', amountLkr: 15000 }]),
      });

      const res = await SuperAdminService.getRevenueBreakdown();

      expect(res.totalInflowLkr).toBeGreaterThan(0);
      expect(res.streams).toHaveLength(4);
      
      const subStream = res.streams.find((s) => s.id === 'subscriptions');
      const gatewayStream = res.streams.find((s) => s.id === 'gateway');
      const branchStream = res.streams.find((s) => s.id === 'branches');
      const servicesStream = res.streams.find((s) => s.id === 'services');

      expect(subStream?.amountLkr).toBe(14000); // 4500 + 9500
      expect(gatewayStream?.amountLkr).toBe(5000); // 0.5% of 1,000,000
      expect(branchStream?.amountLkr).toBe(4000); // 2 extra * 2000
      expect(servicesStream?.amountLkr).toBe(15000);
      expect(res.totalInflowLkr).toBe(38000);
    });
  });

  describe('Real Top Performing Outlets', () => {
    it('ranks merchant branches by order count and GMV and calculates velocity', async () => {
      mockPrisma.branch.findMany.mockResolvedValue([
        {
          id: 'b1',
          name: 'Colombo 03 Hub',
          type: 'RETAIL',
          tenant: { name: 'Velvet Threads', businessType: 'RETAIL' },
          orders: [{ total: 250000 }, { total: 150000 }],
        },
        {
          id: 'b2',
          name: 'Kandy Flagship',
          type: 'RESTAURANT',
          tenant: { name: 'Artisan Bistro', businessType: 'RESTAURANT' },
          orders: [{ total: 50000 }],
        },
        {
          id: 'b3',
          name: 'Galle Fort Salon',
          type: 'SALON',
          tenant: { name: 'Luxe Spa', businessType: 'SALON' },
          orders: [],
        },
      ]);

      const topOutlets = await SuperAdminService.getTopOutlets(3);

      expect(topOutlets).toHaveLength(3);
      expect(topOutlets[0]?.branchName).toBe('Velvet Threads - Colombo 03 Hub');
      expect(topOutlets[0]?.totalOrders).toBe(2);
      expect(topOutlets[0]?.gmvLkr).toBe(400000);
      expect(topOutlets[0]?.velocityPct).toBe(100);

      expect(topOutlets[1]?.branchName).toBe('Artisan Bistro - Kandy Flagship');
      expect(topOutlets[1]?.totalOrders).toBe(1);
      expect(topOutlets[1]?.velocityPct).toBe(50);
    });
  });

  describe('Real Subscription Plan Price Mutation Engine', () => {
    it('persists mutated monthly price in PostgreSQL and calculates 10% quarterly and 20% annual discount', async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      mockPrisma.setting.upsert.mockResolvedValue({});

      const updated = await SuperAdminService.updatePlanPrice('STARTER', 6000);

      expect(updated.monthlyLkr).toBe(6000);
      expect(updated.quarterlyLkr).toBe(16200); // 6000 * 3 * 0.9
      expect(updated.annualLkr).toBe(57600); // 6000 * 12 * 0.8

      expect(mockPrisma.setting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'XONIT_SUBSCRIPTION_PLANS' },
        })
      );
    });
  });

  describe('Real Platform Automated Invoice Generator & Lifecycle', () => {
    it('generates sequential invoice INV-2026-XXXX and updates invoice status', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 't-test-1',
        name: 'Colombo Central Flagship',
        subscriptionTier: 'ENTERPRISE',
      });
      mockPrisma.setting.findUnique.mockResolvedValue({
        value: JSON.stringify([]),
      });
      mockPrisma.setting.upsert.mockResolvedValue({});

      const invoice = await SuperAdminService.generateInvoice('t-test-1', 'MONTHLY');

      expect(invoice.invoiceNumber).toBe('INV-2026-0001');
      expect(invoice.tenantName).toBe('Colombo Central Flagship');
      expect(invoice.amountLkr).toBe(18500); // Enterprise default
      expect(invoice.status).toBe('PAID');

      // Test status update
      mockPrisma.setting.findUnique.mockResolvedValue({
        value: JSON.stringify([invoice]),
      });
      const updated = await SuperAdminService.updateInvoiceStatus(invoice.id, 'VOID');
      expect(updated.status).toBe('VOID');
    });
  });
});
