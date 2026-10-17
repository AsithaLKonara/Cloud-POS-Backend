jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    supplier: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    purchaseOrder: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    purchaseOrderItem: {
      update: jest.fn(),
    },
    inventoryItem: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      aggregate: jest.fn(),
    },
    productVariant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    inventoryBatch: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    stockTransfer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    inventoryTransaction: {
      create: jest.fn(),
    },
  },
}));

import prisma from '../config/prisma';
import { SupplierService } from '../services/supplier.service';
import { PurchaseOrderService } from '../services/purchase-order.service';
import { StockTransferService } from '../services/stock-transfer.service';
import { BatchService } from '../services/batch.service';
import { inventoryService } from '../services/inventory.service';

const mockPrisma = prisma as any;

describe('Multi-Branch ERP & Inventory Flow (Task 4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SupplierService', () => {
    it('creates a supplier with auto-generated code', async () => {
      mockPrisma.supplier.count.mockResolvedValue(5);
      mockPrisma.supplier.create.mockImplementation(async ({ data }: any) => ({
        id: 'sup-1',
        ...data,
      }));

      const supplier = await SupplierService.createSupplier({
        name: 'Global Med & Pharma Supplies',
        contactName: 'John Davis',
        phone: '1234567890',
        paymentTerms: 'NET_30',
      });

      expect(supplier.name).toBe('Global Med & Pharma Supplies');
      expect(supplier.code).toBe('SUP-0006');
      expect(mockPrisma.supplier.create).toHaveBeenCalled();
    });
  });

  describe('PurchaseOrderService & Moving Average Cost', () => {
    it('creates a draft purchase order', async () => {
      mockPrisma.purchaseOrder.create.mockImplementation(async ({ data }: any) => ({
        id: 'po-1',
        ...data,
      }));

      const po = await PurchaseOrderService.createPurchaseOrder({
        supplierId: 'sup-1',
        branchId: 'branch-1',
        items: [
          { variantId: 'v-paracetamol', quantityOrdered: 100, unitCost: 2.5 },
          { variantId: 'v-amoxicillin', quantityOrdered: 50, unitCost: 8.0 },
        ],
      });

      expect(po.supplierId).toBe('sup-1');
      expect(po.status).toBe('DRAFT');
      expect(po.subtotal).toBe(100 * 2.5 + 50 * 8.0);
    });

    it('receives PO items, creates batch, increments stock, and recalculates moving weighted average cost', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValueOnce({
        id: 'po-1',
        poNumber: 'PO-882211',
        branchId: 'branch-1',
        status: 'ORDERED',
        items: [
          {
            id: 'poi-1',
            variantId: 'v-paracetamol',
            quantityOrdered: 20,
            quantityReceived: 0,
            unitCost: 20,
          },
        ],
      }).mockResolvedValueOnce({
        id: 'po-1',
        items: [{ id: 'poi-1', quantityOrdered: 20, quantityReceived: 20 }],
      });

      // Existing stock: 20 units @ cost $10
      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: 'v-paracetamol',
        costPrice: 10,
        quantity: 40, // 20 previous + 20 just received
        product: { trackInventory: true },
      });

      mockPrisma.purchaseOrderItem.update.mockResolvedValue({});
      mockPrisma.inventoryItem.upsert.mockResolvedValue({ id: 'inv-1', quantity: 20 });
      mockPrisma.inventoryItem.aggregate.mockResolvedValue({ _sum: { quantity: 40 } });
      mockPrisma.inventoryTransaction.create.mockResolvedValue({});
      mockPrisma.productVariant.update.mockResolvedValue({});
      mockPrisma.inventoryBatch.findFirst.mockResolvedValue(null);
      mockPrisma.inventoryBatch.create.mockResolvedValue({ id: 'batch-1' });
      mockPrisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1', status: 'RECEIVED' });

      // Receiving 20 units at $20. (20 * $10 + 20 * $20) / 40 = $15.00
      const result = await PurchaseOrderService.receivePurchaseOrder('po-1', [
        {
          itemId: 'poi-1',
          quantityReceived: 20,
          batchNumber: 'LOT-2026-X',
          expiryDate: new Date('2027-12-31'),
        },
      ]);

      expect(mockPrisma.purchaseOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'poi-1' },
        data: expect.objectContaining({
          quantityReceived: 20,
          batchNumber: 'LOT-2026-X',
        }),
      });

      // Check moving weighted average cost calculation
      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'v-paracetamol' },
        data: { costPrice: 15 },
      });

      // Check batch creation
      expect(mockPrisma.inventoryBatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          batchNumber: 'LOT-2026-X',
          initialQuantity: 20,
          currentQuantity: 20,
        }),
      });

      expect(result.status).toBe('RECEIVED');
    });
  });

  describe('StockTransferService', () => {
    it('rejects transfer if source and destination branches are identical', async () => {
      await expect(
        StockTransferService.createTransfer({
          fromBranchId: 'branch-1',
          toBranchId: 'branch-1',
          variantId: 'v-1',
          quantity: 5,
        })
      ).rejects.toThrow('Source and destination branches cannot be the same');
    });

    it('rejects transfer if origin branch lacks sufficient stock', async () => {
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({
        quantity: 2,
      });

      await expect(
        StockTransferService.createTransfer({
          fromBranchId: 'branch-1',
          toBranchId: 'branch-2',
          variantId: 'v-1',
          quantity: 10,
        })
      ).rejects.toThrow('Insufficient stock at source branch');
    });

    it('dispatches transfer into IN_TRANSIT and deducts origin stock', async () => {
      mockPrisma.stockTransfer.findUnique.mockResolvedValue({
        id: 'tr-1',
        variantId: 'v-1',
        fromBranchId: 'branch-1',
        toBranchId: 'branch-2',
        quantity: 5,
        status: 'REQUESTED',
      });

      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: 'v-1',
        costPrice: 50,
        product: { trackInventory: true },
      });
      mockPrisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({
        id: 'inv-1',
        quantity: 15,
        lowStockThreshold: 5,
      });
      mockPrisma.inventoryItem.aggregate.mockResolvedValue({ _sum: { quantity: 15 } });
      mockPrisma.productVariant.update.mockResolvedValue({});
      mockPrisma.inventoryTransaction.create.mockResolvedValue({});
      mockPrisma.stockTransfer.update.mockResolvedValue({ id: 'tr-1', status: 'IN_TRANSIT' });

      const dispatched = await StockTransferService.dispatchTransfer('tr-1');

      expect(dispatched.status).toBe('IN_TRANSIT');
      expect(mockPrisma.inventoryItem.updateMany).toHaveBeenCalledWith({
        where: { variantId: 'v-1', branchId: 'branch-1', quantity: { gte: 5 } },
        data: { quantity: { decrement: 5 } },
      });
    });

    it('receives in-transit transfer and increments destination branch stock', async () => {
      mockPrisma.stockTransfer.findUnique.mockResolvedValue({
        id: 'tr-1',
        variantId: 'v-1',
        fromBranchId: 'branch-1',
        toBranchId: 'branch-2',
        quantity: 5,
        status: 'IN_TRANSIT',
      });

      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: 'v-1',
        costPrice: 50,
        product: { trackInventory: true },
      });
      mockPrisma.inventoryItem.upsert.mockResolvedValue({ id: 'inv-2', quantity: 5 });
      mockPrisma.inventoryItem.aggregate.mockResolvedValue({ _sum: { quantity: 20 } });
      mockPrisma.productVariant.update.mockResolvedValue({});
      mockPrisma.inventoryTransaction.create.mockResolvedValue({});
      mockPrisma.stockTransfer.update.mockResolvedValue({ id: 'tr-1', status: 'RECEIVED' });

      const received = await StockTransferService.receiveTransfer('tr-1');

      expect(received.status).toBe('RECEIVED');
      expect(mockPrisma.inventoryItem.upsert).toHaveBeenCalledWith({
        where: { variantId_branchId: { variantId: 'v-1', branchId: 'branch-2' } },
        create: { variantId: 'v-1', branchId: 'branch-2', quantity: 5 },
        update: { quantity: { increment: 5 } },
      });
    });
  });

  describe('BatchService & FEFO Stock Depletion', () => {
    it('identifies expiring batches within given window', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      mockPrisma.inventoryBatch.findMany.mockResolvedValue([
        {
          id: 'b-1',
          batchNumber: 'LOT-EXP-1',
          currentQuantity: 12,
          expiryDate: tomorrow,
          variant: { sku: 'MED-SYRUP', product: { name: 'Cough Syrup 100ml' } },
          branch: { name: 'Main Pharmacy' },
        },
      ]);

      const expiring = await BatchService.getExpiringBatches(7);

      expect(expiring).toHaveLength(1);
      expect(expiring[0].batchNumber).toBe('LOT-EXP-1');
      expect(expiring[0].daysRemaining).toBeLessThanOrEqual(2);
      expect(expiring[0].isExpired).toBe(false);
    });

    it('depletes stock from batches in FEFO order (earliest expiry first)', async () => {
      const earlyDate = new Date('2026-11-01');
      const laterDate = new Date('2026-12-01');

      mockPrisma.inventoryBatch.findMany.mockResolvedValue([
        { id: 'b-early', batchNumber: 'LOT-EARLY', currentQuantity: 5, expiryDate: earlyDate },
        { id: 'b-late', batchNumber: 'LOT-LATE', currentQuantity: 10, expiryDate: laterDate },
      ]);

      mockPrisma.inventoryBatch.update.mockResolvedValue({});

      // Request deduction of 8 units: should deplete all 5 of early batch, and 3 from late batch
      const depleted = await BatchService.depleteFromBatches('v-syrup', 'branch-1', 8);

      expect(depleted).toHaveLength(2);
      expect(depleted[0]).toEqual({ batchId: 'b-early', batchNumber: 'LOT-EARLY', deducted: 5 });
      expect(depleted[1]).toEqual({ batchId: 'b-late', batchNumber: 'LOT-LATE', deducted: 3 });

      expect(mockPrisma.inventoryBatch.update).toHaveBeenCalledWith({
        where: { id: 'b-early' },
        data: { currentQuantity: 0, status: 'DEPLETED' },
      });
      expect(mockPrisma.inventoryBatch.update).toHaveBeenCalledWith({
        where: { id: 'b-late' },
        data: { currentQuantity: 7, status: 'ACTIVE' },
      });
    });
  });
});
