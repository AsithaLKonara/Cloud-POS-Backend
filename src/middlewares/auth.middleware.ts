import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, JWTPayload, generateFingerprint, generateAccessToken } from "../utils/jwt";
import { requestContext } from "../context/RequestContext";

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

function runWithContext(user: JWTPayload | undefined, next: NextFunction) {
  const isPlatformAdmin = user?.roles?.some(r => ['SUPER_PLATFORM_ADMIN', 'PLATFORM_ADMIN', 'SUPER_ADMIN', 'Super Admin'].includes(r)) || false;
  const isTenantAdmin = user?.roles?.some(r => ['ADMIN', 'SUPER_ADMIN', 'Super Admin', 'Admin'].includes(r)) || false;

  const currentStore = requestContext.getStore();
  const tenantId = user?.tenantId || currentStore?.tenantId || null;
  const tenantSlug = user?.tenantSlug || currentStore?.tenantSlug || null;

  requestContext.run({
    userId: user?.userId || null,
    role: isPlatformAdmin ? 'PLATFORM_ADMIN' : (isTenantAdmin ? 'ADMIN' : (user ? 'USER' : 'GUEST')),
    isAdmin: isTenantAdmin || isPlatformAdmin,
    isPlatformAdmin,
    tenantId,
    tenantSlug,
    branchId: (isTenantAdmin || isPlatformAdmin) ? null : (user?.branchId || null)
  }, () => {
    next();
  });
}

export function authenticateJWT(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  const token = 
    req.cookies?.laural_access_token || 
    (authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null);

  if (!token) {
    res.status(401).json({
      success: false,
      message: "Authentication token missing or invalid",
    });
    return;
  }

  try {
    const payload = verifyAccessToken(token);

    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    const ip = (forwarded ? forwarded.split(',')[0]?.trim() : undefined) || req.socket?.remoteAddress || 'unknown';
    const userAgent = (req.headers['user-agent'] as string) || 'unknown';
    const currentFingerprint = generateFingerprint(ip, userAgent);

    if (payload.fingerprint && payload.fingerprint !== currentFingerprint) {
      res.status(401).json({
        success: false,
        message: "Session context mismatch. Please log in again.",
      });
      return;
    }

    let finalPayload = payload;
    const isAdmin = payload.roles?.some(r => r === 'ADMIN' || r === 'SUPER_ADMIN') || false;

    // Admin Session Rotation every 15 minutes
    if (isAdmin && payload.iat && (Date.now() / 1000) - payload.iat > 15 * 60) {
      const newAccessToken = generateAccessToken({
        userId: payload.userId,
        email: payload.email,
        roles: payload.roles,
        permissions: payload.permissions,
        fingerprint: currentFingerprint
      });
      res.cookie("laural_access_token", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 1000,
      });
      res.setHeader('x-token-rotated', 'true');
      finalPayload = verifyAccessToken(newAccessToken);
    }

    req.user = finalPayload;
    runWithContext(finalPayload, next);
  } catch (error: any) {
    res.status(401).json({
      success: false,
      message: "Session expired or token invalid. Please log in again.",
    });
    return;
  }
}

export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = 
    req.cookies?.laural_access_token || 
    (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null);

  if (token) {
    try {
      const payload = verifyAccessToken(token);
      req.user = payload;
    } catch {
      // Ignore invalid token for optional auth
    }
  }

  runWithContext(req.user, next);
}

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const userRoles = req.user.roles || [];
    const isSuperAdmin = userRoles.some(
      (r) => r.toUpperCase() === "SUPER_ADMIN" || r.toLowerCase() === "super admin"
    );
    const isAdmin = isSuperAdmin || userRoles.some(r => r.toUpperCase() === "ADMIN");

    if (isAdmin) {
      const adminIps = process.env.ADMIN_ALLOWED_IPS;
      if (adminIps) {
        const forwarded = req.headers['x-forwarded-for'] as string | undefined;
        const ip = (forwarded ? forwarded.split(',')[0]?.trim() : undefined) || req.socket?.remoteAddress || 'unknown';
        const allowedIps = adminIps.split(',').map(i => i.trim());
        if (!allowedIps.includes(ip) && !allowedIps.includes('*')) {
          res.status(403).json({ success: false, message: "Access Denied: IP address not whitelisted for admin actions." });
          return;
        }
      }
    }

    if (isSuperAdmin) {
      next();
      return;
    }

    const hasAllowedRole = allowedRoles.some((allowed) =>
      userRoles.some((userRole) => userRole.toLowerCase() === allowed.toLowerCase())
    );

    if (!hasAllowedRole) {
      res.status(403).json({
        success: false,
        message: "Access Denied: You do not have permission to perform this action.",
      });
      return;
    }

    next();
  };
}

export function requirePermission(...requiredPermissions: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const userRoles = req.user.roles || [];
    const isSuperAdmin = userRoles.some(
      (r) => r.toUpperCase() === "SUPER_ADMIN" || r.toLowerCase() === "super admin"
    );
    const isAdmin = isSuperAdmin || userRoles.some(r => r.toUpperCase() === "ADMIN");

    if (isAdmin) {
      const adminIps = process.env.ADMIN_ALLOWED_IPS;
      if (adminIps) {
        const forwarded = req.headers['x-forwarded-for'] as string | undefined;
        const ip = (forwarded ? forwarded.split(',')[0]?.trim() : undefined) || req.socket?.remoteAddress || 'unknown';
        const allowedIps = adminIps.split(',').map(i => i.trim());
        if (!allowedIps.includes(ip) && !allowedIps.includes('*')) {
          res.status(403).json({ success: false, message: "Access Denied: IP address not whitelisted for admin actions." });
          return;
        }
      }
    }

    if (isSuperAdmin) {
      next();
      return;
    }

    const userPermissions = req.user.permissions || [];
    const hasPermission = requiredPermissions.some((reqPerm) =>
      userPermissions.includes(reqPerm)
    );

    if (!hasPermission) {
      res.status(403).json({
        success: false,
        message: "Access Denied: Required permission is missing.",
      });
      return;
    }

    next();
  };
}
