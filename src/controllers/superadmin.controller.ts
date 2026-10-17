import { Request, Response } from 'express';
import { SuperAdminService } from '../services/superadmin.service';
import { TenantService } from '../services/tenant.service';

export class SuperAdminController {
  async getKPIs(req: Request, res: Response): Promise<void> {
    try {
      const kpis = await SuperAdminService.getPlatformKPIs();
      res.status(200).json({ success: true, data: kpis });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch platform KPIs' });
    }
  }

  async getFinancials(req: Request, res: Response): Promise<void> {
    try {
      const financials = await SuperAdminService.getPlatformFinancials();
      res.status(200).json({ success: true, data: financials });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch platform financials' });
    }
  }

  async addExpense(req: Request, res: Response): Promise<void> {
    try {
      const expense = await SuperAdminService.addPlatformExpense(req.body);
      res.status(201).json({ success: true, message: 'Platform expense recorded', data: expense });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to record expense' });
    }
  }

  async getTenants(req: Request, res: Response): Promise<void> {
    try {
      const { search, status, businessType } = req.query;
      const tenants = await SuperAdminService.getTenants({
        search: search as string,
        status: status as string,
        businessType: businessType as string,
      });
      res.status(200).json({ success: true, data: tenants });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch tenants' });
    }
  }

  async updateTenantStatus(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const { status } = req.body;
      const updated = await SuperAdminService.updateTenantStatus(tenantId, status);
      res.status(200).json({ success: true, message: `Tenant status updated to ${status}`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update tenant status' });
    }
  }

  async extendTrial(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const days = parseInt(req.body.days, 10) || 14;
      const updated = await SuperAdminService.extendTrial(tenantId, days);
      res.status(200).json({ success: true, message: `Trial extended by ${days} days`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to extend trial' });
    }
  }

  async provisionTurnkeyTenant(req: Request, res: Response): Promise<void> {
    try {
      const result = await TenantService.provisionTenant(req.body);
      res.status(201).json({ success: true, message: 'Turnkey tenant provisioned successfully', data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Tenant provisioning failed' });
    }
  }

  async getCluster(req: Request, res: Response): Promise<void> {
    try {
      const telemetry = await SuperAdminService.getClusterTelemetry();
      res.status(200).json({ success: true, data: telemetry });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch cluster telemetry' });
    }
  }
}
