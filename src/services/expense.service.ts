import prisma from '../config/prisma';

export interface CreateExpenseDTO {
  branchId: string;
  category: string; // RENT, ELECTRICITY, WATER, SALARY, MAINTENANCE, EQUIPMENT, SUPPLIES, MARKETING, OTHER
  title: string;
  amount: number;
  date?: Date | string;
  notes?: string;
  receiptUrl?: string;
  createdById?: string;
}

export const expenseService = {
  async getExpenses(params: {
    branchId?: string;
    category?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.branchId) {
      where.branchId = params.branchId;
    }
    if (params.category) {
      where.category = params.category.toUpperCase();
    }
    if (params.startDate || params.endDate) {
      where.date = {};
      if (params.startDate) where.date.gte = new Date(params.startDate);
      if (params.endDate) where.date.lte = new Date(params.endDate);
    }

    const [expenses, total] = await Promise.all([
      prisma.branchExpense.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          branch: {
            select: { id: true, name: true, code: true }
          },
          createdBy: {
            select: { id: true, name: true, email: true }
          }
        }
      }),
      prisma.branchExpense.count({ where })
    ]);

    return {
      data: expenses,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  async createExpense(data: CreateExpenseDTO) {
    if (!data.branchId) throw new Error('Branch ID is required');
    if (!data.title) throw new Error('Expense title is required');
    if (data.amount === undefined || data.amount <= 0) throw new Error('Valid expense amount is required');

    return await prisma.branchExpense.create({
      data: {
        branchId: data.branchId,
        category: (data.category || 'OTHER').toUpperCase(),
        title: data.title,
        amount: data.amount,
        date: data.date ? new Date(data.date) : new Date(),
        notes: data.notes,
        receiptUrl: data.receiptUrl,
        createdById: data.createdById
      },
      include: {
        branch: {
          select: { id: true, name: true, code: true }
        }
      }
    });
  },

  async deleteExpense(id: string) {
    return await prisma.branchExpense.delete({
      where: { id }
    });
  },

  async getExpenseSummary(params: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where: any = {};
    if (params.branchId) where.branchId = params.branchId;
    if (params.startDate || params.endDate) {
      where.date = {};
      if (params.startDate) where.date.gte = new Date(params.startDate);
      if (params.endDate) where.date.lte = new Date(params.endDate);
    }

    const [groupedByCategory, totalAgg] = await Promise.all([
      prisma.branchExpense.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        _count: { id: true }
      }),
      prisma.branchExpense.aggregate({
        where,
        _sum: { amount: true },
        _count: { id: true }
      })
    ]);

    return {
      totalAmount: totalAgg._sum.amount || 0,
      totalCount: totalAgg._count.id || 0,
      breakdown: groupedByCategory.map(item => ({
        category: item.category,
        total: item._sum.amount || 0,
        count: item._count.id
      }))
    };
  }
};
