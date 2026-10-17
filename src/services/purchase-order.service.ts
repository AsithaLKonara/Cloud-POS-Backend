import prisma from '../config/prisma';
import { inventoryService } from './inventory.service';
import { logger } from '../utils/logger';

export interface CreatePOItemDTO {
  variantId: string;
  quantityOrdered: number;
  unitCost: number;
  batchNumber?: string;
  expiryDate?: Date | string;
}

export interface CreatePurchaseOrderDTO {
  supplierId: string;
  branchId: string;
  items: CreatePOItemDTO[];
  notes?: string;
  expectedDate?: Date | string;
}

export interface ReceivePOItemDTO {
  itemId: string;
  quantityReceived: number;
  batchNumber?: string;
  expiryDate?: Date | string;
}

export class PurchaseOrderService {
  static async getPurchaseOrders(branchId?: string, status?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (status && status !== 'ALL') where.status = status;

    return (prisma as any).purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: { select: { id: true, name: true, code: true, phone: true } },
        branch: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                price: true,
                costPrice: true,
                product: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  static async getPurchaseOrderById(id: string) {
    return (prisma as any).purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        branch: true,
        items: {
          include: {
            variant: {
              include: { product: true },
            },
          },
        },
      },
    });
  }

  static async createPurchaseOrder(data: CreatePurchaseOrderDTO) {
    const poNumber = `PO-${Date.now().toString().slice(-8)}`;
    const subtotal = data.items.reduce((sum, it) => sum + it.unitCost * it.quantityOrdered, 0);
    const tax = 0;
    const total = subtotal + tax;

    return (prisma as any).purchaseOrder.create({
      data: {
        poNumber,
        supplierId: data.supplierId,
        branchId: data.branchId,
        status: 'DRAFT',
        subtotal,
        tax,
        total,
        notes: data.notes,
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        items: {
          create: data.items.map(it => ({
            variantId: it.variantId,
            quantityOrdered: it.quantityOrdered,
            unitCost: it.unitCost,
            totalCost: it.unitCost * it.quantityOrdered,
            batchNumber: it.batchNumber,
            expiryDate: it.expiryDate ? new Date(it.expiryDate) : null,
          })),
        },
      },
      include: {
        items: true,
        supplier: true,
      },
    });
  }

  static async sendPurchaseOrder(id: string) {
    return (prisma as any).purchaseOrder.update({
      where: { id },
      data: { status: 'ORDERED' },
    });
  }

  static async receivePurchaseOrder(poId: string, receivedItems: ReceivePOItemDTO[]) {
    const po = await (prisma as any).purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });

    if (!po) {
      throw new Error(`Purchase order ${poId} not found`);
    }

    if (po.status === 'CANCELLED' || po.status === 'RECEIVED') {
      throw new Error(`Cannot receive a purchase order in status ${po.status}`);
    }

    const itemMap = new Map<string, any>(po.items.map((it: any) => [it.id, it]));

    for (const rec of receivedItems) {
      const item = itemMap.get(rec.itemId);
      if (!item) continue;
      if (rec.quantityReceived <= 0) continue;

      const newQtyReceived = item.quantityReceived + rec.quantityReceived;

      // 1. Update line item received quantity
      await (prisma as any).purchaseOrderItem.update({
        where: { id: item.id },
        data: {
          quantityReceived: newQtyReceived,
          batchNumber: rec.batchNumber || item.batchNumber,
          expiryDate: rec.expiryDate ? new Date(rec.expiryDate) : item.expiryDate,
        },
      });

      // 2. Inward receive stock to branch
      await inventoryService.adjustStock({
        variantId: item.variantId,
        branchId: po.branchId,
        type: 'RECEIVE',
        quantity: rec.quantityReceived,
        reason: `PO Inward: ${po.poNumber}`,
        reference: po.id,
      });

      // 3. Moving Weighted Average Cost Price recalculation
      const variant = await (prisma as any).productVariant.findUnique({
        where: { id: item.variantId },
      });

      if (variant) {
        const currentCost = variant.costPrice || 0;
        const currentQty = Math.max(0, variant.quantity - rec.quantityReceived);
        const addedQty = rec.quantityReceived;
        const incomingCost = item.unitCost;

        let newWeightedCost = incomingCost;
        if (currentQty + addedQty > 0) {
          newWeightedCost = ((currentQty * currentCost) + (addedQty * incomingCost)) / (currentQty + addedQty);
        }
        newWeightedCost = Math.round(newWeightedCost * 100) / 100;

        await (prisma as any).productVariant.update({
          where: { id: item.variantId },
          data: { costPrice: newWeightedCost },
        });
      }

      // 4. Batch record creation if batch number specified
      const batchNum = rec.batchNumber || item.batchNumber;
      if (batchNum) {
        const existingBatch = await (prisma as any).inventoryBatch.findFirst({
          where: {
            branchId: po.branchId,
            variantId: item.variantId,
            batchNumber: batchNum,
          },
        });

        if (existingBatch) {
          await (prisma as any).inventoryBatch.update({
            where: { id: existingBatch.id },
            data: {
              currentQuantity: { increment: rec.quantityReceived },
              status: 'ACTIVE',
            },
          });
        } else {
          await (prisma as any).inventoryBatch.create({
            data: {
              variantId: item.variantId,
              branchId: po.branchId,
              batchNumber: batchNum,
              expiryDate: rec.expiryDate ? new Date(rec.expiryDate) : item.expiryDate,
              initialQuantity: rec.quantityReceived,
              currentQuantity: rec.quantityReceived,
              costPrice: item.unitCost,
              status: 'ACTIVE',
            },
          });
        }
      }
    }

    // Check completion status
    const updatedPo = await (prisma as any).purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });

    const isFullyReceived = updatedPo.items.every((it: any) => it.quantityReceived >= it.quantityOrdered);
    const newStatus = isFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

    return (prisma as any).purchaseOrder.update({
      where: { id: poId },
      data: { status: newStatus },
      include: { items: true, supplier: true, branch: true },
    });
  }
}
