import { Response, NextFunction } from 'express';
import { HeadlessRequest } from './api-key.middleware';

/**
 * Middleware: Enforces fine-grained API scopes on headless routes.
 * e.g. requireScope('catalog:read'), requireScope(['orders:create', 'orders:write'])
 */
export function requireScope(...scopes: (string | string[])[]) {
  const flattened = scopes.flat();
  return (req: HeadlessRequest, res: Response, next: NextFunction): void => {
    const apiKey = req.apiKey;
    if (!apiKey) {
      res.status(401).json({
        success: false,
        message: 'Unauthenticated API Key request.',
      });
      return;
    }

    const grantedScopes: string[] = apiKey.scopes || [];

    // Master wildcard permissions
    if (grantedScopes.includes('*') || grantedScopes.includes('admin:all')) {
      next();
      return;
    }

    const hasPermission = flattened.some((scope) => grantedScopes.includes(scope));

    if (!hasPermission) {
      res.status(403).json({
        success: false,
        message: `Forbidden: Missing required API scope [${flattened.join(' or ')}]. Your key possesses: [${grantedScopes.join(', ')}].`,
      });
      return;
    }

    next();
  };
}
