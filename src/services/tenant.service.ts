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
}

export class TenantService {
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

  static async getTenantById(id: string) {
    return (prisma as any).tenant.findUnique({
      where: { id },
      include: {
        branches: {
          select: { id: true, name: true, code: true, type: true, isActive: true },
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

  static async getAllTenants(params?: { search?: string; status?: string }) {
    const { search, status } = params || {};
    return (prisma as any).tenant.findMany({
      where: {
        ...(status ? { status } : {}),
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
