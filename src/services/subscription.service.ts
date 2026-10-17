import prisma from '../config/prisma';
import { logger } from '../utils/logger';

export type BillingCycle = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface PlanConfig {
  key: string;
  name: string;
  badge?: string;
  monthlyLkr: number;
  quarterlyLkr: number; // 10% discount
  annualLkr: number; // 20% discount
  maxBranches: number;
  maxUsers: number;
  trialDays: number;
  features: string[];
}

export const DEFAULT_PLANS: Record<string, PlanConfig> = {
  STARTER: {
    key: 'STARTER',
    name: 'Starter Business',
    badge: 'Single Outlet',
    monthlyLkr: 4500,
    quarterlyLkr: 12150, // 10% off
    annualLkr: 43200, // 20% off
    maxBranches: 1,
    maxUsers: 2,
    trialDays: 14,
    features: [
      'Modular Universal POS',
      '80mm/58mm Thermal Receipt Printing',
      'Basic Inventory & Barcodes',
      'Cash & Card Payment Recording',
      '14-Day Full Access Trial',
    ],
  },
  GROWTH: {
    key: 'GROWTH',
    name: 'Growth Store',
    badge: 'Most Popular',
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
  },
  ENTERPRISE: {
    key: 'ENTERPRISE',
    name: 'Enterprise Platform',
    badge: 'Unlimited Scale',
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
      'Custom Courier Webhooks (Koombiyo, PromptX, Domex)',
      '24/7 Priority SLA & Dedicated Hardware Engineer',
    ],
  },
};

export class SubscriptionService {
  /**
   * Retrieves all subscription plans with dynamic Super Admin overrides if present.
   */
  static async getPlans(): Promise<PlanConfig[]> {
    try {
      const setting = await prisma.setting.findUnique({
        where: { key: 'saas_subscription_plans' },
      });

      if (setting && setting.value) {
        const customPlans = JSON.parse(setting.value);
        return Object.values(customPlans);
      }
    } catch (err: any) {
      logger.warn(`Could not load custom plan settings: ${err.message}`);
    }

    return Object.values(DEFAULT_PLANS);
  }

  /**
   * Super Admin: Update pricing, quotas, or features for a subscription plan.
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

    const updatedPlan: PlanConfig = {
      ...planMap[key],
      ...updates,
      key, // preserve key
    };

    // Auto-calculate discount tiers if only monthlyLkr changed
    if (updates.monthlyLkr && !updates.quarterlyLkr) {
      updatedPlan.quarterlyLkr = Math.round(updates.monthlyLkr * 3 * 0.9);
    }
    if (updates.monthlyLkr && !updates.annualLkr) {
      updatedPlan.annualLkr = Math.round(updates.monthlyLkr * 12 * 0.8);
    }

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

    logger.info(`Super Admin updated plan pricing for [${key}]`);
    return updatedPlan;
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
}
