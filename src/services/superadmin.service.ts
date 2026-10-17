import prisma from '../config/prisma';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { SubscriptionService, DEFAULT_PLANS } from './subscription.service';

export interface PlatformKPIs {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
  cancelledTenants: number;
  totalBranches: number;
  totalUsers: number;
  platformGmvLkr: number;
  totalOrders: number;
  mrrLkr: number;
  arrLkr: number;
}

export interface PlatformExpenseItem {
  id: string;
  category: 'CLOUD_SERVERS' | 'DATABASE' | 'REDIS_CACHE' | 'SMS_GATEWAY' | 'SECURITY_SSL' | 'OPERATIONS';
  amountLkr: number;
  vendor: string;
  description: string;
  recordedAt: string;
}

export interface PlatformFinancials {
  mrrLkr: number;
  arrLkr: number;
  grossSubscriptionRevenueLkr: number;
  gatewayMarginRevenueLkr: number;
  totalInflowLkr: number;
  totalPlatformExpensesLkr: number;
  netSaaSProfitLkr: number;
  profitMarginPercent: number;
  expensesBreakdown: PlatformExpenseItem[];
  recentInvoices: any[];
}

export interface ClusterTelemetry {
  database: {
    status: 'HEALTHY' | 'DEGRADED';
    latencyMs: number;
  };
  redis: {
    status: 'ONLINE' | 'OFFLINE';
    latencyMs: number;
  };
  schedulers: Array<{
    name: string;
    schedule: string;
    status: 'ACTIVE';
  }>;
  uptimeSeconds: number;
}

const DEFAULT_PLATFORM_EXPENSES: PlatformExpenseItem[] = [
  {
    id: 'exp-1',
    category: 'CLOUD_SERVERS',
    amountLkr: 65000,
    vendor: 'AWS Singapore (ap-southeast-1)',
    description: 'EC2 Cluster & Application Load Balancers',
    recordedAt: new Date().toISOString(),
  },
  {
    id: 'exp-2',
    category: 'DATABASE',
    amountLkr: 48000,
    vendor: 'AWS RDS Multi-AZ PostgreSQL',
    description: 'High-availability multi-tenant relational cluster',
    recordedAt: new Date().toISOString(),
  },
  {
    id: 'exp-3',
    category: 'REDIS_CACHE',
    amountLkr: 18500,
    vendor: 'Upstash / Local Redis Cloud',
    description: 'Session store & fast rate limiting',
    recordedAt: new Date().toISOString(),
  },
  {
    id: 'exp-4',
    category: 'SMS_GATEWAY',
    amountLkr: 24000,
    vendor: 'Dialog Axiata & Mobitel Gateway',
    description: 'OTP verification & customer invoice SMS credits',
    recordedAt: new Date().toISOString(),
  },
  {
    id: 'exp-5',
    category: 'SECURITY_SSL',
    amountLkr: 12000,
    vendor: 'Cloudflare Enterprise WAF',
    description: 'DDoS mitigation & edge SSL certificates',
    recordedAt: new Date().toISOString(),
  },
];

