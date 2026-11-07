import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';

export function enforceQuota(resourceType: 'BRANCH' | 'USER' | 'PRODUCT') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = (req as any).user;
      const isPlatformAdmin = user?.roles?.some((r: string) => ['SUPER_PLATFORM_ADMIN', 'PLATFORM_ADMIN'].includes(r));

      if (isPlatformAdmin) return next();

      const tenantId = (req as any).tenantId || user?.tenantId;
      if (!tenantId) return next();

      const tenant = await (prisma as any).tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, maxBranches: true, maxUsers: true, subscriptionTier: true }
      });

      if (!tenant) return next();

      if (resourceType === 'BRANCH') {
        const count = await (prisma as any).branch.count({ where: { tenantId } });
        if (count >= tenant.maxBranches) {
          res.status(403).json({
            success: false,
            code: 'QUOTA_EXCEEDED',
            message: `Branch limit reached (${count}/${tenant.maxBranches}). Upgrade your subscription tier to add more branches.`,
            quota: tenant.maxBranches,
            current: count
          });
          return;
        }
      }

      if (resourceType === 'USER') {
        const count = await (prisma as any).user.count({ where: { tenantId } });
        if (count >= tenant.maxUsers) {
          res.status(403).json({
            success: false,
            code: 'QUOTA_EXCEEDED',
            message: `Staff user limit reached (${count}/${tenant.maxUsers}). Upgrade your subscription tier to invite more users.`,
            quota: tenant.maxUsers,
            current: count
          });
          return;
        }
      }

      if (resourceType === 'PRODUCT') {
        const tier = (tenant.subscriptionTier || 'STARTER').toUpperCase();
        const maxProducts = tier === 'STARTER' ? 500 : tier === 'GROWTH' ? 5000 : 100000;
        const count = await (prisma as any).product.count({ where: { tenantId } });
        if (count >= maxProducts) {
          res.status(403).json({
            success: false,
            code: 'QUOTA_EXCEEDED',
            message: `Catalog product limit reached (${count}/${maxProducts}). Upgrade your subscription to add more products.`,
            quota: maxProducts,
            current: count
          });
          return;
        }
      }

      next();
    } catch (err) {
      console.error('Quota enforcement error:', err);
      next();
    }
  };
}

