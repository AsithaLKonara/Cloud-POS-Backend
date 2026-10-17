jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    order: {
      aggregate: jest.fn(),
    },
    orderItem: {
      findMany: jest.fn(),
    },
    returnRequest: {
      aggregate: jest.fn(),
    },
    branchExpense: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    inventoryTransaction: {
      findMany: jest.fn(),
    },
    branch: {
      findMany: jest.fn(),
    },
  },
}));

import prisma from '../config/prisma';
import { pnlService } from '../services/pnl.service';

const mockPrisma = prisma as any;

describe('Universal P&L & Financial Accounting (Task 6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Canonical P&L Metrics & Zero Client-Side Calculation Guarantees', () => {
    it('accurately computes Gross Revenue, Discounts, Approved Returns, and Net Revenue', async () => {
      // 1. Orders Aggregate: Subtotal 1000, Discount 100, Tax 50, Total 950
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: {
          subtotal: 1000,
          discount: 100,
          tax: 50,
          total: 950,
        },
        _count: {
          id: 10,
        },
      });

      // 2. Order items: 1 physical item (cost 40, price 100, qty 5)
      mockPrisma.orderItem.findMany.mockResolvedValue([
        {
          quantity: 5,
          priceAtPurchase: 100,
          costPriceAtPurchase: 40,
          variant: {
            costPrice: 40,
            product: {
              productType: 'PHYSICAL',
              trackInventory: true,
              brand: 'BrandX',
              categoryId: 'cat-1',
              category: { id: 'cat-1', name: 'Electronics' },
            },
          },
        },
      ]);

      // 3. Approved Returns: 50
      mockPrisma.returnRequest.aggregate.mockResolvedValue({
        _sum: { refundAmount: 50 },
      });

      // 4. Expenses: 150
      mockPrisma.branchExpense.aggregate.mockResolvedValue({
        _sum: { amount: 150 },
        _count: { id: 3 },
      });
      mockPrisma.branchExpense.groupBy.mockResolvedValue([
        { category: 'RENT', _sum: { amount: 100 } },
        { category: 'UTILITIES', _sum: { amount: 50 } },
      ]);

      // 5. Wastage: 10
      mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
        {
          quantityChange: -2,
          costPriceAtTransaction: 5,
          variant: { costPrice: 5 },
        },
      ]);

      const statement = await pnlService.getProfitAndLossStatement({
        branchId: 'branch-1',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      // Assertions
      expect(statement.summary.totalOrdersCount).toBe(10);
      expect(statement.summary.grossRevenue).toBe(1000);
      expect(statement.summary.totalDiscounts).toBe(100);
      expect(statement.summary.totalRefunds).toBe(50);
      expect(statement.summary.refunds).toBe(50);

      // Net Revenue = Total Orders (950) - Returns (50) = 900
      expect(statement.summary.netRevenue).toBe(900);

      // COGS = 5 * 40 = 200
      expect(statement.summary.cogs.totalCogs).toBe(200);

      // Gross Profit = Net Revenue (900) - COGS (200) = 700
      expect(statement.summary.grossProfit).toBe(700);
      // Gross Margin = (700 / 900) * 100 = 77.78%
      expect(statement.summary.grossMarginPercent).toBe(77.78);

      // Operating Expenses = 150
      expect(statement.summary.operatingExpenses.total).toBe(150);
      expect(statement.summary.operatingExpenses.breakdown).toHaveLength(2);
      expect(statement.summary.operatingExpenses.breakdown[0].category).toBe('RENT');
      expect(statement.summary.operatingExpenses.breakdown[0].percentageOfExpenses).toBe(66.67);

      // Wastage Loss = 2 * 5 = 10
      expect(statement.summary.wastageLoss).toBe(10);

      // Net Operating Profit (EBIT) = Gross Profit (700) - OPEX (150) - Wastage (10) = 540
      expect(statement.summary.netOperatingProfit).toBe(540);
      expect(statement.summary.netProfit).toBe(540);
      // Net Margin = (540 / 900) * 100 = 60.00%
      expect(statement.summary.netMarginPercent).toBe(60.0);
    });

    it('handles service products with zero physical inventory COGS and category breakdown', async () => {
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: {
          subtotal: 500,
          discount: 0,
          tax: 0,
          total: 500,
        },
        _count: { id: 5 },
      });

      // 1 Service item (Haircut, $50 x 6 = $300, 0 cost) + 1 Physical item (Shampoo, $20 x 10 = $200, $8 cost)
      mockPrisma.orderItem.findMany.mockResolvedValue([
        {
          quantity: 6,
          priceAtPurchase: 50,
          costPriceAtPurchase: 0,
          variant: {
            costPrice: 0,
            product: {
              productType: 'SERVICE',
              trackInventory: false,
              brand: null,
              categoryId: 'cat-salon',
              category: { id: 'cat-salon', name: 'Hair Services' },
            },
          },
        },
        {
          quantity: 10,
          priceAtPurchase: 20,
          costPriceAtPurchase: 8,
          variant: {
            costPrice: 8,
            product: {
              productType: 'PHYSICAL',
              trackInventory: true,
              brand: 'Loreal',
              categoryId: 'cat-retail',
              category: { id: 'cat-retail', name: 'Retail Products' },
            },
          },
        },
      ]);

      mockPrisma.returnRequest.aggregate.mockResolvedValue({ _sum: { refundAmount: 0 } });
      mockPrisma.branchExpense.aggregate.mockResolvedValue({ _sum: { amount: 100 }, _count: { id: 1 } });
      mockPrisma.branchExpense.groupBy.mockResolvedValue([{ category: 'SALARIES', _sum: { amount: 100 } }]);
      mockPrisma.inventoryTransaction.findMany.mockResolvedValue([]);

      const statement = await pnlService.getProfitAndLossStatement({
        branchId: 'salon-branch',
      });

      expect(statement.summary.netRevenue).toBe(500);
      // Service COGS is 0, Physical COGS is 80 (10 * 8) => Total COGS = 80
      expect(statement.summary.cogs.totalCogs).toBe(80);
      expect(statement.summary.cogs.servicesCogs).toBe(0);
      expect(statement.summary.cogs.servicesRevenue).toBe(300);
      expect(statement.summary.cogs.physicalCogs).toBe(80);
      expect(statement.summary.cogs.physicalRevenue).toBe(200);

      // Product Type Breakdown
      expect(statement.breakdown.byProductType.servicesGrossProfit).toBe(300);
      expect(statement.breakdown.byProductType.physicalGrossProfit).toBe(120); // 200 - 80

      // Category Breakdown
      expect(statement.breakdown.byCategory).toHaveLength(2);
      const hairCat = statement.breakdown.byCategory.find(c => c.categoryName === 'Hair Services');
      expect(hairCat).toBeDefined();
      expect(hairCat?.revenue).toBe(300);
      expect(hairCat?.cogs).toBe(0);
      expect(hairCat?.grossProfit).toBe(300);
      expect(hairCat?.marginPercent).toBe(100);
    });

    it('aggregates multi-branch comparison when branchId is omitted without double counting', async () => {
      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: { subtotal: 2000, discount: 0, tax: 0, total: 2000 },
        _count: { id: 20 },
      });
      mockPrisma.orderItem.findMany.mockResolvedValue([]);
      mockPrisma.returnRequest.aggregate.mockResolvedValue({ _sum: { refundAmount: 0 } });
      mockPrisma.branchExpense.aggregate.mockResolvedValue({ _sum: { amount: 500 }, _count: { id: 2 } });
      mockPrisma.branchExpense.groupBy.mockResolvedValue([]);
      mockPrisma.inventoryTransaction.findMany.mockResolvedValue([]);

      // Branch Comparison Mock: 2 Branches
      mockPrisma.branch.findMany.mockResolvedValue([
        { id: 'b-1', name: 'Downtown Branch', code: 'DT-01' },
        { id: 'b-2', name: 'Uptown Branch', code: 'UT-02' },
      ]);

      const statement = await pnlService.getProfitAndLossStatement({});

      expect(statement.branchId).toBe('ALL_BRANCHES');
      expect(statement.branchComparison).toHaveLength(2);
      expect(statement.branchComparison[0].branchCode).toBe('DT-01');
      expect(statement.branchComparison[1].branchCode).toBe('UT-02');
    });
  });
});
