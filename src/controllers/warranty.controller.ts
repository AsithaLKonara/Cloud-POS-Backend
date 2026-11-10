import { Request, Response } from 'express';
import { WarrantyService } from '../services/warranty.service';
import { requestContext } from '../context/RequestContext';

export class WarrantyController {
  static async checkStatus(req: Request, res: Response): Promise<void> {
    try {
      const ctx = requestContext.getStore();
      const tenantId = (req.query.tenantId as string) || ctx?.tenantId || (req as any).user?.tenantId;
      const { serialNumber, imei, orderNumber, phone } = req.query;

      const result = await WarrantyService.checkWarrantyStatus(tenantId, {
        serialNumber: serialNumber as string,
        imei: imei as string,
        orderNumber: orderNumber as string,
        phone: phone as string,
      });

      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to check warranty status' });
    }
  }

  static async getKPIs(req: Request, res: Response): Promise<void> {
    try {
      const ctx = requestContext.getStore();
      const tenantId = (req.query.tenantId as string) || ctx?.tenantId || (req as any).user?.tenantId;
      const kpis = await WarrantyService.getWarrantyKPIs(tenantId);
      res.status(200).json({ success: true, data: kpis });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch warranty KPIs' });
    }
  }

  static async registerSerial(req: Request, res: Response): Promise<void> {
    try {
      const ctx = requestContext.getStore();
      const tenantId = ctx?.tenantId || (req as any).user?.tenantId;
      const serial = await WarrantyService.registerSerial(tenantId, req.body);
      res.status(201).json({ success: true, message: 'Serial number registered', data: serial });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to register serial' });
    }
  }

  static async bulkRegisterSerials(req: Request, res: Response): Promise<void> {
    try {
      const ctx = requestContext.getStore();
      const tenantId = ctx?.tenantId || (req as any).user?.tenantId;
      const { variantId, serialNumbers, branchId } = req.body;
      const result = await WarrantyService.bulkRegisterSerials(tenantId, variantId, serialNumbers, branchId);
      res.status(201).json({ success: true, data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to bulk register serials' });
    }
  }

  static async getSerials(req: Request, res: Response): Promise<void> {
    try {
      const ctx = requestContext.getStore();
      const tenantId = ctx?.tenantId || (req as any).user?.tenantId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = req.query.search as string;
      const status = req.query.status as string;
      const branchId = req.query.branchId as string;
      const variantId = req.query.variantId as string;

      const data = await WarrantyService.getSerials(tenantId, {
        page,
        limit,
        search,
        status,
        branchId,
        variantId,
      });

      res.status(200).json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch serials' });
    }
  }

  static async createClaim(req: Request, res: Response): Promise<void> {
    try {
      const ctx = requestContext.getStore();
      const tenantId = (req.body.tenantId as string) || ctx?.tenantId || (req as any).user?.tenantId;
      const claim = await WarrantyService.createClaim(tenantId, req.body);
      res.status(201).json({ success: true, message: 'Warranty claim ticket opened', data: claim });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to create warranty claim' });
    }
  }

  static async getClaims(req: Request, res: Response): Promise<void> {
    try {
      const ctx = requestContext.getStore();
      const tenantId = ctx?.tenantId || (req as any).user?.tenantId;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = req.query.search as string;
      const status = req.query.status as string;
      const branchId = req.query.branchId as string;

      const data = await WarrantyService.getClaims(tenantId, {
        page,
        limit,
        search,
        status,
        branchId,
      });

      res.status(200).json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch claims' });
    }
  }

  static async getClaimById(req: Request, res: Response): Promise<void> {
    try {
      const ctx = requestContext.getStore();
      const tenantId = ctx?.tenantId || (req as any).user?.tenantId;
      const claimId = req.params.claimId as string;
      if (!tenantId || !claimId) {
        res.status(400).json({ success: false, message: 'tenantId and claimId are required' });
        return;
      }
      const claim = await WarrantyService.getClaimById(tenantId, claimId);
      res.status(200).json({ success: true, data: claim });
    } catch (err: any) {
      res.status(404).json({ success: false, message: err.message || 'Claim not found' });
    }
  }

  static async updateClaimStatus(req: Request, res: Response): Promise<void> {
    try {
      const ctx = requestContext.getStore();
      const tenantId = ctx?.tenantId || (req as any).user?.tenantId;
      const user = (req as any).user;
      const claimId = req.params.claimId as string;

      if (!tenantId || !claimId) {
        res.status(400).json({ success: false, message: 'tenantId and claimId are required' });
        return;
      }

      const updated = await WarrantyService.updateClaimStatus(tenantId, claimId, {
        ...req.body,
        performedBy: user?.name || user?.email || req.body.performedBy || 'Staff Member',
      });

      res.status(200).json({ success: true, message: 'Claim updated successfully', data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update claim' });
    }
  }
}
