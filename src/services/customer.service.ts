import prisma from '../config/prisma';
import { loyaltyService } from './loyalty.service';
import { logger } from '../utils/logger';

export interface CreateCustomerDTO {
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  companyName?: string;
  customerType?: string;
  tags?: string[];
  birthday?: Date | string;
  gender?: string;
  taxNumber?: string;
  creditLimit?: number;
  vehicleNumber?: string;
  notes?: string;
  metadata?: Record<string, any>;
  isGuest?: boolean;
}

export class CustomerService {
  static async getCustomers(params: {
    search?: string;
    customerType?: string;
    tag?: string;
    hasCredit?: boolean;
    skip?: number;
    take?: number;
  }) {
    const { search, customerType, tag, hasCredit, skip = 0, take = 50 } = params;
    const where: any = {};

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { vehicleNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (customerType && customerType !== 'ALL') {
      where.customerType = customerType;
    }

    if (tag) {
      where.tags = { has: tag };
    }

    if (hasCredit === true) {
      where.creditBalance = { gt: 0 };
    }

    const [customers, total] = await Promise.all([
      (prisma as any).customer.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          loyaltyAccount: {
            select: { points: true, tier: true, lifetimePoints: true },
          },
          _count: {
            select: { orders: true, creditTransactions: true },
          },
        },
      }),
      (prisma as any).customer.count({ where }),
    ]);

    return {
      customers,
      total,
      skip,
      take,
    };
  }

  static async createCustomer(data: CreateCustomerDTO) {
    const customer = await (prisma as any).customer.create({
      data: {
        phone: data.phone.trim(),
        firstName: data.firstName?.trim() || null,
        lastName: data.lastName?.trim() || null,
        email: data.email?.toLowerCase().trim() || null,
        companyName: data.companyName?.trim() || null,
        customerType: data.customerType || 'RETAIL',
        tags: data.tags || [],
        birthday: data.birthday ? new Date(data.birthday) : null,
        gender: data.gender || null,
        taxNumber: data.taxNumber || null,
        creditLimit: data.creditLimit || 0,
        creditBalance: 0,
        vehicleNumber: data.vehicleNumber || null,
        notes: data.notes || null,
        metadata: data.metadata || null,
        isGuest: data.isGuest ?? false,
      },
    });

    // Automatically initialize loyalty account for new non-guest customers
    if (!customer.isGuest) {
      await loyaltyService.ensureLoyaltyAccount(customer.id).catch(() => {});
    }

    return customer;
  }

  static async updateCustomer(id: string, data: Partial<CreateCustomerDTO>) {
    const updateData: any = { ...data };
    if (data.birthday) {
      updateData.birthday = new Date(data.birthday);
    }
    return (prisma as any).customer.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Charges a customer's credit account, verifying credit limit.
   */
  static async chargeCredit(customerId: string, amount: number, orderId?: string, orderNumber?: string) {
    if (amount <= 0) {
      throw new Error('Charge amount must be positive');
    }

    const customer = await (prisma as any).customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const currentBalance = customer.creditBalance || 0;
    const limit = customer.creditLimit || 0;

    if (limit > 0 && currentBalance + amount > limit) {
      throw new Error(`Credit limit exceeded! Limit: ${limit}, Current: ${currentBalance}, Charge: ${amount}`);
    }

    const updated = await (prisma as any).customer.update({
      where: { id: customerId },
      data: { creditBalance: { increment: amount } },
    });

    const ledger = await (prisma as any).customerCreditLedger.create({
      data: {
        customerId,
        orderId,
        type: 'CHARGE',
        amount,
        balanceAfter: updated.creditBalance,
        paymentMethod: 'CREDIT_ACCOUNT',
        reference: orderNumber || `CHG-${Date.now().toString().slice(-6)}`,
        notes: `Credit Sale ${orderNumber ? '#' + orderNumber : ''}`,
      },
    });

    return {
      newBalance: updated.creditBalance,
      availableCredit: limit > 0 ? Math.max(0, limit - updated.creditBalance) : null,
      ledger,
    };
  }

  /**
   * Settles / Repays customer credit debt and logs an audited ledger entry.
   */
  static async settleDebt(
    customerId: string,
    amount: number,
    paymentMethod = 'CASH',
    reference?: string,
    notes?: string
  ) {
    if (amount <= 0) {
      throw new Error('Settlement amount must be positive');
    }

    const customer = await (prisma as any).customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const updated = await (prisma as any).customer.update({
      where: { id: customerId },
      data: { creditBalance: { decrement: amount } },
    });

    const ledger = await (prisma as any).customerCreditLedger.create({
      data: {
        customerId,
        type: 'SETTLEMENT',
        amount,
        balanceAfter: updated.creditBalance,
        paymentMethod,
        reference: reference || null,
        notes: notes || 'Debt Repayment Received',
      },
    });

    return {
      newBalance: updated.creditBalance,
      ledger,
    };
  }

  /**
   * Aggregates full CRM customer intelligence: lifetime spend, orders, loyalty, and credit.
   */
  static async getCustomerSummary(id: string) {
    const customer = await (prisma as any).customer.findUnique({
      where: { id },
      include: {
        loyaltyAccount: true,
        orders: {
          select: { id: true, orderNumber: true, total: true, status: true, paymentStatus: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        creditTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!customer) {
      throw new Error(`Customer ${id} not found`);
    }

    const orderAgg = await (prisma as any).order.aggregate({
      where: { customerId: id, status: { not: 'CANCELLED' } },
      _sum: { total: true },
      _count: { id: true },
    });

    const totalSpend = orderAgg._sum.total || 0;
    const totalOrders = orderAgg._count.id || 0;
    const averageOrderValue = totalOrders > 0 ? Math.round((totalSpend / totalOrders) * 100) / 100 : 0;

    return {
      customer,
      metrics: {
        totalSpend,
        totalOrders,
        averageOrderValue,
        creditLimit: customer.creditLimit,
        creditBalance: customer.creditBalance,
        availableCredit: customer.creditLimit > 0 ? Math.max(0, customer.creditLimit - customer.creditBalance) : null,
        loyaltyPoints: customer.loyaltyAccount?.points || 0,
        loyaltyTier: customer.loyaltyAccount?.tier || 'Bronze',
      },
    };
  }
}
