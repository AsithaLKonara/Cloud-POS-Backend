import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';

export const PLAN_FEATURE_MATRIX: Record<string, string[]> = {
  // Features allowed per subscription tier
  STARTER: [
    'POS_SALES',
    'THERMAL_PRINTING',
    'BASIC_INVENTORY',
    'REPORTS_BASIC',
  ],
  GROWTH: [
    'POS_SALES',
    'THERMAL_PRINTING',
    'BASIC_INVENTORY',
    'REPORTS_BASIC',
    'INTER_BRANCH_TRANSFER',
    'DINING_TABLES',
    'SPLIT_BILLS',
    'CUSTOMER_CREDIT',
    'RECIPE_BOM',
    'DOUBLE_ENTRY_GL',
    'ACCOUNTS_PAYABLE',
    'ACCOUNTS_RECEIVABLE',
    'CYCLE_COUNT',
    'INTEGRATIONS_LOCAL',
  ],
  ENTERPRISE: [
    '*', // All features
  ],
};

/**
 * Middleware factory to guard route access based on tenant's SaaS subscription tier
 */
export function requirePlanFeature(featureKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const isPlatformAdmin = user?.roles?.some((r: string) => ['SUPER_PLATFORM_ADMIN', 'PLATFORM_ADMIN'].includes(r));

      // Platform admins bypass feature guards
      if (isPlatformAdmin) {
        return next();
      }

      const tenantId = (req as any).tenantId || user?.tenantId;
      if (!tenantId) {
        return next();
      }

      const tenant = await (prisma as any).tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, subscriptionTier: true, status: true }
      });

      if (!tenant) {
        res.status(404).json({ success: false, message: 'Tenant not found.' });
        return;
      }

      if (tenant.status === 'SUSPENDED') {
        res.status(403).json({ success: false, message: 'Tenant subscription is suspended.' });
        return;
      }

      const tier = (tenant.subscriptionTier || 'STARTER').toUpperCase();
      const allowedFeatures: string[] = PLAN_FEATURE_MATRIX[tier] || PLAN_FEATURE_MATRIX['STARTER'] || [];

      const hasAccess = allowedFeatures.includes('*') || allowedFeatures.includes(featureKey);

      if (!hasAccess) {
        res.status(403).json({
          success: false,
          code: 'FEATURE_NOT_PERMITTED',
          message: `Feature [${featureKey}] is not available on your current plan (${tier}). Upgrade your subscription to unlock this feature.`,
          requiredFeature: featureKey,
          currentTier: tier
        });
        return;
      }

      next();
    } catch (err: any) {
      console.error('Feature guard error:', err);
      next();
    }
  };
}
