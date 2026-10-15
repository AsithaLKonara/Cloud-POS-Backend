import { Router } from 'express';
import { ExpenseController } from '../controllers/expense.controller';
import { authenticateJWT, requireRole } from '../middlewares/auth.middleware';

const router = Router();
const controller = new ExpenseController();

// Expenses can be viewed by Admin, Superadmin, and Branch Managers
router.get('/', authenticateJWT, requireRole('ADMIN', 'SUPER_ADMIN', 'BRANCH_MANAGER'), controller.getExpenses.bind(controller));
router.get('/summary', authenticateJWT, requireRole('ADMIN', 'SUPER_ADMIN', 'BRANCH_MANAGER'), controller.getSummary.bind(controller));

// Expenses can be created by Branch Managers and Admins
router.post('/', authenticateJWT, requireRole('ADMIN', 'SUPER_ADMIN', 'BRANCH_MANAGER'), controller.createExpense.bind(controller));

// Deletion restricted to Super Admin and Admin
router.delete('/:id', authenticateJWT, requireRole('ADMIN', 'SUPER_ADMIN'), controller.deleteExpense.bind(controller));

export default router;
