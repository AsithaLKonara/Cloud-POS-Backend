import { Request, Response } from 'express';
import { checkoutService } from '../services/checkout.service';
import { velocityService } from '../services/velocity.service';
import fs from 'fs';

const getIdentifier = (req: Request) => {
  const sessionId = req.headers['x-session-id'] as string;
  const customerId = req.headers['x-customer-id'] as string | undefined;
  return { sessionId, customerId };
};

export const calculateCheckout = async (req: Request, res: Response) => {
  try {
    const { cartId, shippingAddress } = req.body;
    if (!cartId) {
      return res.status(400).json({ error: 'cartId is required' });
    }

    const { customerId } = getIdentifier(req);
    const isGuest = !customerId;

    const totals = await checkoutService.calculateCheckout(cartId, shippingAddress, isGuest);
    res.json(totals);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const initiateCheckout = async (req: Request, res: Response) => {
  try {
    const { cartId, customer, shippingAddress, paymentMethod, deviceFingerprint } = req.body;
    const { redisClient } = require('../config/redis');
    
    if (!cartId) {
      return res.status(400).json({ error: 'cartId is required' });
    }
    if (!customer || !customer.phone) {
      return res.status(400).json({ error: 'customer object with phone number is required' });
    }
    if (!shippingAddress) {
      return res.status(400).json({ error: 'shippingAddress is required' });
    }

    // Force isGuest appropriately based on the authenticated context
    const { customerId } = getIdentifier(req);
    if (customerId) {
      customer.isGuest = false;
    } else {
      customer.isGuest = true;
    }

    // ── Order Velocity Anomaly Check ──────────────────────────────────
    const isRateLimitDisabled = process.env.ENABLE_RATE_LIMIT === 'false' || process.env.DISABLE_RATE_LIMIT === 'true';
    const forwardedFor = req.headers['x-forwarded-for'] as string | undefined;
    const ip = (forwardedFor ? forwardedFor.split(',')[0]?.trim() : undefined)
               || req.socket?.remoteAddress || 'unknown';

    if (!isRateLimitDisabled && customer?.phone) {
      const isBlocked = await velocityService.isBlocked(
        customer.phone, ip, deviceFingerprint
      );
      if (isBlocked) {
        return res.status(429).json({
          error: 'Unusual order activity detected. Please try again later or contact support.'
        });
      }
    }

    // ── Device Fingerprint Velocity Check ─────────────────────────────
    if (!isRateLimitDisabled && deviceFingerprint) {
      const fingerprintKey = `fingerprint:checkout:${deviceFingerprint}`;
      const attempts = await redisClient.incr(fingerprintKey);
      
      if (attempts === 1) {
        await redisClient.expire(fingerprintKey, 900); // 15 minutes window
      }
      
      if (attempts > 5) {
        console.warn(`[Bot Detected] Checkout spam from fingerprint: ${deviceFingerprint}`);
        return res.status(429).json({ error: 'Too many checkout attempts from this device. Please try again later.' });
      }
    }

    if (customer.isGuest && paymentMethod?.toLowerCase() !== 'koko' && paymentMethod?.toLowerCase() !== 'cod') {
      const { verificationToken } = req.body;
      if (!verificationToken) {
        return res.status(403).json({ error: 'Phone number verification is required for guest checkout' });
      }
      
      const tokenKey = `verified_phone:${customer.phone}`;
      const storedToken = await redisClient.get(tokenKey);
      
      if (!storedToken || storedToken !== verificationToken) {
        return res.status(403).json({ error: 'Invalid or expired verification token' });
      }
      
      // Consume the token so it can't be reused
      await redisClient.del(tokenKey);
    }
    
    // Inject fingerprint for fraud scoring
    if (deviceFingerprint) {
      customer.deviceFingerprint = deviceFingerprint;
    }

    const { pointsToRedeem } = req.body;
    const order = await checkoutService.initiateCheckout(cartId, customer, shippingAddress, paymentMethod, pointsToRedeem);

    // ── Record order velocity AFTER successful placement ──────────────
    if (customer?.phone) {
      await velocityService.checkAndRecord({
        phone:       customer.phone,
        ip,
        fingerprint: deviceFingerprint,
        orderAmount: order?.order?.total,
      });
    }

    res.status(201).json(order);
  } catch (error: any) {
    console.error("CHECKOUT 500 ERROR: ", error);
    try {
      fs.appendFileSync('checkout-error.log', new Date().toISOString() + ': ' + (error.stack || error.message) + '\n');
    } catch (fsError) {
      console.error("Failed to write to checkout-error.log:", fsError);
    }
    res.status(500).json({ error: error.message });
  }
};
