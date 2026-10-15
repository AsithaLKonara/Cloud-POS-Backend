import prisma from '../config/prisma';

export interface PnLFilterParams {
  branchId?: string;
  startDate?: string;
  endDate?: string;
}

export const pnlService = {
  /**
   * Authoritative canonical Profit & Loss (P&L) Engine
   */
  async getProfitAndLossStatement(params: PnLFilterParams) {
    const { branchId, startDate, endDate } = params;

    // Date range filter
    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const hasDate = Object.keys(dateFilter).length > 0;

    // 1. Orders Filter (Only completed/delivered/paid sales)
    const orderWhere: any = {
      paymentStatus: 'PAID',
    };
    if (branchId) orderWhere.branchId = branchId;
    if (hasDate) orderWhere.createdAt = dateFilter;

    // 2. Fetch Aggregated Sales & COGS
    const [ordersAgg, orderItems] = await Promise.all([
      prisma.order.aggregate({
        where: orderWhere,
        _sum: {
          subtotal: true,
          discount: true,
          tax: true,
          total: true,
        },
        _count: {
          id: true,
        },
      }),
      prisma.orderItem.findMany({
        where: {
          order: orderWhere,
        },
        select: {
          quantity: true,
          priceAtPurchase: true,
          costPriceAtPurchase: true,
          variant: {
            select: {
              costPrice: true,
              product: {
                select: {
                  productType: true,
                  brand: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const totalOrdersCount = ordersAgg._count.id || 0;
    const grossRevenue = ordersAgg._sum.subtotal || 0;
    const totalDiscounts = ordersAgg._sum.discount || 0;
    const totalTaxes = ordersAgg._sum.tax || 0;
    const netRevenue = ordersAgg._sum.total || 0;

    // Calculate COGS and Breakdown by Product Type (Oils vs Non-Oil)
    let totalCogs = 0;
    let oilCogs = 0;
    let nonOilCogs = 0;
    let oilRevenue = 0;
    let nonOilRevenue = 0;

    for (const item of orderItems) {
      const unitCost = item.costPriceAtPurchase > 0 
        ? item.costPriceAtPurchase 
        : (item.variant?.costPrice || 0);

      const itemCogs = unitCost * item.quantity;
      const itemRev = item.priceAtPurchase * item.quantity;

      totalCogs += itemCogs;

      const isOil = item.variant?.product?.productType === 'LUBRICANT';
      if (isOil) {
        oilCogs += itemCogs;
        oilRevenue += itemRev;
      } else {
        nonOilCogs += itemCogs;
        nonOilRevenue += itemRev;
      }
    }

    const grossProfit = netRevenue - totalCogs;
    const grossMarginPercent = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

    // 3. Operating Expenses Aggregation
    const expenseWhere: any = {};
    if (branchId) expenseWhere.branchId = branchId;
    if (hasDate) expenseWhere.date = dateFilter;

    const [expenseAgg, expenseCategories] = await Promise.all([
      prisma.branchExpense.aggregate({
        where: expenseWhere,
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.branchExpense.groupBy({
        by: ['category'],
        where: expenseWhere,
        _sum: { amount: true },
      }),
    ]);

    const totalOperatingExpenses = expenseAgg._sum.amount || 0;
    const expenseBreakdown = expenseCategories.map((cat) => ({
      category: cat.category,
      amount: cat._sum.amount || 0,
      percentageOfExpenses: totalOperatingExpenses > 0 ? ((cat._sum.amount || 0) / totalOperatingExpenses) * 100 : 0,
    }));

    // 4. Spillage / Wastage / Damage Loss Aggregation
    const wastageWhere: any = {
      type: { in: ['SPILLAGE_WASTAGE', 'DAMAGE'] },
    };
    if (branchId) wastageWhere.branchId = branchId;
    if (hasDate) wastageWhere.createdAt = dateFilter;

    const wastageTransactions = await prisma.inventoryTransaction.findMany({
      where: wastageWhere,
      select: {
        quantityChange: true,
        costPriceAtTransaction: true,
        variant: {
          select: {
            costPrice: true,
          },
        },
      },
    });

    let totalWastageLoss = 0;
    for (const tx of wastageTransactions) {
      const unitCost = tx.costPriceAtTransaction !== null && tx.costPriceAtTransaction !== undefined
        ? tx.costPriceAtTransaction
        : (tx.variant?.costPrice || 0);
      totalWastageLoss += Math.abs(tx.quantityChange) * unitCost;
    }

    // 5. Final Net Profit Computation
    const netProfit = grossProfit - totalOperatingExpenses - totalWastageLoss;
    const netMarginPercent = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;

    // 6. Branch Comparison (when Superadmin views all branches)
    let branchComparison: any[] = [];
    if (!branchId) {
      const allBranches = await prisma.branch.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
      });

      branchComparison = await Promise.all(
        allBranches.map(async (b) => {
          const bOrders = await prisma.order.aggregate({
            where: { branchId: b.id, paymentStatus: 'PAID', ...(hasDate ? { createdAt: dateFilter } : {}) },
            _sum: { total: true },
          });

          const bExpenses = await prisma.branchExpense.aggregate({
            where: { branchId: b.id, ...(hasDate ? { date: dateFilter } : {}) },
            _sum: { amount: true },
          });

          const bRev = bOrders._sum.total || 0;
          const bExp = bExpenses._sum.amount || 0;

          return {
            branchId: b.id,
            branchName: b.name,
            branchCode: b.code,
            revenue: bRev,
            expenses: bExp,
            estimatedNet: bRev - bExp,
          };
        })
      );
    }

    return {
      period: {
        startDate: startDate || 'ALL_TIME',
        endDate: endDate || 'CURRENT',
      },
      branchId: branchId || 'ALL_BRANCHES',
      summary: {
        totalOrdersCount,
        grossRevenue,
        totalDiscounts,
        totalTaxes,
        netRevenue,
        cogs: {
          totalCogs,
          oilCogs,
          nonOilCogs,
          oilRevenue,
          nonOilRevenue,
        },
        grossProfit,
        grossMarginPercent: Number(grossMarginPercent.toFixed(2)),
        operatingExpenses: {
          total: totalOperatingExpenses,
          breakdown: expenseBreakdown,
        },
        wastageLoss: totalWastageLoss,
        netProfit,
        netMarginPercent: Number(netMarginPercent.toFixed(2)),
      },
      branchComparison,
    };
  },
};
