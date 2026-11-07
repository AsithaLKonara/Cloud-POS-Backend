import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { SuperAdminService } from '../services/superadmin.service';
import { TenantService } from '../services/tenant.service';

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
}
