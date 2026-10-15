import prisma from '../config/prisma';
import { pnlService } from './pnl.service';
import { inventoryService } from './inventory.service';

interface DateRange {
  start: Date;
  end: Date;
}

export const analyticsService = {
  getDateRanges(period: string): { current: DateRange; previous: DateRange } {
    const now = new Date();
    let currentStart = new Date();
    let currentEnd = new Date();
    let previousStart = new Date();
    let previousEnd = new Date();

    currentEnd = now;

    if (period === 'Today') {
      currentStart.setHours(0, 0, 0, 0);
      previousStart = new Date(currentStart);
      previousStart.setDate(previousStart.getDate() - 1);
      previousEnd = new Date(currentStart);
      previousEnd.setMilliseconds(-1);
    } else if (period === 'Last 7 Days') {
      currentStart.setDate(currentStart.getDate() - 7);
      currentStart.setHours(0, 0, 0, 0);
      previousStart = new Date(currentStart);
      previousStart.setDate(previousStart.getDate() - 7);
      previousEnd = new Date(currentStart);
      previousEnd.setMilliseconds(-1);
    } else if (period === 'Last 30 Days') {
      currentStart.setDate(currentStart.getDate() - 30);
      currentStart.setHours(0, 0, 0, 0);
      previousStart = new Date(currentStart);
      previousStart.setDate(previousStart.getDate() - 30);
      previousEnd = new Date(currentStart);
      previousEnd.setMilliseconds(-1);
    } else if (period === 'This Month') {
      currentStart.setDate(1);
      currentStart.setHours(0, 0, 0, 0);
      
      previousStart = new Date(currentStart);
      previousStart.setMonth(previousStart.getMonth() - 1);
      
      previousEnd = new Date(currentStart);
      previousEnd.setMilliseconds(-1);
    } else {
      // Default to Today
      currentStart.setHours(0, 0, 0, 0);
      previousStart = new Date(currentStart);
      previousStart.setDate(previousStart.getDate() - 1);
      previousEnd = new Date(currentStart);
      previousEnd.setMilliseconds(-1);
    }

    return {
      current: { start: currentStart, end: currentEnd },
      previous: { start: previousStart, end: previousEnd }
    };
  },

  calculateTrend(currentValue: number, previousValue: number): number {
    if (previousValue === 0) return currentValue > 0 ? 100 : 0;
    return ((currentValue - previousValue) / previousValue) * 100;
  },

  formatTrend(trend: number, suffix = '%'): string {
    const sign = trend > 0 ? '↑' : trend < 0 ? '↓' : '';
    return `${sign} ${Math.abs(trend).toFixed(1)}${suffix}`;
  },

  async getBusinessOverview(period: string, branchName: string) {
    const { current, previous } = this.getDateRanges(period);

    // Resolve branch
    let branchFilter: any = {};
    if (branchName && branchName !== 'All') {
      if (branchName === 'Online') {
        branchFilter = { branchId: null };
      } else {
        const branch = await prisma.branch.findUnique({ where: { code: branchName.toUpperCase() } });
        if (branch) {
          branchFilter = { branchId: branch.id };
        } else {
          // If branch not found by code, try by name
          const branchByName = await prisma.branch.findFirst({ where: { name: { contains: branchName, mode: 'insensitive' } } });
          if (branchByName) {
            branchFilter = { branchId: branchByName.id };
          }
        }
      }
    }

    const orderBaseFilter = {
      ...branchFilter,
      status: { notIn: ['CANCELLED', 'REFUNDED', 'AWAITING_PAYMENT'] }
    };

    // Run aggregations concurrently to speed up dashboard
    const [
      currentOrdersAgg,
      currentNewCustomers,
      previousOrdersAgg,
      previousNewCustomers,
      pendingOrdersCount,
      inventoryResult,
      returnsAgg,
      gatewayGroups,
      recentTransactions
    ] = await Promise.all([
      // CURRENT PERIOD METRICS
      prisma.order.aggregate({
        where: {
          ...orderBaseFilter,
          createdAt: { gte: current.start, lte: current.end }
        },
        _sum: { total: true },
        _count: true
      }),
      prisma.customer.count({
        where: { createdAt: { gte: current.start, lte: current.end } }
      }),
      // PREVIOUS PERIOD METRICS
      prisma.order.aggregate({
        where: {
          ...orderBaseFilter,
          createdAt: { gte: previous.start, lte: previous.end }
        },
        _sum: { total: true },
        _count: true
      }),
      prisma.customer.count({
        where: { createdAt: { gte: previous.start, lte: previous.end } }
      }),
      // OVERALL METRICS
      prisma.order.count({
        where: {
          ...branchFilter,
          status: { in: ['PENDING', 'PROCESSING'] }
        }
      }),
      // CORRECTED Inventory Value Query (using InventoryItem)
      branchName && branchName !== 'All' && branchName !== 'Online'
        ? prisma.$queryRaw<[{ total: number | null }]>`
            SELECT SUM(pv.price * ii.quantity) as total 
            FROM "ProductVariant" pv 
            JOIN "InventoryItem" ii ON ii."variantId" = pv.id
            WHERE ii."branchId" = ${branchFilter.branchId}
          `
        : prisma.$queryRaw<[{ total: number | null }]>`
            SELECT SUM(pv.price * ii.quantity) as total 
            FROM "ProductVariant" pv 
            JOIN "InventoryItem" ii ON ii."variantId" = pv.id
          `,
      prisma.order.aggregate({
        where: {
          ...branchFilter,
          paymentStatus: 'REFUNDED',
          createdAt: { gte: current.start, lte: current.end }
        },
        _sum: { total: true }
      }),
      prisma.order.groupBy({
        by: ['paymentMethod'],
        where: {
          ...orderBaseFilter,
          createdAt: { gte: current.start, lte: current.end }
        },
        _sum: { total: true },
        _count: true
      }),
      prisma.order.findMany({
        where: orderBaseFilter,
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { customer: true, branch: true }
      })
    ]);

    const currentRevenue = currentOrdersAgg._sum.total || 0;
    const currentOrderCount = currentOrdersAgg._count || 0;
    const currentAvgOrderValue = currentOrderCount > 0 ? currentRevenue / currentOrderCount : 0;

    const previousRevenue = previousOrdersAgg._sum.total || 0;
    const previousOrderCount = previousOrdersAgg._count || 0;
    const previousAvgOrderValue = previousOrderCount > 0 ? previousRevenue / previousOrderCount : 0;

    const inventoryValue = inventoryResult[0]?.total || 0;
    const returnsValue = returnsAgg._sum.total || 0;

    const paymentGateways: Record<string, { count: number, total: number }> = {};
    let totalGatewayAmount = 0;
    
    gatewayGroups.forEach(group => {
      const method = group.paymentMethod || 'UNKNOWN';
      if (!paymentGateways[method]) {
        paymentGateways[method] = { count: 0, total: 0 };
      }
      paymentGateways[method].count += group._count;
      const total = group._sum.total || 0;
      paymentGateways[method].total += total;
      totalGatewayAmount += total;
    });

    const paymentGatewayPerformance = Object.entries(paymentGateways)
      .map(([gw, stats]) => ({
        gw,
        amount: stats.total,
        count: stats.count,
        pct: totalGatewayAmount > 0 ? Math.round((stats.total / totalGatewayAmount) * 100) : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    const revenueTrend = this.calculateTrend(currentRevenue, previousRevenue);
    const ordersTrend = this.calculateTrend(currentOrderCount, previousOrderCount);
    const customersTrend = this.calculateTrend(currentNewCustomers, previousNewCustomers);
    const aovTrend = this.calculateTrend(currentAvgOrderValue, previousAvgOrderValue);

    return {
      revenue: {
        value: currentRevenue,
        trend: `${this.formatTrend(revenueTrend)} vs last period`,
        trendType: revenueTrend >= 0 ? 'positive' : 'negative'
      },
      orders: {
        value: currentOrderCount,
        trend: `${this.formatTrend(ordersTrend)} vs last period`,
        trendType: ordersTrend >= 0 ? 'positive' : 'negative'
      },
      newCustomers: {
        value: currentNewCustomers,
        trend: `${this.formatTrend(customersTrend)} vs last period`,
        trendType: customersTrend >= 0 ? 'positive' : 'negative'
      },
      avgOrderValue: {
        value: currentAvgOrderValue,
        trend: `${this.formatTrend(aovTrend)} vs last period`,
        trendType: aovTrend >= 0 ? 'positive' : 'negative'
      },
      pendingOrders: {
        value: pendingOrdersCount,
        trend: "Requires action",
        trendType: pendingOrdersCount > 0 ? 'neutral' : 'positive'
      },
      inventoryValue: {
        value: inventoryValue,
        trend: "Across all branches",
        trendType: "neutral"
      },
      loyaltyPoints: {
        value: 0, // Mocked until loyalty engine is built
        trend: "Outstanding balance",
        trendType: "neutral"
      },
      returns: {
        value: returnsValue,
        trend: "This period",
        trendType: returnsValue > 0 ? 'negative' : 'neutral'
      },
      paymentGatewayPerformance,
      recentTransactions: recentTransactions.map(t => ({
        id: t.id,
        customer: t.customer?.firstName ? `${t.customer.firstName} ${t.customer.lastName || ''}`.trim() : (t.customer?.isGuest ? 'Guest' : 'Unknown'),
        branch: t.branch?.name || 'Online',
        amount: t.total,
        paymentMethod: t.paymentMethod || 'Unknown',
        paymentStatus: t.paymentStatus,
        orderStatus: t.status,
        createdAt: t.createdAt
      }))
    };
  },

  /**
   * Superadmin Executive Central Command Analytics
   * Canonical integration with P&L service and multi-branch inventory valuation
   */
  async getExecutiveOverview(period: string, branchId?: string) {
    const { current } = this.getDateRanges(period);
    const startDate = current.start.toISOString();
    const endDate = current.end.toISOString();

    // 1. Canonical P&L Engine
    const pnl = await pnlService.getProfitAndLossStatement({
      branchId,
      startDate,
      endDate,
    });

    // 2. Inventory Valuation across branches (Cost + Retail)
    const [invStats, transferStats] = await Promise.all([
      inventoryService.getStats(branchId),
      prisma.stockTransfer.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
    ]);

    const pendingTransfers = transferStats.find(t => t.status === 'PENDING')?._count.id || 0;
    const dispatchedTransfers = transferStats.find(t => t.status === 'DISPATCHED')?._count.id || 0;

    // 3. Payment Tenders (CASH, CARD, CREDIT_ACCOUNT / GARAGE_CREDIT, BANK_TRANSFER)
    const orderWhere: any = {
      paymentStatus: 'PAID',
      createdAt: { gte: current.start, lte: current.end },
    };
    if (branchId) orderWhere.branchId = branchId;

    const tenderGroups = await prisma.order.groupBy({
      by: ['paymentMethod'],
      where: orderWhere,
      _sum: { total: true },
      _count: { id: true },
    });

    const tenders = tenderGroups.map(t => ({
      method: t.paymentMethod || 'UNKNOWN',
      amount: t._sum.total || 0,
      count: t._count.id || 0,
      percentage: pnl.summary.netRevenue > 0 ? Math.round(((t._sum.total || 0) / pnl.summary.netRevenue) * 100) : 0,
    }));

    // 4. Detailed Branch Performance Matrix
    const allBranches = await prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, address: true, phone: true },
      orderBy: { name: 'asc' },
    });

    const branchMatrix = await Promise.all(
      allBranches.map(async (b) => {
        const [bOrders, bExpenses, bInv, bActiveShift] = await Promise.all([
          prisma.order.aggregate({
            where: { branchId: b.id, paymentStatus: 'PAID', createdAt: { gte: current.start, lte: current.end } },
            _sum: { total: true, subtotal: true },
            _count: { id: true },
          }),
          prisma.branchExpense.aggregate({
            where: { branchId: b.id, date: { gte: current.start, lte: current.end } },
            _sum: { amount: true },
          }),
          inventoryService.getStats(b.id),
          prisma.posSession.findFirst({
            where: { branchId: b.id, status: 'OPEN' },
            include: { user: { select: { name: true, email: true } } },
          }),
        ]);

        const revenue = bOrders._sum.total || 0;
        const expenses = bExpenses._sum.amount || 0;
        const ordersCount = bOrders._count.id || 0;

        return {
          branchId: b.id,
          branchName: b.name,
          branchCode: b.code,
          address: b.address,
          phone: b.phone,
          revenue,
          ordersCount,
          expenses,
          inventoryCost: bInv.estimatedCostValue,
          inventoryRetail: bInv.estimatedValue,
          totalStockQty: bInv.totalItems,
          lowStockCount: bInv.lowStockCount,
          activeShift: bActiveShift ? {
            cashierName: bActiveShift.user?.name || bActiveShift.user?.email || 'Active Cashier',
            openedAt: bActiveShift.openedAt,
            openingFloat: bActiveShift.openingFloat,
          } : null,
        };
      })
    );

    // 5. Recent Transactions with B2B oil context
    const recentOrders = await prisma.order.findMany({
      where: orderWhere,
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: {
            firstName: true,
            lastName: true,
            companyName: true,
            customerType: true,
            vehicleNumber: true,
          },
        },
        branch: { select: { name: true, code: true } },
      },
    });

    const formattedTransactions = recentOrders.map(o => ({
      id: o.id,
      customerName: o.customer?.companyName || (o.customer?.firstName ? `${o.customer.firstName} ${o.customer.lastName || ''}`.trim() : 'Walk-in Retail'),
      customerType: o.customer?.customerType || 'RETAIL',
      vehicleNumber: o.customer?.vehicleNumber || null,
      branchName: o.branch?.name || 'Main Hub',
      amount: o.total,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    }));

    return {
      period,
      branchId: branchId || 'ALL',
      pnl: pnl.summary,
      inventory: {
        totalUnits: invStats.totalItems,
        valuationAtCost: invStats.estimatedCostValue,
        valuationAtRetail: invStats.estimatedValue,
        lowStockAlerts: invStats.lowStockCount,
        outOfStockCount: invStats.outOfStockCount,
        totalCatalogSKUs: invStats.totalSKUs,
      },
      transfers: {
        pendingApproval: pendingTransfers,
        dispatchedInTransit: dispatchedTransfers,
      },
      tenders,
      branchMatrix,
      recentTransactions: formattedTransactions,
    };
  },

  /**
   * Branch Manager Local Dashboard
   */
  async getBranchManagerDashboard(branchId: string) {
    if (!branchId) throw new Error('branchId is required');

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (!branch) throw new Error('Branch not found');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    // 1. Today's sales vs Yesterday
    const [todayOrdersAgg, yesterdayOrdersAgg] = await Promise.all([
      prisma.order.aggregate({
        where: {
          branchId,
          paymentStatus: 'PAID',
          createdAt: { gte: todayStart },
        },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.order.aggregate({
        where: {
          branchId,
          paymentStatus: 'PAID',
          createdAt: { gte: yesterdayStart, lt: todayStart },
        },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    const todaySales = todayOrdersAgg._sum.total || 0;
    const todayOrdersCount = todayOrdersAgg._count.id || 0;
    const yesterdaySales = yesterdayOrdersAgg._sum.total || 0;
    const salesGrowth = this.calculateTrend(todaySales, yesterdaySales);

    // 2. Active Cashier / Shift Status
    const activeShift = await prisma.posSession.findFirst({
      where: { branchId, status: 'OPEN' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { openedAt: 'desc' },
    });

    // 3. Tenders Breakdown for Today
    const todayTenderGroups = await prisma.order.groupBy({
      by: ['paymentMethod'],
      where: {
        branchId,
        paymentStatus: 'PAID',
        createdAt: { gte: todayStart },
      },
      _sum: { total: true },
      _count: { id: true },
    });

    const tenders = todayTenderGroups.map(t => ({
      method: t.paymentMethod || 'UNKNOWN',
      amount: t._sum.total || 0,
      count: t._count.id || 0,
      percentage: todaySales > 0 ? Math.round(((t._sum.total || 0) / todaySales) * 100) : 0,
    }));

    // 4. Critical Low Stock Lubricants in this Branch
    const criticalItems = await prisma.$queryRaw<any[]>`
      SELECT 
        ii.id,
        ii.quantity,
        ii."lowStockThreshold",
        pv.id as "variantId",
        pv.sku,
        pv.name as "variantName",
        pv.price,
        p.name as "productName",
        p.brand,
        p.grade,
        p."unitVolume",
        p."productType"
      FROM "InventoryItem" ii
      JOIN "ProductVariant" pv ON ii."variantId" = pv.id
      JOIN "Product" p ON pv."productId" = p.id
      WHERE ii."branchId" = ${branchId}
        AND ii.quantity <= ii."lowStockThreshold"
      ORDER BY ii.quantity ASC
      LIMIT 10
    `;

    // 5. Pending Transfers for this Branch (Incoming and Outgoing)
    const [incomingTransfers, outgoingTransfers] = await Promise.all([
      prisma.stockTransfer.findMany({
        where: { toBranchId: branchId, status: { in: ['PENDING', 'APPROVED', 'DISPATCHED'] } },
        include: {
          fromBranch: { select: { name: true, code: true } },
          variant: { select: { sku: true, name: true, product: { select: { name: true, brand: true, viscosity: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.stockTransfer.findMany({
        where: { fromBranchId: branchId, status: { in: ['PENDING', 'APPROVED', 'DISPATCHED'] } },
        include: {
          toBranch: { select: { name: true, code: true } },
          variant: { select: { sku: true, name: true, product: { select: { name: true, brand: true, viscosity: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    // 6. Recent Branch Orders
    const recentOrders = await prisma.order.findMany({
      where: { branchId },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: {
            firstName: true,
            lastName: true,
            companyName: true,
            customerType: true,
            vehicleNumber: true,
          },
        },
        items: {
          select: {
            quantity: true,
            priceAtPurchase: true,
            dispensedVolumeLiters: true,
            variant: {
              select: {
                name: true,
                product: { select: { name: true, brand: true, viscosity: true } },
              },
            },
          },
        },
      },
    });

    // 7. Branch Inventory Stats
    const branchInvStats = await inventoryService.getStats(branchId);

    return {
      branch: {
        id: branch.id,
        name: branch.name,
        code: branch.code,
        address: branch.address,
        phone: branch.phone,
      },
      today: {
        sales: todaySales,
        ordersCount: todayOrdersCount,
        avgOrderValue: todayOrdersCount > 0 ? Math.round(todaySales / todayOrdersCount) : 0,
        yesterdaySales,
        salesGrowth: `${salesGrowth >= 0 ? '+' : ''}${salesGrowth.toFixed(1)}%`,
      },
      activeShift: activeShift ? {
        sessionId: activeShift.id,
        cashierId: activeShift.user.id,
        cashierName: activeShift.user?.name || activeShift.user?.email || 'Active Cashier',
        openedAt: activeShift.openedAt,
        openingFloat: activeShift.openingFloat,
        totalCashSales: activeShift.totalCashSales,
        totalCardSales: activeShift.totalCardSales,
        totalCreditSales: activeShift.totalCreditSales,
        estimatedCashInDrawer: activeShift.openingFloat + (activeShift.totalCashSales || 0),
      } : null,
      inventoryStats: branchInvStats,
      criticalLubricants: criticalItems.map(item => ({
        id: item.id,
        variantId: item.variantId,
        sku: item.sku,
        productName: item.productName,
        brand: item.brand,
        grade: item.grade,
        unitVolume: item.unitVolume,
        productType: item.productType,
        quantity: item.quantity,
        threshold: item.lowStockThreshold,
        price: item.price,
      })),
      tenders,
      incomingTransfers,
      outgoingTransfers,
      recentOrders: recentOrders.map(o => ({
        id: o.id,
        customerName: o.customer?.companyName || (o.customer?.firstName ? `${o.customer.firstName} ${o.customer.lastName || ''}`.trim() : 'Walk-in Retail'),
        customerType: o.customer?.customerType || 'RETAIL',
        vehicleNumber: o.customer?.vehicleNumber || null,
        amount: o.total,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        createdAt: o.createdAt,
        itemsCount: o.items.length,
        itemsSummary: o.items.map(i => `${i.variant?.product?.name || 'Item'} (x${i.quantity})`).join(', '),
      })),
    };
  }
};
