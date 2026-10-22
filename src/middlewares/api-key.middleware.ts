import { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../services/api-key.service';
import { requestContext } from '../context/RequestContext';

export interface HeadlessRequest extends Request {
  apiKey?: any;
}

/**
 * Middleware: Authenticates inbound headless API requests via Client ID and API Key.
 * Binds tenant context and validates origin and IP whitelists.
 */
export async function authenticateApiKey(
  req: HeadlessRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Extract credentials from headers
  const clientId = (req.headers['x-client-id'] as string) || (req.query.client_id as string);
  let rawSecret = (req.headers['x-api-key'] as string) || (req.query.api_key as string);

  if (!rawSecret && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && (parts[0] === 'ApiKey' || parts[0] === 'Bearer') && parts[1]) {
      rawSecret = parts[1];
    }
  }

  if (!clientId || !rawSecret) {
    res.status(401).json({
      success: false,
      message: 'Authentication failed. Please provide X-Client-Id and X-Api-Key headers.',
    });
    return;
  }

  try {
    const verifiedKey = await ApiKeyService.verifyApiKey(clientId, rawSecret);
    if (!verifiedKey) {
      res.status(401).json({
        success: false,
        message: 'Invalid, expired, or revoked API Key credentials.',
      });
      return;
    }

    // CORS Origin check
    if (verifiedKey.allowedOrigins && verifiedKey.allowedOrigins.length > 0) {
      const origin = req.headers.origin || req.headers.referer;
      if (origin) {
        const isAllowed = verifiedKey.allowedOrigins.some((allowed: string) =>
          origin.startsWith(allowed.trim().replace(/\/$/, ''))
        );
        if (!isAllowed) {
          res.status(403).json({
            success: false,
            message: `Origin [${origin}] is not permitted for this API Key.`,
          });
          return;
        }
      }
    }

    // IP Whitelist check
    if (verifiedKey.allowedIps && verifiedKey.allowedIps.length > 0) {
      const forwarded = req.headers['x-forwarded-for'] as string | undefined;
      const clientIp = (forwarded ? (forwarded.split(',')[0] || '').trim() : undefined) || req.socket.remoteAddress || '';
      const isIpAllowed = verifiedKey.allowedIps.some((allowed: string) => allowed.trim() === clientIp);
      if (!isIpAllowed) {
        res.status(403).json({
          success: false,
          message: `IP [${clientIp}] is not permitted for this API Key.`,
        });
        return;
      }
    }

    req.apiKey = verifiedKey;

    // Run in isolated asynchronous tenant request context
    requestContext.run(
      {
        tenantId: verifiedKey.tenantId,
        tenantSlug: verifiedKey.tenant?.slug || null,
        role: 'EXTERNAL_CLIENT',
        isAdmin: false,
        isPlatformAdmin: false,
        branchId: null,
      },
      () => {
        next();
      }
    );
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: `API Key verification error: ${err.message}`,
    });
  }
}
