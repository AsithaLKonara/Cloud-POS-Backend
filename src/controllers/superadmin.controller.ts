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

  async updateTenantSettings(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const updated = await TenantService.updateTenant(tenantId, req.body);
      res.status(200).json({ success: true, message: 'Tenant settings updated successfully', data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update tenant settings' });
    }
  }

  async provisionTurnkeyTenant(req: Request, res: Response): Promise<void> {
    try {
      const b = req.body || {};
      const payload: any = {
        name: b.name || b.businessName,
        slug: b.slug,
        businessType: b.businessType,
        subscriptionTier: b.subscriptionTier,
        maxBranches: b.maxBranches,
        maxUsers: b.maxUsers,
        currency: b.currency,
        currencySymbol: b.currencySymbol,
        initialBranchName: b.initialBranchName,
        adminUser: b.adminUser || {
          email: b.adminEmail,
          password: b.adminPassword,
          name: b.adminFullName || b.adminName,
          phone: b.adminPhone,
        },
      };
      const result = await TenantService.provisionTenant(payload);
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

  async getMonthlyAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const analytics = await SuperAdminService.getMonthlyAnalytics();
      res.status(200).json({ success: true, data: analytics });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch monthly analytics' });
    }
  }

  async getRevenueBreakdown(req: Request, res: Response): Promise<void> {
    try {
      const breakdown = await SuperAdminService.getRevenueBreakdown();
      res.status(200).json({ success: true, data: breakdown });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch revenue breakdown' });
    }
  }

  async getTopOutlets(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 5;
      const outlets = await SuperAdminService.getTopOutlets(limit);
      res.status(200).json({ success: true, data: outlets });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch top outlets' });
    }
  }

  async updatePlanPrice(req: Request, res: Response): Promise<void> {
    try {
      const tier = req.params.tier as string;
      const monthlyLkr = parseInt(req.body.monthlyLkr, 10);
      if (isNaN(monthlyLkr) || monthlyLkr <= 0) {
        res.status(400).json({ success: false, message: 'Valid positive monthly price required' });
        return;
      }
      const updated = await SuperAdminService.updatePlanPrice(tier, monthlyLkr);
      res.status(200).json({ success: true, message: `Subscription tier ${tier} price updated to Rs. ${monthlyLkr}`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update plan pricing' });
    }
  }

  async generateInvoice(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId, billingCycle, amountLkr } = req.body;
      if (!tenantId) {
        res.status(400).json({ success: false, message: 'tenantId is required' });
        return;
      }
      const invoice = await SuperAdminService.generateInvoice(tenantId, billingCycle, amountLkr);
      res.status(201).json({ success: true, message: `Invoice ${invoice.invoiceNumber} generated`, data: invoice });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to generate invoice' });
    }
  }

  async updateInvoiceStatus(req: Request, res: Response): Promise<void> {
    try {
      const invoiceId = req.params.invoiceId as string;
      const { status } = req.body;
      const updated = await SuperAdminService.updateInvoiceStatus(invoiceId, status);
      res.status(200).json({ success: true, message: `Invoice status updated to ${status}`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update invoice status' });
    }
  }
}
