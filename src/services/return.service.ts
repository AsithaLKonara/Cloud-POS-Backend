import prisma from '../config/prisma';
import { inventoryService } from './inventory.service';

export const returnService = {
  verifyOrderForReturn: async (orderNumber: string, email: string) => {
    const order = await prisma.order.findFirst({
      where: { orderNumber },
      include: {
        customer: true,
        items: {
          include: {
            variant: {
              include: { product: true }
            },
            returnItems: true
          }
        }
      }
    });

    if (!order) {
      throw new Error('Order not found.');
    }

    if (order.customer?.email !== email) {
      throw new Error('Order email does not match.');
    }

    // Filter out items that have already been fully returned
    const returnableItems = order.items.filter((item: any) => {
      const alreadyReturnedQty = item.returnItems.reduce((acc: number, r: any) => acc + r.quantity, 0);
      return alreadyReturnedQty < item.quantity;
    }).map((item: any) => {
      const alreadyReturnedQty = item.returnItems.reduce((acc: number, r: any) => acc + r.quantity, 0);
      return {
        id: item.id,
        quantity: item.quantity - alreadyReturnedQty,
        priceAtPurchase: item.priceAtPurchase,
        variant: {
          id: item.variant.id,
          name: item.variant.name,
          featuredImage: item.variant.featuredImage,
          product: {
            name: item.variant.product.name
          }
        }
      };
    });

    if (returnableItems.length === 0) {
      throw new Error('No items available to return for this order.');
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      date: order.createdAt,
      items: returnableItems
    };
  },

  createReturn: async (orderId: string, items: { orderItemId: string, quantity: number, reason: string, details?: string }[]) => {
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });
    
    if (!order) throw new Error("Order not found");

    // Generate unique RMA
    const count = await prisma.returnRequest.count();
    const rmaId = `RET-${10000 + count + 1}`;

    // ── Duplicate guard ─────────────────────────────────────────────────────
    // Check if each item already has an active (non-REJECTED/REFUNDED) RMA that
    // covers its full requested quantity to prevent double returns/exchanges.
    for (const item of items) {
      const orderItem = await prisma.orderItem.findUnique({
        where: { id: item.orderItemId },
        include: {
          returnItems: {
            include: {
              returnRequest: { select: { status: true } }
            }
          }
        }
      });
      if (!orderItem) throw new Error(`Order item ${item.orderItemId} not found`);

      // Sum quantity already in active (non-terminal) RMAs
      const activeReturnedQty = orderItem.returnItems
        .filter(ri => !['REJECTED', 'REFUNDED'].includes(ri.returnRequest?.status || ''))
        .reduce((acc, ri) => acc + ri.quantity, 0);

      const alreadyFullyReturnedQty = orderItem.returnItems
        .filter(ri => ri.returnRequest?.status === 'REFUNDED')
        .reduce((acc, ri) => acc + ri.quantity, 0);

      const availableForReturn = orderItem.quantity - alreadyFullyReturnedQty - activeReturnedQty;

      if (item.quantity > availableForReturn) {
        if (availableForReturn <= 0) {
          throw new Error(
            `Item has already been fully returned or has a pending return/exchange in progress. ` +
            `Please wait for the existing RMA to be processed before submitting a new one.`
          );
        } else {
          throw new Error(
            `You requested to return ${item.quantity} units, but only ${availableForReturn} unit(s) are available for return ` +
            `(some are already in active RMA or fully refunded).`
          );
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Calculate initial refund amount based on items
    let totalRefund = 0;
    for (const item of items) {
      const orderItem = await prisma.orderItem.findUnique({ where: { id: item.orderItemId }});
      if (orderItem) {
        totalRefund += orderItem.priceAtPurchase * item.quantity;
      }
    }

    const returnRequest = await prisma.returnRequest.create({
      data: {
        rmaId,
        orderId: order.id,
        customerId: order.customerId,
        reason: items[0]?.reason || 'Customer Return',
        customerNote: items[0]?.details || '',
        refundAmount: totalRefund,
        status: 'REQUESTED',
        items: {
          create: items.map(item => ({
            orderItemId: item.orderItemId,
            quantity: item.quantity,
          }))
        }
      },
      include: {
        items: true
      }
    });

    return returnRequest;
  },

  getReturns: async (page: number, limit: number, search?: string, status?: string, customerId?: string, origin?: string, type?: string) => {
    const skip = (page - 1) * limit;

    let whereClause: any = {};
    if (status && status !== 'ALL') {
      whereClause.status = status;
    }
    
    if (customerId) {
      whereClause.customerId = customerId;
    }
    
    if (origin && origin !== 'ALL') {
      if (origin === 'POS') {
        whereClause.OR = [
          ...(whereClause.OR || []),
          { order: { type: 'POS' } },
          { order: { orderNumber: { startsWith: 'POS' } } },
          { reason: { contains: 'POS', mode: 'insensitive' } }
        ];
      } else if (origin === 'COURIER') {
        whereClause.AND = [
          ...(whereClause.AND || []),
          { OR: [{ order: { type: { not: 'POS' } } }, { orderId: null }] },
          { NOT: { order: { orderNumber: { startsWith: 'POS' } } } }
        ];
      }
    }

    if (type && type !== 'ALL') {
      if (type === 'EXCHANGE') {
        whereClause.OR = [
          ...(whereClause.OR || []),
          { reason: { contains: 'EXCHANGE', mode: 'insensitive' } },
          { customerNote: { contains: 'EXCHANGE', mode: 'insensitive' } }
        ];
      } else if (type === 'REFUND') {
        whereClause.NOT = [
          { reason: { contains: 'EXCHANGE', mode: 'insensitive' } }
        ];
      }
    }

    if (search) {
      whereClause.OR = [
        ...(whereClause.OR || []),
        { rmaId: { contains: search, mode: 'insensitive' } },
        { customer: { firstName: { contains: search, mode: 'insensitive' } } },
        { customer: { lastName: { contains: search, mode: 'insensitive' } } },
        { order: { orderNumber: { contains: search, mode: 'insensitive' } } }
      ];
    }

    const [total, returns] = await Promise.all([
      prisma.returnRequest.count({ where: whereClause }),
      prisma.returnRequest.findMany({
        where: whereClause,
        include: {
          customer: true,
          order: true,
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      })
    ]);

    return {
      returns: returns.map(r => {
        const isPos = r.order?.type === 'POS' || r.order?.orderNumber?.startsWith('POS') || r.reason?.toLowerCase().includes('pos');
        const isExchange = r.reason?.toLowerCase().includes('exchange') || r.customerNote?.toLowerCase().includes('exchange');
        return {
          id: r.id,
          rmaId: r.rmaId,
          orderId: r.order?.orderNumber || null,
          customer: r.customer ? `${r.customer.firstName} ${r.customer.lastName || ''}`.trim() : 'Walk-in / POS Customer',
          date: r.createdAt.toISOString().split('T')[0],
          status: r.status,
          amount: r.refundAmount,
          origin: isPos ? 'POS' : 'COURIER',
          type: isExchange ? 'EXCHANGE' : 'REFUND',
          reason: r.reason
        };
      }),
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  },

  getReturnById: async (id: string) => {
    const rma = await prisma.returnRequest.findUnique({
      where: { id },
      include: {
        customer: true,
        order: {
          include: {
            items: {
              include: {
                variant: {
                  include: {
                    product: true
                  }
                }
              }
            }
          }
        },
        items: {
          include: {
            orderItem: {
              include: {
                variant: {
                  include: {
                    product: true
                  }
                }
              }
            },
            variant: {
              include: {
                product: true
              }
            }
          }
        }
      }
    });

    if (!rma) throw new Error('Return not found');

    // Calculate Customer LTV
    const customerOrders = await prisma.order.findMany({
      where: { customerId: rma.customerId || '' },
      select: { total: true }
    });
    const ltv = customerOrders.reduce((sum, o) => sum + o.total, 0);

    return { ...rma, customerLtv: ltv };
  },

  updateReturnStatus: async (id: string, status: string, items?: any[]) => {
    // 1. Update overall status
    const updated = await prisma.returnRequest.update({
      where: { id },
      data: { status }
    });

    // 2. If it's the inspection step, update items
    if (items && items.length > 0) {
      for (const item of items) {
        await prisma.returnItem.update({
          where: { id: item.id },
          data: {
            condition: item.condition,
            inspectionStatus: item.inspectionStatus
          }
        });
        
        // If restockable, create inventory transaction
        if (item.inspectionStatus === 'RESTOCKABLE') {
          const retItem = await prisma.returnItem.findUnique({
            where: { id: item.id },
            include: { orderItem: true }
          });
          
          if (retItem) {
            const variantId = retItem.variantId || retItem.orderItem?.variantId;
            if (!variantId) continue;
            
            // Find default warehouse or online branch for return
            const branch = await prisma.branch.findFirst({
              where: { type: 'WAREHOUSE' }
            });
            
            if (branch) {
              await prisma.inventoryTransaction.create({
                data: {
                  variantId: variantId,
                  branchId: branch.id,
                  type: 'RETURN',
                  quantityChange: retItem.quantity,
                  reason: 'Customer Return RMA',
                  reference: updated.rmaId
                }
              });
              
              // Also update InventoryItem count
              const invItem = await prisma.inventoryItem.findUnique({
                where: { variantId_branchId: { variantId: variantId, branchId: branch.id } }
              });
              
              if (invItem) {
                await prisma.inventoryItem.update({
                  where: { id: invItem.id },
                  data: { quantity: { increment: retItem.quantity } }
                });
              } else {
                await prisma.inventoryItem.create({
                  data: {
                    variantId: variantId,
                    branchId: branch.id,
                    quantity: retItem.quantity
                  }
                });
              }
            }
          }
        }
      }
    }

    // 3. If refunded, update order status
    if (status === 'REFUNDED' && updated.orderId) {
      await prisma.order.update({
        where: { id: updated.orderId },
        data: { paymentStatus: 'REFUNDED' }
      });
    }

    return updated;
  },

  processBulkManualReturns: async (branchId: string, items: { variantId: string, quantity: number, condition: string, notes?: string, unitPrice?: number }[]) => {
    return prisma.$transaction(async (tx) => {
      let totalRefundAmount = 0;

      for (const item of items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          include: { product: true }
        });
        if (!variant) throw new Error(`Variant ${item.variantId} not found`);

        // Use provided unit price, or fall back to variant price
        const unitPrice = item.unitPrice ?? (variant as any).price ?? 0;
        totalRefundAmount += unitPrice * item.quantity;

        if (item.condition === 'GOOD') {
          await inventoryService.adjustStock({
            variantId: variant.id,
            branchId,
            type: 'RECEIVE',
            quantity: item.quantity,
            reason: item.notes || 'Manual Bulk Return - Restock',
            reference: 'MANUAL_RETURN'
          }, tx);
        } else if (item.condition === 'DAMAGED') {
          // Damaged goods: write off from inventory (deduct)
          await inventoryService.adjustStock({
            variantId: variant.id,
            branchId,
            type: 'DEDUCT',
            quantity: item.quantity,
            reason: item.notes || 'Damaged Write-Off',
            reference: 'MANUAL_RETURN_DAMAGED'
          }, tx);
        }
        // QUARANTINE condition: log only, no stock movement until inspected
      }

      const rmaId = `RMA-MANUAL-${Date.now()}`;
      await tx.returnRequest.create({
        data: {
          rmaId,
          status: 'RECEIVED', // Manual returns are instantly received
          adminNote: 'Manual Bulk Return',
          refundAmount: totalRefundAmount, // Persist calculated amount
          items: {
            create: items.map(item => ({
              variantId: item.variantId,
              quantity: item.quantity,
              condition: item.condition,
              inspectionStatus: item.condition === 'DAMAGED' ? 'REJECTED' : 'APPROVED'
            }))
          }
        }
      });

      return { success: true, refundAmount: totalRefundAmount };
    });
  }
};