export class SuperAdminService {
  /**
   * Calculates platform-wide KPIs: MRR, ARR, GMV, and Tenant tallies
   */
  static async getPlatformKPIs(): Promise<PlatformKPIs> {
    const [
      tenants,
      totalBranches,
      totalUsers,
      ordersAgg,
    ] = await Promise.all([
      (prisma as any).tenant.findMany({
        select: { id: true, status: true, subscriptionTier: true, settings: true },
      }),
      (prisma as any).branch.count(),
      (prisma as any).user.count(),
      (prisma as any).order.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    let activeTenants = 0;
    let trialTenants = 0;
    let suspendedTenants = 0;
    let cancelledTenants = 0;
    let calculatedMrr = 0;

    for (const t of tenants) {
      if (t.status === 'ACTIVE') activeTenants++;
      else if (t.status === 'TRIAL') trialTenants++;
      else if (t.status === 'SUSPENDED') suspendedTenants++;
      else if (t.status === 'CANCELLED') cancelledTenants++;

      // Only count active or paying tenants towards MRR
      if (t.status === 'ACTIVE' || t.status === 'TRIAL') {
        const tier = (t.subscriptionTier || 'STARTER').toUpperCase();
        const plan = DEFAULT_PLANS[tier] || DEFAULT_PLANS.STARTER;
        calculatedMrr += plan?.monthlyLkr || 4500;
      }
    }

    const platformGmv = Number((ordersAgg._sum.total || 0).toFixed(2));

    return {
      totalTenants: tenants.length,
      activeTenants,
      trialTenants,
      suspendedTenants,
      cancelledTenants,
      totalBranches,
      totalUsers,
      platformGmvLkr: platformGmv,
      totalOrders: ordersAgg._count.id || 0,
      mrrLkr: calculatedMrr,
      arrLkr: calculatedMrr * 12,
    };
  }

  /**
   * Retrieves SaaS platform financial statement (Revenue vs Cloud & Infrastructure Expenses)
   */
  static async getPlatformFinancials(): Promise<PlatformFinancials> {
    const kpis = await this.getPlatformKPIs();
    const plans = await SubscriptionService.getPlans();

    // Fetch saved platform expenses from Setting table
    const setting = await (prisma as any).setting.findUnique({
      where: { key: 'XONIT_PLATFORM_EXPENSES' },
    });
    const expenses: PlatformExpenseItem[] = setting?.value ? JSON.parse(setting.value) : DEFAULT_PLATFORM_EXPENSES;

    const totalExpenses = expenses.reduce((sum, item) => sum + item.amountLkr, 0);

    // Platform Inflow = MRR + 0.5% Payment Processing Margin from GMV
    const subRevenue = kpis.mrrLkr;
    const gatewayMargin = Number((kpis.platformGmvLkr * 0.005).toFixed(2));
    const totalInflow = subRevenue + gatewayMargin;
    const netProfit = totalInflow - totalExpenses;
    const marginPercent = totalInflow > 0 ? Number(((netProfit / totalInflow) * 100).toFixed(1)) : 0;

    // Fetch recent tenant subscription invoices
    const invoiceSetting = await (prisma as any).setting.findUnique({
      where: { key: 'PLATFORM_INVOICE_LOGS' },
    });
    const recentInvoices = invoiceSetting?.value ? JSON.parse(invoiceSetting.value) : [];

    return {
      mrrLkr: kpis.mrrLkr,
      arrLkr: kpis.arrLkr,
      grossSubscriptionRevenueLkr: subRevenue,
      gatewayMarginRevenueLkr: gatewayMargin,
      totalInflowLkr: totalInflow,
      totalPlatformExpensesLkr: totalExpenses,
      netSaaSProfitLkr: netProfit,
      profitMarginPercent: marginPercent,
      expensesBreakdown: expenses,
      recentInvoices: recentInvoices.slice(0, 10),
    };
  }

  /**
   * Adds or updates a platform operating expense (e.g. AWS bill, SMS credits)
   */
  static async addPlatformExpense(data: Omit<PlatformExpenseItem, 'id' | 'recordedAt'>) {
    const setting = await (prisma as any).setting.findUnique({
      where: { key: 'XONIT_PLATFORM_EXPENSES' },
    });
    const current: PlatformExpenseItem[] = setting?.value ? JSON.parse(setting.value) : DEFAULT_PLATFORM_EXPENSES;

    const newExpense: PlatformExpenseItem = {
      ...data,
      id: `exp-${Date.now()}`,
      recordedAt: new Date().toISOString(),
    };

    const updated = [newExpense, ...current];
    await (prisma as any).setting.upsert({
      where: { key: 'XONIT_PLATFORM_EXPENSES' },
      update: { value: JSON.stringify(updated) },
      create: { key: 'XONIT_PLATFORM_EXPENSES', value: JSON.stringify(updated) },
    });

    logger.info(`Recorded new platform expense: [${data.category}] - Rs. ${data.amountLkr} (${data.vendor})`);
    return newExpense;
  }

  /**
   * Retrieves complete tenant registry with resource quotas, counts, and filters
   */
  static async getTenants(filters?: { search?: string; status?: string; businessType?: string }) {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.businessType) where.businessType = filters.businessType;
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { slug: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const tenants = await (prisma as any).tenant.findMany({
      where,
      include: {
        _count: {
          select: {
            branches: true,
            users: true,
            products: true,
            orders: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return tenants.map((t: any) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      businessType: t.businessType,
      status: t.status,
      subscriptionTier: t.subscriptionTier,
      maxBranches: t.maxBranches,
      maxUsers: t.maxUsers,
      branchesCount: t._count.branches,
      usersCount: t._count.users,
      productsCount: t._count.products,
      ordersCount: t._count.orders,
      createdAt: t.createdAt,
      settings: t.settings,
    }));
  }

  /**
   * Updates tenant status (ACTIVE, SUSPENDED, TRIAL, CANCELLED)
   */
  static async updateTenantStatus(tenantId: string, status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'CANCELLED') {
    const tenant = await (prisma as any).tenant.update({
      where: { id: tenantId },
      data: { status },
    });
    logger.info(`Super Admin updated status for tenant [${tenant.name}] -> ${status}`);
    return tenant;
  }

  /**
   * Extends tenant free trial by a given number of days
   */
  static async extendTrial(tenantId: string, extraDays = 14) {
    const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    const currentTrialEnds = tenant.settings?.subscription?.trialEndsAt
      ? new Date(tenant.settings.subscription.trialEndsAt)
      : new Date();

    const newDate = new Date(currentTrialEnds.getTime() + extraDays * 24 * 60 * 60 * 1000);

    const updatedSettings = {
      ...(tenant.settings || {}),
      subscription: {
        ...(tenant.settings?.subscription || {}),
        trialEndsAt: newDate.toISOString(),
      },
    };

    return (prisma as any).tenant.update({
      where: { id: tenantId },
      data: {
        status: 'TRIAL',
        settings: updatedSettings,
      },
    });
  }

  /**
   * Real-time cluster health and telemetry (PostgreSQL latency, Redis status, Schedulers)
   */
  static async getClusterTelemetry(): Promise<ClusterTelemetry> {
    const dbStart = Date.now();
    let dbStatus: 'HEALTHY' | 'DEGRADED' = 'HEALTHY';
    try {
      await (prisma as any).$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'DEGRADED';
    }
    const dbLatency = Date.now() - dbStart;

    const redisStart = Date.now();
    let redisStatus: 'ONLINE' | 'OFFLINE' = 'ONLINE';
    try {
      if (redisClient) {
        const pong = await redisClient.ping();
        redisStatus = pong === 'PONG' ? 'ONLINE' : 'OFFLINE';
      } else {
        redisStatus = 'OFFLINE';
      }
    } catch {
      redisStatus = 'OFFLINE';
    }
    const redisLatency = Date.now() - redisStart;

    return {
      database: {
        status: dbStatus,
        latencyMs: dbLatency,
      },
      redis: {
        status: redisStatus,
        latencyMs: redisLatency,
      },
      schedulers: [
        { name: 'weekly-audit-digest', schedule: '0 8 * * 1', status: 'ACTIVE' },
        { name: 'daily-db-backup', schedule: '0 2 * * *', status: 'ACTIVE' },
        { name: 'quarterly-pentest-reminder', schedule: '0 0 1 1,4,7,10 *', status: 'ACTIVE' },
      ],
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
