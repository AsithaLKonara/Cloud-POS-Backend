jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    customer: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    customerCreditLedger: {
      create: jest.fn(),
    },
    order: {
      aggregate: jest.fn(),
      findUnique: jest.fn(),
    },
    loyaltyAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    loyaltyTransaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    setting: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(promises => Promise.all(promises)),
  },
}));

import prisma from '../config/prisma';
import { CustomerService } from '../services/customer.service';
import { loyaltyService } from '../services/loyalty.service';

const mockPrisma = prisma as any;

describe('Universal CRM & Customer Credit Accounts (Task 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CustomerService Profile & Directory', () => {
    it('creates a customer with tags, birthday, and metadata and initializes loyalty', async () => {
      mockPrisma.customer.create.mockImplementation(async ({ data }: any) => ({
        id: 'cust-1',
        ...data,
      }));
      mockPrisma.loyaltyAccount.findUnique.mockResolvedValue(null);
      mockPrisma.loyaltyAccount.create.mockResolvedValue({ id: 'la-1', points: 0, tier: 'Bronze' });

      const customer = await CustomerService.createCustomer({
        phone: '0771234567',
        firstName: 'Nimal',
        lastName: 'Perera',
        customerType: 'VIP',
        tags: ['VIP', 'Corporate', 'PromptPayer'],
        birthday: '1990-05-15',
        creditLimit: 50000,
        metadata: { preferredStylist: 'Elena', skinTone: 'Warm' },
      });

      expect(customer.firstName).toBe('Nimal');
      expect(customer.tags).toEqual(['VIP', 'Corporate', 'PromptPayer']);
      expect(customer.creditLimit).toBe(50000);
      expect(mockPrisma.customer.create).toHaveBeenCalled();
    });
  });

  describe('Accounts Receivable & Credit Limits', () => {
    it('allows credit charge within credit limit and logs CHARGE ledger', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'cust-credit-1',
        creditLimit: 10000,
        creditBalance: 2000,
      });

      mockPrisma.customer.update.mockResolvedValue({
        id: 'cust-credit-1',
        creditBalance: 5000,
      });

      mockPrisma.customerCreditLedger.create.mockResolvedValue({
        id: 'ccl-1',
        type: 'CHARGE',
        amount: 3000,
        balanceAfter: 5000,
      });

      const result = await CustomerService.chargeCredit('cust-credit-1', 3000, 'ord-123', 'POS-9988');

      expect(result.newBalance).toBe(5000);
      expect(result.availableCredit).toBe(5000); // 10000 - 5000
      expect(mockPrisma.customerCreditLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'CHARGE',
          amount: 3000,
          balanceAfter: 5000,
          paymentMethod: 'CREDIT_ACCOUNT',
        }),
      });
    });

    it('rejects credit charge if attempted charge exceeds customer credit limit', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'cust-credit-2',
        creditLimit: 5000,
        creditBalance: 4000,
      });

      // Attempting to charge 2000 would result in balance 6000 > limit 5000
      await expect(
        CustomerService.chargeCredit('cust-credit-2', 2000, 'ord-456')
      ).rejects.toThrow('Credit limit exceeded');
    });

    it('settles debt, decrements balance, and logs SETTLEMENT ledger', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'cust-credit-3',
        creditBalance: 7500,
      });

      mockPrisma.customer.update.mockResolvedValue({
        id: 'cust-credit-3',
        creditBalance: 2500,
      });

      mockPrisma.customerCreditLedger.create.mockResolvedValue({
        id: 'ccl-2',
        type: 'SETTLEMENT',
        amount: 5000,
        balanceAfter: 2500,
      });

      const result = await CustomerService.settleDebt(
        'cust-credit-3',
        5000,
        'BANK_TRANSFER',
        'TXN-SLIP-7766',
        'Part payment by company bank transfer'
      );

      expect(result.newBalance).toBe(2500);
      expect(mockPrisma.customerCreditLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'SETTLEMENT',
          amount: 5000,
          balanceAfter: 2500,
          paymentMethod: 'BANK_TRANSFER',
          reference: 'TXN-SLIP-7766',
        }),
      });
    });
  });

  describe('Customer Intelligence & Lifetime Value', () => {
    it('aggregates total spend, order count, AOV, and loyalty standing', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: 'cust-metrics-1',
        creditLimit: 20000,
        creditBalance: 4000,
        loyaltyAccount: { points: 350, tier: 'Silver' },
        orders: [],
        creditTransactions: [],
      });

      mockPrisma.order.aggregate.mockResolvedValue({
        _sum: { total: 15000 },
        _count: { id: 5 },
      });

      const summary = await CustomerService.getCustomerSummary('cust-metrics-1');

      expect(summary.metrics.totalSpend).toBe(15000);
      expect(summary.metrics.totalOrders).toBe(5);
      expect(summary.metrics.averageOrderValue).toBe(3000);
      expect(summary.metrics.availableCredit).toBe(16000);
      expect(summary.metrics.loyaltyPoints).toBe(350);
      expect(summary.metrics.loyaltyTier).toBe('Silver');
    });
  });
});
