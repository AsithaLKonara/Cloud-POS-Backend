import prisma from '../config/prisma';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { SubscriptionService, DEFAULT_PLANS, PlanConfig } from './subscription.service';
import { SystemMonitorService } from './system-monitor.service';

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
    status: 'HEALTHY' | 'DEGRADED' | 'ONLINE' | 'OFFLINE';
    latencyMs: number;
  };
  redis: {
    status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
    latencyMs: number;
  };
  cpu?: {
    cores: number;
    model: string;
    loadAvg: {
      '1m': number;
      '5m': number;
      '15m': number;
    };
    usagePercentage: number;
  };
  memory?: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
    percentage: number;
    processRssMb: number;
    processHeapUsedMb: number;
  };
  disk?: {
    totalGb: number;
    usedGb: number;
    freeGb: number;
    percentage: number;
  };
  alerts?: Array<{
    severity: 'WARNING' | 'CRITICAL' | 'INFO';
    title: string;
    message: string;
    timestamp: string;
  }>;
  schedulers: Array<{
    name: string;
    schedule: string;
    status: 'ACTIVE';
  }>;
  uptimeSeconds: number;
  uptimeFormatted?: string;
}

export interface MonthlyAnalyticsSeriesItem {
  month: string;
  monthKey: string;
  revenueLkr: number;
  gmvLkr: number;
  orderCount: number;
  newTenantsCount: number;
}

export interface PlatformMoMGrowth {
  mrrGrowthPct: number;
  tenantsGrowthPct: number;
  gmvGrowthPct: number;
  ordersGrowthPct: number;
}

export interface MonthlyAnalyticsResponse {
  series: MonthlyAnalyticsSeriesItem[];
  momGrowth: PlatformMoMGrowth;
}

export interface PlatformRevenueStream {
  id: string;
  name: string;
  amountLkr: number;
  pct: number;
  color: string;
  dotClass: string;
  highlight?: boolean;
}

export interface PlatformRevenueBreakdownResponse {
  totalInflowLkr: number;
  streams: PlatformRevenueStream[];
}

export interface TopOutletPerformanceItem {
  id: string;
  branchName: string;
  tenantName: string;
  businessType: string;
  totalOrders: number;
  gmvLkr: number;
  velocityPct: number;
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
        const effectiveTier = tier === 'PRO' ? 'GROWTH' : tier;
        const plan = DEFAULT_PLANS[effectiveTier] || DEFAULT_PLANS.STARTER;
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
   * Retrieves real historical 12-month analytics and MoM growth metrics from PostgreSQL
   */
  static async getMonthlyAnalytics(): Promise<MonthlyAnalyticsResponse> {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const seriesSlots: Array<{ month: string; monthKey: string; start: Date; end: Date }> = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      seriesSlots.push({
        month: months[d.getMonth()] || 'Jan',
        monthKey,
        start,
        end,
      });
    }

    const allTenants = await (prisma as any).tenant.findMany({
      select: { id: true, createdAt: true, status: true, subscriptionTier: true },
    });

    // Query all orders within the 12-month interval
    const oldestStart = seriesSlots[0]?.start || new Date();
    const orders = await (prisma as any).order.findMany({
      where: {
        paymentStatus: 'PAID',
        createdAt: { gte: oldestStart },
      },
      select: { id: true, total: true, createdAt: true },
    });

    const series: MonthlyAnalyticsSeriesItem[] = [];

    for (const slot of seriesSlots) {
      // Filter orders in this slot
      const slotOrders = orders.filter((o: any) => o.createdAt >= slot.start && o.createdAt <= slot.end);
      const gmvLkr = slotOrders.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);
      const orderCount = slotOrders.length;

      // Filter tenants registered on or before slot end
      const activeInSlot = allTenants.filter((t: any) => t.createdAt <= slot.end && t.status !== 'CANCELLED');
      let slotMrr = 0;
      for (const t of activeInSlot) {
        const tier = (t.subscriptionTier || 'STARTER').toUpperCase();
        const effectiveTier = tier === 'PRO' ? 'GROWTH' : tier;
        const plan = DEFAULT_PLANS[effectiveTier] || DEFAULT_PLANS.STARTER;
        slotMrr += plan?.monthlyLkr || 4500;
      }

