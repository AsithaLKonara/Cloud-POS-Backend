import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis';

/**
 * Factory to create Redis-backed rate limiters
 */
export const createRateLimiter = (endpointName: string, maxAttempts: number, windowInSeconds: number) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Try multiple ways to get the real IP if behind proxies
    let ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    // If behind a proxy, extract the first IP from X-Forwarded-For
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string') {
      ip = xForwardedFor.split(',')[0]?.trim() || ip;
    } else if (Array.isArray(xForwardedFor)) {
      ip = xForwardedFor[0]?.trim() || ip;
    }

    if (process.env.NODE_ENV !== 'production' && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) {
      return next();
    }

    const key = `ratelimit:${endpointName}:${ip}`;

    if (redisClient.status !== 'ready') {
      return next();
    }

    try {
      const current = await redisClient.incr(key);
      
      // If this is the first attempt, set expiry
      if (current === 1) {
        await redisClient.expire(key, windowInSeconds);
      }
      
      if (current > maxAttempts) {
        res.status(429).json({ 
          success: false,
          message: `Too many attempts. Please wait a moment and try again.` 
        });
        return;
      }
      
      next();
    } catch (error) {
      // Fail open: if Redis is down, we still want users to be able to access the API
      next();
    }
  };
};

export const loginRateLimiter = createRateLimiter("login", 5, 900); // 5 per 15 min
export const registerRateLimiter = createRateLimiter("register", 5, 900); // 5 per 15 min
export const checkoutRateLimiter = createRateLimiter("checkout", 10, 60); // 10 per 1 min
export const otpRateLimiter = createRateLimiter("otp", 3, 300); // 3 per 5 min
export const globalApiLimiter = createRateLimiter("global", 300, 60); // 300 per 1 min
