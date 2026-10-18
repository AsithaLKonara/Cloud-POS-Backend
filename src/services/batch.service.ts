import prisma from '../config/prisma';
import { logger } from '../utils/logger';

export class BatchService {
  /**
   * Retrieves active batches sorted by FEFO (First-Expired, First-Out).
   */
  static async getBatches(variantId?: string, branchId?: string) {
    const where: any = { status: 'ACTIVE' };
    if (variantId) where.variantId = variantId;
    if (branchId) where.branchId = branchId;

    return (prisma as any).inventoryBatch.findMany({
      where,
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        branch: { select: { id: true, name: true, code: true } },
        variant: {
          select: {
            id: true,
            sku: true,
            price: true,
            product: { select: { name: true } },
          },
        },
      },
    });
  }

  /**
   * Returns all inventory batches expiring within the specified window (daysAhead).
   */
  static async getExpiringBatches(daysAhead = 30, branchId?: string) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + daysAhead);

    const where: any = {
      status: 'ACTIVE',
      currentQuantity: { gt: 0 },
      expiryDate: {
        lte: cutoffDate,
      },
    };
    if (branchId) where.branchId = branchId;

    const batches = await (prisma as any).inventoryBatch.findMany({
      where,
      orderBy: { expiryDate: 'asc' },
      include: {
        branch: { select: { id: true, name: true } },
        variant: {
          select: {
            id: true,
            sku: true,
            product: { select: { name: true } },
          },
        },
      },
    });

    const now = Date.now();
    return batches.map((b: any) => {
      const expTime = b.expiryDate ? new Date(b.expiryDate).getTime() : now;
      const daysRemaining = Math.ceil((expTime - now) / (1000 * 60 * 60 * 24));
      return {
        id: b.id,
        batchNumber: b.batchNumber,
        productName: b.variant?.product?.name,
        sku: b.variant?.sku,
        branchName: b.branch?.name,
        currentQuantity: b.currentQuantity,
        expiryDate: b.expiryDate,
        daysRemaining,
        isExpired: daysRemaining <= 0,
      };
    });
  }

  /**
   * Automatically consumes stock from batches using FEFO order.
   */
  static async depleteFromBatches(variantId: string, branchId: string, quantityToDeduct: number) {
    if (quantityToDeduct <= 0) return [];

    const activeBatches = await (prisma as any).inventoryBatch.findMany({
      where: {
        variantId,
        branchId,
        status: 'ACTIVE',
        currentQuantity: { gt: 0 },
      },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
    });

    let remaining = quantityToDeduct;
    const depletedList: { batchId: string; batchNumber: string; deducted: number }[] = [];

    for (const batch of activeBatches) {
      if (remaining <= 0) break;

      const toDeduct = Math.min(batch.currentQuantity, remaining);
      const newQty = batch.currentQuantity - toDeduct;
      remaining -= toDeduct;

      await (prisma as any).inventoryBatch.update({
        where: { id: batch.id },
        data: {
          currentQuantity: newQty,
          status: newQty === 0 ? 'DEPLETED' : 'ACTIVE',
        },
      });

      depletedList.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        deducted: toDeduct,
      });
    }

    return depletedList;
  }
}
