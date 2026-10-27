import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getAdaptiveCookieOptions } from '../utils/cookie-helper';

/**
 * CSRF Double-Submit Cookie Middleware
 * 
 * Protects against Cross-Site Request Forgery by ensuring that state-changing
 * requests (POST, PUT, DELETE, PATCH) contain a valid CSRF token in the headers
 * that precisely matches the token stored in the user's HttpOnly cookie.
 */

const CSRF_COOKIE_NAME = 'laural_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

// Safe methods that do not modify state
const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

// Routes that expect external POSTs without CSRF tokens (e.g. webhooks & headless API & file upload bucket)
const excludedRoutes = [
  '/api/v1/payments/webhook',
  '/api/v1/inventory/shipping/webhook',
  '/api/v1/headless',
  '/api/v1/upload',
  '/upload',
];

export const csrfMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Check if the route is explicitly excluded from CSRF or authenticated via Headless API Keys
  if (
    excludedRoutes.some(route => req.originalUrl.startsWith(route)) ||
    (req.headers['x-api-key'] && req.headers['x-client-id'])
  ) {
    return next();
  }

  // 1. Ensure a CSRF cookie exists for this session
  let csrfCookie = req.cookies[CSRF_COOKIE_NAME];
  
  if (!csrfCookie) {
    csrfCookie = crypto.randomBytes(32).toString('hex');
    // IMPORTANT: httpOnly must be FALSE for the double-submit cookie pattern.
    // The frontend JS needs to READ this cookie to attach it as x-csrf-token header.
    // CSRF protection comes from the strict header match — NOT from sameSite strict alone.
    res.cookie(
      CSRF_COOKIE_NAME,
      csrfCookie,
      getAdaptiveCookieOptions(req, {
        httpOnly: false,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      })
    );
  }

  // 2. Attach the token to the request object so safe routes (like GET /csrf-token) can expose it to the frontend
  (req as any).csrfToken = csrfCookie;

  // 3. Skip validation for safe methods
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // 4. Validate state-changing methods
  const headerToken = req.headers[CSRF_HEADER_NAME];

  if (!headerToken || headerToken !== csrfCookie) {
    return res.status(403).json({
      success: false,
      error: 'CSRF token missing or invalid. Access denied.'
    });
  }

  next();
};
