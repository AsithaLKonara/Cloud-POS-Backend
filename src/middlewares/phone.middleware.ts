import { Request, Response, NextFunction } from 'express';
import { normalizePhone, isValidPhone } from '../utils/phone';

export const phoneNormalizerMiddleware = (req: Request, res: Response, next: NextFunction): any => {
  // Exclude external webhooks from strict local phone normalization
  const excludedPaths = [
    '/api/v1/integrations/whatsapp/webhook',
    '/api/v1/payments/webhook',
    '/api/v1/inventory/shipping/webhook',
  ];
  if (excludedPaths.some(p => req.originalUrl.startsWith(p))) {
    return next();
  }

  const errors: string[] = [];
  
  // Recursively traverse and normalize any key containing 'phone'
  const normalizeDeep = (obj: any, path = '') => {
    if (!obj || typeof obj !== 'object') return;
    
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Exclude identifier keys like phoneNumberId, phoneId, phone_number_id, etc.
        const isIdentifier = key.toLowerCase().endsWith('id') || key.toLowerCase().endsWith('_id') || key.toLowerCase().includes('token');
        if (key.toLowerCase().includes('phone') && !isIdentifier && typeof obj[key] === 'string') {
          const normalized = normalizePhone(obj[key]);
          if (!isValidPhone(normalized)) {
            errors.push(`Invalid phone format for '${path}${key}'. Phone number must strictly follow the 0712345678 pattern (starting with 0 and exactly 10 digits).`);
          }
          obj[key] = normalized;
        } else if (typeof obj[key] === 'object') {
          normalizeDeep(obj[key], `${path}${key}.`);
        }
      }
    }
  };

  if (req.body) normalizeDeep(req.body);
  if (req.query) normalizeDeep(req.query);
  if (req.params) normalizeDeep(req.params);

  if (errors.length > 0) {
    return res.status(400).json({ 
      success: false,
      error: 'Validation Error',
      message: 'Invalid phone number format provided',
      details: errors 
    });
  }

  next();
};
