import { Router } from 'express';
import { calculateCheckout, initiateCheckout } from '../controllers/checkout.controller';
import { checkoutRateLimiter } from '../middlewares/rateLimiter.middleware';
import { checkHoneypot } from '../middlewares/honeypot.middleware';
import { verifyTurnstile } from '../middlewares/turnstile.middleware';
import prisma from '../config/prisma';

const router = Router();

router.post('/calculate', checkHoneypot, checkoutRateLimiter, calculateCheckout);
router.post('/initiate', checkHoneypot, verifyTurnstile, checkoutRateLimiter, initiateCheckout);
router.get('/loyalty/:phone', checkoutRateLimiter, async (req, res) => {
  const phone = req.params.phone as string;
  try {

    const customer = await prisma.customer.findFirst({ where: { phone } });
    if (!customer) {
      return res.json({ loyaltyPoints: 0 });
    }
    const loyaltyAccount = await prisma.loyaltyAccount.findUnique({ where: { customerId: customer.id } });
    res.json({ loyaltyPoints: loyaltyAccount?.points || 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch loyalty points' });
  }
});

export default router;
