import prisma from '../config/prisma';
import { logger } from '../utils/logger';

export interface SplitEvenlyResult {
  orderId: string;
  orderNumber: string;
  total: number;
  ways: number;
  splitAmount: number;
  splits: {
    splitIndex: number;
    amount: number;
    subtotal: number;
    tax: number;
    status: 'UNPAID' | 'PAID';
    paymentMethod?: string;
    reference?: string;
  }[];
}

export interface SplitByItemsGroup {
  name?: string;
  itemIds: string[];
}

export interface SplitByItemsResult {
  originalOrderId: string;
  bills: {
    billNumber: number;
    name?: string;
    items: {
      id: string;
      variantId: string;
      quantity: number;
      priceAtPurchase: number;
      total: number;
    }[];
    subtotal: number;
    tax: number;
    total: number;
  }[];
}

export class SplitBillService {
  /**
   * Splits an order's total evenly across N patrons.
   */
  static async splitEvenly(orderId: string, ways: number): Promise<SplitEvenlyResult> {
    if (ways < 2) {
      throw new Error('Split ways must be at least 2');
    }

    const order = await (prisma as any).order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const baseAmount = Math.floor((order.total / ways) * 100) / 100;
    const baseSubtotal = Math.floor((order.subtotal / ways) * 100) / 100;
    const baseTax = Math.floor((order.tax / ways) * 100) / 100;

    // Allocate remainder cent(s) to the first split
    const remainder = Math.round((order.total - baseAmount * ways) * 100) / 100;

    const splits = Array.from({ length: ways }, (_, i) => {
      const isFirst = i === 0;
      return {
        splitIndex: i + 1,
        amount: isFirst ? Math.round((baseAmount + remainder) * 100) / 100 : baseAmount,
        subtotal: baseSubtotal,
        tax: baseTax,
        status: 'UNPAID' as const,
      };
    });

    await (prisma as any).order.update({
      where: { id: orderId },
      data: {
        metadata: {
          ...(typeof order.metadata === 'object' && order.metadata !== null ? order.metadata : {}),
          splitType: 'EVEN',
          splitWays: ways,
          splits,
        },
      },
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.total,
      ways,
      splitAmount: baseAmount,
      splits,
    };
  }

  /**
   * Splits an order by segregating specific line items into multiple independent bills.
   */
  static async splitByItems(orderId: string, groups: SplitByItemsGroup[]): Promise<SplitByItemsResult> {
    if (!groups || groups.length < 2) {
      throw new Error('Must provide at least 2 bill groups to split items');
    }

    const order = await (prisma as any).order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const orderItemMap = new Map<string, any>(order.items.map((item: any) => [item.id, item]));

    const bills = groups.map((grp, idx) => {
      const billItems = grp.itemIds.map(itemId => {
        const item = orderItemMap.get(itemId);
        if (!item) {
          throw new Error(`Item ${itemId} does not belong to order ${orderId}`);
        }
        return {
          id: item.id,
          variantId: item.variantId,
          quantity: item.quantity,
          priceAtPurchase: item.priceAtPurchase,
          total: item.priceAtPurchase * item.quantity,
        };
      });

      const subtotal = billItems.reduce((acc, it) => acc + it.total, 0);
      const taxRate = order.subtotal > 0 ? order.tax / order.subtotal : 0;
      const tax = Math.round(subtotal * taxRate * 100) / 100;
      const total = subtotal + tax;

      return {
        billNumber: idx + 1,
        name: grp.name || `Bill #${idx + 1}`,
        items: billItems,
        subtotal,
        tax,
        total,
      };
    });

    await (prisma as any).order.update({
      where: { id: orderId },
      data: {
        metadata: {
          ...(typeof order.metadata === 'object' && order.metadata !== null ? order.metadata : {}),
          splitType: 'ITEMIZED',
          itemizedBills: bills,
        },
      },
    });

    return {
      originalOrderId: order.id,
      bills,
    };
  }
}
