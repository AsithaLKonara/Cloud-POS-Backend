import { Request, Response } from 'express';
import { TenantService } from '../services/tenant.service';

export class TenantController {
  /**
   * Turnkey Provisioning: Creates new business tenant, initial branch, admin user, and seeds presets.
   */
  async provision(req: Request, res: Response): Promise<void> {
    try {
      const result = await TenantService.provisionTenant(req.body);
      res.status(201).json({
        success: true,
        message: `Successfully provisioned tenant "${result.tenant.name}"`,
        data: result,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to provision tenant.',
      });
    }
  }

  /**
   * Lists all tenants with optional filters.
   */
  async getAll(req: Request, res: Response): Promise<void> {
    try {
      const { search, status, businessType, subscriptionTier } = req.query;
      const tenants = await TenantService.getAllTenants({
        search: search as string | undefined,
        status: status as string | undefined,
        businessType: businessType as string | undefined,
        subscriptionTier: subscriptionTier as string | undefined,
      });
      res.status(200).json({
        success: true,
        data: tenants,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch tenants.',
      });
    }
  }

  /**
   * Retrieves high-level platform SaaS overview and KPIs.
   */
  async getPlatformOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = await TenantService.getPlatformOverview();
      res.status(200).json({
        success: true,
        data: overview,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to generate platform overview.',
      });
    }
  }

  /**
   * Retrieves single tenant details.
   */
  async getById(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const tenant = await TenantService.getTenantById(id);
      if (!tenant) {
        res.status(404).json({
          success: false,
          message: `Tenant with ID ${id} not found.`,
        });
        return;
      }
      res.status(200).json({
        success: true,
        data: tenant,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch tenant.',
      });
    }
  }

  /**
   * Retrieves resource usage vs quota limits.
   */
  async getUsage(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const usage = await TenantService.getTenantUsage(id);
      res.status(200).json({
        success: true,
        data: usage,
      });
    } catch (error: any) {
      res.status(404).json({
        success: false,
        message: error.message || 'Failed to fetch tenant usage.',
      });
    }
  }

  /**
   * Updates tenant status (ACTIVE, SUSPENDED, TRIAL, CANCELLED).
   */
  async updateStatus(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const { status, reason } = req.body;
      if (!status) {
        res.status(400).json({ success: false, message: 'Status is required.' });
        return;
      }
      const updated = await TenantService.updateTenantStatus(id, status, reason);
      res.status(200).json({
        success: true,
        message: `Tenant status updated to ${status}.`,
        data: updated,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to update tenant status.',
      });
    }
  }

  /**
   * Updates tenant subscription plan and quotas.
   */
  async updatePlan(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.id as string;
      const updated = await TenantService.updateTenantPlan(id, req.body);
      res.status(200).json({
        success: true,
        message: 'Tenant plan updated successfully.',
        data: updated,
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to update tenant plan.',
      });
    }
  }
}
