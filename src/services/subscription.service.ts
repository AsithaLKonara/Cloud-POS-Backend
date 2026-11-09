import prisma from '../config/prisma';
import { logger } from '../utils/logger';

export type BillingCycle = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface PlanConfig {
  key: string;
  name: string;
  badge?: string;
  description?: string;
  monthlyLkr: number;
  quarterlyLkr: number; // 10% discount
  annualLkr: number; // 20% discount
  maxBranches: number;
  maxUsers: number;
  trialDays: number;
  features: string[];
  isPopular?: boolean;
  isActive?: boolean;
  color?: string; // 'blue' | 'emerald' | 'purple' | 'amber' | 'rose' | 'cyan'
  subscriberCount?: number;
  totalMrrLkr?: number;
  createdAt?: string;
  updatedAt?: string;
}

export const DEFAULT_PLANS: Record<string, PlanConfig> = {
  STARTER: {
    key: 'STARTER',
    name: 'Starter Business',
    badge: 'Single Outlet',
    description: 'Essential POS and inventory for individual stores and retail counters.',
    monthlyLkr: 4500,
    quarterlyLkr: 12150, // 10% off
    annualLkr: 43200, // 20% off
    maxBranches: 1,
    maxUsers: 2,
    trialDays: 14,
    features: [
      'Modular Universal POS Terminal',
      '80mm/58mm Thermal Receipt Printing',
      'Basic Inventory & Barcodes',
      'Cash & Card Payment Recording',
      '14-Day Full Access Trial',
    ],
    isActive: true,
    color: 'blue',
  },
  GROWTH: {
    key: 'GROWTH',
    name: 'Growth Store',
    badge: 'Most Popular',
    description: 'Multi-outlet operations with table management, branch transfers and accounting.',
    monthlyLkr: 9500,
    quarterlyLkr: 25650, // 10% off
    annualLkr: 91200, // 20% off
    maxBranches: 3,
    maxUsers: 10,
    trialDays: 14,
    features: [
      'Up to 3 Branches & Multi-Branch Allocations',
      'Inter-Branch Stock Transfers & In-Transit Auditing',
      'Restaurant Dining Tables & KOT Routing',
      'Split Bill Engine (N-Way & By Line Item)',
      'Customer Credit Accounts & Debt Settlement Ledger',
      'Full GAAP Canonical P&L Reporting',
      'LankaQR & Local Fintech Gateways',
    ],
    isPopular: true,
    isActive: true,
    color: 'emerald',
  },
  ENTERPRISE: {
    key: 'ENTERPRISE',
    name: 'Enterprise Platform',
    badge: 'Unlimited Scale',
    description: 'High-throughput multi-tenant retail, wholesale, and omnichannel networks.',
    monthlyLkr: 18500,
    quarterlyLkr: 49950, // 10% off
    annualLkr: 177600, // 20% off
    maxBranches: 100,
    maxUsers: 500,
    trialDays: 14,
    features: [
      'Unlimited Branches, Outlets & Terminals',
      'Unlimited Staff Roles & Granular Permissions',
      'FEFO / FIFO Batch Lot Tracking & Expiry Alerts',
      'Moving Weighted Average Cost Purchase Orders',
      'Digital Scale RS-232 Continuous Integration',
      'Headless Developer API & Storefront Webhooks',
      'Custom Courier Webhooks (Koombiyo, PromptX, Domex)',
      '24/7 Priority SLA & Dedicated Hardware Engineer',
    ],
    isActive: true,
    color: 'purple',
  },
};

