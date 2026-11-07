import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { GeneralLedgerService } from '../services/gl.service';
import { AccountsPayableService } from '../services/ap.service';
import { AccountsReceivableService } from '../services/ar.service';
import { BillOfMaterialsService } from '../services/bom.service';
import { StocktakingService } from '../services/stocktaking.service';

function getTenantId(req: Request): string | undefined {
  return (req as any).tenantId || (req as any).user?.tenantId;
}

// ----------------- General Ledger (GL) -----------------
export const initChartOfAccounts = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant context required' });
    await GeneralLedgerService.initChartOfAccounts(tenantId);
    res.json({ success: true, message: 'Chart of accounts initialized' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const getChartOfAccounts = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const accounts = await (prisma as any).chartOfAccount.findMany({
      where: tenantId ? { OR: [{ tenantId }, { isSystem: true, tenantId: null }] } : {},
      orderBy: { code: 'asc' }
    });
    res.json(accounts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const postJournalEntry = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const entry = await GeneralLedgerService.postJournalEntry({
      tenantId,
      ...req.body
    });
    res.status(201).json(entry);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const getTrialBalance = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const tb = await GeneralLedgerService.getTrialBalance(tenantId);
    res.json(tb);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getBalanceSheet = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const bs = await GeneralLedgerService.getBalanceSheet(tenantId);
    res.json(bs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ----------------- Accounts Payable (AP) -----------------
export const createVendorBill = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const bill = await AccountsPayableService.createVendorBill({
      tenantId,
      ...req.body
    });
    res.status(201).json(bill);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const recordVendorPayment = async (req: Request, res: Response) => {
  try {
    const payment = await AccountsPayableService.recordVendorPayment(req.body);
    res.json(payment);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const getApAgingReport = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const report = await AccountsPayableService.getApAgingReport(tenantId);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getVendorBills = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const bills = await (prisma as any).vendorBill.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: 'desc' }
    });
    res.json(bills);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ----------------- Accounts Receivable (AR) -----------------
export const createSalesInvoice = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const invoice = await AccountsReceivableService.createSalesInvoice({
      tenantId,
      ...req.body
    });
    res.status(201).json(invoice);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const recordCustomerPayment = async (req: Request, res: Response) => {
  try {
    const payment = await AccountsReceivableService.recordCustomerPayment(req.body);
    res.json(payment);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const getArAgingReport = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const report = await AccountsReceivableService.getArAgingReport(tenantId);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getSalesInvoices = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const invoices = await (prisma as any).salesInvoice.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: 'desc' }
    });
    res.json(invoices);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ----------------- Bill of Materials (BOM) -----------------
export const upsertBom = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const bom = await BillOfMaterialsService.upsertBom({
      tenantId,
      ...req.body
    });
    res.status(201).json(bom);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const getBomForVariant = async (req: Request, res: Response) => {
  try {
    const variantId = String(req.params.variantId);
    const bom = await BillOfMaterialsService.getBomForVariant(variantId);
    if (!bom) return res.status(404).json({ error: 'BOM not found' });
    res.json(bom);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

// ----------------- Stocktaking / Cycle Counts -----------------
export const startStocktake = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const user = (req as any).user;
    const session = await StocktakingService.startStocktake({
      tenantId,
      createdById: user?.id,
      ...req.body
    });
    res.status(201).json(session);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const recordStocktakeCounts = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { counts } = req.body;
    const session = await StocktakingService.recordCounts(id, counts);
    res.json(session);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const reconcileStocktake = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { managerNotes } = req.body;
    const session = await StocktakingService.reconcileStocktake(id, managerNotes || 'Reconciliation approved');
    res.json(session);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const getStocktakeSessions = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const sessions = await (prisma as any).stocktakeSession.findMany({
      where: tenantId ? { tenantId } : {},
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(sessions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getStocktakeSession = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const session = await (prisma as any).stocktakeSession.findUnique({
      where: { id },
      include: { items: true }
    });
    if (!session) return res.status(404).json({ error: 'Stocktake session not found' });
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
