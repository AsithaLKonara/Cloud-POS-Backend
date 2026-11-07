jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    tenant: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    branch: {
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    product: {
      count: jest.fn(),
    },
    productVariant: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    posSession: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    order: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    paymentTransaction: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      create: jest.fn(),
    },
    idempotencyKey: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    chartOfAccount: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    journalEntry: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    vendorBill: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    salesInvoice: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    purchaseOrder: {
      findUnique: jest.fn(),
    },
    billOfMaterials: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    inventoryItem: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 18 } }),
    },
    inventoryTransaction: {
      create: jest.fn(),
    },
    stocktakeSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    stocktakeItem: {
      update: jest.fn(),
    },
    posHeldCart: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    role: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ currentVal: 1001 }]),
  },
}));

import prisma from '../config/prisma';
import { extractSubdomainFromHost, tenantMiddleware } from '../middlewares/tenant.middleware';
import { SequenceService } from '../services/sequence.service';
import { HardwareService } from '../services/hardware.service';
import { posService } from '../services/pos.service';
import { GeneralLedgerService } from '../services/gl.service';
import { AccountsPayableService } from '../services/ap.service';
import { AccountsReceivableService } from '../services/ar.service';
import { BillOfMaterialsService } from '../services/bom.service';
import { StocktakingService } from '../services/stocktaking.service';
import { productService } from '../services/product.service';
import { requirePlanFeature } from '../middlewares/featureGuard.middleware';
import { enforceQuota } from '../middlewares/quota.middleware';
import bcrypt from 'bcryptjs';

const mockPrisma = prisma as any;

