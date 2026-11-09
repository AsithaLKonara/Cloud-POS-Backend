import prisma from '../config/prisma';
import { logger } from '../utils/logger';
import { DEFAULT_PLANS } from './subscription.service';

export interface DelinquentTenantItem {
  tenantId: string;
  name: string;
  slug: string;
  businessType: string;
  status: string;
  subscriptionTier: string;
  delinquencyStatus: 'IN_GRACE_PERIOD' | 'OVERDUE' | 'SUSPENDED_DELINQUENT' | 'EXEMPT' | 'HEALTHY';
  daysOverdue: number;
  graceExpiresAt: string | null;
  periodEnd: string | null;
  amountAtRiskLkr: number;
  isExempt: boolean;
  notes?: string;
}

export class DunningService {
  /**
   * Get platform delinquency metrics and tenant billing health status
   */
  static async getDelinquencyOverview() {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        businessType: true,
        status: true,
        subscriptionTier: true,
        settings: true,
      },
    });

    const now = Date.now();
    const GRACE_PERIOD_DAYS = 7;
    const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

    const delinquentList: DelinquentTenantItem[] = [];
    let atRiskMrrLkr = 0;
    let inGraceCount = 0;
    let overdueCount = 0;
    let suspendedCount = 0;
    let exemptCount = 0;

    for (const t of tenants) {
      const settings = (t.settings as Record<string, any>) || {};
      const dunningSettings = settings.dunning || {};
      const isExempt = Boolean(dunningSettings.isExempt);

      // Determine expiration time
      let expirationTime: number | null = null;
      if (t.status === 'TRIAL' && settings.trialEndsAt) {
        expirationTime = new Date(settings.trialEndsAt).getTime();
      } else if (settings.subscription?.currentPeriodEnd) {
        expirationTime = new Date(settings.subscription.currentPeriodEnd).getTime();
      } else if (dunningSettings.graceExpiresAt) {
        expirationTime = new Date(dunningSettings.graceExpiresAt).getTime();
      }

      // Monthly price for tier
      const tierKey = (t.subscriptionTier || 'STARTER').toUpperCase();
      const planConfig = DEFAULT_PLANS[tierKey] || DEFAULT_PLANS.STARTER;
      const tierMonthlyLkr = planConfig?.monthlyLkr ?? 4500;

      // Check if overdue
      let delinquencyStatus: DelinquentTenantItem['delinquencyStatus'] = 'HEALTHY';
      let daysOverdue = 0;
      let graceExpiresAt: string | null = null;

      if (expirationTime && expirationTime < now) {
        const overdueMs = now - expirationTime;
        daysOverdue = Math.max(1, Math.floor(overdueMs / (24 * 60 * 60 * 1000)));

        const computedGraceEnd = new Date(expirationTime + GRACE_PERIOD_MS);
        graceExpiresAt = dunningSettings.graceExpiresAt || computedGraceEnd.toISOString();

        if (isExempt) {
          delinquencyStatus = 'EXEMPT';
          exemptCount++;
        } else if (t.status === 'SUSPENDED') {
          delinquencyStatus = 'SUSPENDED_DELINQUENT';
          suspendedCount++;
          atRiskMrrLkr += tierMonthlyLkr;
        } else if (overdueMs <= GRACE_PERIOD_MS) {
          delinquencyStatus = 'IN_GRACE_PERIOD';
          inGraceCount++;
          atRiskMrrLkr += tierMonthlyLkr;
        } else {
          delinquencyStatus = 'OVERDUE';
          overdueCount++;
          atRiskMrrLkr += tierMonthlyLkr;
        }
      } else if (dunningSettings.graceExpiresAt && new Date(dunningSettings.graceExpiresAt).getTime() > now) {
        delinquencyStatus = 'IN_GRACE_PERIOD';
        graceExpiresAt = dunningSettings.graceExpiresAt;
        inGraceCount++;
        atRiskMrrLkr += tierMonthlyLkr;
      } else if (t.status === 'SUSPENDED') {
        delinquencyStatus = 'SUSPENDED_DELINQUENT';
        suspendedCount++;
        atRiskMrrLkr += tierMonthlyLkr;
      } else if (isExempt) {
        delinquencyStatus = 'EXEMPT';
        exemptCount++;
      }

      // If tenant has any delinquency status, include in list
      if (delinquencyStatus !== 'HEALTHY') {
        delinquentList.push({
          tenantId: t.id,
          name: t.name,
          slug: t.slug,
          businessType: t.businessType,
          status: t.status,
          subscriptionTier: t.subscriptionTier,
          delinquencyStatus,
          daysOverdue,
          graceExpiresAt,
          periodEnd: expirationTime ? new Date(expirationTime).toISOString() : null,
          amountAtRiskLkr: tierMonthlyLkr,
          isExempt,
          notes: dunningSettings.notes,
        });
      }
    }

    return {
      kpis: {
        totalDelinquentCount: delinquentList.length,
        atRiskMrrLkr,
        inGraceCount,
        overdueCount,
        suspendedCount,
        exemptCount,
      },
      tenants: delinquentList,
    };
  }

  /**
   * SuperAdmin: Extend grace period for a delinquent merchant
   */
  static async extendGracePeriod(tenantId: string, daysToAdd: number, superAdminUser: any) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, status: true, settings: true },
    });

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const currentSettings = (tenant.settings as Record<string, any>) || {};
    const currentDunning = currentSettings.dunning || {};

    const now = Date.now();
    const msToAdd = daysToAdd * 24 * 60 * 60 * 1000;
    const baseTime = currentDunning.graceExpiresAt
      ? Math.max(now, new Date(currentDunning.graceExpiresAt).getTime())
      : now;

    const newGraceExpiresAt = new Date(baseTime + msToAdd).toISOString();

    const updatedSettings = {
      ...currentSettings,
      dunning: {
        ...currentDunning,
        graceExpiresAt: newGraceExpiresAt,
        lastExtendedAt: new Date().toISOString(),
        lastExtendedBy: superAdminUser?.email || 'SuperAdmin',
      },
      // If subscription exists, also advance currentPeriodEnd
      subscription: currentSettings.subscription
        ? {
            ...currentSettings.subscription,
            currentPeriodEnd: newGraceExpiresAt,
          }
        : currentSettings.subscription,
    };

    // If tenant was suspended, reactivate
    const nextStatus = tenant.status === 'SUSPENDED' ? 'ACTIVE' : tenant.status;

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        status: nextStatus,
        settings: updatedSettings,
      },
    });

    // Record audit log
    await prisma.auditLog.create({
      data: {
        userId: superAdminUser?.id,
        tenantId,
        action: 'SUPERADMIN_EXTEND_GRACE_PERIOD',
        entity: 'TENANT_DUNNING',
        entityId: tenantId,
        oldData: { graceExpiresAt: currentDunning.graceExpiresAt, status: tenant.status },
        newData: { graceExpiresAt: newGraceExpiresAt, daysAdded: daysToAdd, status: nextStatus },
        userAgent: 'SuperAdmin Web Console',
      },
    });

    logger.info(`Grace period extended by ${daysToAdd} days for tenant ${tenant.name} until ${newGraceExpiresAt}`);

    return {
      tenantId,
      newGraceExpiresAt,
      status: nextStatus,
    };
  }

  /**
   * SuperAdmin: Toggle VIP exemption from automated suspension
   */
  static async toggleExemption(tenantId: string, isExempt: boolean, superAdminUser: any) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, settings: true },
    });

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const currentSettings = (tenant.settings as Record<string, any>) || {};
    const currentDunning = currentSettings.dunning || {};

    const updatedSettings = {
      ...currentSettings,
      dunning: {
        ...currentDunning,
        isExempt,
        exemptionToggledAt: new Date().toISOString(),
        exemptionToggledBy: superAdminUser?.email || 'SuperAdmin',
      },
    };

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: updatedSettings,
      },
    });

    // Record audit log
    await prisma.auditLog.create({
      data: {
        userId: superAdminUser?.id,
        tenantId,
        action: 'SUPERADMIN_TOGGLE_DUNNING_EXEMPTION',
        entity: 'TENANT_DUNNING',
        entityId: tenantId,
        oldData: { isExempt: currentDunning.isExempt },
        newData: { isExempt },
        userAgent: 'SuperAdmin Web Console',
      },
    });

    return {
      tenantId,
      isExempt,
    };
  }

  /**
   * SuperAdmin: Trigger manual dunning check scan
   */
  static async triggerDunningScan(superAdminUser: any) {
    const tenants = await prisma.tenant.findMany({
      where: {
        status: { in: ['ACTIVE', 'TRIAL'] },
      },
      select: {
        id: true,
        name: true,
        status: true,
        settings: true,
      },
    });

    const now = Date.now();
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7-day grace period

    const suspended: string[] = [];
    const inGracePeriod: string[] = [];

    for (const tenant of tenants) {
      const settings = (tenant.settings as Record<string, any>) || {};
      const dunningSettings = settings.dunning || {};

      // If exempt, skip automated suspension
      if (dunningSettings.isExempt) {
        continue;
      }

      let expirationTime: number | null = null;
      if (dunningSettings.graceExpiresAt) {
        expirationTime = new Date(dunningSettings.graceExpiresAt).getTime();
      } else if (tenant.status === 'TRIAL' && settings.trialEndsAt) {
        expirationTime = new Date(settings.trialEndsAt).getTime();
      } else if (settings.subscription?.currentPeriodEnd) {
        expirationTime = new Date(settings.subscription.currentPeriodEnd).getTime();
      }

      if (expirationTime && expirationTime < now) {
        const overdueMs = now - expirationTime;
        if (overdueMs > GRACE_PERIOD_MS) {
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: { status: 'SUSPENDED' },
          });

          await prisma.auditLog.create({
            data: {
              userId: superAdminUser?.id,
              tenantId: tenant.id,
              action: 'AUTOMATED_DUNNING_SUSPENSION',
              entity: 'TENANT',
              entityId: tenant.id,
              oldData: { status: tenant.status },
              newData: { status: 'SUSPENDED', daysOverdue: Math.round(overdueMs / 86400000) },
              userAgent: 'Automated Dunning Engine',
            },
          });

          logger.warn(`Tenant [${tenant.name}] suspended by automated dunning (${Math.round(overdueMs / 86400000)} days overdue).`);
          suspended.push(tenant.id);
        } else {
          inGracePeriod.push(tenant.id);
        }
      }
    }

    return {
      scannedCount: tenants.length,
      suspendedCount: suspended.length,
      inGraceCount: inGracePeriod.length,
      suspendedTenantIds: suspended,
    };
  }
}

