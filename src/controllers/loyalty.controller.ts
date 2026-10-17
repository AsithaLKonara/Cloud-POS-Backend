import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { loyaltyService } from '../services/loyalty.service';

export const getMyLoyalty = async (req: Request, res: Response) => {
  try {
    // Assuming authMiddleware attaches userId to req.user
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Since our system relies on Customer table for the Storefront, find the Customer associated with this User
    // Our auth.service mirrors the user to Customer via email
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const customer = await prisma.customer.findFirst({ where: { email: user.email } });
    if (!customer) return res.status(404).json({ error: 'Customer profile not found' });

    const account = await loyaltyService.ensureLoyaltyAccount(customer.id);

    const transactions = await (prisma as any).loyaltyTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    const rules = await loyaltyService.getLoyaltyRules();
    
    // Calculate progress to next tier
    const sortedTiers = rules.tiers.sort((a: any, b: any) => a.minPoints - b.minPoints);
    let currentTierIndex = sortedTiers.findIndex((t: any) => t.name === account.tier);
    if (currentTierIndex === -1) currentTierIndex = 0;
    
    let nextTier = null;
    let pointsNeeded = 0;
    let progressPercentage = 100;
    
    if (currentTierIndex < sortedTiers.length - 1) {
      nextTier = sortedTiers[currentTierIndex + 1];
      const currentTierMin = sortedTiers[currentTierIndex].minPoints;
      const nextTierMin = nextTier.minPoints;
      
      pointsNeeded = nextTierMin - account.lifetimePoints;
      
      // Calculate progress between the two tiers
      const range = nextTierMin - currentTierMin;
      const progress = account.lifetimePoints - currentTierMin;
      progressPercentage = Math.min(100, Math.max(0, (progress / range) * 100));
    }

    res.json({
      account,
      transactions,
      tierProgress: {
        currentTier: account.tier,
        nextTier: nextTier ? nextTier.name : null,
        pointsNeeded,
        progressPercentage,
        nextTierMinPoints: nextTier ? nextTier.minPoints : null
      }
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to fetch loyalty profile' });
  }
};

export const getLoyaltyMembers = async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    
    const result = await loyaltyService.getMembers(search, page, limit);
    res.json(result);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to fetch loyalty members' });
  }
};

export const getLoyaltyKpis = async (req: Request, res: Response) => {
  try {
    const kpis = await loyaltyService.getKpis();
    res.json({ data: kpis });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to fetch loyalty KPIs' });
  }
};