      // New tenants in this slot
      const newTenantsCount = allTenants.filter((t: any) => t.createdAt >= slot.start && t.createdAt <= slot.end).length;

      // Inflow = Subscription MRR + 0.5% of GMV
      const revenueLkr = slotMrr + Number((gmvLkr * 0.005).toFixed(2));

      series.push({
        month: slot.month,
        monthKey: slot.monthKey,
        revenueLkr: Math.round(revenueLkr),
        gmvLkr: Math.round(gmvLkr),
        orderCount,
        newTenantsCount,
      });
    }

    // Calculate Month-over-Month (MoM) Growth Comparing Current Month (Index 11) with Previous Month (Index 10)
    const cur = series[11];
    const prev = series[10];

    const calcGrowth = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    const momGrowth: PlatformMoMGrowth = {
      mrrGrowthPct: calcGrowth(cur?.revenueLkr || 0, prev?.revenueLkr || 0),
      tenantsGrowthPct: calcGrowth(cur?.newTenantsCount || 0, prev?.newTenantsCount || 0),
      gmvGrowthPct: calcGrowth(cur?.gmvLkr || 0, prev?.gmvLkr || 0),
      ordersGrowthPct: calcGrowth(cur?.orderCount || 0, prev?.orderCount || 0),
    };

    return {
      series,
      momGrowth,
    };
  }

  /**
   * Calculates live revenue breakdown by streams: Subscriptions, Gateway Margins, Branch Addons, Services
   */
  static async getRevenueBreakdown(): Promise<PlatformRevenueBreakdownResponse> {
    const kpis = await this.getPlatformKPIs();
    const subRevenue = kpis.mrrLkr;
    const gatewayRevenue = Number((kpis.platformGmvLkr * 0.005).toFixed(2));

    // Branch Addons: Count branches beyond base (1 per tenant) across active tenants
    const tenants = await (prisma as any).tenant.findMany({
      where: { status: 'ACTIVE' },
      include: {
        _count: {
          select: { branches: true },
        },
      },
    });

    let extraBranchesCount = 0;
    for (const t of tenants) {
      const branchesCount = t._count?.branches || 1;
      if (branchesCount > 1) {
        extraBranchesCount += (branchesCount - 1);
      }
    }
    const branchAddonRevenue = extraBranchesCount * 2000; // Rs. 2,000 / month / extra branch

    // Custom invoices / professional services
    const invoiceSetting = await (prisma as any).setting.findUnique({
      where: { key: 'PLATFORM_INVOICE_LOGS' },
    });
    const invoices = invoiceSetting?.value ? JSON.parse(invoiceSetting.value) : [];
    const customServicesRevenue = invoices
      .filter((inv: any) => inv.type === 'PROFESSIONAL_SERVICES' || inv.billingCycle === 'SETUP')
      .reduce((sum: number, inv: any) => sum + (inv.amountLkr || 0), 0);

    const total = subRevenue + gatewayRevenue + branchAddonRevenue + customServicesRevenue;
    const safeTotal = total > 0 ? total : 1;

    const streams: PlatformRevenueStream[] = [
      {
        id: 'subscriptions',
        name: 'Subscriptions',
        amountLkr: subRevenue,
        pct: total > 0 ? Math.round((subRevenue / safeTotal) * 100) : 100,
        color: '#3B82F6',
        dotClass: 'bg-blue-500',
      },
      {
        id: 'gateway',
        name: 'One-time Sales (0.5% Gateway)',
        amountLkr: gatewayRevenue,
        pct: total > 0 ? Math.round((gatewayRevenue / safeTotal) * 100) : 0,
        color: '#10B981',
        dotClass: 'bg-emerald-500',
        highlight: true,
      },
      {
        id: 'branches',
        name: 'Branch Addons',
        amountLkr: branchAddonRevenue,
        pct: total > 0 ? Math.round((branchAddonRevenue / safeTotal) * 100) : 0,
        color: '#F59E0B',
        dotClass: 'bg-amber-500',
      },
      {
        id: 'services',
        name: 'Partnerships & APIs',
        amountLkr: customServicesRevenue,
        pct: total > 0 ? Math.round((customServicesRevenue / safeTotal) * 100) : 0,
        color: '#8B5CF6',
        dotClass: 'bg-purple-500',
      },
    ];

    return {
      totalInflowLkr: total,
      streams,
    };
  }

  /**
   * Retrieves top performing multi-tenant branches ranked by sales volume & order count
   */
  static async getTopOutlets(limit = 5): Promise<TopOutletPerformanceItem[]> {
    const branches = await (prisma as any).branch.findMany({
      include: {
        tenant: {
          select: {
            name: true,
            businessType: true,
          },
        },
        orders: {
          where: { paymentStatus: 'PAID' },
          select: { total: true },
        },
      },
    });

    const parsed = branches.map((b: any) => {
      const orders = b.orders || [];
      const totalOrders = orders.length;
      const gmvLkr = orders.reduce((sum: number, o: any) => sum + (o.total || 0), 0);

      return {
        id: b.id,
        branchName: b.tenant?.name ? `${b.tenant.name} - ${b.name}` : b.name,
        tenantName: b.tenant?.name || b.name,
        businessType: b.tenant?.businessType || b.type || 'RETAIL',
        totalOrders,
        gmvLkr,
        velocityPct: 0,
      };
    });

    // Sort by order count descending, then GMV descending
    parsed.sort((a: any, b: any) => {
      if (b.totalOrders !== a.totalOrders) {
        return b.totalOrders - a.totalOrders;
      }
      return b.gmvLkr - a.gmvLkr;
    });

    const highestOrders = parsed[0]?.totalOrders || 1;
    const topOutlets = parsed.slice(0, limit).map((outlet: any) => ({
      ...outlet,
      velocityPct: highestOrders > 0 && outlet.totalOrders > 0
        ? Math.round((outlet.totalOrders / highestOrders) * 100)
        : Math.min(100, Math.round((outlet.gmvLkr / 100000) * 10)),
    }));

    return topOutlets;
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
   * Mutates subscription plan pricing and persists in PostgreSQL Setting table
   */
  static async updatePlanPrice(tierKey: string, monthlyLkr: number) {
    const tier = tierKey.toUpperCase();
    const effectiveTier = tier === 'PRO' ? 'GROWTH' : tier;
    const plans = await SubscriptionService.getPlans();
    const current = plans.find((p) => p.key === tier || (tier === 'PRO' && p.key === 'GROWTH')) || DEFAULT_PLANS[effectiveTier];
    if (!current) throw new Error(`Subscription tier ${tier} not found`);

    const quarterlyLkr = Math.round(monthlyLkr * 3 * 0.9);
    const annualLkr = Math.round(monthlyLkr * 12 * 0.8);

    const updatedPlan: PlanConfig = {
      ...current,
      monthlyLkr,
      quarterlyLkr,
      annualLkr,
    };

    // Load existing overrides
    const setting = await (prisma as any).setting.findUnique({
      where: { key: 'XONIT_SUBSCRIPTION_PLANS' },
    });
    const currentOverrides: Record<string, PlanConfig> = setting?.value ? JSON.parse(setting.value) : {};
    currentOverrides[tier] = updatedPlan;
    if (tier === 'GROWTH') {
      currentOverrides.PRO = { ...updatedPlan, key: 'PRO' };
    } else if (tier === 'PRO') {
      currentOverrides.GROWTH = { ...updatedPlan, key: 'GROWTH' };
    }

    await (prisma as any).setting.upsert({
      where: { key: 'XONIT_SUBSCRIPTION_PLANS' },
      update: { value: JSON.stringify(currentOverrides) },
      create: { key: 'XONIT_SUBSCRIPTION_PLANS', value: JSON.stringify(currentOverrides) },
    });

    logger.info(`Super Admin updated ${tier} plan pricing to Rs. ${monthlyLkr}/mo`);
    return updatedPlan;
  }

  /**
   * Generates a platform billing invoice for a tenant and logs to PostgreSQL
   */
  static async generateInvoice(tenantId: string, billingCycle: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'SETUP' = 'MONTHLY', customAmount?: number) {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, subscriptionTier: true },
    });
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    const setting = await (prisma as any).setting.findUnique({
      where: { key: 'PLATFORM_INVOICE_LOGS' },
    });
    const invoices: any[] = setting?.value ? JSON.parse(setting.value) : [];

    // Calculate invoice amount
    let amount = customAmount;
    if (amount === undefined || amount === null) {
      const tier = (tenant.subscriptionTier || 'STARTER').toUpperCase();
      const effectiveTier = tier === 'PRO' ? 'GROWTH' : tier;
      const plan: PlanConfig = DEFAULT_PLANS[effectiveTier] || (DEFAULT_PLANS.STARTER as PlanConfig);
      if (billingCycle === 'ANNUAL') amount = plan.annualLkr;
      else if (billingCycle === 'QUARTERLY') amount = plan.quarterlyLkr;
      else amount = plan.monthlyLkr;
    }

    const nextSeq = invoices.length + 1;
    const invoiceNumber = `INV-2026-${String(nextSeq).padStart(4, '0')}`;
    const newInvoice = {
      id: `inv-${Date.now()}`,
      invoiceNumber,
      tenantId: tenant.id,
      tenantName: tenant.name,
      amountLkr: amount,
      billingCycle,
      status: 'PAID',
      issuedAt: new Date().toISOString(),
    };

    const updated = [newInvoice, ...invoices];
    await (prisma as any).setting.upsert({
      where: { key: 'PLATFORM_INVOICE_LOGS' },
      update: { value: JSON.stringify(updated) },
      create: { key: 'PLATFORM_INVOICE_LOGS', value: JSON.stringify(updated) },
    });

    logger.info(`Super Admin generated invoice ${invoiceNumber} for tenant [${tenant.name}] - Rs. ${amount}`);
    return newInvoice;
  }

  /**
   * Updates an invoice status (e.g. PENDING, PAID, VOID)
   */
  static async updateInvoiceStatus(invoiceId: string, status: 'PAID' | 'PENDING' | 'VOID') {
    const setting = await (prisma as any).setting.findUnique({
      where: { key: 'PLATFORM_INVOICE_LOGS' },
    });
    const invoices: any[] = setting?.value ? JSON.parse(setting.value) : [];
    const index = invoices.findIndex((inv: any) => inv.id === invoiceId || inv.invoiceNumber === invoiceId);
    if (index === -1) throw new Error(`Invoice ${invoiceId} not found`);

    invoices[index].status = status;
    invoices[index].updatedAt = new Date().toISOString();

    await (prisma as any).setting.upsert({
      where: { key: 'PLATFORM_INVOICE_LOGS' },
      update: { value: JSON.stringify(invoices) },
      create: { key: 'PLATFORM_INVOICE_LOGS', value: JSON.stringify(invoices) },
    });

    return invoices[index];
  }

  /**
   * Real-time cluster health and telemetry (PostgreSQL latency, Redis status, Schedulers & VPS Hardware)
   */
  static async getClusterTelemetry(): Promise<ClusterTelemetry> {
    const vps = await SystemMonitorService.getSystemTelemetry();

    return {
      database: {
        status: vps.database.status === 'ONLINE' ? 'HEALTHY' : 'DEGRADED',
        latencyMs: vps.database.latencyMs,
      },
      redis: {
        status: vps.redis.status,
        latencyMs: vps.redis.latencyMs,
      },
      cpu: vps.cpu,
      memory: vps.memory,
      disk: vps.disk,
      alerts: vps.alerts,
      schedulers: [
        { name: 'weekly-audit-digest', schedule: '0 8 * * 1 (Every Monday 08:00)', status: 'ACTIVE' },
        { name: 'daily-db-backup', schedule: '0 2 * * * (Daily 02:00 UTC)', status: 'ACTIVE' },
        { name: 'vps-log-rotation', schedule: '0 0 * * * (Daily 00:00 UTC)', status: 'ACTIVE' },
      ],
      uptimeSeconds: vps.uptimeSeconds,
      uptimeFormatted: vps.uptimeFormatted,
    };
  }
}
