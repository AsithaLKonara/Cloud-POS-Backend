import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { logger } from '../utils/logger';
import { PresetService } from './preset.service';

export interface CreateTenantDTO {
  name: string;
  slug: string;
  businessType?: 'RETAIL' | 'RESTAURANT_CAFE' | 'SALON_SPA' | 'PHARMACY_CLINIC' | 'GROCERY_SUPERMARKET' | 'AUTOMOTIVE_SERVICES' | 'WHOLESALE_DISTRIBUTION' | 'GENERAL_SERVICES';
  currency?: string;
  currencySymbol?: string;
  timezone?: string;
  taxRate?: number;
  logoUrl?: string;
  settings?: Record<string, any>;
  subscriptionTier?: string;
  maxBranches?: number;
  maxUsers?: number;
}

export interface ProvisionAdminUserDTO {
  email: string;
  password: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface ProvisionTenantDTO {
  name: string;
  slug?: string;
  businessType?: 'RETAIL' | 'RESTAURANT_CAFE' | 'SALON_SPA' | 'PHARMACY_CLINIC' | 'GROCERY_SUPERMARKET' | 'AUTOMOTIVE_SERVICES' | 'WHOLESALE_DISTRIBUTION' | 'GENERAL_SERVICES';
  subscriptionTier?: 'FREE_TRIAL' | 'STARTER' | 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
  maxBranches?: number;
  maxUsers?: number;
  currency?: string;
  currencySymbol?: string;
  timezone?: string;
  taxRate?: number;
  logoUrl?: string;
  initialBranchName?: string;
  initialBranchCode?: string;
  settings?: Record<string, any>;
  adminUser: ProvisionAdminUserDTO;
}

export class TenantService {
  /**
   * Generates a clean URL slug from a business name.
   */
  static slugify(text: string): string {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[\s\W-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Retrieves or creates the primary default tenant for backfilling legacy records.
   */
  static async getOrCreateDefaultTenant() {
    let tenant = await (prisma as any).tenant.findUnique({
      where: { slug: 'default-organization' },
    });

    if (!tenant) {
      tenant = await (prisma as any).tenant.create({
        data: {
          name: 'Default Business Store',
          slug: 'default-organization',
          businessType: 'RETAIL',
          status: 'ACTIVE',
          currency: 'LKR',
          currencySymbol: 'Rs.',
          timezone: 'Asia/Colombo',
          taxRate: 0.0,
          subscriptionTier: 'ENTERPRISE',
          maxBranches: 100,
          maxUsers: 500,
        },
      });
      logger.info(`Created default primary tenant [${tenant.id}] (default-organization)`);
    }

    return tenant;
  }

  /**
   * Backfills existing legacy data without tenantId to the default tenant.
   */
  static async backfillLegacyDataToDefaultTenant(): Promise<{ backfilledTables: string[] }> {
    const defaultTenant = await this.getOrCreateDefaultTenant();
    const tenantId = defaultTenant.id;
    const backfilled: string[] = [];

    const tables = [
      'branch',
      'category',
      'product',
      'posTerminal',
      'posSession',
      'order',
      'customer',
      'branchExpense',
      'auditLog',
      'coupon',
      'user',
      'diningTable',
      'supplier',
      'purchaseOrder',
      'stockTransfer',
    ];

    for (const modelName of tables) {
      try {
        const delegate = (prisma as any)[modelName];
        if (delegate && typeof delegate.updateMany === 'function') {
          const res = await delegate.updateMany({
            where: { tenantId: null },
            data: { tenantId },
          });
          if (res.count > 0) {
            backfilled.push(`${modelName}: ${res.count} rows`);
            logger.info(`Backfilled ${res.count} unassigned ${modelName} records to tenant ${tenantId}`);
          }
        }
      } catch (err: any) {
        logger.warn(`Could not backfill model ${modelName}: ${err.message}`);
      }
    }

    return { backfilledTables: backfilled };
  }

  /**
   * Legacy simple tenant creator for existing tests & backward compatibility
   */
  static async createTenant(data: CreateTenantDTO) {
    const existing = await (prisma as any).tenant.findUnique({
      where: { slug: data.slug },
    });

    if (existing) {
      throw new Error(`A tenant with slug "${data.slug}" already exists.`);
    }

    const tenant = await (prisma as any).tenant.create({
      data: {
        name: data.name,
        slug: data.slug.toLowerCase().trim(),
        businessType: data.businessType || 'RETAIL',
        currency: data.currency || 'LKR',
        currencySymbol: data.currencySymbol || 'Rs.',
        timezone: data.timezone || 'Asia/Colombo',
        taxRate: data.taxRate || 0.0,
        logoUrl: data.logoUrl || null,
        settings: data.settings || {},
        subscriptionTier: data.subscriptionTier || 'STANDARD',
        maxBranches: data.maxBranches || 3,
        maxUsers: data.maxUsers || 10,
      },
    });

    // Auto-seed industry categories & attributes preset
    try {
      await PresetService.seedPresetsForTenant(tenant.id, tenant.businessType);
    } catch (err: any) {
      logger.warn(`Failed to seed presets for tenant ${tenant.id}: ${err.message}`);
    }

    return tenant;
  }

  /**
   * Provisions a turnkey business tenant with initial branch, admin user, and industry presets.
   */
  static async provisionTenant(input: ProvisionTenantDTO) {
    if (!input.name) throw new Error('Business name is required.');
    if (!input.adminUser?.email || !input.adminUser?.password) {
      throw new Error('Admin email and password are required for tenant provisioning.');
    }

    // Determine unique slug
    let baseSlug = input.slug ? this.slugify(input.slug) : this.slugify(input.name);
    let finalSlug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await (prisma as any).tenant.findUnique({
        where: { slug: finalSlug },
      });
      if (!existing) break;
      finalSlug = `${baseSlug}-${counter++}`;
    }

    // Default tier configurations
    const tier = input.subscriptionTier || 'STANDARD';
    let defaultBranches = 3;
    let defaultUsers = 10;
    let status: 'ACTIVE' | 'TRIAL' = 'ACTIVE';

    if (tier === 'FREE_TRIAL') {
      defaultBranches = 1;
      defaultUsers = 2;
      status = 'TRIAL';
    } else if (tier === 'STARTER') {
      defaultBranches = 1;
      defaultUsers = 5;
    } else if (tier === 'PROFESSIONAL') {
      defaultBranches = 10;
      defaultUsers = 25;
    } else if (tier === 'ENTERPRISE') {
      defaultBranches = 100;
      defaultUsers = 500;
    }

    const businessType = input.businessType || 'RETAIL';

    // 1. Create Tenant
    const tenant = await (prisma as any).tenant.create({
      data: {
        name: input.name,
        slug: finalSlug,
        businessType,
        status,
        subscriptionTier: tier,
        maxBranches: input.maxBranches || defaultBranches,
        maxUsers: input.maxUsers || defaultUsers,
        currency: input.currency || 'LKR',
        currencySymbol: input.currencySymbol || 'Rs.',
        timezone: input.timezone || 'Asia/Colombo',
        taxRate: input.taxRate !== undefined ? input.taxRate : 0.0,
        logoUrl: input.logoUrl || null,
        settings: input.settings || {},
      },
    });

    // 2. Create Initial Branch
    const branchName = input.initialBranchName || `${input.name} - Main Branch`;
    const branchCode = input.initialBranchCode || 'MAIN-01';

    const branch = await (prisma as any).branch.create({
      data: {
        name: branchName,
        code: branchCode,
        tenantId: tenant.id,
        type: 'HEAD_OFFICE',
        isActive: true,
      },
    });

    // 3. Ensure 'ADMIN' role exists
    let adminRole = await (prisma as any).role.findUnique({
      where: { name: 'ADMIN' },
    });
    if (!adminRole) {
      adminRole = await (prisma as any).role.create({
        data: {
          name: 'ADMIN',
          description: 'Tenant Administrator',
          isSystem: true,
          status: 'Active',
        },
      });
    }

    // 4. Create Admin User
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(input.adminUser.password, salt);
    const adminFullName = input.adminUser.name ||
      `${input.adminUser.firstName || ''} ${input.adminUser.lastName || ''}`.trim() ||
      'Tenant Admin';

    const adminUser = await (prisma as any).user.create({
      data: {
        email: input.adminUser.email.toLowerCase().trim(),
        password: hashedPassword,
        name: adminFullName,
        phone: input.adminUser.phone || null,
        tenantId: tenant.id,
        branchId: branch.id,
        status: 'ACTIVE',
        userRoles: {
          create: {
            roleId: adminRole.id,
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        status: true,
        tenantId: true,
        branchId: true,
      },
    });

    // 5. Auto-seed Industry Catalog Presets
    let seededCategoriesCount = 0;
    try {
      const presetResult = await PresetService.seedPresetsForTenant(tenant.id, businessType);
      seededCategoriesCount = presetResult.createdCategories;
    } catch (err: any) {
      logger.warn(`Preset seeding failed during onboarding for tenant ${tenant.id}: ${err.message}`);
    }

    logger.info(`Turnkey tenant provisioned: [${tenant.name}] (${tenant.slug}) with Branch [${branch.name}] & Admin [${adminUser.email}]`);

    return {
      tenant,
      branch,
      adminUser,
      seededCategoriesCount,
    };
  }

  /**
   * Updates tenant operating status (ACTIVE, SUSPENDED, TRIAL, CANCELLED).
   */
  static async updateTenantStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'CANCELLED', reason?: string) {
    const existing = await (prisma as any).tenant.findUnique({ where: { id } });
    if (!existing) throw new Error(`Tenant with ID ${id} not found.`);

    const currentSettings = (existing.settings as Record<string, any>) || {};
    const updatedSettings = {
      ...currentSettings,
      statusHistory: [
        ...(currentSettings.statusHistory || []),
        {
          previousStatus: existing.status,
          newStatus: status,
          reason: reason || 'Status updated via Super Admin',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    return (prisma as any).tenant.update({
      where: { id },
      data: {
        status,
        settings: updatedSettings,
      },
    });
  }

  /**
   * Updates subscription plan and quotas.
   */
  static async updateTenantPlan(id: string, data: { subscriptionTier?: string; maxBranches?: number; maxUsers?: number; settings?: any }) {
    const existing = await (prisma as any).tenant.findUnique({ where: { id } });
    if (!existing) throw new Error(`Tenant with ID ${id} not found.`);

    return (prisma as any).tenant.update({
      where: { id },
      data: {
        ...(data.subscriptionTier ? { subscriptionTier: data.subscriptionTier } : {}),
        ...(data.maxBranches !== undefined ? { maxBranches: data.maxBranches } : {}),
        ...(data.maxUsers !== undefined ? { maxUsers: data.maxUsers } : {}),
        ...(data.settings ? { settings: { ...((existing.settings as any) || {}), ...data.settings } } : {}),
      },
    });
  }

  /**
   * Retrieves tenant resource usage against quota limits.
   */
  static async getTenantUsage(tenantId: string) {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: {
            branches: true,
            users: true,
            products: true,
            orders: true,
          },
        },
      },
    });

    if (!tenant) throw new Error(`Tenant with ID ${tenantId} not found.`);

    const branchesCount = tenant._count.branches;
    const usersCount = tenant._count.users;

    return {
      tenantId: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      businessType: tenant.businessType,
      subscriptionTier: tenant.subscriptionTier,
      status: tenant.status,
      branches: {
        current: branchesCount,
        max: tenant.maxBranches,
        canAddMore: branchesCount < tenant.maxBranches,
        usagePercent: tenant.maxBranches > 0 ? Number(((branchesCount / tenant.maxBranches) * 100).toFixed(1)) : 0,
      },
      users: {
        current: usersCount,
        max: tenant.maxUsers,
        canAddMore: usersCount < tenant.maxUsers,
        usagePercent: tenant.maxUsers > 0 ? Number(((usersCount / tenant.maxUsers) * 100).toFixed(1)) : 0,
      },
      totalProducts: tenant._count.products,
      totalOrders: tenant._count.orders,
    };
  }

  /**
   * Retrieves high-level SaaS platform health overview & aggregated KPIs across all tenants.
   */
  static async getPlatformOverview() {
    const [
      totalTenants,
      statusGroups,
      typeGroups,
      tierGroups,
      totalBranches,
      totalUsers,
      ordersAgg,
    ] = await Promise.all([
      (prisma as any).tenant.count(),
      (prisma as any).tenant.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      (prisma as any).tenant.groupBy({
        by: ['businessType'],
        _count: { id: true },
      }),
      (prisma as any).tenant.groupBy({
        by: ['subscriptionTier'],
        _count: { id: true },
      }),
      (prisma as any).branch.count(),
      (prisma as any).user.count(),
      (prisma as any).order.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const g of statusGroups) {
      byStatus[g.status] = g._count.id;
    }

    const byBusinessType: Record<string, number> = {};
    for (const g of typeGroups) {
      byBusinessType[g.businessType] = g._count.id;
    }

    const bySubscriptionTier: Record<string, number> = {};
    for (const g of tierGroups) {
      bySubscriptionTier[g.subscriptionTier] = g._count.id;
    }

    return {
      tenants: {
        total: totalTenants,
        active: byStatus['ACTIVE'] || 0,
        suspended: byStatus['SUSPENDED'] || 0,
        trial: byStatus['TRIAL'] || 0,
        cancelled: byStatus['CANCELLED'] || 0,
        byStatus,
        byBusinessType,
        bySubscriptionTier,
      },
      infrastructure: {
        totalBranches,
        totalUsers,
      },
      commerce: {
        totalPaidOrders: ordersAgg._count.id || 0,
        totalPlatformVolume: Number((ordersAgg._sum.total || 0).toFixed(2)),
      },
    };
  }

  static async getTenantById(id: string) {
    return (prisma as any).tenant.findUnique({
      where: { id },
      include: {
        branches: {
          select: { id: true, name: true, code: true, type: true, isActive: true },
        },
        _count: {
          select: {
            branches: true,
            products: true,
            orders: true,
            users: true,
          },
        },
      },
    });
  }

  static async getTenantBySlug(slug: string) {
    return (prisma as any).tenant.findUnique({
      where: { slug },
      include: {
        branches: {
          select: { id: true, name: true, code: true, type: true, isActive: true },
        },
      },
    });
  }

  static async getAllTenants(params?: { search?: string; status?: string; businessType?: string; subscriptionTier?: string }) {
    const { search, status, businessType, subscriptionTier } = params || {};
    return (prisma as any).tenant.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(businessType ? { businessType } : {}),
        ...(subscriptionTier ? { subscriptionTier } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { slug: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            branches: true,
            products: true,
            orders: true,
            users: true,
          },
        },
      },
    });
  }
}
