import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { requestContext } from '../context/RequestContext';

export interface TenantRequest extends Request {
  tenantId?: string | null;
  tenantSlug?: string | null;
}

/**
 * Tenant resolution middleware:
 * Determines the target tenant via:
 * 1. Explicit request header `x-tenant-id` or `x-tenant-slug`
 * 2. Authenticated user's associated tenantId
 * 3. Default fallback for legacy single-tenant requests / background jobs
 */
export async function tenantMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = (req as any).user;
    const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
    const headerTenantSlug = req.headers['x-tenant-slug'] as string | undefined;

    const isPlatformAdmin = user?.roles?.some((r: string) => ['SUPER_PLATFORM_ADMIN', 'PLATFORM_ADMIN'].includes(r));

    let resolvedTenantId: string | null = null;
    let resolvedTenantSlug: string | null = null;

    if (headerTenantId) {
      // Validate that headerTenantId exists
      const tenant = await (prisma as any).tenant.findUnique({
        where: { id: headerTenantId },
        select: { id: true, slug: true, status: true },
      });

      if (!tenant) {
        res.status(404).json({ success: false, message: `Tenant not found for ID: ${headerTenantId}` });
        return;
      }

      if (tenant.status !== 'ACTIVE' && !isPlatformAdmin) {
        res.status(403).json({ success: false, message: `Tenant is ${tenant.status.toLowerCase()}` });
        return;
      }

      resolvedTenantId = tenant.id;
      resolvedTenantSlug = tenant.slug;
    } else if (headerTenantSlug) {
      const tenant = await (prisma as any).tenant.findUnique({
        where: { slug: headerTenantSlug },
        select: { id: true, slug: true, status: true },
      });

      if (!tenant) {
        res.status(404).json({ success: false, message: `Tenant not found for slug: ${headerTenantSlug}` });
        return;
      }

      if (tenant.status !== 'ACTIVE' && !isPlatformAdmin) {
        res.status(403).json({ success: false, message: `Tenant is ${tenant.status.toLowerCase()}` });
        return;
      }

      resolvedTenantId = tenant.id;
      resolvedTenantSlug = tenant.slug;
    } else if (user?.tenantId) {
      resolvedTenantId = user.tenantId;
      resolvedTenantSlug = user.tenantSlug || null;
    }

    // Security Guard: Non-platform admins cannot access a different tenant than their own assigned tenant
    if (user?.tenantId && resolvedTenantId && user.tenantId !== resolvedTenantId && !isPlatformAdmin) {
      res.status(403).json({
        success: false,
        message: 'Access denied: You do not have permission to access another tenant\'s workspace.',
      });
      return;
    }

    (req as any).tenantId = resolvedTenantId;
    (req as any).tenantSlug = resolvedTenantSlug;

    // Attach to current RequestContext if already running, or pass along
    const currentStore = requestContext.getStore();
    if (currentStore) {
      currentStore.tenantId = resolvedTenantId;
      currentStore.tenantSlug = resolvedTenantSlug;
      currentStore.isPlatformAdmin = isPlatformAdmin || false;
    }

    next();
  } catch (error) {
    next(error);
  }
}
