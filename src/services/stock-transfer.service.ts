import prisma from '../config/prisma';
import { inventoryService } from './inventory.service';
import { logger } from '../utils/logger';

export interface CreateStockTransferDTO {
  fromBranchId: string;
  toBranchId: string;
  variantId: string;
  quantity: number;
  notes?: string;
  requestedBy?: string;
}

export class StockTransferService {
  static async getTransfers(branchId?: string, status?: string) {
    const where: any = {};
    if (branchId) {
      where.OR = [{ fromBranchId: branchId }, { toBranchId: branchId }];
    }
    if (status && status !== 'ALL') {
      where.status = status;
    }

    return (prisma as any).stockTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        fromBranch: { select: { id: true, name: true, code: true } },
        toBranch: { select: { id: true, name: true, code: true } },
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
    });
  }

  static async createTransfer(data: CreateStockTransferDTO) {
    if (data.fromBranchId === data.toBranchId) {
      throw new Error('Source and destination branches cannot be the same');
    }

    if (data.quantity <= 0) {
      throw new Error('Transfer quantity must be greater than zero');
    }

    // Check available source inventory
    const sourceInv = await (prisma as any).inventoryItem.findUnique({
      where: {
        variantId_branchId: {
          variantId: data.variantId,
          branchId: data.fromBranchId,
        },
      },
    });

    if (!sourceInv || sourceInv.quantity < data.quantity) {
      throw new Error(`Insufficient stock at source branch. Available: ${sourceInv?.quantity || 0}, Requested: ${data.quantity}`);
    }

    return (prisma as any).stockTransfer.create({
      data: {
        fromBranchId: data.fromBranchId,
        toBranchId: data.toBranchId,
        variantId: data.variantId,
        quantity: data.quantity,
        status: 'REQUESTED',
        notes: data.notes,
        requestedBy: data.requestedBy,
      },
      include: {
        fromBranch: true,
        toBranch: true,
        variant: { include: { product: true } },
      },
    });
  }

  static async dispatchTransfer(transferId: string) {
    const transfer = await (prisma as any).stockTransfer.findUnique({
      where: { id: transferId },
    });

    if (!transfer) {
      throw new Error(`Stock transfer ${transferId} not found`);
    }

    if (transfer.status !== 'REQUESTED' && transfer.status !== 'APPROVED') {
      throw new Error(`Cannot dispatch transfer in status ${transfer.status}`);
    }

    // Deduct stock from origin branch
    await inventoryService.adjustStock({
      variantId: transfer.variantId,
      branchId: transfer.fromBranchId,
      type: 'TRANSFER_OUT',
      quantity: transfer.quantity,
      reason: `Transfer #${transfer.id.slice(-6)} In-Transit Dispatch`,
      reference: transfer.id,
    });

    return (prisma as any).stockTransfer.update({
      where: { id: transferId },
      data: { status: 'IN_TRANSIT' },
      include: {
        fromBranch: true,
        toBranch: true,
        variant: { include: { product: true } },
      },
    });
  }

  static async receiveTransfer(transferId: string) {
    const transfer = await (prisma as any).stockTransfer.findUnique({
      where: { id: transferId },
    });

    if (!transfer) {
      throw new Error(`Stock transfer ${transferId} not found`);
    }

    if (transfer.status !== 'IN_TRANSIT') {
      throw new Error(`Cannot receive a transfer that is not in-transit (current status: ${transfer.status})`);
    }

    // Inward receive stock at destination branch
    await inventoryService.adjustStock({
      variantId: transfer.variantId,
      branchId: transfer.toBranchId,
      type: 'TRANSFER_IN',
      quantity: transfer.quantity,
      reason: `Transfer #${transfer.id.slice(-6)} Inward Received`,
      reference: transfer.id,
    });

    return (prisma as any).stockTransfer.update({
      where: { id: transferId },
      data: { status: 'RECEIVED' },
      include: {
        fromBranch: true,
        toBranch: true,
        variant: { include: { product: true } },
      },
    });
  }

  static async cancelTransfer(transferId: string) {
    const transfer = await (prisma as any).stockTransfer.findUnique({
      where: { id: transferId },
    });

    if (!transfer) {
      throw new Error(`Stock transfer ${transferId} not found`);
    }

    if (transfer.status === 'RECEIVED' || transfer.status === 'CANCELLED') {
      throw new Error(`Cannot cancel transfer in status ${transfer.status}`);
    }

    // If already dispatched, restore stock back to origin branch
    if (transfer.status === 'IN_TRANSIT') {
      await inventoryService.adjustStock({
        variantId: transfer.variantId,
        branchId: transfer.fromBranchId,
        type: 'TRANSFER_IN',
        quantity: transfer.quantity,
        reason: `Transfer #${transfer.id.slice(-6)} Cancelled - Stock Restored`,
        reference: transfer.id,
      });
    }

    return (prisma as any).stockTransfer.update({
      where: { id: transferId },
      data: { status: 'CANCELLED' },
    });
  }
}
