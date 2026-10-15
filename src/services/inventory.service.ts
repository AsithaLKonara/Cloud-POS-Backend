import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import { signImageUrl } from './product.service';
import { NotificationService } from './notification.service';

export const inventoryService = {

  // ─── Branches ────────────────────────────────────────────────────────────────
  async getBranches() {
    const [branches, revenueAgg] = await Promise.all([
      prisma.branch.findMany({
        orderBy: { name: 'asc' },
        include: {
          manager: {
            select: { name: true }
          },
          _count: {
            select: { staff: true, posTerminals: true }
          }
        }
      }),
      prisma.order.groupBy({
        by: ['branchId'],
        _sum: { total: true },
        where: {
          branchId: { not: null }
        }
      })
    ]);

    const revenueMap = new Map(
      revenueAgg.map(r => [r.branchId, r._sum.total || 0])
    );

    return branches.map(branch => {
      return {
        id: branch.id,
        name: branch.name,
        code: branch.code,
        address: branch.address,
        phone: branch.phone,
        type: branch.type,
        isActive: branch.isActive,
        managerName: branch.manager?.name || 'N/A',
        staffCount: branch._count.staff,
        posCount: branch._count.posTerminals,
        revenue: revenueMap.get(branch.id) || 0,
      };
    });
  },

  async createBranch(data: { name: string, code: string, address?: string, phone?: string, type?: string, isActive?: boolean }) {
    return prisma.branch.create({ data });
  },

  async updateBranch(id: string, data: Partial<{ name: string, code: string, address: string, phone: string, type: string, isActive: boolean }>) {
    return prisma.branch.update({ where: { id }, data });
  },

  async deleteBranch(id: string) {
    // Soft delete by setting isActive to false
    return prisma.branch.update({ where: { id }, data: { isActive: false } });
  },

  // ─── Stock Levels ────────────────────────────────────────────────────────────
  async getInventory(search?: string, branchId?: string, status?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (search) {
      where.variant = {
        OR: [
          { sku: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { product: { name: { contains: search, mode: 'insensitive' } } },
        ]
      };
    }
    
    if (status === 'outofstock') {
      where.quantity = 0;
    } else if (status === 'lowstock') {
      where.quantity = { gt: 0, lte: 10 }; // Using default threshold 10
    } else if (status === 'instock') {
      where.quantity = { gt: 10 };
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      include: {
        variant: { include: { product: true } },
        branch: true
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' }
    });

    const total = await prisma.inventoryItem.count({ where });

    const data = await Promise.all(items.map(async (inv: any) => {
      const v = inv.variant;
      const qty = inv.quantity;
      const reserved = inv.reservedQty;
      const sellable = Math.max(0, qty - reserved);
      const threshold = inv.lowStockThreshold;
      const isLowStock = qty > 0 && (qty <= threshold);
      const isOutOfStock = qty === 0;

      let imageUrl: string | null = null;
      if (v.featuredImage) {
        imageUrl = await signImageUrl(v.featuredImage);
      }

      return {
        id: inv.id,
        variantId: v.id,
        branchId: inv.branchId,
        branchName: inv.branch.name,
        sku: v.sku ?? '—',
        name: (v.name ?? `${v.color ?? ''} ${v.size ?? ''}`.trim()) || 'Variant',
        productName: v.product.name,
        productId: v.product.id,
        price: v.price,
        imageUrl,
        quantity: qty,
        reservedQty: reserved,
        sellable,
        lowStockThreshold: threshold,
        isLowStock,
        isOutOfStock,
        stockStatus: isOutOfStock ? 'outofstock' : isLowStock ? 'lowstock' : 'instock',
      };
    }));

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  },

  // ─── KPI Stats ───────────────────────────────────────────────────────────────
  async getStats(branchId?: string) {
    const baseQuery = `
      SELECT 
        CAST(COALESCE(SUM(ii."quantity"), 0) AS INTEGER) as "totalQty",
        CAST(COALESCE(SUM(CASE WHEN ii."quantity" = 0 THEN 1 ELSE 0 END), 0) AS INTEGER) as "outOfStockCount",
        CAST(COALESCE(SUM(CASE WHEN ii."quantity" > 0 AND ii."quantity" <= ii."lowStockThreshold" THEN 1 ELSE 0 END), 0) AS INTEGER) as "lowStockCount",
        CAST(COALESCE(SUM(ii."quantity" * pv."price"), 0) AS FLOAT) as "estimatedValue",
        CAST(COALESCE(SUM(ii."quantity" * COALESCE(pv."costPrice", 0)), 0) AS FLOAT) as "estimatedCostValue"
      FROM "InventoryItem" ii
      JOIN "ProductVariant" pv ON ii."variantId" = pv."id"
    `;

    const query = branchId ? `${baseQuery} WHERE ii."branchId" = $1` : baseQuery;
    const args = branchId ? [branchId] : [];

    const [statsResult, totalVariants] = await Promise.all([
      prisma.$queryRawUnsafe(query, ...args) as Promise<any[]>,
      prisma.productVariant.count(),
    ]);

    const stats = Array.isArray(statsResult) && statsResult.length > 0 ? statsResult[0] : {
      totalQty: 0,
      outOfStockCount: 0,
      lowStockCount: 0,
      estimatedValue: 0,
      estimatedCostValue: 0,
    };

    return {
      totalItems: stats.totalQty,
      lowStockCount: stats.lowStockCount,
      outOfStockCount: stats.outOfStockCount,
      estimatedValue: stats.estimatedValue,
      estimatedCostValue: stats.estimatedCostValue,
      totalSKUs: totalVariants, // Total catalog SKUs, regardless of stock
    };
  },

  // ─── Adjust Stock ─────────────────────────────────────────────────────────────
  async adjustStock(data: {
    variantId: string;
    branchId: string;
    type: 'RECEIVE' | 'DEDUCT' | 'SPILLAGE_WASTAGE' | 'DAMAGE' | 'INTERNAL_USE' | 'TRANSFER_OUT' | 'TRANSFER_IN';
    quantity: number;
    reason?: string;
    reference?: string;
  }, tx: any = prisma) {
    const { variantId, branchId, type, quantity, reason, reference } = data;
    const isDeduction = ['DEDUCT', 'SPILLAGE_WASTAGE', 'DAMAGE', 'INTERNAL_USE', 'TRANSFER_OUT'].includes(type);
    const delta = isDeduction ? -Math.abs(quantity) : Math.abs(quantity);

    // Ensure stock doesn't go below 0 for deductions
    let inv;
    if (isDeduction) {
      const result = await tx.inventoryItem.updateMany({
        where: { 
          variantId, 
          branchId,
          quantity: { gte: Math.abs(quantity) }
        },
        data: { quantity: { decrement: Math.abs(quantity) } }
      });
      if (result.count === 0) {
        throw new Error(`Insufficient stock for deduction. Variant: ${variantId}`);
      }
      
      inv = await tx.inventoryItem.findUnique({
        where: { variantId_branchId: { variantId, branchId } }
      });
    } else {
      inv = await tx.inventoryItem.upsert({
        where: { variantId_branchId: { variantId, branchId } },
        create: { variantId, branchId, quantity: Math.max(0, delta) },
        update: { quantity: { increment: delta } },
      });
    }

    // Recalculate total quantity for this variant across all branches
    const totalInventory = await tx.inventoryItem.aggregate({
      where: { variantId },
      _sum: { quantity: true }
    });
    const totalQuantity = totalInventory._sum.quantity || 0;
    
    // Sync ProductVariant quantity
    await tx.productVariant.update({
      where: { id: variantId },
      data: { quantity: totalQuantity }
    });

    const variantRecord = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { costPrice: true }
    });

    const transaction = await tx.inventoryTransaction.create({
      data: {
        variantId,
        branchId,
        type,
        quantityChange: delta,
        reason,
        reference,
        costPriceAtTransaction: variantRecord?.costPrice ?? 0,
      },
    });

    if (inv.quantity > 0 && inv.quantity <= inv.lowStockThreshold && type === 'DEDUCT') {
      try {
        const variant = await tx.productVariant.findUnique({
          where: { id: variantId },
          include: { product: true }
        });
        if (variant) {
          await NotificationService.createInternal(
            'Low Stock Alert',
            `${variant.product.name} (SKU: ${variant.sku}) is running low on stock. Only ${inv.quantity} left.`,
            'INVENTORY',
            `/inventory`
          );
        }
      } catch (e) {
        console.error('Failed to trigger low stock notification:', e);
      }
    }

    return { inventoryItem: inv, transaction };
  },

  // ─── Reservations ─────────────────────────────────────────────────────────────
  async reserveStock(data: { variantId: string; branchId: string; quantity: number; orderId: string }) {
    const { variantId, branchId, quantity, orderId } = data;
    const inv = await prisma.inventoryItem.findUnique({
      where: { variantId_branchId: { variantId, branchId } }
    });

    if (!inv || (inv.quantity - inv.reservedQty < quantity)) {
      throw new Error('Insufficient sellable stock to reserve');
    }

    const updated = await prisma.inventoryItem.update({
      where: { id: inv.id },
      data: { reservedQty: { increment: quantity } }
    });

    await prisma.inventoryTransaction.create({
      data: { variantId, branchId, type: 'RESERVE', quantityChange: 0, reason: 'Order Reservation', reference: orderId }
    });

    return updated;
  },

  async releaseStock(data: { variantId: string; branchId: string; quantity: number; orderId: string }) {
    const { variantId, branchId, quantity, orderId } = data;
    const inv = await prisma.inventoryItem.findUnique({
      where: { variantId_branchId: { variantId, branchId } }
    });

    if (!inv) return null;

    const releaseQty = Math.min(inv.reservedQty, quantity);

    const updated = await prisma.inventoryItem.update({
      where: { id: inv.id },
      data: { reservedQty: { decrement: releaseQty } }
    });

    await prisma.inventoryTransaction.create({
      data: { variantId, branchId, type: 'RELEASE', quantityChange: 0, reason: 'Reservation Released', reference: orderId }
    });

    return updated;
  },

  // ─── Transactions ─────────────────────────────────────────────────────────────
  async getTransactions(branchId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (branchId) where.branchId = branchId;

    const [data, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where,
        include: {
          variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
          branch: { select: { name: true } }
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  },

  // ─── Transfers ────────────────────────────────────────────────────────────────
  async getTransfers(branchId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (branchId) {
      where.OR = [
        { fromBranchId: branchId },
        { toBranchId: branchId },
      ];
    }
    const [data, total] = await Promise.all([
      prisma.stockTransfer.findMany({
        where,
        include: {
          fromBranch: true,
          toBranch: true,
          variant: { select: { sku: true, name: true, product: { select: { name: true, brand: true, viscosity: true } } } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stockTransfer.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  },

  async createTransfer(data: {
    variantId: string;
    fromBranchId: string;
    toBranchId: string;
    quantity: number;
    requestedBy?: string;
    notes?: string;
  }) {
    // Validate source branch has enough stock
    const sourceItem = await prisma.inventoryItem.findUnique({
      where: { variantId_branchId: { variantId: data.variantId, branchId: data.fromBranchId } }
    });

    if (!sourceItem || sourceItem.quantity < data.quantity) {
      throw new Error('Insufficient stock in source branch');
    }

    return prisma.stockTransfer.create({ data: { ...data, status: 'PENDING' } });
  },

  async updateTransferStatus(id: string, status: string) {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id } });
    if (!transfer) throw new Error('Transfer not found');

    const updated = await prisma.stockTransfer.update({
      where: { id },
      data: { status },
    });

    if (status === 'DISPATCHED' && transfer.status !== 'DISPATCHED') {
      await this.adjustStock({
        variantId: transfer.variantId,
        branchId: transfer.fromBranchId,
        type: 'DEDUCT',
        quantity: transfer.quantity,
        reason: 'Transfer Dispatch',
        reference: transfer.id,
      });
      await prisma.inventoryTransaction.create({
        data: {
          variantId: transfer.variantId,
          branchId: transfer.fromBranchId,
          type: 'TRANSFER_OUT',
          quantityChange: -transfer.quantity,
          reason: 'Transfer Dispatched',
          reference: transfer.id,
        },
      });
    }

    if (status === 'RECEIVED' && transfer.status !== 'RECEIVED') {
      await this.adjustStock({
        variantId: transfer.variantId,
        branchId: transfer.toBranchId,
        type: 'RECEIVE',
        quantity: transfer.quantity,
        reason: 'Transfer Receive',
        reference: transfer.id,
      });
      await prisma.inventoryTransaction.create({
        data: {
          variantId: transfer.variantId,
          branchId: transfer.toBranchId,
          type: 'TRANSFER_IN',
          quantityChange: transfer.quantity,
          reason: 'Transfer Received',
          reference: transfer.id,
        },
      });
    }

    return updated;
  },

};
