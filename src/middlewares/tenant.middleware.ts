import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { requestContext } from '../context/RequestContext';

export interface TenantRequest extends Request {
  tenantId?: string | null;
  tenantSlug?: string | null;
}

export function extractSubdomainFromHost(host?: string | null): string | null {
  if (!host) return null;
  const parts1 = host.split(':');
  const cleanHost = (parts1[0] || '').toLowerCase();
  if (!cleanHost) return null;
  // Skip raw IPs
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(cleanHost)) return null;
  if (cleanHost === 'localhost') return null;

  const parts = cleanHost.split('.');
  // e.g. store-alpha.localhost
  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost' && parts[0]) {
    return parts[0];
  }
  // e.g. store-alpha.xonitspace.com
  if (parts.length >= 3 && parts[0]) {
    const reserved = ['www', 'app', 'api', 'admin', 'pos', 'platform'];
    if (!reserved.includes(parts[0])) {
      return parts[0];
    }
  }
  return null;
}

/**
 * Tenant resolution middleware:
 * Determines the target tenant via:
 * 1. Explicit request header `x-tenant-id` or `x-tenant-slug`
 * 2. Wildcard Subdomain (e.g. `store-alpha.domain.com` or `store-alpha.localhost:3000`)
 * 3. Authenticated user's associated tenantId
 * 4. Default fallback for legacy single-tenant requests / background jobs
 */
export async function tenantMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = (req as any).user;
    const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
    const headerTenantSlug = req.headers['x-tenant-slug'] as string | undefined;

    const hostHeader = (req.headers['x-forwarded-host'] as string) || req.headers['host'] || req.hostname;
    const subdomainSlug = extractSubdomainFromHost(hostHeader);

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
    } else if (headerTenantSlug || subdomainSlug) {
      const targetSlug = headerTenantSlug || subdomainSlug;
      const tenant = await (prisma as any).tenant.findUnique({
        where: { slug: targetSlug },
        select: { id: true, slug: true, status: true },
      });

      if (!tenant) {
        res.status(404).json({ success: false, message: `Tenant not found for slug: ${targetSlug}` });
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
