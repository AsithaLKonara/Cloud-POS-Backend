import prisma from '../config/prisma';
import { SequenceService } from './sequence.service';

export interface AccountTemplate {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
}

export const DEFAULT_CHART_OF_ACCOUNTS: AccountTemplate[] = [
  // Current Assets (1000-1999)
  { code: '1010', name: 'Cash on Hand (POS Till)', type: 'ASSET' },
  { code: '1020', name: 'Operating Bank Account', type: 'ASSET' },
  { code: '1100', name: 'Accounts Receivable (Trade Debtors)', type: 'ASSET' },
  { code: '1200', name: 'Merchandise Inventory Asset', type: 'ASSET' },

  // Current Liabilities (2000-2999)
  { code: '2000', name: 'Accounts Payable (Trade Creditors)', type: 'LIABILITY' },
  { code: '2100', name: 'Sales Tax & VAT Payable', type: 'LIABILITY' },

  // Equity (3000-3999)
  { code: '3000', name: "Owner's Equity & Retained Earnings", type: 'EQUITY' },

  // Revenue (4000-4999)
  { code: '4000', name: 'Sales Revenue (POS & Storefront)', type: 'REVENUE' },
  { code: '4050', name: 'Service & Labor Revenue', type: 'REVENUE' },

  // Cost of Goods Sold (5000-5999)
  { code: '5000', name: 'Cost of Goods Sold (COGS)', type: 'EXPENSE' },

  // Operating Expenses (6000-6999)
  { code: '6010', name: 'Rent & Premises Expense', type: 'EXPENSE' },
  { code: '6020', name: 'Electricity & Utilities', type: 'EXPENSE' },
  { code: '6030', name: 'Salaries & Staff Wages', type: 'EXPENSE' },
  { code: '6090', name: 'General & Administrative Expenses', type: 'EXPENSE' },
  { code: '6100', name: 'Inventory Shrinkage & Loss', type: 'EXPENSE' },
];

