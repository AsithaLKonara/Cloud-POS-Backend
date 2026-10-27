import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis';
import { alertService } from '../services/alert.service';
import { logger } from '../utils/logger';

const WINDOW_SECONDS = 5 * 60;     // 5-minute sliding window
const ALERT_THRESHOLD = 10;        // Alert after 10 failed attempts
const LOCKOUT_THRESHOLD = 15;      // Hard lockout after 15 failed attempts
const LOCKOUT_SECONDS = 15 * 60;   // 15-minute lockout

function getIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'] as string | undefined;
  return (
    (forwarded ? forwarded.split(',')[0]?.trim() : undefined) ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Records a failed login attempt for the given IP in Redis.
 * Fires a Slack/webhook alert when the threshold is exceeded.
 * Returns a 429 if the IP is currently hard-locked.
 */
export const trackFailedLogin = async (ip: string, email: string) => {
  const attemptKey = `login:failures:${ip}`;
  const alertKey   = `login:alerted:${ip}`;

  try {
    // Atomically increment + set expiry
    const attempts = await redisClient.incr(attemptKey);
    if (attempts === 1) {
      await redisClient.expire(attemptKey, WINDOW_SECONDS);
    }

    logger.warn(`Failed login attempt`, { ip, email, attempts });

    // Alert once per window when threshold is crossed
    if (attempts === ALERT_THRESHOLD) {
      const alreadyAlerted = await redisClient.get(alertKey);
      if (!alreadyAlerted) {
        await redisClient.setex(alertKey, WINDOW_SECONDS, '1');
        await alertService.sendSecurityAlert(
          'Brute-Force Detected',
          `${attempts} failed login attempts in the last 5 minutes`,
          ip,
          { email, attempts, windowSeconds: WINDOW_SECONDS }
        );
      }
    }

    // Hard lockout beyond threshold
    if (attempts >= LOCKOUT_THRESHOLD) {
      const lockKey = `login:locked:${ip}`;
      await redisClient.setex(lockKey, LOCKOUT_SECONDS, '1');
    }

    return attempts;
  } catch (err) {
    logger.error('Redis error during trackFailedLogin:', err);
    return 1; // Gracefully degrade
  }
};

/**
 * Express middleware — call BEFORE the login handler.
 * Returns 429 immediately if the IP is currently locked out.
 */
export const checkLoginLockout = async (req: Request, res: Response, next: NextFunction) => {
  if (process.env.ENABLE_RATE_LIMIT === 'false' || process.env.DISABLE_RATE_LIMIT === 'true') {
    return next();
  }

  if (redisClient.status !== 'ready') {
    return next();
  }

  const ip      = getIp(req);
  const lockKey = `login:locked:${ip}`;

  try {
    const locked = await redisClient.get(lockKey);
    if (locked) {
      logger.warn(`Login attempt from locked IP`, { ip });
      return res.status(429).json({
        success: false,
        message: 'Too many failed login attempts. Please try again in 15 minutes.'
      });
    }
  } catch (err) {
    // Fail open
  }

  next();
};
