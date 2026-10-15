import { Request, Response } from 'express';
import { analyticsService } from '../services/analytics.service';
import prisma from '../config/prisma';

export const getBusinessOverview = async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'Today';
    const branch = (req.query.branch as string) || 'All';
    
    const overview = await analyticsService.getBusinessOverview(period, branch);
    res.json(overview);
  } catch (error) {
    console.error('Error fetching analytics overview:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
};

export const getExecutiveOverview = async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'This Month';
    const branchId = (req.query.branchId as string) || undefined;

    const data = await analyticsService.getExecutiveOverview(period, branchId);
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching executive overview:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch executive overview' });
  }
};

export const getBranchDashboard = async (req: Request, res: Response) => {
  try {
    let branchId = (req.query.branchId as string) || (req as any).user?.branchId;

    if (!branchId) {
      // Fallback to first active branch if superadmin without specific branchId
      const firstBranch = await prisma.branch.findFirst({
        where: { isActive: true },
        select: { id: true }
      });
      branchId = firstBranch?.id;
    }

    if (!branchId) {
      return res.status(404).json({ error: 'No active branch found' });
    }

    const data = await analyticsService.getBranchManagerDashboard(branchId);
    res.json(data);
  } catch (error: any) {
    console.error('Error fetching branch manager dashboard:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch branch dashboard' });
  }
};
