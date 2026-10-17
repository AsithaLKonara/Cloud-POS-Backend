import prisma from '../config/prisma';

export interface PnLFilterParams {
  branchId?: string;
  startDate?: string;
  endDate?: string;
}

export interface PnLStatement {
  period: {
    startDate: string;
    endDate: string;
  };
  branchId: string;
  summary: {
    totalOrdersCount: number;
    grossRevenue: number;
    totalDiscounts: number;
    totalTaxes: number;
    totalRefunds: number;
    refunds: number;
    netRevenue: number;
    cogs: {
      totalCogs: number;
      oilCogs: number;
      nonOilCogs: number;
      oilRevenue: number;
      nonOilRevenue: number;
      servicesCogs: number;
      servicesRevenue: number;
      physicalCogs: number;
      physicalRevenue: number;
    };
    grossProfit: number;
    grossMarginPercent: number;
    operatingExpenses: {
      total: number;
      breakdown: {
        category: string;
        amount: number;
        percentageOfExpenses: number;
      }[];
    };
    wastageLoss: number;
    netOperatingProfit: number;
    netProfit: number;
    netMarginPercent: number;
  };
  breakdown: {
    byProductType: {
      servicesRevenue: number;
      servicesCogs: number;
      servicesGrossProfit: number;
      physicalRevenue: number;
      physicalCogs: number;
      physicalGrossProfit: number;
    };
    byCategory: {
      categoryId: string;
      categoryName: string;
      revenue: number;
      cogs: number;
      grossProfit: number;
      marginPercent: number;
    }[];
    byExpenseCategory: {
      category: string;
      amount: number;
      percentage: number;
    }[];
  };
  branchComparison: {
    branchId: string;
    branchName: string;
    branchCode: string;
    revenue: number;
    cogs: number;
    expenses: number;
    estimatedNet: number;
    netProfit: number;
  }[];
}

