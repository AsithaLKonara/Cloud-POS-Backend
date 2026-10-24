import { Request, CookieOptions } from "express";

/**
 * Determines whether the current incoming request is over HTTPS.
 * Checks native req.secure and reverse proxy headers (X-Forwarded-Proto, CF-Visitor).
 */
export const isSecureRequest = (req: Request): boolean => {
  if (req.secure) return true;
  const proto = req.headers["x-forwarded-proto"];
  if (typeof proto === "string" && proto.toLowerCase().includes("https")) {
    return true;
  }
  const cfVisitor = req.headers["cf-visitor"];
  if (typeof cfVisitor === "string" && cfVisitor.includes("https")) {
    return true;
  }
  return false;
};

/**
 * Returns cookie options that adapt cleanly to:
 * - Localhost development (HTTP)
 * - VPS Direct IP access (HTTP during staging/testing)
 * - Production Domain with SSL (HTTPS via Cloudflare / Nginx / Certbot)
 * 
 * Prevents the critical issue where browsers reject cookies because secure: true is sent over HTTP.
 */
export const getAdaptiveCookieOptions = (
  req: Request,
  options: Partial<CookieOptions> = {}
): CookieOptions => {
  const isHttps = isSecureRequest(req);

  return {
    httpOnly: options.httpOnly !== undefined ? options.httpOnly : true,
    // Only set secure: true when HTTPS is actively detected
    secure: isHttps,
    // sameSite: 'none' requires secure: true in all modern browsers; fallback to 'lax' on HTTP
    sameSite: isHttps ? (options.sameSite || "none") : "lax",
    path: options.path || "/",
    ...options,
  };
};
