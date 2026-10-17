jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    tenant: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
    },
    category: {
      create: jest.fn().mockResolvedValue({ id: 'cat-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

import prisma from '../config/prisma';
import { TenantService } from '../services/tenant.service';
import { tenantMiddleware } from '../middlewares/tenant.middleware';
import { requestContext } from '../context/RequestContext';

const mockPrisma = prisma as any;

describe('Multi-Tenancy Foundation (Task 1)', () => {
  const tenants: Record<string, any> = {
    'tenant-1': { id: 'tenant-1', name: 'Store Alpha', slug: 'store-alpha', status: 'ACTIVE' },
    'tenant-2': { id: 'tenant-2', name: 'Store Beta', slug: 'store-beta', status: 'ACTIVE' },
    'tenant-suspended': { id: 'tenant-suspended', name: 'Store Suspended', slug: 'store-suspended', status: 'SUSPENDED' },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.tenant.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id) return tenants[where.id] || null;
      if (where.slug) return Object.values(tenants).find(t => t.slug === where.slug) || null;
      return null;
    });

    mockPrisma.tenant.create.mockImplementation(async ({ data }: any) => {
      return { id: `tenant-${Date.now()}`, ...data };
    });

    mockPrisma.tenant.updateMany.mockResolvedValue({ count: 5 });
  });

  describe('TenantService', () => {
    it('creates a tenant with required fields', async () => {
      const result = await TenantService.createTenant({
        name: 'Gourmet Cafe & Bistro',
        slug: 'gourmet-cafe',
        businessType: 'RESTAURANT_CAFE',
        currency: 'USD',
        currencySymbol: '$',
      });

      expect(result).toBeDefined();
      expect(result.slug).toBe('gourmet-cafe');
      expect(result.currency).toBe('USD');
    });

    it('rejects duplicate tenant slugs', async () => {
      await expect(
        TenantService.createTenant({
          name: 'Store Alpha Duplicate',
          slug: 'store-alpha', // Already exists in mock
        })
      ).rejects.toThrow('A tenant with slug "store-alpha" already exists.');
    });
  });

  describe('tenantMiddleware & RequestContext Resolution', () => {
    let mockReq: any;
    let mockRes: any;
    let nextFn: jest.Mock;

    beforeEach(() => {
      mockReq = {
        headers: {},
      };
      mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      nextFn = jest.fn();
    });

    it('resolves tenant from x-tenant-id header', async () => {
      mockReq.headers['x-tenant-id'] = 'tenant-1';

      await tenantMiddleware(mockReq, mockRes, nextFn);

      expect(mockReq.tenantId).toBe('tenant-1');
      expect(mockReq.tenantSlug).toBe('store-alpha');
      expect(nextFn).toHaveBeenCalled();
    });

    it('resolves tenant from x-tenant-slug header', async () => {
      mockReq.headers['x-tenant-slug'] = 'store-beta';

      await tenantMiddleware(mockReq, mockRes, nextFn);

      expect(mockReq.tenantId).toBe('tenant-2');
      expect(mockReq.tenantSlug).toBe('store-beta');
      expect(nextFn).toHaveBeenCalled();
    });

    it('returns 404 if tenant ID does not exist', async () => {
      mockReq.headers['x-tenant-id'] = 'non-existent-tenant';

      await tenantMiddleware(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(nextFn).not.toHaveBeenCalled();
    });

    it('returns 403 if tenant is suspended and user is not platform admin', async () => {
      mockReq.headers['x-tenant-id'] = 'tenant-suspended';

      await tenantMiddleware(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('suspended') }));
      expect(nextFn).not.toHaveBeenCalled();
    });

    it('blocks cross-tenant access when non-admin user attempts to query a different tenant', async () => {
      // User belongs to tenant-1, but tries to access tenant-2 via header
      mockReq.user = {
        userId: 'usr-1',
        tenantId: 'tenant-1',
        roles: ['CASHIER'],
      };
      mockReq.headers['x-tenant-id'] = 'tenant-2';

      await tenantMiddleware(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Access denied') })
      );
      expect(nextFn).not.toHaveBeenCalled();
    });

    it('allows SUPER_PLATFORM_ADMIN to access any tenant', async () => {
      mockReq.user = {
        userId: 'super-admin-id',
        tenantId: null,
        roles: ['SUPER_PLATFORM_ADMIN'],
      };
      mockReq.headers['x-tenant-id'] = 'tenant-1';

      await tenantMiddleware(mockReq, mockRes, nextFn);

      expect(mockReq.tenantId).toBe('tenant-1');
      expect(nextFn).toHaveBeenCalled();
    });
  });

  describe('RequestContext Propagation', () => {
    it('carries tenantId across asynchronous execution chains', (done) => {
      requestContext.run(
        {
          tenantId: 'tenant-xyz',
          tenantSlug: 'store-xyz',
          role: 'ADMIN',
          isAdmin: true,
        },
        () => {
          setTimeout(() => {
            const store = requestContext.getStore();
            expect(store).toBeDefined();
            expect(store?.tenantId).toBe('tenant-xyz');
            expect(store?.tenantSlug).toBe('store-xyz');
            done();
          }, 10);
        }
      );
    });
  });
});