export const pnlService = {
  /**
   * Authoritative canonical Profit & Loss (P&L) Engine
   * Conforms to GAAP standards with strict zero client-side calculation guarantees:
   * Net Revenue = Gross Orders - Discounts - Approved Returns/Refunds
   * COGS = Σ(Unit Cost * Quantity) across all products (bypassing non-tracked services)
   * Gross Profit = Net Revenue - COGS
   * Net Operating Profit (EBIT) = Gross Profit - Operating Expenses - Wastage Loss
   */
  async getProfitAndLossStatement(params: PnLFilterParams): Promise<PnLStatement> {
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

    // 2. Returns Filter (Approved or Completed RMA refunds)
    const returnWhere: any = {
      status: { in: ['APPROVED', 'COMPLETED'] },
    };
    if (branchId) returnWhere.order = { branchId };
    if (hasDate) returnWhere.createdAt = dateFilter;

    // 3. Operating Expenses Filter
    const expenseWhere: any = {};
    if (branchId) expenseWhere.branchId = branchId;
    if (hasDate) expenseWhere.date = dateFilter;

    // 4. Wastage Filter
    const wastageWhere: any = {
      type: { in: ['SPILLAGE_WASTAGE', 'DAMAGE'] },
    };
    if (branchId) wastageWhere.branchId = branchId;
    if (hasDate) wastageWhere.createdAt = dateFilter;

    // Execute core aggregations in parallel
    const [ordersAgg, orderItems, returnsAgg, expenseAgg, expenseCategories, wastageTransactions] = await Promise.all([
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
                  trackInventory: true,
                  brand: true,
                  categoryId: true,
                  category: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.returnRequest.aggregate({
        where: returnWhere,
        _sum: {
          refundAmount: true,
        },
      }),
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
      prisma.inventoryTransaction.findMany({
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
      }),
    ]);

    const totalOrdersCount = ordersAgg._count.id || 0;
    const grossRevenue = Number((ordersAgg._sum.subtotal || 0).toFixed(2));
    const totalDiscounts = Number((ordersAgg._sum.discount || 0).toFixed(2));
    const totalTaxes = Number((ordersAgg._sum.tax || 0).toFixed(2));
    const totalRefunds = Number((returnsAgg._sum.refundAmount || 0).toFixed(2));

    // Net Revenue: Gross order totals minus approved refunds/returns
    const netRevenue = Number(Math.max(0, (ordersAgg._sum.total || 0) - totalRefunds).toFixed(2));

    // Calculate COGS and Breakdown by Product Type (Services vs Physical Goods, Oil vs Non-Oil)
    let totalCogs = 0;
    let servicesRevenue = 0;
    let servicesCogs = 0;
    let physicalRevenue = 0;
    let physicalCogs = 0;
    let oilCogs = 0;
    let nonOilCogs = 0;
    let oilRevenue = 0;
    let nonOilRevenue = 0;

    const categoryStats = new Map<string, { categoryId: string; categoryName: string; revenue: number; cogs: number }>();

    for (const item of orderItems) {
      const isService = item.variant?.product?.productType === 'SERVICE' || item.variant?.product?.trackInventory === false;

      const unitCost = isService
        ? (item.costPriceAtPurchase || 0)
        : (item.costPriceAtPurchase > 0 ? item.costPriceAtPurchase : (item.variant?.costPrice || 0));

      const itemCogs = unitCost * item.quantity;
      const itemRev = item.priceAtPurchase * item.quantity;

      totalCogs += itemCogs;

      if (isService) {
        servicesRevenue += itemRev;
        servicesCogs += itemCogs;
      } else {
        physicalRevenue += itemRev;
        physicalCogs += itemCogs;
      }

      // Backward compatibility for automotive lubricants
      const isOil = item.variant?.product?.productType === 'LUBRICANT';
      if (isOil) {
        oilCogs += itemCogs;
        oilRevenue += itemRev;
      } else {
        nonOilCogs += itemCogs;
        nonOilRevenue += itemRev;
      }

      // Dynamic Category Breakdown
      const catId = item.variant?.product?.categoryId || 'uncategorized';
      const catName = item.variant?.product?.category?.name || 'Uncategorized';
      const existingCat = categoryStats.get(catId) || {
        categoryId: catId,
        categoryName: catName,
        revenue: 0,
        cogs: 0,
      };
      existingCat.revenue += itemRev;
      existingCat.cogs += itemCogs;
      categoryStats.set(catId, existingCat);
    }

    totalCogs = Number(totalCogs.toFixed(2));
    servicesRevenue = Number(servicesRevenue.toFixed(2));
    servicesCogs = Number(servicesCogs.toFixed(2));
    physicalRevenue = Number(physicalRevenue.toFixed(2));
    physicalCogs = Number(physicalCogs.toFixed(2));
    oilRevenue = Number(oilRevenue.toFixed(2));
    oilCogs = Number(oilCogs.toFixed(2));
    nonOilRevenue = Number(nonOilRevenue.toFixed(2));
    nonOilCogs = Number(nonOilCogs.toFixed(2));

    const grossProfit = Number((netRevenue - totalCogs).toFixed(2));
    const grossMarginPercent = netRevenue > 0 ? Number(((grossProfit / netRevenue) * 100).toFixed(2)) : 0;

    // Operating Expenses
    const totalOperatingExpenses = Number((expenseAgg._sum.amount || 0).toFixed(2));
    const expenseBreakdown = expenseCategories.map((cat) => ({
      category: cat.category,
      amount: Number((cat._sum.amount || 0).toFixed(2)),
      percentageOfExpenses: totalOperatingExpenses > 0 ? Number((((cat._sum.amount || 0) / totalOperatingExpenses) * 100).toFixed(2)) : 0,
    }));

    // Wastage Loss
    let totalWastageLoss = 0;
    for (const tx of wastageTransactions) {
      const unitCost = tx.costPriceAtTransaction !== null && tx.costPriceAtTransaction !== undefined
        ? tx.costPriceAtTransaction
        : (tx.variant?.costPrice || 0);
      totalWastageLoss += Math.abs(tx.quantityChange) * unitCost;
    }
    totalWastageLoss = Number(totalWastageLoss.toFixed(2));

    // Net Operating Profit (EBIT)
    const netOperatingProfit = Number((grossProfit - totalOperatingExpenses - totalWastageLoss).toFixed(2));
    const netProfit = netOperatingProfit;
    const netMarginPercent = netRevenue > 0 ? Number(((netOperatingProfit / netRevenue) * 100).toFixed(2)) : 0;

    // Category breakdown list
    const byCategory = Array.from(categoryStats.values()).map((cat) => {
      const catGrossProfit = Number((cat.revenue - cat.cogs).toFixed(2));
      const margin = cat.revenue > 0 ? Number(((catGrossProfit / cat.revenue) * 100).toFixed(2)) : 0;
      return {
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        revenue: Number(cat.revenue.toFixed(2)),
        cogs: Number(cat.cogs.toFixed(2)),
        grossProfit: catGrossProfit,
        marginPercent: margin,
      };
    });

    // Multi-Branch Comparison
    let branchComparison: PnLStatement['branchComparison'] = [];
    if (!branchId) {
      const allBranches = await prisma.branch.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true },
      });

      branchComparison = await Promise.all(
        allBranches.map(async (b) => {
          const [bOrders, bExpenses, bReturns, bItems] = await Promise.all([
            prisma.order.aggregate({
              where: { branchId: b.id, paymentStatus: 'PAID', ...(hasDate ? { createdAt: dateFilter } : {}) },
              _sum: { total: true },
            }),
            prisma.branchExpense.aggregate({
              where: { branchId: b.id, ...(hasDate ? { date: dateFilter } : {}) },
              _sum: { amount: true },
            }),
            prisma.returnRequest.aggregate({
              where: { order: { branchId: b.id }, status: { in: ['APPROVED', 'COMPLETED'] }, ...(hasDate ? { createdAt: dateFilter } : {}) },
              _sum: { refundAmount: true },
            }),
            prisma.orderItem.findMany({
              where: { order: { branchId: b.id, paymentStatus: 'PAID', ...(hasDate ? { createdAt: dateFilter } : {}) } },
              select: {
                quantity: true,
                costPriceAtPurchase: true,
                variant: {
                  select: {
                    costPrice: true,
                    product: {
                      select: {
                        trackInventory: true,
                        productType: true,
                      },
                    },
                  },
                },
              },
            }),
          ]);

          let bCogs = 0;
          for (const it of bItems) {
            const isSvc = it.variant?.product?.productType === 'SERVICE' || it.variant?.product?.trackInventory === false;
            const uCost = isSvc
              ? (it.costPriceAtPurchase || 0)
              : (it.costPriceAtPurchase > 0 ? it.costPriceAtPurchase : (it.variant?.costPrice || 0));
            bCogs += uCost * it.quantity;
          }

          const rawTotal = bOrders._sum.total || 0;
          const rawRefunds = bReturns._sum.refundAmount || 0;
          const bRev = Number(Math.max(0, rawTotal - rawRefunds).toFixed(2));
          const bExp = Number((bExpenses._sum.amount || 0).toFixed(2));
          bCogs = Number(bCogs.toFixed(2));
          const bNet = Number((bRev - bCogs - bExp).toFixed(2));

          return {
            branchId: b.id,
            branchName: b.name,
            branchCode: b.code,
            revenue: bRev,
            cogs: bCogs,
            expenses: bExp,
            estimatedNet: bNet,
            netProfit: bNet,
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
        totalRefunds,
        refunds: totalRefunds,
        netRevenue,
        cogs: {
          totalCogs,
          oilCogs,
          nonOilCogs,
          oilRevenue,
          nonOilRevenue,
          servicesCogs,
          servicesRevenue,
          physicalCogs,
          physicalRevenue,
        },
        grossProfit,
        grossMarginPercent,
        operatingExpenses: {
          total: totalOperatingExpenses,
          breakdown: expenseBreakdown,
        },
        wastageLoss: totalWastageLoss,
        netOperatingProfit,
        netProfit,
        netMarginPercent,
      },
      breakdown: {
        byProductType: {
          servicesRevenue,
          servicesCogs,
          servicesGrossProfit: Number((servicesRevenue - servicesCogs).toFixed(2)),
          physicalRevenue,
          physicalCogs,
          physicalGrossProfit: Number((physicalRevenue - physicalCogs).toFixed(2)),
        },
        byCategory,
        byExpenseCategory: expenseBreakdown.map((e) => ({
          category: e.category,
          amount: e.amount,
          percentage: e.percentageOfExpenses,
        })),
      },
      branchComparison,
    };
  },
};

