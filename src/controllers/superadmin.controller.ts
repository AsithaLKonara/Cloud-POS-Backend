import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { SuperAdminService } from '../services/superadmin.service';
import { TenantService } from '../services/tenant.service';
import { SubscriptionService } from '../services/subscription.service';
import { FeatureFlagService } from '../services/feature-flag.service';
import { SuperAdminAuditService } from '../services/superadmin-audit.service';
import { DunningService } from '../services/dunning.service';
import { AnnouncementService } from '../services/announcement.service';
import { DisasterRecoveryService } from '../services/disaster-recovery.service';

export class SuperAdminController {
  async getKPIs(req: Request, res: Response): Promise<void> {
    try {
      const kpis = await SuperAdminService.getPlatformKPIs();
      res.status(200).json({ success: true, data: kpis });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch platform KPIs' });
    }
  }

  async getFinancials(req: Request, res: Response): Promise<void> {
    try {
      const financials = await SuperAdminService.getPlatformFinancials();
      res.status(200).json({ success: true, data: financials });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch platform financials' });
    }
  }

  async addExpense(req: Request, res: Response): Promise<void> {
    try {
      const expense = await SuperAdminService.addPlatformExpense(req.body);
      res.status(201).json({ success: true, message: 'Platform expense recorded', data: expense });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to record expense' });
    }
  }

  async getTenants(req: Request, res: Response): Promise<void> {
    try {
      const { search, status, businessType } = req.query;
      const tenants = await SuperAdminService.getTenants({
        search: search as string,
        status: status as string,
        businessType: businessType as string,
      });
      res.status(200).json({ success: true, data: tenants });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch tenants' });
    }
  }

