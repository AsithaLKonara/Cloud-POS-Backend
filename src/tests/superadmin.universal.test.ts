jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    tenant: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    branch: {
      create: jest.fn(),
      count: jest.fn(),
    },
    role: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    user: {
      create: jest.fn(),
      count: jest.fn(),
    },
    category: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    order: {
      aggregate: jest.fn(),
    },
  },
}));

import prisma from '../config/prisma';
import { TenantService } from '../services/tenant.service';

const mockPrisma = prisma as any;

describe('SaaS Super Admin & Turnkey Tenant Onboarding (Task 7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Turnkey Tenant Provisioning', () => {
    it('provisions a turnkey business tenant with initial branch, admin user, and industry presets', async () => {
      // Slug uniqueness check returns null (available)
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      // Create Tenant mock
      mockPrisma.tenant.create.mockImplementation(async ({ data }: any) => ({
        id: 'tenant-cafe-1',
        ...data,
      }));

      // Create Branch mock
      mockPrisma.branch.create.mockImplementation(async ({ data }: any) => ({
        id: 'branch-cafe-1',
        ...data,
      }));

      // Role check: ADMIN exists
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'role-admin', name: 'ADMIN' });

      // Create User mock
      mockPrisma.user.create.mockImplementation(async ({ data }: any) => ({
        id: 'user-admin-1',
        email: data.email,
        name: data.name,
        phone: data.phone,
        status: data.status,
        tenantId: data.tenantId,
        branchId: data.branchId,
      }));

      // Category mock for preset seeding
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockPrisma.category.create.mockResolvedValue({ id: 'cat-1' });

      const result = await TenantService.provisionTenant({
        name: 'The Artisan Cafe & Bakery',
        businessType: 'RESTAURANT_CAFE',
        subscriptionTier: 'STANDARD',
        currency: 'USD',
        currencySymbol: '$',
        adminUser: {
          email: 'owner@artisancafe.com',
          password: 'SecretPassword123!',
          name: 'Jane Doe',
          phone: '+15551234567',
        },
      });

      // Tenant assertions
      expect(result.tenant.name).toBe('The Artisan Cafe & Bakery');
      expect(result.tenant.slug).toBe('the-artisan-cafe-bakery');
      expect(result.tenant.businessType).toBe('RESTAURANT_CAFE');
      expect(result.tenant.status).toBe('ACTIVE');
      expect(result.tenant.maxBranches).toBe(3);
      expect(result.tenant.maxUsers).toBe(10);
      expect(result.tenant.currency).toBe('USD');

      // Branch assertions
      expect(result.branch.tenantId).toBe('tenant-cafe-1');
      expect(result.branch.name).toBe('The Artisan Cafe & Bakery - Main Branch');
      expect(result.branch.code).toBe('MAIN-01');

      // Admin user assertions
      expect(result.adminUser.email).toBe('owner@artisancafe.com');
      expect(result.adminUser.name).toBe('Jane Doe');
      expect(result.adminUser.tenantId).toBe('tenant-cafe-1');
      expect(result.adminUser.branchId).toBe('branch-cafe-1');

      // Presets seeded
      expect(result.seededCategoriesCount).toBeGreaterThan(0);
    });

    it('enforces FREE_TRIAL tier quotas (1 branch, 2 users, TRIAL status)', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);
      mockPrisma.tenant.create.mockImplementation(async ({ data }: any) => ({
        id: 'tenant-boutique-1',
        ...data,
      }));
      mockPrisma.branch.create.mockImplementation(async ({ data }: any) => ({
        id: 'branch-1',
        ...data,
      }));
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'role-admin', name: 'ADMIN' });
      mockPrisma.user.create.mockImplementation(async ({ data }: any) => ({
        id: 'user-1',
        ...data,
      }));
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockPrisma.category.create.mockResolvedValue({ id: 'cat-1' });

      const result = await TenantService.provisionTenant({
        name: 'Velvet Threads Boutique',
        businessType: 'RETAIL',
        subscriptionTier: 'FREE_TRIAL',
        adminUser: {
          email: 'velvet@example.com',
          password: 'Password123!',
        },
      });

      expect(result.tenant.status).toBe('TRIAL');
      expect(result.tenant.maxBranches).toBe(1);
      expect(result.tenant.maxUsers).toBe(2);
    });

    it('rejects provisioning without business name or admin credentials', async () => {
      await expect(
        TenantService.provisionTenant({
          name: '',
          adminUser: { email: '', password: '' },
        })
      ).rejects.toThrow('Business name is required.');
    });
  });

  describe('Tenant Status & Plan Lifecycle Management', () => {
    it('suspends a tenant and records reason in status history', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        status: 'ACTIVE',
        settings: {},
      });

      mockPrisma.tenant.update.mockImplementation(async ({ data }: any) => ({
        id: 'tenant-1',
        ...data,
      }));

      const updated = await TenantService.updateTenantStatus(
        'tenant-1',
        'SUSPENDED',
        'Non-payment of monthly invoice'
      );

      expect(updated.status).toBe('SUSPENDED');
      expect(updated.settings.statusHistory).toHaveLength(1);
      expect(updated.settings.statusHistory[0].newStatus).toBe('SUSPENDED');
      expect(updated.settings.statusHistory[0].reason).toBe('Non-payment of monthly invoice');
    });

    it('upgrades tenant plan and increases quota limits', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        subscriptionTier: 'STARTER',
        maxBranches: 1,
        maxUsers: 5,
        settings: {},
      });

      mockPrisma.tenant.update.mockImplementation(async ({ data }: any) => ({
        id: 'tenant-1',
        ...data,
      }));

      const updated = await TenantService.updateTenantPlan('tenant-1', {
        subscriptionTier: 'PROFESSIONAL',
        maxBranches: 10,
        maxUsers: 50,
      });

      expect(updated.subscriptionTier).toBe('PROFESSIONAL');
      expect(updated.maxBranches).toBe(10);
      expect(updated.maxUsers).toBe(50);
    });
  });

  describe('Quota Usage & Platform-Wide KPIs', () => {
    it('calculates tenant resource usage against quota limits', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        name: 'Spa Luxe',
        slug: 'spa-luxe',
        businessType: 'SALON_SPA',
        subscriptionTier: 'STANDARD',
        status: 'ACTIVE',
        maxBranches: 3,
        maxUsers: 10,
        _count: {
          branches: 2,
          users: 8,
          products: 45,
          orders: 120,
        },
      });

      const usage = await TenantService.getTenantUsage('tenant-1');

      expect(usage.branches.current).toBe(2);
      expect(usage.branches.max).toBe(3);
      expect(usage.branches.canAddMore).toBe(true);
      expect(usage.branches.usagePercent).toBe(66.7);

      expect(usage.users.current).toBe(8);
      expect(usage.users.max).toBe(10);
      expect(usage.users.canAddMore).toBe(true);
      expect(usage.users.usagePercent).toBe(80.0);
    });

    it('aggregates platform overview KPIs across all tenants', async () => {
      mockPrisma.tenant.count.mockResolvedValue(15);
      mockPrisma.tenant.groupBy
        .mockResolvedValueOnce([
          { status: 'ACTIVE', _count: { id: 12 } },
          { status: 'SUSPENDED', _count: { id: 2 } },
          { status: 'TRIAL', _count: { id: 1 } },
        ])
        .mockResolvedValueOnce([
          { businessType: 'RETAIL', _count: { id: 6 } },
          { businessType: 'RESTAURANT_CAFE', _count: { id: 5 } },
          { businessType: 'SALON_SPA', _count: { id: 4 } },
        ])
        .mockResolvedValueOnce([
          { subscriptionTier: 'STANDARD', _count: { id: 10 } },
          { subscriptionTier: 'ENTERPRISE', _count: { id: 5 } },
        ]);

      mockPrisma.branch.count.mockResolvedValue(42);
      mockPrisma.user.count.mockResolvedValue(180);
      mockPrisma.order.aggregate.mockResolvedValue({
        _count: { id: 12500 },
        _sum: { total: 450000 },
      });

      const overview = await TenantService.getPlatformOverview();

      expect(overview.tenants.total).toBe(15);
      expect(overview.tenants.active).toBe(12);
      expect(overview.tenants.suspended).toBe(2);
      expect(overview.tenants.trial).toBe(1);
      expect(overview.infrastructure.totalBranches).toBe(42);
      expect(overview.infrastructure.totalUsers).toBe(180);
      expect(overview.commerce.totalPaidOrders).toBe(12500);
      expect(overview.commerce.totalPlatformVolume).toBe(450000);
    });
  });
});