export class SubscriptionService {
  /**
   * Retrieves all subscription plans with dynamic Super Admin overrides if present,
   * injecting live subscriber counts and calculated MRR per tier.
   */
  static async getPlans(): Promise<PlanConfig[]> {
    let plansMap: Record<string, PlanConfig> = { ...DEFAULT_PLANS };

    try {
      const setting = await prisma.setting.findFirst({
        where: { key: { in: ['saas_subscription_plans', 'XONIT_SUBSCRIPTION_PLANS'] } },
      });

      if (setting && setting.value) {
        const customPlans = JSON.parse(setting.value);
        if (customPlans && typeof customPlans === 'object') {
          plansMap = { ...DEFAULT_PLANS, ...customPlans };
        }
      }
    } catch (err: any) {
      logger.warn(`Could not load custom plan settings: ${err.message}`);
    }

    // Query active tenant distribution to inject subscriber metrics
    try {
      const tenants = await (prisma as any).tenant.findMany({
        where: { status: { in: ['ACTIVE', 'TRIAL'] } },
        select: { subscriptionTier: true, status: true },
      });

      const counts: Record<string, number> = {};
      for (const t of tenants) {
        const tier = (t.subscriptionTier || 'STARTER').toUpperCase();
        counts[tier] = (counts[tier] || 0) + 1;
      }

      return Object.values(plansMap).map((plan) => {
        const subs = counts[plan.key] || 0;
        return {
          ...plan,
          subscriberCount: subs,
          totalMrrLkr: subs * (plan.monthlyLkr || 0),
          isActive: plan.isActive !== false,
        };
      });
    } catch (e) {
      return Object.values(plansMap);
    }
  }

