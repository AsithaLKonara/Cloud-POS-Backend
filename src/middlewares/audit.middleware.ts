import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';

export const auditLog = (entity: string, action: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    const ipAddress = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor as string) || req.ip || '0.0.0.0';
    const userAgent = (req.headers['user-agent'] as string) || 'unknown';
    const userId = (req as any).user?.userId || (req as any).user?.id || null;
    const tenantId = (req as any).user?.tenantId || null;
    const newData = req.body;
    
    // We need to wait for the response to finish to capture the ID of a newly created entity,
    // or just fire and forget if we only care about the attempt.
    // For now, we will log the *attempt* and the payload.
    
    res.on('finish', async () => {
      // If the request was successful, log it.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          // Attempt to extract entityId from params (for updates/deletes) or response body
          const entityId = (req.params.id as string) || null;
          
          await prisma.auditLog.create({
            data: {
              userId: userId || null,
              tenantId: tenantId || null,
              action,
              entity,
              entityId,
              newData: newData ? JSON.parse(JSON.stringify(newData)) : null,
              ipAddress,
              userAgent
            }
          });
        } catch (error) {
          console.error('[Audit Log Error]: Failed to write audit log', error);
        }
      }
    });

    next();
  };
};
