import { Request, Response } from 'express';
import { inventoryService } from '../services/inventory.service';
import { FardarService } from '../services/fardar.service';
import prisma from '../config/prisma';

// GET /api/inventory/branches
export const getBranches = async (req: Request, res: Response) => {
  try {
    const branches = await inventoryService.getBranches();
    res.json(branches);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/inventory/branches
export const createBranch = async (req: Request, res: Response) => {
  try {
    const branch = await inventoryService.createBranch(req.body);
    res.status(201).json(branch);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
};

// PUT /api/inventory/branches/:id
export const updateBranch = async (req: Request, res: Response) => {
  try {
    const branch = await inventoryService.updateBranch(req.params.id as string, req.body);
    res.json(branch);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
};

// DELETE /api/inventory/branches/:id
export const deleteBranch = async (req: Request, res: Response) => {
  try {
    await inventoryService.deleteBranch(req.params.id as string);
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
};

// GET /api/inventory
export const getInventory = async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const branchId = req.query.branchId as string | undefined;
    const status = req.query.status as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = await inventoryService.getInventory(search, branchId, status, page, limit);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /api/inventory/stats
export const getStats = async (req: Request, res: Response) => {
  try {
    const branchId = req.query.branchId as string | undefined;
    const stats = await inventoryService.getStats(branchId);
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /api/inventory/transactions
export const getTransactions = async (req: Request, res: Response) => {
  try {
    const branchId = req.query.branchId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = await inventoryService.getTransactions(branchId, page, limit);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/inventory/adjust
export const adjustStock = async (req: Request, res: Response) => {
  try {
    const { variantId, branchId, type, quantity, reason, reference } = req.body;
    if (!variantId || !branchId || !type || !quantity) {
      return res.status(400).json({ error: 'variantId, branchId, type and quantity are required' });
    }
    if (!['RECEIVE', 'DEDUCT'].includes(type)) {
      return res.status(400).json({ error: 'type must be RECEIVE or DEDUCT' });
    }
    const result = await inventoryService.adjustStock({ variantId, branchId, type, quantity: Number(quantity), reason, reference });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /api/inventory/transfers
export const getTransfers = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const branchId = req.query.branchId as string | undefined;
    const result = await inventoryService.getTransfers(branchId, page, limit);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/inventory/transfers
export const createTransfer = async (req: Request, res: Response) => {
  try {
    const { variantId, fromBranchId, toBranchId, quantity, requestedBy, notes } = req.body;
    if (!variantId || !fromBranchId || !toBranchId || !quantity) {
      return res.status(400).json({ error: 'variantId, fromBranchId, toBranchId, and quantity are required' });
    }
    if (fromBranchId === toBranchId) {
      return res.status(400).json({ error: 'fromBranchId and toBranchId must be different' });
    }
    const transfer = await inventoryService.createTransfer({ variantId, fromBranchId, toBranchId, quantity: Number(quantity), requestedBy, notes });
    res.status(201).json(transfer);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// PUT /api/inventory/transfers/:id/status
export const updateTransferStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;
    const validStatuses = ['PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'CANCELLED'];
    if (!status || !validStatuses.includes(status as string)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }
    const result = await inventoryService.updateTransferStatus(id, status);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/inventory/shipping/create
export const createShipment = async (req: Request, res: Response) => {
  try {
    const shipment = await FardarService.createShipment(req.body);
    res.status(201).json(shipment);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /api/inventory/shipping/:trackingNumber
export const trackShipment = async (req: Request, res: Response) => {
  try {
    const status = await FardarService.trackShipment(req.params.trackingNumber as string);
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/inventory/reserve
export const reserveStock = async (req: Request, res: Response) => {
  try {
    const result = await inventoryService.reserveStock(req.body);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
};

// POST /api/inventory/release
export const releaseStock = async (req: Request, res: Response) => {
  try {
    const result = await inventoryService.releaseStock(req.body);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
};

