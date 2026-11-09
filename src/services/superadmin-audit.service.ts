import prisma from '../config/prisma';

export interface AuditQueryOptions {
  search?: string;
  action?: string;
  entity?: string;
  tenantId?: string;
  timeframe?: string;
  page?: number;
  limit?: number;
}

export class SuperAdminAuditService {
  /**
   * Query cross-tenant global audit log with multi-dimensional filtering
   */
  static async getGlobalAuditLogs(params: AuditQueryOptions) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
    const skip = (page - 1) * limit;

    const where: any = {};

    // Filter by tenant
    if (params.tenantId && params.tenantId !== 'ALL') {
      if (params.tenantId === 'PLATFORM_SYSTEM') {
        where.tenantId = null;
      } else {
        where.tenantId = params.tenantId;
      }
    }

    // Filter by action
    if (params.action && params.action !== 'ALL') {
      where.action = { contains: params.action, mode: 'insensitive' };
    }

    // Filter by entity
    if (params.entity && params.entity !== 'ALL') {
      where.entity = params.entity;
    }

    // Filter by timeframe
    if (params.timeframe && params.timeframe !== 'ALL') {
      const now = new Date();
      if (params.timeframe === '24H') {
        where.createdAt = { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) };
      } else if (params.timeframe === '7D') {
        where.createdAt = { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
      } else if (params.timeframe === '30D') {
        where.createdAt = { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
      }
    }

    // Multi-field search
    if (params.search) {
      where.OR = [
        { action: { contains: params.search, mode: 'insensitive' } },
        { entity: { contains: params.search, mode: 'insensitive' } },
        { entityId: { contains: params.search, mode: 'insensitive' } },
        { ipAddress: { contains: params.search, mode: 'insensitive' } },
        { user: { email: { contains: params.search, mode: 'insensitive' } } },
        { user: { name: { contains: params.search, mode: 'insensitive' } } },
        { tenant: { name: { contains: params.search, mode: 'insensitive' } } },
        { tenant: { slug: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        oldData: l.oldData,
        newData: l.newData,
        ipAddress: l.ipAddress || '127.0.0.1',
        userAgent: l.userAgent || 'SuperAdmin Web Console',
        createdAt: l.createdAt,
        user: l.user
          ? {
              id: l.user.id,
              name: l.user.name,
              email: l.user.email,
            }
          : null,
        tenant: l.tenant
          ? {
              id: l.tenant.id,
              name: l.tenant.name,
              slug: l.tenant.slug,
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Platform Security KPI Summary
   */
  static async getAuditStats() {
    const now = new Date();
    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [totalEvents, events24h, impersonationCount, securityEvents] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.count({ where: { createdAt: { gte: past24h } } }),
      prisma.auditLog.count({ where: { action: { contains: 'IMPERSONATE' } } }),
      prisma.auditLog.count({
        where: {
          OR: [
            { action: { contains: 'PASSWORD' } },
            { action: { contains: 'STATUS' } },
            { action: { contains: 'FLAG' } },
            { action: { contains: 'ENTITLEMENT' } },
            { action: { contains: 'ROLE' } },
          ],
        },
      }),
    ]);

    return {
      totalEvents,
      events24h,
      impersonationCount,
      securityEvents,
    };
  }
}

