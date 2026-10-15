import { Request, Response } from 'express';
import { expenseService } from '../services/expense.service';

export class ExpenseController {
  async getExpenses(req: Request, res: Response) {
    try {
      const { branchId, category, startDate, endDate, page, limit } = req.query;

      const result = await expenseService.getExpenses({
        branchId: branchId as string | undefined,
        category: category as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
      });

      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  }

  async createExpense(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { branchId, category, title, amount, date, notes, receiptUrl } = req.body;

      const result = await expenseService.createExpense({
        branchId,
        category,
        title,
        amount: parseFloat(amount),
        date,
        notes,
        receiptUrl,
        createdById: userId,
      });

      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to create expense' });
    }
  }

  async deleteExpense(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      if (!id) {
        res.status(400).json({ error: 'Expense ID is required' });
        return;
      }
      await expenseService.deleteExpense(id);
      res.status(200).json({ message: 'Expense deleted successfully' });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to delete expense' });
    }
  }

  async getSummary(req: Request, res: Response) {
    try {
      const { branchId, startDate, endDate } = req.query;
      const result = await expenseService.getExpenseSummary({
        branchId: branchId as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  }
}
