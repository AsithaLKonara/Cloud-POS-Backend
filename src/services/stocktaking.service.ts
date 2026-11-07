import prisma from '../config/prisma';
import { GeneralLedgerService } from './gl.service';

export class StocktakingService {
  /**
   * Freezes a branch inventory snapshot for cycle count / stocktake session
   */
  static async startStocktake(data: {
    tenantId?: string | null;
    branchId: string;
    title: string;
    createdById?: string;
    notes?: string;
  }) {
    // 1. Fetch current inventory for the branch
    const inventoryItems = await (prisma as any).inventoryItem.findMany({
      where: { branchId: data.branchId },
      include: {
        variant: true
      }
    });

    // 2. Create Stocktake Session
    const session = await (prisma as any).stocktakeSession.create({
      data: {
        tenantId: data.tenantId || null,
        branchId: data.branchId,
        title: data.title,
        status: 'IN_PROGRESS',
        createdById: data.createdById || null,
        notes: data.notes || null,
        items: {
          create: inventoryItems.map((inv: any) => ({
            variantId: inv.variantId,
            systemQuantity: inv.quantity,
            countedQuantity: null,
            variance: null,
            unitCost: inv.variant?.costPrice || 0,
            reconciled: false
          }))
        }
      },
      include: {
        items: true
      }
    });

    return session;
  }

  /**
   * Cashiers / auditors record physical counted numbers per variant
   */
  static async recordCounts(sessionId: string, counts: Array<{ variantId: string; countedQty: number; notes?: string }>) {
    const session = await (prisma as any).stocktakeSession.findUnique({
      where: { id: sessionId },
      include: { items: true }
    });

    if (!session || session.status === 'RECONCILED' || session.status === 'CANCELLED') {
      throw new Error('Stocktake session not found or already closed/reconciled.');
    }

    const itemMap = new Map(session.items.map((i: any) => [i.variantId, i]));

    for (const c of counts) {
      const item: any = itemMap.get(c.variantId);
      if (!item) continue;

      const variance = c.countedQty - item.systemQuantity;

      await (prisma as any).stocktakeItem.update({
        where: { id: item.id },
        data: {
          countedQuantity: c.countedQty,
          variance,
          notes: c.notes || item.notes
        }
      });
    }

    return await (prisma as any).stocktakeSession.findUnique({
      where: { id: sessionId },
      include: { items: true }
    });
  }

  /**
   * Manager reconciliation: applies adjustments to inventory and posts shrinkage/surplus to GL
   */
  static async reconcileStocktake(sessionId: string, managerNotes: string) {
    const session = await (prisma as any).stocktakeSession.findUnique({
      where: { id: sessionId },
      include: { items: true }
    });

    if (!session || session.status !== 'IN_PROGRESS') {
      throw new Error('Session is not in progress or already reconciled.');
    }

    let netVarianceValueLkr = 0;
    const adjustments = [];

    for (const it of session.items) {
      if (it.countedQuantity === null || it.countedQuantity === undefined) {
        continue;
      }

      const variance = it.countedQuantity - it.systemQuantity;
      if (variance !== 0) {
        // Adjust inventory to match physical count
        await (prisma as any).inventoryItem.updateMany({
          where: { variantId: it.variantId, branchId: session.branchId },
          data: { quantity: it.countedQuantity }
        });

        // Recalculate and synchronize ProductVariant total quantity across all branches
        const totalInv = await (prisma as any).inventoryItem.aggregate({
          where: { variantId: it.variantId },
          _sum: { quantity: true }
        });
        await (prisma as any).productVariant.update({
          where: { id: it.variantId },
          data: { quantity: totalInv?._sum?.quantity || 0 }
        });

        // Audit inventory transaction
        await (prisma as any).inventoryTransaction.create({
          data: {
            variantId: it.variantId,
            branchId: session.branchId,
            type: 'CYCLE_COUNT_RECONCILIATION',
            quantityChange: variance,
            reference: session.id,
            reason: `Stocktake Reconciliation: ${session.title}. ${managerNotes}`
          }
        });

        const lineVal = variance * it.unitCost;
        netVarianceValueLkr += lineVal;

        adjustments.push({
          variantId: it.variantId,
          variance,
          varianceValue: lineVal
        });
      }

      await (prisma as any).stocktakeItem.update({
        where: { id: it.id },
        data: { reconciled: true }
      });
    }

    // Double-entry GL posting for net inventory adjustment
    if (Math.abs(netVarianceValueLkr) > 0.01) {
      try {
        const absVal = Math.abs(netVarianceValueLkr);
        if (netVarianceValueLkr < 0) {
          // Inventory shrinkage (loss): Debit 6100 Shrinkage, Credit 1200 Inventory
          await GeneralLedgerService.postJournalEntry({
            tenantId: session.tenantId,
            reference: session.id,
            description: `Inventory Shrinkage (Cycle Count #${session.id.substring(0, 8)})`,
            lines: [
              { accountCode: '6100', debit: absVal, credit: 0, description: 'Shrinkage & Loss' },
              { accountCode: '1200', debit: 0, credit: absVal, description: 'Inventory Asset Adjustment' }
            ]
          });
        } else {
          // Inventory surplus: Debit 1200 Inventory, Credit 4000 Revenue
          await GeneralLedgerService.postJournalEntry({
            tenantId: session.tenantId,
            reference: session.id,
            description: `Inventory Surplus Gain (Cycle Count #${session.id.substring(0, 8)})`,
            lines: [
              { accountCode: '1200', debit: absVal, credit: 0, description: 'Inventory Asset Increase' },
              { accountCode: '4000', debit: 0, credit: absVal, description: 'Inventory Adjustment Gain' }
            ]
          });
        }
      } catch (e) {
        // Graceful
      }
    }

    return await (prisma as any).stocktakeSession.update({
      where: { id: sessionId },
      data: {
        status: 'RECONCILED',
        completedAt: new Date(),
        notes: session.notes ? `${session.notes}\nReconciliation Notes: ${managerNotes}` : managerNotes
      },
      include: { items: true }
    });
  }
}

