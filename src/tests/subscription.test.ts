jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    setting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import prisma from '../config/prisma';
import { SubscriptionService } from '../services/subscription.service';

const mockPrisma = prisma as any;

describe('Subscription & Billing Engine in LKR (Task 4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('LKR Plan Querying & Super Admin Overrides', () => {
    it('returns default plans in LKR with 10% quarterly and 20% annual discounts', async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);

      const plans = await SubscriptionService.getPlans();

      expect(plans).toHaveLength(3);
      const starter = plans.find((p) => p.key === 'STARTER');
      expect(starter).toBeDefined();
      expect(starter?.monthlyLkr).toBe(4500);
      expect(starter?.quarterlyLkr).toBe(12150); // 10% discount
      expect(starter?.annualLkr).toBe(43200); // 20% discount
      expect(starter?.trialDays).toBe(14);
      expect(starter?.maxBranches).toBe(1);

      const growth = plans.find((p) => p.key === 'GROWTH');
      expect(growth?.monthlyLkr).toBe(9500);
      expect(growth?.maxBranches).toBe(3);

      const enterprise = plans.find((p) => p.key === 'ENTERPRISE');
      expect(enterprise?.monthlyLkr).toBe(18500);
      expect(enterprise?.maxBranches).toBe(100);
    });

    it('allows Super Admin to update plan pricing and persists custom overrides', async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      mockPrisma.setting.upsert.mockResolvedValue({ id: 's-1' });

      const updated = await SubscriptionService.updatePlanPricing('STARTER', {
        monthlyLkr: 5000,
        maxUsers: 4,
      });

      expect(updated.monthlyLkr).toBe(5000);
      expect(updated.quarterlyLkr).toBe(13500); // 5000 * 3 * 0.9
      expect(updated.annualLkr).toBe(48000); // 5000 * 12 * 0.8
      expect(updated.maxUsers).toBe(4);
      expect(mockPrisma.setting.upsert).toHaveBeenCalled();
    });
  });

  describe('14-Day Free Trial Engine', () => {
    it('activates 14-day free trial with trial status and exact expiry calculation', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-cafe',
        name: 'Artisan Cafe',
        settings: {},
      });

      mockPrisma.tenant.update.mockImplementation(async ({ data }: any) => ({
        id: 'tenant-cafe',
        name: 'Artisan Cafe',
        ...data,
      }));

      const result = await SubscriptionService.start14DayTrial('tenant-cafe');

      expect(result.status).toBe('TRIAL');
      expect(result.daysRemaining).toBe(14);
      expect(result.trialEndsAt.getTime()).toBeGreaterThan(Date.now());
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'TRIAL',
            subscriptionTier: 'STARTER',
            maxBranches: 1,
            maxUsers: 2,
          }),
        })
      );
    });
  });

  describe('Paid Subscription & Billing Cycles in LKR', () => {
    it('activates an ANNUAL subscription with 20% discount and generates LKR invoice', async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-boutique',
        name: 'Velvet Threads',
        settings: {},
      });

      mockPrisma.tenant.update.mockImplementation(async ({ data }: any) => ({
        id: 'tenant-boutique',
        name: 'Velvet Threads',
        ...data,
      }));

      const result = await SubscriptionService.activateSubscription('tenant-boutique', {
        planKey: 'GROWTH',
        billingCycle: 'ANNUAL',
        paymentReference: 'PAYHERE-REF-8910',
      });

      expect(result.tenant.status).toBe('ACTIVE');
      expect(result.tenant.subscriptionTier).toBe('GROWTH');
      expect(result.tenant.maxBranches).toBe(3);
      expect(result.tenant.maxUsers).toBe(10);

      // Annual Growth: 91,200 LKR
      expect(result.invoice.amountLkr).toBe(91200);
      expect(result.invoice.currency).toBe('LKR');
      expect(result.invoice.billingCycle).toBe('ANNUAL');
      expect(result.invoice.status).toBe('PAID');
      expect(result.invoice.invoiceNumber).toMatch(/^INV-/);
    });

    it('supports custom negotiated pricing for Enterprise tenants', async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-corp',
        name: 'Apex Wholesale Group',
        settings: {},
      });

      mockPrisma.tenant.update.mockImplementation(async ({ data }: any) => ({
        id: 'tenant-corp',
        name: 'Apex Wholesale Group',
        ...data,
      }));

      // Custom enterprise rate: 25,000 LKR / month billed Quarterly
      const result = await SubscriptionService.activateSubscription('tenant-corp', {
        planKey: 'ENTERPRISE',
        billingCycle: 'QUARTERLY',
        customMonthlyPriceLkr: 25000,
        paymentReference: 'BANK-SL-7721',
      });

      // 25,000 * 3 * 0.9 = 67,500 LKR
      expect(result.invoice.amountLkr).toBe(67500);
      expect(result.invoice.billingCycle).toBe('QUARTERLY');
      expect(result.tenant.subscriptionTier).toBe('ENTERPRISE');
    });

    it('calculates real-time subscription status and remaining period days', async () => {
      const futureDate = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString();
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-1',
        name: 'Colombo Store',
        status: 'ACTIVE',
        subscriptionTier: 'GROWTH',
        maxBranches: 3,
        maxUsers: 10,
        currency: 'LKR',
        settings: {
          subscription: {
            currentPeriodEnd: futureDate,
          },
          invoices: [{ invoiceNumber: 'INV-123', amountLkr: 9500 }],
        },
        _count: { branches: 2, users: 5 },
      });

      const status = await SubscriptionService.getTenantSubscriptionStatus('tenant-1');

      expect(status.status).toBe('ACTIVE');
      expect(status.isTrial).toBe(false);
      expect(status.daysRemaining).toBe(25);
      expect(status.quotas.branches.current).toBe(2);
      expect(status.quotas.branches.max).toBe(3);
      expect(status.latestInvoice?.amountLkr).toBe(9500);
    });
  });
});