  async updateTenantStatus(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const { status } = req.body;
      const updated = await SuperAdminService.updateTenantStatus(tenantId, status);
      res.status(200).json({ success: true, message: `Tenant status updated to ${status}`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update tenant status' });
    }
  }

  async extendTrial(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const days = parseInt(req.body.days, 10) || 14;
      const updated = await SuperAdminService.extendTrial(tenantId, days);
      res.status(200).json({ success: true, message: `Trial extended by ${days} days`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to extend trial' });
    }
  }

  async updateTenantSettings(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const updated = await TenantService.updateTenant(tenantId, req.body);
      res.status(200).json({ success: true, message: 'Tenant settings updated successfully', data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update tenant settings' });
    }
  }

  async provisionTurnkeyTenant(req: Request, res: Response): Promise<void> {
    try {
      const b = req.body || {};
      const payload: any = {
        name: b.name || b.businessName,
        slug: b.slug,
        businessType: b.businessType,
        subscriptionTier: b.subscriptionTier,
        maxBranches: b.maxBranches,
        maxUsers: b.maxUsers,
        currency: b.currency,
        currencySymbol: b.currencySymbol,
        initialBranchName: b.initialBranchName,
        adminUser: b.adminUser || {
          email: b.adminEmail,
          password: b.adminPassword,
          name: b.adminFullName || b.adminName,
          phone: b.adminPhone,
        },
      };
      const result = await TenantService.provisionTenant(payload);
      res.status(201).json({ success: true, message: 'Turnkey tenant provisioned successfully', data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Tenant provisioning failed' });
    }
  }

  async getCluster(req: Request, res: Response): Promise<void> {
    try {
      const telemetry = await SuperAdminService.getClusterTelemetry();
      res.status(200).json({ success: true, data: telemetry });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch cluster telemetry' });
    }
  }

  async getMonthlyAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const analytics = await SuperAdminService.getMonthlyAnalytics();
      res.status(200).json({ success: true, data: analytics });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch monthly analytics' });
    }
  }

  async getRevenueBreakdown(req: Request, res: Response): Promise<void> {
    try {
      const breakdown = await SuperAdminService.getRevenueBreakdown();
      res.status(200).json({ success: true, data: breakdown });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch revenue breakdown' });
    }
  }

  async getTopOutlets(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 5;
      const outlets = await SuperAdminService.getTopOutlets(limit);
      res.status(200).json({ success: true, data: outlets });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch top outlets' });
    }
  }

  async getPlans(req: Request, res: Response): Promise<void> {
    try {
      const plans = await SubscriptionService.getPlans();
      res.status(200).json({ success: true, data: plans });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch subscription packages' });
    }
  }

  async createPlan(req: Request, res: Response): Promise<void> {
    try {
      const created = await SubscriptionService.createPlan(req.body);
      res.status(201).json({ success: true, message: `Package "${created.name}" created successfully`, data: created });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to create subscription package' });
    }
  }

  async updatePlan(req: Request, res: Response): Promise<void> {
    try {
      const planKey = req.params.planKey as string;
      const updated = await SubscriptionService.updatePlanPricing(planKey, req.body);
      res.status(200).json({ success: true, message: `Package "${planKey}" updated successfully`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update subscription package' });
    }
  }

  async deletePlan(req: Request, res: Response): Promise<void> {
    try {
      const planKey = req.params.planKey as string;
      const result = await SubscriptionService.deletePlan(planKey);
      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to delete subscription package' });
    }
  }

  async assignPlanToTenant(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const { planKey, billingCycle = 'MONTHLY', customPriceLkr } = req.body;
      if (!planKey) {
        res.status(400).json({ success: false, message: 'planKey is required' });
        return;
      }
      const result = await SubscriptionService.activateSubscription(tenantId, {
        planKey: planKey.toUpperCase(),
        billingCycle,
        customMonthlyPriceLkr: customPriceLkr,
      });
      res.status(200).json({ success: true, message: `Tenant successfully assigned to package ${planKey}`, data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to assign package to tenant' });
    }
  }

  async updatePlanPrice(req: Request, res: Response): Promise<void> {
    try {
      const tier = req.params.tier as string;
      const monthlyLkr = parseInt(req.body.monthlyLkr, 10);
      if (isNaN(monthlyLkr) || monthlyLkr <= 0) {
        res.status(400).json({ success: false, message: 'Valid positive monthly price required' });
        return;
      }
      const updated = await SuperAdminService.updatePlanPrice(tier, monthlyLkr);
      res.status(200).json({ success: true, message: `Subscription tier ${tier} price updated to Rs. ${monthlyLkr}`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update plan pricing' });
    }
  }

  async generateInvoice(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId, billingCycle, amountLkr } = req.body;
      if (!tenantId) {
        res.status(400).json({ success: false, message: 'tenantId is required' });
        return;
      }
      const invoice = await SuperAdminService.generateInvoice(tenantId, billingCycle, amountLkr);
      res.status(201).json({ success: true, message: `Invoice ${invoice.invoiceNumber} generated`, data: invoice });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to generate invoice' });
    }
  }

  async updateInvoiceStatus(req: Request, res: Response): Promise<void> {
    try {
      const invoiceId = req.params.invoiceId as string;
      const { status } = req.body;
      const updated = await SuperAdminService.updateInvoiceStatus(invoiceId, status);
      res.status(200).json({ success: true, message: `Invoice status updated to ${status}`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update invoice status' });
    }
  }

  async getTenantAdmins(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const admins = await (prisma as any).user.findMany({
        where: {
          tenantId,
          userRoles: {
            some: {
              role: {
                name: { in: ['ADMIN', 'Admin', 'Super Admin', 'SUPER_ADMIN', 'Tenant Admin'] },
              },
            },
          },
        },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          status: true,
          createdAt: true,
          branch: {
            select: { id: true, name: true, code: true },
          },
          userRoles: {
            select: {
              role: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      res.status(200).json({ success: true, data: admins });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch tenant admins' });
    }
  }

  async createTenantAdmin(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const { email, password, name, phone, branchId } = req.body;
      if (!email || !password) {
        res.status(400).json({ success: false, message: 'Email and password are required.' });
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();
      const existingUser = await (prisma as any).user.findUnique({
        where: { email: normalizedEmail },
      });
      if (existingUser) {
        res.status(400).json({ success: false, message: `User with email "${normalizedEmail}" already exists.` });
        return;
      }

      const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        res.status(404).json({ success: false, message: 'Tenant not found.' });
        return;
      }

      let targetBranchId = branchId;
      if (!targetBranchId) {
        const firstBranch = await (prisma as any).branch.findFirst({ where: { tenantId } });
        targetBranchId = firstBranch?.id || null;
      }

      let adminRole = await (prisma as any).role.findFirst({
        where: {
          name: 'ADMIN',
          OR: [{ tenantId }, { isSystem: true }],
        },
      });
      if (!adminRole) {
        adminRole = await (prisma as any).role.create({
          data: { name: 'ADMIN', description: 'Tenant Administrator', tenantId, isSystem: true, status: 'Active' },
        });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const user = await (prisma as any).user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          name: name || 'Tenant Admin',
          phone: phone || null,
          tenantId,
          branchId: targetBranchId,
          status: 'ACTIVE',
          userRoles: {
            create: { roleId: adminRole.id },
          },
        },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          status: true,
          branchId: true,
          createdAt: true,
        },
      });

      res.status(201).json({ success: true, message: 'Tenant admin created successfully', data: user });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to create tenant admin' });
    }
  }

  async updateTenantAdminStatus(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId, adminId } = req.params;
      const { status } = req.body;
      if (!status || !['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status.toUpperCase())) {
        res.status(400).json({ success: false, message: 'Invalid status. Must be ACTIVE or SUSPENDED.' });
        return;
      }

      const user = await (prisma as any).user.findFirst({
        where: { id: adminId, tenantId },
      });
      if (!user) {
        res.status(404).json({ success: false, message: 'Tenant admin user not found.' });
        return;
      }

      const updated = await (prisma as any).user.update({
        where: { id: adminId },
        data: { status: status.toUpperCase() },
        select: { id: true, email: true, name: true, status: true },
      });

      res.status(200).json({ success: true, message: `Tenant admin status updated to ${status.toUpperCase()}`, data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update admin status' });
    }
  }

  async resetTenantAdminPassword(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId, adminId } = req.params;
      const { newPassword } = req.body;
      const passwordToSet = newPassword || 'Password@123';

      const user = await (prisma as any).user.findFirst({
        where: { id: adminId, tenantId },
      });
      if (!user) {
        res.status(404).json({ success: false, message: 'Tenant admin user not found.' });
        return;
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(passwordToSet, salt);

      await (prisma as any).user.update({
        where: { id: adminId },
        data: { password: hashedPassword },
      });

      res.status(200).json({ success: true, message: 'Tenant admin password successfully reset.' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to reset admin password' });
    }
  }

  async impersonateTenant(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = req.params;
      const superAdminUser = (req as any).user;
      const result = await SuperAdminService.impersonateTenant(tenantId as string, superAdminUser);
      res.status(200).json({
        success: true,
        message: `Successfully generated impersonation context for ${result.user.tenant?.name}`,
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to impersonate tenant' });
    }
  }

  async getFeatureFlags(req: Request, res: Response): Promise<void> {
    try {
      const flags = await FeatureFlagService.getAllGlobalFlags();
      res.status(200).json({ success: true, data: flags });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch global feature flags' });
    }
  }

  async updateGlobalFeatureFlag(req: Request, res: Response): Promise<void> {
    try {
      const { key } = req.params;
      const { isEnabled } = req.body;
      if (typeof isEnabled !== 'boolean') {
        res.status(400).json({ success: false, message: 'isEnabled must be a boolean' });
        return;
      }
      const superAdminUser = (req as any).user;
      const updated = await FeatureFlagService.updateGlobalFlag(key as string, isEnabled, superAdminUser);
      res.status(200).json({
        success: true,
        message: `Feature flag ${key} set to ${isEnabled ? 'ENABLED' : 'DISABLED'}`,
        data: updated,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update feature flag' });
    }
  }

  async getTenantEntitlements(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = req.params;
      const entitlements = await FeatureFlagService.getTenantEntitlements(tenantId as string);
      res.status(200).json({ success: true, data: entitlements });
    } catch (err: any) {
      res.status(404).json({ success: false, message: err.message || 'Failed to fetch tenant entitlements' });
    }
  }

  async updateTenantEntitlements(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = req.params;
      const { overrides } = req.body;
      if (!overrides || typeof overrides !== 'object') {
        res.status(400).json({ success: false, message: 'overrides object is required' });
        return;
      }
      const superAdminUser = (req as any).user;
      const updated = await FeatureFlagService.updateTenantEntitlements(
        tenantId as string,
        overrides,
        superAdminUser
      );
      res.status(200).json({
        success: true,
        message: 'Tenant feature entitlements updated successfully',
        data: updated,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update tenant entitlements' });
    }
  }

  async getGlobalAuditLogs(req: Request, res: Response): Promise<void> {
    try {
      const { search, action, entity, tenantId, timeframe, page, limit } = req.query;
      const result = await SuperAdminAuditService.getGlobalAuditLogs({
        search: search as string,
        action: action as string,
        entity: entity as string,
        tenantId: tenantId as string,
        timeframe: timeframe as string,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch global audit logs' });
    }
  }

  async getAuditStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await SuperAdminAuditService.getAuditStats();
      res.status(200).json({ success: true, data: stats });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch audit stats' });
    }
  }

  async getDelinquencyOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = await DunningService.getDelinquencyOverview();
      res.status(200).json({ success: true, data: overview });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch delinquency overview' });
    }
  }

  async extendGracePeriod(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = req.params;
      const { days } = req.body;
      const daysToAdd = Number(days) || 7;
      const superAdminUser = (req as any).user;
      const result = await DunningService.extendGracePeriod(tenantId as string, daysToAdd, superAdminUser);
      res.status(200).json({
        success: true,
        message: `Grace period extended by ${daysToAdd} days.`,
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to extend grace period' });
    }
  }

  async toggleDunningExemption(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = req.params;
      const { isExempt } = req.body;
      const superAdminUser = (req as any).user;
      const result = await DunningService.toggleExemption(tenantId as string, Boolean(isExempt), superAdminUser);
      res.status(200).json({
        success: true,
        message: `Tenant is now ${result.isExempt ? 'EXEMPT' : 'SUBJECT TO'} automated suspension.`,
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to toggle exemption' });
    }
  }

  async triggerDunningScan(req: Request, res: Response): Promise<void> {
    try {
      const superAdminUser = (req as any).user;
      const result = await DunningService.triggerDunningScan(superAdminUser);
      res.status(200).json({
        success: true,
        message: `Dunning scan completed. Scanned ${result.scannedCount} tenants, ${result.suspendedCount} suspended, ${result.inGraceCount} in grace period.`,
        data: result,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to execute dunning scan' });
    }
  }

  // --- Task 5: Platform Announcements & Broadcasts ---
  async getAnnouncements(req: Request, res: Response): Promise<void> {
    try {
      const announcements = await AnnouncementService.getAllAnnouncements();
      res.status(200).json({ success: true, data: announcements });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch announcements' });
    }
  }

  async createAnnouncement(req: Request, res: Response): Promise<void> {
    try {
      const superAdminUser = (req as any).user;
      const announcement = await AnnouncementService.createAnnouncement(req.body, superAdminUser);
      res.status(201).json({ success: true, message: 'Broadcast announcement created', data: announcement });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to create announcement' });
    }
  }

  async updateAnnouncement(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const superAdminUser = (req as any).user;
      const updated = await AnnouncementService.updateAnnouncement(id as string, req.body, superAdminUser);
      res.status(200).json({ success: true, message: 'Announcement updated', data: updated });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update announcement' });
    }
  }

  async toggleAnnouncement(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const superAdminUser = (req as any).user;
      const updated = await AnnouncementService.toggleActive(id as string, superAdminUser);
      res.status(200).json({
        success: true,
        message: `Announcement ${updated.isActive ? 'activated' : 'deactivated'}`,
        data: updated,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to toggle announcement' });
    }
  }

  async deleteAnnouncement(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const superAdminUser = (req as any).user;
      await AnnouncementService.deleteAnnouncement(id as string, superAdminUser);
      res.status(200).json({ success: true, message: 'Announcement deleted successfully' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to delete announcement' });
    }
  }

  async getActiveBroadcasts(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = (req as any).tenantId || (req as any).user?.tenantId || (req.query.tenantId as string);
      const active = await AnnouncementService.getActiveAnnouncementsForTenant(tenantId);
      res.status(200).json({ success: true, data: active });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch active broadcasts' });
    }
  }

  // --- Task 6: Disaster Recovery & Storage ---
  async getBackups(req: Request, res: Response): Promise<void> {
    try {
      const backups = await DisasterRecoveryService.listBackups();
      res.status(200).json({ success: true, data: backups });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to list backups' });
    }
  }

  async createBackup(req: Request, res: Response): Promise<void> {
    try {
      const { label } = req.body;
      const superAdminUser = (req as any).user;
      const backup = await DisasterRecoveryService.createBackup(label, superAdminUser);
      res.status(201).json({
        success: true,
        message: 'Database backup snapshot created successfully',
        data: backup,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to create backup' });
    }
  }

  async deleteBackup(req: Request, res: Response): Promise<void> {
    try {
      const { filename } = req.params;
      const superAdminUser = (req as any).user;
      await DisasterRecoveryService.deleteBackup(filename as string, superAdminUser);
      res.status(200).json({
        success: true,
        message: `Backup ${filename} deleted successfully`,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to delete backup' });
    }
  }

  async downloadBackup(req: Request, res: Response): Promise<void> {
    try {
      const { filename } = req.params;
      const filePath = DisasterRecoveryService.getDownloadFilePath(filename as string);
      res.download(filePath, filename as string);
    } catch (err: any) {
      res.status(404).json({ success: false, message: err.message || 'Backup file not found' });
    }
  }

  async getStorageStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await DisasterRecoveryService.getStorageStats();
      res.status(200).json({ success: true, data: stats });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch storage statistics' });
    }
  }
}
