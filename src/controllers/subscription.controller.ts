import { Request, Response } from 'express';
import { SubscriptionService } from '../services/subscription.service';

export class SubscriptionController {
  async getPlans(req: Request, res: Response): Promise<void> {
    try {
      const plans = await SubscriptionService.getPlans();
      res.status(200).json({ success: true, data: plans });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch plans' });
    }
  }

  async updatePlan(req: Request, res: Response): Promise<void> {
    try {
      const planKey = req.params.planKey as string;
      const updated = await SubscriptionService.updatePlanPricing(planKey, req.body);
      res.status(200).json({ success: true, message: `Plan ${planKey} updated`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update plan' });
    }
  }

  async startTrial(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const result = await SubscriptionService.start14DayTrial(tenantId);
      res.status(200).json({ success: true, message: '14-Day Free Trial activated', data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to start trial' });
    }
  }

  async activateSubscription(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const result = await SubscriptionService.activateSubscription(tenantId, req.body);
      res.status(200).json({ success: true, message: 'Subscription activated', data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to activate subscription' });
    }
  }

  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const status = await SubscriptionService.getTenantSubscriptionStatus(tenantId);
      res.status(200).json({ success: true, data: status });
    } catch (err: any) {
      res.status(404).json({ success: false, message: err.message || 'Failed to fetch subscription status' });
    }
  }
}