export class GeneralLedgerService {
  /**
   * Initializes default Chart of Accounts for a tenant if not already present
   */
  static async initChartOfAccounts(tenantId: string) {
    const existingCount = await (prisma as any).chartOfAccount.count({
      where: { tenantId }
    });

    if (existingCount > 0) return;

    for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
      await (prisma as any).chartOfAccount.create({
        data: {
          tenantId,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          isSystem: true,
          isActive: true
        }
      });
    }
  }

  /**
   * Posts a balanced double-entry journal entry.
   * Validates sum(debits) === sum(credits).
   */
  static async postJournalEntry(data: {
    tenantId?: string | null;
    date?: Date;
    reference?: string;
    description: string;
    lines: Array<{
      accountCode: string;
      debit: number;
      credit: number;
      description?: string;
    }>;
  }, client?: any) {
    const db = client || prisma;
    const tenantId = data.tenantId || null;

    if (!data.lines || data.lines.length < 2) {
      throw new Error('A journal entry requires at least 2 lines (debit and credit).');
    }

    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of data.lines) {
      totalDebit += Math.round((line.debit || 0) * 100) / 100;
      totalCredit += Math.round((line.credit || 0) * 100) / 100;
    }

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(
        `Unbalanced Journal Entry: Total Debits (Rs. ${totalDebit.toFixed(2)}) must equal Total Credits (Rs. ${totalCredit.toFixed(2)}).`
      );
    }

    // Generate gapless sequential journal entry number
    const entryNumber = await SequenceService.getNextSequence('JE', tenantId, db);

    // Resolve accounts
    const accountMap = new Map<string, string>();
    for (const line of data.lines) {
      if (!accountMap.has(line.accountCode)) {
        let account = await db.chartOfAccount.findFirst({
          where: { code: line.accountCode, ...(tenantId ? { tenantId } : {}) }
        });
        if (!account && tenantId) {
          // Fall back to system account
          account = await db.chartOfAccount.findFirst({
            where: { code: line.accountCode, isSystem: true }
          });
        }
        if (!account) {
          // Auto-provision if missing from default template
          const template = DEFAULT_CHART_OF_ACCOUNTS.find(a => a.code === line.accountCode);
          if (template) {
            account = await db.chartOfAccount.create({
              data: {
                tenantId,
                code: template.code,
                name: template.name,
                type: template.type,
                isSystem: true
              }
            });
          } else {
            throw new Error(`Chart of Account code [${line.accountCode}] not found.`);
          }
        }
        accountMap.set(line.accountCode, account.id);
      }
    }

    // Create journal entry with lines
    return await db.journalEntry.create({
      data: {
        tenantId,
        entryNumber,
        date: data.date || new Date(),
        reference: data.reference || null,
        description: data.description,
        status: 'POSTED',
        lines: {
          create: data.lines.map(line => ({
            accountId: accountMap.get(line.accountCode)!,
            debit: line.debit || 0,
            credit: line.credit || 0,
            description: line.description || null
          }))
        }
      },
      include: {
        lines: {
          include: { account: true }
        }
      }
    });
  }

  /**
   * Generates a canonical Trial Balance verifying system-wide debits == credits
   */
  static async getTrialBalance(tenantId?: string | null) {
    const where: any = { status: 'POSTED' };
    if (tenantId) where.tenantId = tenantId;

    const entries = await (prisma as any).journalEntry.findMany({
      where,
      include: {
        lines: {
          include: { account: true }
        }
      }
    });

    const accountTotals: Record<string, { code: string; name: string; type: string; debit: number; credit: number; balance: number }> = {};

    for (const entry of entries) {
      for (const line of entry.lines) {
        const code = line.account.code;
        if (!accountTotals[code]) {
          accountTotals[code] = {
            code,
            name: line.account.name,
            type: line.account.type,
            debit: 0,
            credit: 0,
            balance: 0
          };
        }
        accountTotals[code].debit += line.debit;
        accountTotals[code].credit += line.credit;
      }
    }

    let grandDebit = 0;
    let grandCredit = 0;

    const rows = Object.values(accountTotals).map(acc => {
      grandDebit += acc.debit;
      grandCredit += acc.credit;
      // Normal balance: Asset & Expense = Debit - Credit, Liab/Equity/Rev = Credit - Debit
      const balance = ['ASSET', 'EXPENSE'].includes(acc.type) 
        ? (acc.debit - acc.credit) 
        : (acc.credit - acc.debit);
      return { ...acc, balance };
    }).sort((a, b) => a.code.localeCompare(b.code));

    return {
      asOfDate: new Date(),
      isBalanced: Math.abs(grandDebit - grandCredit) < 0.01,
      totalDebit: grandDebit,
      totalCredit: grandCredit,
      accounts: rows
    };
  }

  /**
   * Generates a formal Balance Sheet: Assets = Liabilities + Equity
   */
  static async getBalanceSheet(tenantId?: string | null) {
    const trialBalance = await this.getTrialBalance(tenantId);
    
    const assets = trialBalance.accounts.filter(a => a.type === 'ASSET');
    const liabilities = trialBalance.accounts.filter(a => a.type === 'LIABILITY');
    const equity = trialBalance.accounts.filter(a => a.type === 'EQUITY');
    
    // Net Income = Total Revenue - Total Expense
    const revenues = trialBalance.accounts.filter(a => a.type === 'REVENUE');
    const expenses = trialBalance.accounts.filter(a => a.type === 'EXPENSE');

    const totalRevenue = revenues.reduce((s, a) => s + (a.credit - a.debit), 0);
    const totalExpense = expenses.reduce((s, a) => s + (a.debit - a.credit), 0);
    const netIncome = totalRevenue - totalExpense;

    const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
    const totalLiabilities = liabilities.reduce((s, a) => s + a.balance, 0);
    const totalBaseEquity = equity.reduce((s, a) => s + a.balance, 0);
    const totalEquity = totalBaseEquity + netIncome;

    return {
      asOfDate: new Date(),
      assets: {
        accounts: assets,
        total: totalAssets
      },
      liabilities: {
        accounts: liabilities,
        total: totalLiabilities
      },
      equity: {
        accounts: equity,
        netIncome,
        total: totalEquity
      },
      isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
    };
  }

  /**
   * Retrieves paginated journal entries with line accounts for tenant
   */
  static async getJournalEntries(tenantId?: string | null, options?: { limit?: number; offset?: number; search?: string }) {
    const where: any = {};
    if (tenantId) where.tenantId = tenantId;
    if (options?.search) {
      where.OR = [
        { entryNumber: { contains: options.search, mode: 'insensitive' } },
        { description: { contains: options.search, mode: 'insensitive' } },
        { reference: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    const limit = Math.min(options?.limit || 50, 100);
    const offset = options?.offset || 0;

    const [entries, total] = await Promise.all([
      (prisma as any).journalEntry.findMany({
        where,
        include: {
          lines: {
            include: { account: true }
          }
        },
        orderBy: { date: 'desc' },
        take: limit,
        skip: offset
      }),
      (prisma as any).journalEntry.count({ where })
    ]);

    return { entries, total, limit, offset };
  }
}

