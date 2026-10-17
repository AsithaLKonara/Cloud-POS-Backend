import { Request, Response, NextFunction } from 'express';
import { requestContext } from '../context/RequestContext';

/**
 * Middleware to initialize the AsyncLocalStorage context for Row-Level Security (RLS).
 * Must be placed AFTER the authentication middleware so that `req.user` is available.
 * 
 * branchId = null  → Super Admin / no branch restriction (all branches visible)
 * branchId = string → Staff member restricted to that single branch
 */
export const rlsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user; // Set by authenticateJWT
  const isPlatformAdmin = user?.roles?.some((r: string) => ['SUPER_PLATFORM_ADMIN', 'PLATFORM_ADMIN'].includes(r)) || false;
  const isTenantAdmin = user?.roles?.some((r: string) => ['SUPER_ADMIN', 'ADMIN'].includes(r)) || false;

  const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
  const resolvedTenantId = (req as any).tenantId || user?.tenantId || headerTenantId || null;
  const resolvedTenantSlug = (req as any).tenantSlug || user?.tenantSlug || (req.headers['x-tenant-slug'] as string) || null;

  const contextData = {
    userId: user?.userId || null,
    role: user?.role || 'GUEST',
    isAdmin: isTenantAdmin || isPlatformAdmin,
    isPlatformAdmin,
    tenantId: resolvedTenantId,
    tenantSlug: resolvedTenantSlug,
    // Tenant Admins / Platform Admins get null (unrestricted across branches). Branch staff get their assigned branchId.
    branchId: (isTenantAdmin || isPlatformAdmin) ? null : (user?.branchId || null),
  };

  requestContext.run(contextData, () => {
    next();
  });
};
