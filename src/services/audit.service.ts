import prisma from '../config/prisma';
import { requestContext } from '../context/RequestContext';

export const auditService = {
  getLogs: async (search?: string, action?: string, timeframe?: string, page: number = 1, limit: number = 50) => {
    const store = requestContext.getStore();
    const tenantId = store?.tenantId;
    const isPlatformAdmin = store?.isPlatformAdmin;

    const where: any = {};
    if (tenantId && !isPlatformAdmin) {
      where.tenantId = tenantId;
    }
    
    if (action && action !== 'All Actions') {
      where.action = action;
    }
    
    if (timeframe) {
      const now = new Date();
      if (timeframe === 'Last 24 Hours') {
        where.createdAt = { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) };
      } else if (timeframe === 'Last 7 Days') {
        where.createdAt = { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
      } else if (timeframe === 'Last 30 Days') {
        where.createdAt = { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
      }
    }
    
    if (search) {
      where.OR = [
        { userId: { contains: search, mode: 'insensitive' } },
        { entity: { contains: search, mode: 'insensitive' } },
        { action: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }
    
    const skip = (page - 1) * limit;
    
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { name: true, email: true } } }
      }),
      prisma.auditLog.count({ where })
    ]);
    
    // Map logs to return user name if available
    const mappedLogs = logs.map(log => ({
      ...log,
      userName: log.user?.name || log.user?.email || 'System'
    }));
    
    return {
      data: mappedLogs,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
};