  /**
   * Super Admin: Create a brand new subscription package.
   */
  static async createPlan(data: Partial<PlanConfig>): Promise<PlanConfig> {
    if (!data.name || typeof data.name !== 'string') {
      throw new Error('Package name is required.');
    }

    const monthlyLkr = Number(data.monthlyLkr);
    if (isNaN(monthlyLkr) || monthlyLkr <= 0) {
      throw new Error('A valid positive monthly price in LKR is required.');
    }

    // Generate or format uppercase key
    const rawKey = data.key || data.name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const key = rawKey.toUpperCase().trim();

    const existingPlans = await this.getPlans();
    if (existingPlans.some((p) => p.key === key)) {
      throw new Error(`A package with key "${key}" already exists.`);
    }

    const quarterlyLkr = data.quarterlyLkr || Math.round(monthlyLkr * 3 * 0.9);
    const annualLkr = data.annualLkr || Math.round(monthlyLkr * 12 * 0.8);

    const newPlan: PlanConfig = {
      key,
      name: data.name.trim(),
      badge: data.badge?.trim() || undefined,
      description: data.description?.trim() || undefined,
      monthlyLkr,
      quarterlyLkr,
      annualLkr,
      maxBranches: typeof data.maxBranches === 'number' ? data.maxBranches : 1,
      maxUsers: typeof data.maxUsers === 'number' ? data.maxUsers : 5,
      trialDays: typeof data.trialDays === 'number' ? data.trialDays : 14,
      features: Array.isArray(data.features) && data.features.length > 0
        ? data.features.filter((f) => typeof f === 'string' && f.trim().length > 0)
        : ['Modular Universal POS', 'Thermal Receipts', 'Inventory Tracking'],
      isPopular: Boolean(data.isPopular),
      isActive: data.isActive !== false,
      color: data.color || 'blue',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const planMap: Record<string, PlanConfig> = {};
    for (const p of existingPlans) {
      planMap[p.key] = p;
    }
    planMap[key] = newPlan;

    // Persist to database setting
    await prisma.setting.upsert({
      where: { key: 'saas_subscription_plans' },
      create: {
        key: 'saas_subscription_plans',
        value: JSON.stringify(planMap),
        type: 'json',
        group: 'billing',
        isPublic: true,
      },
      update: {
        value: JSON.stringify(planMap),
      },
    });

    // Sync legacy key
    await prisma.setting.upsert({
      where: { key: 'XONIT_SUBSCRIPTION_PLANS' },
      create: {
        key: 'XONIT_SUBSCRIPTION_PLANS',
        value: JSON.stringify(planMap),
        type: 'json',
        group: 'billing',
        isPublic: true,
      },
      update: {
        value: JSON.stringify(planMap),
      },
    }).catch(() => {});

    logger.info(`Super Admin created new subscription package [${key}] - Rs. ${monthlyLkr}/mo`);
    return newPlan;
  }

  /**
   * Super Admin: Update full configuration, quotas, pricing, or features for any plan.
   */
  static async updatePlanPricing(planKey: string, updates: Partial<PlanConfig>): Promise<PlanConfig> {
    const key = planKey.toUpperCase();
    const plans = await this.getPlans();
    const planMap: Record<string, PlanConfig> = {};
    for (const p of plans) {
      planMap[p.key] = p;
    }

    if (!planMap[key]) {
      throw new Error(`Plan with key "${planKey}" does not exist.`);
    }

    const current = planMap[key]!;
    const monthlyLkr = updates.monthlyLkr !== undefined ? Number(updates.monthlyLkr) : current.monthlyLkr;
    const quarterlyLkr = updates.quarterlyLkr !== undefined
      ? Number(updates.quarterlyLkr)
      : (updates.monthlyLkr ? Math.round(monthlyLkr * 3 * 0.9) : current.quarterlyLkr);
    const annualLkr = updates.annualLkr !== undefined
      ? Number(updates.annualLkr)
      : (updates.monthlyLkr ? Math.round(monthlyLkr * 12 * 0.8) : current.annualLkr);

    const updatedPlan: PlanConfig = {
      ...current,
      name: updates.name ? updates.name.trim() : current.name,
      badge: updates.badge !== undefined ? (updates.badge?.trim() || undefined) : current.badge,
      description: updates.description !== undefined ? (updates.description?.trim() || undefined) : current.description,
      monthlyLkr,
      quarterlyLkr,
      annualLkr,
      maxBranches: typeof updates.maxBranches === 'number' ? updates.maxBranches : current.maxBranches,
      maxUsers: typeof updates.maxUsers === 'number' ? updates.maxUsers : current.maxUsers,
      trialDays: typeof updates.trialDays === 'number' ? updates.trialDays : current.trialDays,
      features: Array.isArray(updates.features) ? updates.features.filter(Boolean) : current.features,
      isPopular: updates.isPopular !== undefined ? Boolean(updates.isPopular) : current.isPopular,
      isActive: updates.isActive !== undefined ? Boolean(updates.isActive) : current.isActive !== false,
      color: updates.color || current.color || 'blue',
      updatedAt: new Date().toISOString(),
      key, // preserve key
    };

    planMap[key] = updatedPlan;

    // Persist to database setting
    await prisma.setting.upsert({
      where: { key: 'saas_subscription_plans' },
      create: {
        key: 'saas_subscription_plans',
        value: JSON.stringify(planMap),
        type: 'json',
        group: 'billing',
        isPublic: true,
      },
      update: {
        value: JSON.stringify(planMap),
      },
    });

    await prisma.setting.upsert({
      where: { key: 'XONIT_SUBSCRIPTION_PLANS' },
      create: {
        key: 'XONIT_SUBSCRIPTION_PLANS',
        value: JSON.stringify(planMap),
        type: 'json',
        group: 'billing',
        isPublic: true,
      },
      update: {
        value: JSON.stringify(planMap),
      },
    }).catch(() => {});

    logger.info(`Super Admin updated package [${key}]`);
    return updatedPlan;
  }

  /**
   * Super Admin: Delete or soft-archive a subscription package.
   */
  static async deletePlan(planKey: string): Promise<{ deleted: boolean; archived: boolean; message: string }> {
    const key = planKey.toUpperCase();
    const plans = await this.getPlans();
    const planMap: Record<string, PlanConfig> = {};
    for (const p of plans) {
      planMap[p.key] = p;
    }

    if (!planMap[key]) {
      throw new Error(`Plan with key "${planKey}" does not exist.`);
    }

    // Check if tenants are currently assigned to this tier
    const activeSubscribers = await (prisma as any).tenant.count({
      where: { subscriptionTier: key },
    });

    if (activeSubscribers > 0) {
      // Soft-archive: Mark inactive to preserve existing tenant access while hiding from new signups
      planMap[key] = {
        ...planMap[key]!,
        isActive: false,
        updatedAt: new Date().toISOString(),
      };

      await prisma.setting.upsert({
        where: { key: 'saas_subscription_plans' },
        create: { key: 'saas_subscription_plans', value: JSON.stringify(planMap), type: 'json' },
        update: { value: JSON.stringify(planMap) },
      });

      return {
        deleted: false,
        archived: true,
        message: `Package "${key}" has ${activeSubscribers} active tenant(s). It has been archived and hidden rather than permanently deleted.`,
      };
    }

    // No active tenants: Safe to remove
    delete planMap[key];

    await prisma.setting.upsert({
      where: { key: 'saas_subscription_plans' },
      create: { key: 'saas_subscription_plans', value: JSON.stringify(planMap), type: 'json' },
      update: { value: JSON.stringify(planMap) },
    });

    await prisma.setting.upsert({
      where: { key: 'XONIT_SUBSCRIPTION_PLANS' },
      create: { key: 'XONIT_SUBSCRIPTION_PLANS', value: JSON.stringify(planMap), type: 'json' },
      update: { value: JSON.stringify(planMap) },
    }).catch(() => {});

    logger.info(`Super Admin deleted package [${key}]`);
    return {
      deleted: true,
      archived: false,
      message: `Package "${key}" has been permanently removed.`,
    };
  }

  /**
   * Activates a 14-day full access free trial for a tenant.
   */
  static async start14DayTrial(tenantId: string) {
    const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error(`Tenant with ID ${tenantId} not found.`);

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const existingSettings = (tenant.settings as Record<string, any>) || {};

    const updatedSettings = {
      ...existingSettings,
      trialStartedAt: new Date().toISOString(),
      trialEndsAt: trialEndsAt.toISOString(),
    };

    const updated = await (prisma as any).tenant.update({
      where: { id: tenantId },
      data: {
        status: 'TRIAL',
        subscriptionTier: 'STARTER',
        maxBranches: 1,
        maxUsers: 2,
        settings: updatedSettings,
      },
    });

    return {
      tenantId: updated.id,
      name: updated.name,
      status: updated.status,
      trialEndsAt,
      daysRemaining: 14,
    };
  }

  /**
   * Activates a paid subscription for a tenant with custom billing cycle and LKR invoicing.
   */
  static async activateSubscription(
    tenantId: string,
    params: {
      planKey: 'STARTER' | 'GROWTH' | 'ENTERPRISE';
      billingCycle: BillingCycle;
      customMonthlyPriceLkr?: number;
      paymentReference?: string;
    }
  ) {
    const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error(`Tenant with ID ${tenantId} not found.`);

    const plans = await this.getPlans();
    const plan = plans.find((p) => p.key === params.planKey.toUpperCase()) || DEFAULT_PLANS['GROWTH']!;

    const cycle = params.billingCycle || 'MONTHLY';
    let durationDays = 30;
    let finalAmountLkr = plan.monthlyLkr;

    if (params.customMonthlyPriceLkr) {
      if (cycle === 'QUARTERLY') {
        durationDays = 90;
        finalAmountLkr = Math.round(params.customMonthlyPriceLkr * 3 * 0.9);
      } else if (cycle === 'ANNUAL') {
        durationDays = 365;
        finalAmountLkr = Math.round(params.customMonthlyPriceLkr * 12 * 0.8);
      } else {
        durationDays = 30;
        finalAmountLkr = params.customMonthlyPriceLkr;
      }
    } else {
      if (cycle === 'QUARTERLY') {
        durationDays = 90;
        finalAmountLkr = plan.quarterlyLkr;
      } else if (cycle === 'ANNUAL') {
        durationDays = 365;
        finalAmountLkr = plan.annualLkr;
      } else {
        durationDays = 30;
        finalAmountLkr = plan.monthlyLkr;
      }
    }

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

    const existingSettings = (tenant.settings as Record<string, any>) || {};
    const invoices = existingSettings.invoices || [];

    const newInvoice = {
      invoiceNumber,
      planKey: plan.key,
      planName: plan.name,
      billingCycle: cycle,
      amountLkr: finalAmountLkr,
      currency: 'LKR',
      paymentReference: params.paymentReference || 'DIRECT_PAYMENT',
      status: 'PAID',
      issuedAt: startDate.toISOString(),
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
    };

    const updatedSettings = {
      ...existingSettings,
      subscription: {
        planKey: plan.key,
        billingCycle: cycle,
        currentPeriodStart: startDate.toISOString(),
        currentPeriodEnd: endDate.toISOString(),
        amountLkr: finalAmountLkr,
      },
      invoices: [newInvoice, ...invoices],
    };

    const updatedTenant = await (prisma as any).tenant.update({
      where: { id: tenantId },
      data: {
        status: 'ACTIVE',
        subscriptionTier: plan.key,
        maxBranches: plan.maxBranches,
        maxUsers: plan.maxUsers,
        settings: updatedSettings,
      },
    });

    logger.info(`Activated [${cycle}] subscription for tenant [${tenant.name}] - LKR ${finalAmountLkr} (Invoice: ${invoiceNumber})`);

    return {
      tenant: updatedTenant,
      invoice: newInvoice,
    };
  }

  /**
   * Retrieves real-time subscription, trial status, and days remaining.
   */
  static async getTenantSubscriptionStatus(tenantId: string) {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: { branches: true, users: true },
        },
      },
    });

    if (!tenant) throw new Error(`Tenant with ID ${tenantId} not found.`);

    const settings = (tenant.settings as Record<string, any>) || {};
    const now = new Date();

    let isTrial = tenant.status === 'TRIAL';
    let daysRemaining = 0;
    let periodEnd: string | null = null;

    if (isTrial && settings.trialEndsAt) {
      const trialEnd = new Date(settings.trialEndsAt);
      const diffMs = trialEnd.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    } else if (settings.subscription?.currentPeriodEnd) {
      const subEnd = new Date(settings.subscription.currentPeriodEnd);
      const diffMs = subEnd.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      periodEnd = settings.subscription.currentPeriodEnd;
    }

    return {
      tenantId: tenant.id,
      name: tenant.name,
      status: tenant.status,
      subscriptionTier: tenant.subscriptionTier,
      isTrial,
      daysRemaining,
      currentPeriodEnd: periodEnd,
      currency: tenant.currency || 'LKR',
      quotas: {
        branches: { current: tenant._count.branches, max: tenant.maxBranches },
        users: { current: tenant._count.users, max: tenant.maxUsers },
      },
      latestInvoice: settings.invoices?.[0] || null,
    };
  }

  /**
   * Automated Dunning Engine:
   * Checks for overdue subscriptions and handles grace periods and auto-suspensions.
   */
  static async runDunningCheck() {
    const tenants = await (prisma as any).tenant.findMany({
      where: {
        status: { in: ['ACTIVE', 'TRIAL'] }
      }
    });

    const now = new Date().getTime();
    const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000; // 3-day grace period

    const suspended: string[] = [];
    const inGracePeriod: string[] = [];

    for (const tenant of tenants) {
      const settings = (tenant.settings as Record<string, any>) || {};
      let expirationTime: number | null = null;

      if (tenant.status === 'TRIAL' && settings.trialEndsAt) {
        expirationTime = new Date(settings.trialEndsAt).getTime();
      } else if (settings.subscription?.currentPeriodEnd) {
        expirationTime = new Date(settings.subscription.currentPeriodEnd).getTime();
      }

      if (expirationTime && expirationTime < now) {
        const overdueMs = now - expirationTime;
        if (overdueMs > GRACE_PERIOD_MS) {
          // Suspend tenant
          await (prisma as any).tenant.update({
            where: { id: tenant.id },
            data: { status: 'SUSPENDED' }
          });
          logger.warn(`Tenant [${tenant.name}] suspended due to overdue subscription payment (${Math.round(overdueMs / 86400000)} days overdue).`);
          suspended.push(tenant.id);
        } else {
          inGracePeriod.push(tenant.id);
        }
      }
    }

    return {
      processedCount: tenants.length,
      suspended,
      inGracePeriod
    };
  }
}
