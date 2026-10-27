import { Request, Response, NextFunction } from 'express';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Cloudflare test secrets that always pass/fail — safe for dev/CI
// https://developers.cloudflare.com/turnstile/reference/testing/
const TEST_ALWAYS_PASS_SECRET = '1x0000000000000000000000000000000AA';

export const verifyTurnstile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = process.env.TURNSTILE_SECRET_KEY;

    // Skip verification in development, or if CAPTCHA is disabled, or when using test keys
    if (
      process.env.ENABLE_CAPTCHA === 'false' ||
      !secret ||
      secret === 'disabled' ||
      secret === TEST_ALWAYS_PASS_SECRET ||
      process.env.NODE_ENV !== 'production'
    ) {
      return next();
    }

    const token = req.body.turnstileToken;
    console.log(`[Turnstile] Received token of length: ${token ? token.length : 0} for IP ${req.ip}`);

    if (!token) {
      return res.status(403).json({ 
        success: false,
        error: 'CAPTCHA verification is required.' 
      });
    }

    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token);
    if (req.ip) formData.append('remoteip', req.ip);

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (data.success) {
      return next();
    } else {
      console.warn(`[Turnstile] Verification failed from IP ${req.ip}:`, data['error-codes']);
      return res.status(403).json({ 
        success: false,
        error: 'CAPTCHA verification failed. Please refresh and try again.' 
      });
    }
  } catch (error) {
    console.error('[Turnstile] Error during verification:', error);
    // Fail open on network errors (Cloudflare outage) — log and proceed
    console.error('[Turnstile] Failing open due to network error — monitor for abuse');
    return next();
  }
};