describe('SaaS ERP + POS Gap Audit Verification Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Subdomain Resolution & Multi-Tenancy Scoping', () => {
    it('extracts tenant subdomain from host header correctly', () => {
      expect(extractSubdomainFromHost('store-alpha.xonitspace.com')).toBe('store-alpha');
      expect(extractSubdomainFromHost('retail-mart.pos.lk:3000')).toBe('retail-mart');
      expect(extractSubdomainFromHost('store-beta.localhost:3000')).toBe('store-beta');
      expect(extractSubdomainFromHost('localhost:3000')).toBeNull();
      expect(extractSubdomainFromHost('www.xonitspace.com')).toBeNull();
      expect(extractSubdomainFromHost('192.168.1.100:8000')).toBeNull();
    });

    it('resolves tenant automatically via subdomain in tenantMiddleware', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-omega-id',
        slug: 'omega-store',
        status: 'ACTIVE',
      });

      const req: any = {
        headers: { host: 'omega-store.xonitspace.com' },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await tenantMiddleware(req, res, next);

      expect(req.tenantId).toBe('tenant-omega-id');
      expect(req.tenantSlug).toBe('omega-store');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('2. Atomic Gapless Order Sequence Generation', () => {
    it('generates sequential reference numbers per prefix and tenant', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ currentVal: 1045 }]);
      const seq1 = await SequenceService.getNextSequence('POS', 'tenant-1');
      expect(seq1).toBe('POS-1045');

      mockPrisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('Mock DB fallback'));
      const seq2 = await SequenceService.getNextSequence('QD', 'tenant-1');
      expect(seq2).toMatch(/^QD-\d+$/);
    });
  });

  describe('3. POS Intra-Shift Cash Controls & Till Denominations', () => {
    it('records Cash In (petty cash float) and appends to session audit', async () => {
      mockPrisma.posSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        status: 'OPEN',
        totalCashIn: 1000,
        cashMovements: [],
      });
      mockPrisma.posSession.update.mockImplementation(async ({ data }: any) => ({
        id: 'sess-1',
        ...data,
      }));

      const res = await posService.cashIn({
        sessionId: 'sess-1',
        amount: 5000,
        reason: 'Morning change float',
      });

      expect(res.totalCashIn).toBe(6000);
      expect((res.cashMovements as any)).toHaveLength(1);
      expect((res.cashMovements as any)[0].type).toBe('CASH_IN');
      expect((res.cashMovements as any)[0].amount).toBe(5000);
    });

    it('records Cash Drop (safe skim) and factors into closing expected cash', async () => {
      mockPrisma.posSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        status: 'OPEN',
        totalCashDrop: 0,
        cashMovements: [],
      });
      mockPrisma.posSession.update.mockImplementation(async ({ data }: any) => ({
        id: 'sess-1',
        ...data,
      }));

      const res = await posService.cashDrop({
        sessionId: 'sess-1',
        amount: 25000,
        reason: 'Safe drop excess cash',
      });

      expect(res.totalCashDrop).toBe(25000);
      expect((res.cashMovements as any)[0].type).toBe('CASH_DROP');
    });

    it('calculates closing variance using bill denomination breakdown', async () => {
      mockPrisma.posSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        status: 'OPEN',
        openingFloat: 5000,
        totalCashIn: 2000,
        totalCashDrop: 3000,
      });

      mockPrisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { total: 15000 } }) // cash
        .mockResolvedValueOnce({ _sum: { total: 5000 } })  // card
        .mockResolvedValueOnce({ _sum: { total: 0 } });     // credit

      mockPrisma.posSession.update.mockImplementation(async ({ data }: any) => data);

      // Expected: Opening 5000 + CashSales 15000 + CashIn 2000 - CashDrop 3000 = 19,000
      // Denominations: 5000 x 3 = 15,000; 1000 x 4 = 4,000 -> Total = 19,000 (0 variance)
      const closed = await posService.closeSession({
        sessionId: 'sess-1',
        denominations: {
          '5000': 3,
          '1000': 4,
        },
      });

      expect(closed.expectedClosing).toBe(19000);
      expect(closed.actualClosing).toBe(19000);
      expect(closed.variance).toBe(0);
      expect(closed.denominations).toEqual({ '5000': 3, '1000': 4 });
    });

    it('captures split-tender cash payments in session closing via payment transactions', async () => {
      mockPrisma.posSession.findUnique.mockResolvedValue({
        id: 'sess-split-1',
        status: 'OPEN',
        openingFloat: 5000,
        totalCashIn: 0,
        totalCashDrop: 0,
      });

      mockPrisma.order.aggregate
        .mockResolvedValueOnce({ _sum: { total: 0 } })
        .mockResolvedValueOnce({ _sum: { total: 0 } })
        .mockResolvedValueOnce({ _sum: { total: 0 } });

      mockPrisma.paymentTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 8500 } })
        .mockResolvedValueOnce({ _sum: { amount: 6500 } })
        .mockResolvedValueOnce({ _sum: { amount: 0 } });

      mockPrisma.posSession.update.mockImplementation(async ({ data }: any) => data);

      const closed = await posService.closeSession({
        sessionId: 'sess-split-1',
        actualClosing: 13500,
      });

      expect(closed.totalCashSales).toBe(8500);
      expect(closed.totalCardSales).toBe(6500);
      expect(closed.expectedClosing).toBe(13500);
      expect(closed.variance).toBe(0);
    });

    it('parks, recalls, and discards held carts during POS shift', async () => {
      mockPrisma.posSession.findUnique.mockResolvedValue({ id: 'sess-1', status: 'OPEN', tenantId: 'tenant-1' });
      mockPrisma.posHeldCart.create.mockImplementation(async ({ data }: any) => ({ id: 'held-1', ...data }));
      mockPrisma.posHeldCart.findMany.mockResolvedValue([
        { id: 'held-1', sessionId: 'sess-1', status: 'HELD', items: [{ variantId: 'v1', qty: 2 }] }
      ]);
      mockPrisma.posHeldCart.findUnique.mockResolvedValue({ id: 'held-1', status: 'HELD' });
      mockPrisma.posHeldCart.update.mockImplementation(async ({ data }: any) => ({ id: 'held-1', ...data }));

      // 1. Hold cart
      const held = await posService.holdCart({
        sessionId: 'sess-1',
        branchId: 'branch-1',
        reference: 'HOLD-001',
        customerName: 'Kamal Perera',
        items: [{ variantId: 'v1', qty: 2 }],
        subtotal: 5000,
      });
      expect(held.status).toBe('HELD');
      expect(held.reference).toBe('HOLD-001');

      // 2. Fetch held carts
      const list = await posService.getHeldCarts('sess-1');
      expect(list).toHaveLength(1);

      // 3. Recall cart
      const recalled = await posService.recallHeldCart('held-1');
      expect(recalled.status).toBe('RECALLED');

      // 4. Discard cart
      const discarded = await posService.discardHeldCart('held-1');
      expect(discarded.status).toBe('DISCARDED');
    });
  });

  describe('4. Manager PIN Approval & Hardware Barcode Parsing', () => {
    it('validates supervisor override PIN', async () => {
      const pinResult = await posService.verifyManagerPin({ pin: '9999' });
      expect(pinResult.authorized).toBe(true);
      expect(pinResult.managerName).toBe('Supervisor Admin');
    });

    it('verifies manager PIN using user posPin and rejects invalid PINs', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'user-mgr-1', name: 'Store Manager', password: 'hashedpassword', posPin: '5829' }
      ]);

      const validResult = await posService.verifyManagerPin({ pin: '5829', tenantId: 'tenant-1' });
      expect(validResult.authorized).toBe(true);
      expect(validResult.managerName).toBe('Store Manager');

      const invalidResult = await posService.verifyManagerPin({ pin: '0000', tenantId: 'tenant-1' });
      expect(invalidResult.authorized).toBe(false);
    });

    it('parses embedded weight & price from scale EAN-13 barcodes', () => {
      // 200012301450C -> Item 00123, 1450g = 1.45 kg
      const scaleWeight = HardwareService.parseEmbeddedScaleBarcode('2000123014508');
      expect(scaleWeight.isScaleBarcode).toBe(true);
      expect(scaleWeight.itemCode).toBe('00123');
      expect(scaleWeight.weightKg).toBe(1.45);

      // 220055502500C -> Item 00555, Price = Rs. 25.00
      const scalePrice = HardwareService.parseEmbeddedScaleBarcode('2200555025001');
      expect(scalePrice.isScaleBarcode).toBe(true);
      expect(scalePrice.itemCode).toBe('00555');
      expect(scalePrice.price).toBe(25);

      // Standard non-scale barcode
      const standard = HardwareService.parseEmbeddedScaleBarcode('4792011001234');
      expect(standard.isScaleBarcode).toBe(false);
    });

    it('integrates scale barcode parsing in product lookup and attaches scaleData', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue({
        id: 'var-produce-1',
        product: {
          id: 'prod-produce-1',
          name: 'Red Onions Bulk',
          variants: [
            { id: 'var-produce-1', sku: 'SKU-00123', price: 650 }
          ]
        }
      });

      const found: any = await productService.getProductBySku('2000123014508');
      expect(found).not.toBeNull();
      expect(found.scaleData).toBeDefined();
      expect(found.scaleData.weightKg).toBe(1.45);
      expect(found.scaleData.itemCode).toBe('00123');
    });
  });

  describe('5. General Ledger (GL) & Double-Entry Accounting', () => {
    it('rejects unbalanced journal entries with unequal debits and credits', async () => {
      await expect(
        GeneralLedgerService.postJournalEntry({
          description: 'Unbalanced entry test',
          lines: [
            { accountCode: '1010', debit: 1000, credit: 0 },
            { accountCode: '4000', debit: 0, credit: 950 }, // 50 discrepancy!
          ],
        })
      ).rejects.toThrow('Unbalanced Journal Entry');
    });

    it('posts balanced double-entry and calculates Trial Balance', async () => {
      mockPrisma.chartOfAccount.findFirst.mockImplementation(async ({ where }: any) => ({
        id: `acc-${where.code}`,
        code: where.code,
        name: `Account ${where.code}`,
        type: where.code.startsWith('1') ? 'ASSET' : 'REVENUE',
      }));

      mockPrisma.journalEntry.create.mockImplementation(async ({ data }: any) => ({
        id: 'je-1',
        ...data,
      }));

      const entry = await GeneralLedgerService.postJournalEntry({
        tenantId: 'tenant-1',
        description: 'POS Cash Sale Settlement',
        lines: [
          { accountCode: '1010', debit: 12500, credit: 0 },
          { accountCode: '4000', debit: 0, credit: 12500 },
        ],
      });

      expect(entry.status).toBe('POSTED');

      // Test Trial Balance calculation
      mockPrisma.journalEntry.findMany.mockResolvedValue([
        {
          lines: [
            { debit: 12500, credit: 0, account: { code: '1010', name: 'Cash', type: 'ASSET' } },
            { debit: 0, credit: 12500, account: { code: '4000', name: 'Sales Revenue', type: 'REVENUE' } },
          ],
        },
      ]);

      const tb = await GeneralLedgerService.getTrialBalance('tenant-1');
      expect(tb.isBalanced).toBe(true);
      expect(tb.totalDebit).toBe(12500);
      expect(tb.totalCredit).toBe(12500);
    });
  });

  describe('6. Accounts Payable (AP) & 3-Way PO Matching', () => {
    it('creates vendor bill and flags 3-way match status against goods received', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-101',
        subtotal: 50000,
        items: [
          { quantityReceived: 100, unitCost: 500 }, // Total received = 50,000
        ],
      });

      mockPrisma.vendorBill.create.mockImplementation(async ({ data }: any) => ({
        id: 'bill-1',
        ...data,
      }));

      const bill = await AccountsPayableService.createVendorBill({
        tenantId: 'tenant-1',
        supplierId: 'sup-1',
        purchaseOrderId: 'po-101',
        branchId: 'branch-1',
        subtotal: 50000,
        tax: 0,
        dueDate: '2026-12-01',
      });

      expect(bill.matchStatus).toBe('MATCHED');
      expect(bill.balanceDue).toBe(50000);
    });

    it('records vendor payment and updates balance due', async () => {
      mockPrisma.vendorBill.findUnique.mockResolvedValue({
        id: 'bill-1',
        total: 50000,
        amountPaid: 0,
        balanceDue: 50000,
        billNumber: 'BILL-1001',
      });

      mockPrisma.vendorBill.update.mockImplementation(async ({ data }: any) => ({
        id: 'bill-1',
        ...data,
      }));

      const updated = await AccountsPayableService.recordVendorPayment({
        billId: 'bill-1',
        amount: 20000,
        paymentMethod: 'BANK_TRANSFER',
      });

      expect(updated.amountPaid).toBe(20000);
      expect(updated.balanceDue).toBe(30000);
      expect(updated.status).toBe('PARTIALLY_PAID');
    });

    it('generates AP Aging report across aging buckets', async () => {
      const past35Days = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
      const future10Days = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

      mockPrisma.vendorBill.findMany.mockResolvedValue([
        { id: 'b1', balanceDue: 15000, dueDate: future10Days },
        { id: 'b2', balanceDue: 25000, dueDate: past35Days },
      ]);

      const aging = await AccountsPayableService.getApAgingReport('tenant-1');
      expect(aging.totalDue).toBe(40000);
      expect(aging.current).toBe(15000);
      expect(aging.days31_60).toBe(25000);
    });
  });

  describe('7. Accounts Receivable (AR) & Formal Commercial Invoicing', () => {
    it('creates commercial invoice and manages customer settlement', async () => {
      mockPrisma.salesInvoice.create.mockImplementation(async ({ data }: any) => ({
        id: 'inv-1',
        ...data,
      }));

      const invoice = await AccountsReceivableService.createSalesInvoice({
        tenantId: 'tenant-1',
        customerId: 'cust-1',
        branchId: 'branch-1',
        invoiceType: 'COMMERCIAL',
        subtotal: 80000,
        tax: 0,
        dueDate: '2026-12-15',
      });

      expect(invoice.status).toBe('ISSUED');
      expect(invoice.balanceDue).toBe(80000);

      mockPrisma.salesInvoice.findUnique.mockResolvedValue(invoice);
      mockPrisma.salesInvoice.update.mockImplementation(async ({ data }: any) => ({
        ...invoice,
        ...data,
      }));

      const settled = await AccountsReceivableService.recordCustomerPayment({
        invoiceId: 'inv-1',
        amount: 80000,
        paymentMethod: 'LANKA_QR',
      });

      expect(settled.status).toBe('PAID');
      expect(settled.balanceDue).toBe(0);
    });
  });

  describe('8. Manufacturing / BOM Recipe Deductions', () => {
    it('auto-deducts component raw materials upon finished good sale', async () => {
      mockPrisma.billOfMaterials.findUnique.mockResolvedValue({
        id: 'bom-burger',
        name: 'Deluxe Burger Kit',
        items: [
          { componentVariantId: 'raw-bun', quantity: 1 },
          { componentVariantId: 'raw-patty', quantity: 2 },
        ],
      });

      const deductResult = await BillOfMaterialsService.deductBomIngredients({
        parentVariantId: 'deluxe-burger-variant',
        quantitySold: 3,
        branchId: 'branch-kitchen',
        reference: 'ORD-5501',
      });

      expect(deductResult).toBeDefined();
      expect(deductResult?.name).toBe('Deluxe Burger Kit');
      expect(deductResult?.componentsDeducted).toEqual([
        { variantId: 'raw-bun', deducted: 3 },
        { variantId: 'raw-patty', deducted: 6 },
      ]);
      expect(mockPrisma.inventoryItem.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrisma.inventoryTransaction.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('9. Cycle Count & Physical Stocktaking Reconciliation', () => {
    it('starts stocktake, records counted variances, and reconciles inventory with GL adjustment', async () => {
      mockPrisma.inventoryItem.findMany.mockResolvedValue([
        { variantId: 'v-oil-4l', quantity: 20, variant: { costPrice: 4000 } },
      ]);

      mockPrisma.stocktakeSession.create.mockImplementation(async ({ data }: any) => ({
        id: 'st-sess-1',
        ...data,
        items: data.items.create.map((it: any, idx: number) => ({ id: `sti-${idx}`, ...it })),
      }));

      const session = await StocktakingService.startStocktake({
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        title: 'Monthly Oil Bay Audit',
      });

      expect(session.status).toBe('IN_PROGRESS');
      expect(session.items).toHaveLength(1);
      expect(session.items[0].systemQuantity).toBe(20);

      // Cashier counts 18 bottles (2 missing / shrinkage)
      mockPrisma.stocktakeSession.findUnique.mockResolvedValue({
        id: 'st-sess-1',
        status: 'IN_PROGRESS',
        branchId: 'branch-1',
        tenantId: 'tenant-1',
        title: 'Monthly Oil Bay Audit',
        items: [
          {
            id: 'sti-0',
            variantId: 'v-oil-4l',
            systemQuantity: 20,
            countedQuantity: 18,
            unitCost: 4000,
          },
        ],
      });

      mockPrisma.stocktakeSession.update.mockImplementation(async ({ data }: any) => ({
        id: 'st-sess-1',
        status: data.status,
      }));

      mockPrisma.inventoryItem.aggregate.mockResolvedValue({ _sum: { quantity: 18 } });

      const reconciled = await StocktakingService.reconcileStocktake('st-sess-1', 'Manager signoff: 2 broken in transit');
      expect(reconciled.status).toBe('RECONCILED');
      expect(mockPrisma.inventoryItem.updateMany).toHaveBeenCalledWith({
        where: { variantId: 'v-oil-4l', branchId: 'branch-1' },
        data: { quantity: 18 },
      });
      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'v-oil-4l' },
        data: { quantity: 18 },
      });
      expect(mockPrisma.inventoryTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'CYCLE_COUNT_RECONCILIATION',
            quantityChange: -2,
          }),
        })
      );
    });
  });

  describe('10. SaaS Feature-Flag & Quota Enforcement Guards', () => {
    it('blocks Starter plan from accessing Enterprise feature', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-starter-1',
        subscriptionTier: 'STARTER',
        status: 'ACTIVE',
      });

      const guard = requirePlanFeature('INTER_BRANCH_TRANSFER');
      const req: any = { tenantId: 'tenant-starter-1' };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await guard(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'FEATURE_NOT_PERMITTED' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('enforces branch creation quota', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-starter-1',
        maxBranches: 1,
        maxUsers: 2,
        subscriptionTier: 'STARTER',
      });
      mockPrisma.branch.count.mockResolvedValue(1); // Already reached 1/1

      const quotaGuard = enforceQuota('BRANCH');
      const req: any = { tenantId: 'tenant-starter-1' };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await quotaGuard(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'QUOTA_EXCEEDED' })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });
});

