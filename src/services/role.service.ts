import bcrypt from "bcryptjs";
import prisma from "../config/prisma";
import { AppError } from "../middlewares/errorHandler";

export const SYSTEM_PERMISSIONS = [
  // Orders & Fulfillment
  { code: "orders:view", module: "Orders & Fulfillment", action: "View", description: "View customer orders" },
  { code: "orders:create", module: "Orders & Fulfillment", action: "Create", description: "Create manual orders" },
  { code: "orders:edit_status", module: "Orders & Fulfillment", action: "Edit", description: "Update order status" },
  { code: "orders:cancel_refund", module: "Orders & Fulfillment", action: "Delete", description: "Cancel orders and issue refunds" },
  { code: "returns:view", module: "Orders & Fulfillment", action: "View", description: "View return requests & RMA" },
  { code: "returns:approve_reject", module: "Orders & Fulfillment", action: "Edit", description: "Approve or reject return requests" },
  { code: "returns:issue_refund", module: "Orders & Fulfillment", action: "Edit", description: "Issue refund for returns" },
  { code: "shipping:view_queue", module: "Orders & Fulfillment", action: "View", description: "View dispatch and shipping queue" },
  { code: "shipping:dispatch_fardar", module: "Orders & Fulfillment", action: "Create", description: "Dispatch packages via courier (Fardar)" },
  { code: "shipping:print_labels", module: "Orders & Fulfillment", action: "View", description: "Print airway bills and shipping labels" },

  // Point of Sale (POS)
  { code: "pos:shift_open_close", module: "Point of Sale (POS)", action: "Edit", description: "Open and close cashier shift" },
  { code: "pos:sales_mode", module: "Point of Sale (POS)", action: "Create", description: "Process in-store checkout & sales" },
  { code: "pos:returns_mode", module: "Point of Sale (POS)", action: "Create", description: "Process in-store return & exchange" },
  { code: "pos:exchange_mode", module: "Point of Sale (POS)", action: "Create", description: "Process exchange vouchers" },
  { code: "pos:dispatch_mode", module: "Point of Sale (POS)", action: "Create", description: "Dispatch orders from POS" },
  { code: "pos:hold_resume", module: "Point of Sale (POS)", action: "Edit", description: "Hold and resume active cart sessions" },
  { code: "pos:apply_discounts", module: "Point of Sale (POS)", action: "Edit", description: "Apply manual or promotional discounts" },
  { code: "pos:view_sales_history", module: "Point of Sale (POS)", action: "View", description: "View terminal sales history" },

  // Catalog & Products
  { code: "products:view", module: "Catalog & Products", action: "View", description: "View catalog products" },
  { code: "products:create", module: "Catalog & Products", action: "Create", description: "Create new products" },
  { code: "products:edit", module: "Catalog & Products", action: "Edit", description: "Update product details & pricing" },
  { code: "products:delete", module: "Catalog & Products", action: "Delete", description: "Archive or delete products" },
  { code: "categories:manage", module: "Catalog & Products", action: "Edit", description: "Manage categories and hierarchy" },
  { code: "collections:manage", module: "Catalog & Products", action: "Edit", description: "Manage curated collections" },

  // Inventory
  { code: "inventory:view_stock", module: "Inventory", action: "View", description: "View multi-branch stock levels" },
  { code: "inventory:receive_po", module: "Inventory", action: "Create", description: "Receive stock via Purchase Orders" },
  { code: "inventory:stock_transfers", module: "Inventory", action: "Edit", description: "Create and accept stock transfers" },
  { code: "inventory:report_damage", module: "Inventory", action: "Create", description: "Record damaged or lost items" },
  { code: "inventory:adjust_stock", module: "Inventory", action: "Edit", description: "Manual stock level adjustments" },

  // Payments
  { code: "payments:view_transactions", module: "Payments", action: "View", description: "View online & POS transaction logs" },
  { code: "payments:process_refund", module: "Payments", action: "Edit", description: "Process payment gateway refunds" },
  { code: "payments:retry_failed", module: "Payments", action: "Edit", description: "Retry failed webhooks or payments" },
  { code: "payments:view_gateway_reports", module: "Payments", action: "View", description: "View settlement and fee reports" },

  // Customers & Loyalty
  { code: "customers:view", module: "Customers & Loyalty", action: "View", description: "View customer profiles and order history" },
  { code: "customers:edit", module: "Customers & Loyalty", action: "Edit", description: "Update customer records" },
  { code: "customers:suspend", module: "Customers & Loyalty", action: "Delete", description: "Suspend customer access" },
  { code: "loyalty:view_points", module: "Customers & Loyalty", action: "View", description: "View loyalty points ledger" },
  { code: "loyalty:adjust_points", module: "Customers & Loyalty", action: "Edit", description: "Manually adjust customer points" },
  { code: "loyalty:manage_tiers", module: "Customers & Loyalty", action: "Edit", description: "Configure membership tiers" },

  // Promotions & Marketing
  { code: "promotions:view", module: "Promotions & Marketing", action: "View", description: "View discounts and promotions" },
  { code: "promotions:create_coupon", module: "Promotions & Marketing", action: "Create", description: "Create coupon codes" },
  { code: "promotions:create_campaign", module: "Promotions & Marketing", action: "Create", description: "Create sales campaigns & flash sales" },
  { code: "promotions:deactivate", module: "Promotions & Marketing", action: "Delete", description: "Deactivate running promotions" },

  // Reviews
  { code: "reviews:view", module: "Reviews", action: "View", description: "View customer reviews" },
  { code: "reviews:approve", module: "Reviews", action: "Edit", description: "Approve customer reviews" },
  { code: "reviews:reject", module: "Reviews", action: "Delete", description: "Reject or flag reviews" },
  { code: "reviews:reply", module: "Reviews", action: "Create", description: "Post official response to reviews" },

  // Reports & Analytics
  { code: "reports:view_dashboard", module: "Reports & Analytics", action: "View", description: "View executive and sales analytics" },
  { code: "reports:export_data", module: "Reports & Analytics", action: "View", description: "Export CSV and financial reports" },
  { code: "reports:view_financial", module: "Reports & Analytics", action: "View", description: "View revenue and profit analytics" },

  // Content Management (CMS)
  { code: "cms:view", module: "Content Management (CMS)", action: "View", description: "View CMS content and banners" },
  { code: "cms:edit_hero", module: "Content Management (CMS)", action: "Edit", description: "Update hero sliders" },
  { code: "cms:edit_promo", module: "Content Management (CMS)", action: "Edit", description: "Update promo banners" },
  { code: "cms:edit_homepage", module: "Content Management (CMS)", action: "Edit", description: "Update homepage sections" },
  { code: "cms:edit_static", module: "Content Management (CMS)", action: "Edit", description: "Update policy & static pages" },

  // Media Library
  { code: "media:view_library", module: "Media Library", action: "View", description: "View uploaded media assets" },
  { code: "media:upload", module: "Media Library", action: "Create", description: "Upload images and media" },
  { code: "media:delete", module: "Media Library", action: "Delete", description: "Delete media items" },
  { code: "media:assign", module: "Media Library", action: "Edit", description: "Assign media to products or banners" },

  // Branches
  { code: "branches:view", module: "Branches", action: "View", description: "View branch locations & terminals" },
  { code: "branches:create", module: "Branches", action: "Create", description: "Add new branch location" },
  { code: "branches:edit", module: "Branches", action: "Edit", description: "Update branch settings & assigned staff" },
  { code: "branches:delete", module: "Branches", action: "Delete", description: "Decommission branch location" },

  // System Administration
  { code: "system:view_audit_logs", module: "System Administration", action: "View", description: "View system audit trail" },
  { code: "system:manage_users", module: "System Administration", action: "Edit", description: "Manage system staff & invitations" },
  { code: "system:manage_roles", module: "System Administration", action: "Edit", description: "Create and configure access roles" },
  { code: "system:platform_settings", module: "System Administration", action: "Edit", description: "Global configuration & integrations" },
];

export class RoleService {
  /**
   * Automatically seed system permissions, default roles, and super admin account
   */
  static async seedDefaultRolesAndPermissions() {
    try {
      // 1. Seed Permissions in batch
      await prisma.permission.createMany({
        data: SYSTEM_PERMISSIONS,
        skipDuplicates: true,
      });

      const allPermissions = await prisma.permission.findMany();
      const permMap = new Map(allPermissions.map((p) => [p.code, p.id]));

      // 2. Define System Roles & Initial Permission Sets
      const rolesConfig = [
        {
          name: "Super Admin",
          description: "Full system access — all modules, all branches, all settings. Can manage roles and users.",
          isSystem: true,
          permissionCodes: allPermissions.map((p) => p.code),
        },
        {
          name: "Admin",
          description: "Full administrative access across all branches of the tenant. Executive dashboard, P&L, catalog, inventory, settings, staff.",
          isSystem: true,
          permissionCodes: allPermissions
            .map((p) => p.code)
            .filter((c) => !c.startsWith("system:platform_settings")),
        },
        {
          name: "Branch Admin",
          description: "Full access within assigned branch. Orders, POS, inventory, returns, reports.",
          isSystem: true,
          permissionCodes: allPermissions
            .map((p) => p.code)
            .filter((c) => !c.startsWith("system:") && !c.startsWith("branches:delete")),
        },
        {
          name: "Cashier",
          description: "POS-only access: open/close shift, sales, returns, exchanges, holds. No admin dashboard.",
          isSystem: true,
          permissionCodes: [
            "pos:shift_open_close",
            "pos:sales_mode",
            "pos:returns_mode",
            "pos:exchange_mode",
            "pos:hold_resume",
            "pos:apply_discounts",
            "pos:view_sales_history",
            "orders:view",
            "customers:view",
          ],
        },
        {
          name: "Inventory Manager",
          description: "Catalog, stock levels, receive PO, stock transfers, damage reports.",
          isSystem: true,
          permissionCodes: [
            "inventory:view_stock",
            "inventory:receive_po",
            "inventory:stock_transfers",
            "inventory:report_damage",
            "inventory:adjust_stock",
            "products:view",
            "products:create",
            "products:edit",
            "categories:manage",
            "collections:manage",
            "shipping:view_queue",
          ],
        },
        {
          name: "Warehouse Staff",
          description: "Shipping queue, dispatch via Fardar, print labels, receive warehouse returns.",
          isSystem: true,
          permissionCodes: [
            "inventory:view_stock",
            "inventory:receive_po",
            "inventory:report_damage",
            "shipping:view_queue",
            "shipping:dispatch_fardar",
            "shipping:print_labels",
            "orders:view",
            "returns:view",
          ],
        },
        {
          name: "Marketing Manager",
          description: "Full access to Promotions, CMS, Media Library, Reviews, and customer viewing.",
          isSystem: true,
          permissionCodes: [
            "promotions:view",
            "promotions:create_coupon",
            "promotions:create_campaign",
            "promotions:deactivate",
            "reviews:view",
            "reviews:approve",
            "reviews:reject",
            "reviews:reply",
            "cms:view",
            "cms:edit_hero",
            "cms:edit_promo",
            "cms:edit_homepage",
            "cms:edit_static",
            "media:view_library",
            "media:upload",
            "media:delete",
            "media:assign",
            "customers:view",
            "reports:view_dashboard",
          ],
        },
        {
          name: "Customer Support",
          description: "View orders, process returns/RMA, view customer profiles.",
          isSystem: true,
          permissionCodes: [
            "orders:view",
            "returns:view",
            "returns:approve_reject",
            "returns:issue_refund",
            "customers:view",
            "customers:edit",
            "reviews:view",
            "reviews:reply",
          ],
        },
        {
          name: "Finance Auditor",
          description: "Read-only access to Payments, Reports/Analytics, and Audit Logs.",
          isSystem: true,
          permissionCodes: [
            "payments:view_transactions",
            "payments:view_gateway_reports",
            "reports:view_dashboard",
            "reports:export_data",
            "reports:view_financial",
            "system:view_audit_logs",
          ],
        },
        {
          name: "PUBLIC_USER",
          description: "Default customer role with public storefront and account access",
          isSystem: true,
          permissionCodes: [],
        },
      ];

      const rolePermissionLinks: { roleId: string; permissionId: string }[] = [];

      for (const roleDef of rolesConfig) {
        const role = await prisma.role.upsert({
          where: { name: roleDef.name },
          update: {
            description: roleDef.description,
            isSystem: roleDef.isSystem,
            status: "Active",
          },
          create: {
            name: roleDef.name,
            description: roleDef.description,
            isSystem: roleDef.isSystem,
            status: "Active",
          },
        });

        if (roleDef.permissionCodes && roleDef.permissionCodes.length > 0) {
          for (const pCode of roleDef.permissionCodes) {
            const pId = permMap.get(pCode);
            if (pId) {
              rolePermissionLinks.push({
                roleId: role.id,
                permissionId: pId,
              });
            }
          }
        }
      }

      if (rolePermissionLinks.length > 0) {
        await prisma.rolePermission.createMany({
          data: rolePermissionLinks,
          skipDuplicates: true,
        });
      }

      // 3. Seed default Super Admin user if none exists
      const superAdminRole = await prisma.role.findUnique({
        where: { name: "Super Admin" },
      });

      if (superAdminRole) {
        const adminEmail = "admin@seramaaduwen.lk";
        const existingAdmin = await prisma.user.findUnique({
          where: { email: adminEmail },
        });

        if (!existingAdmin) {
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash("Admin@123456", salt);

          await prisma.user.create({
            data: {
              email: adminEmail,
              password: hashedPassword,
              name: "Super Admin",
              phone: "+94770000000",
              status: "ACTIVE",
              userRoles: {
                create: {
                  roleId: superAdminRole.id,
                },
              },
            },
          });
        }
      }
    } catch (error) {
      console.error("Error seeding default roles and permissions:", error);
    }
  }

  /**
   * Get all roles with assigned user count & permissions
   */
  static async getAllRoles() {
    const roles = await prisma.role.findMany({
      include: {
        _count: {
          select: {
            userRoles: true,
            permissions: true,
          },
        },
        permissions: {
          include: {
            permission: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return roles.map((r) => {
      // Determine permission level for UI badge
      let level = "Low";
      if (r.name === "Super Admin" || r.name === "Branch Admin" || r._count.permissions > 30) {
        level = "High";
      } else if (r._count.permissions > 10) {
        level = "Medium";
      }

      return {
        id: r.id,
        name: r.name,
        description: r.description || "",
        isSystem: r.isSystem,
        status: r.status,
        users: r._count.userRoles,
        permissionCount: r._count.permissions,
        level,
        permissions: r.permissions.map((p) => p.permission.code),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  }

  /**
   * Get role details with full permission matrix
   */
  static async getRoleById(id: string) {
    const role = await prisma.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        userRoles: {
          include: {
            user: {
              select: { id: true, name: true, email: true, status: true },
            },
          },
        },
      },
    });

    if (!role) {
      throw new AppError("Role not found.", 404);
    }

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      status: role.status,
      permissions: role.permissions.map((p) => p.permission.code),
      users: role.userRoles.map((ur) => ur.user),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  /**
   * Create a new custom role
   */
  static async createRole(data: {
    name: string;
    description?: string;
    status?: string;
    permissionCodes?: string[];
  }) {
    const existing = await prisma.role.findUnique({
      where: { name: data.name.trim() },
    });

    if (existing) {
      throw new AppError(`Role with name '${data.name}' already exists.`, 400);
    }

    const role = await prisma.role.create({
      data: {
        name: data.name.trim(),
        description: data.description || "",
        status: data.status || "Active",
        isSystem: false,
      },
    });

    // Attach permissions
    if (data.permissionCodes && data.permissionCodes.length > 0) {
      const perms = await prisma.permission.findMany({
        where: { code: { in: data.permissionCodes } },
      });

      for (const p of perms) {
        await prisma.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId: p.id,
          },
        });
      }
    }

    return this.getRoleById(role.id);
  }

  /**
   * Update role details and permissions
   */
  static async updateRole(
    id: string,
    data: {
      name?: string;
      description?: string;
      status?: string;
      permissionCodes?: string[];
    }
  ) {
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) {
      throw new AppError("Role not found.", 404);
    }

    // Update base fields
    await prisma.role.update({
      where: { id },
      data: {
        name: data.name ? data.name.trim() : role.name,
        description: data.description !== undefined ? data.description : role.description,
        status: data.status || role.status,
      },
    });

    // Sync permissions if provided
    if (data.permissionCodes !== undefined) {
      // Clear existing
      await prisma.rolePermission.deleteMany({
        where: { roleId: id },
      });

      if (data.permissionCodes.length > 0) {
        const perms = await prisma.permission.findMany({
          where: { code: { in: data.permissionCodes } },
        });

        for (const p of perms) {
          await prisma.rolePermission.create({
            data: {
              roleId: id,
              permissionId: p.id,
            },
          });
        }
      }
    }

    return this.getRoleById(id);
  }

  /**
   * Delete a custom role
   */
  static async deleteRole(id: string) {
    const role = await prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { userRoles: true } } },
    });

    if (!role) {
      throw new AppError("Role not found.", 404);
    }

    if (role.isSystem) {
      throw new AppError("System roles cannot be deleted.", 400);
    }

    if (role._count.userRoles > 0) {
      throw new AppError(
        `Cannot delete role '${role.name}' because it is currently assigned to ${role._count.userRoles} user(s).`,
        400
      );
    }

    await prisma.role.delete({ where: { id } });
    return { success: true, message: `Role '${role.name}' deleted successfully.` };
  }

  /**
   * Get all permissions grouped by module
   */
  static async getAllPermissions() {
    const permissions = await prisma.permission.findMany({
      orderBy: [{ module: "asc" }, { code: "asc" }],
    });

    // Group permissions by module
    const grouped: Record<string, typeof permissions> = {};
    for (const p of permissions) {
      if (!grouped[p.module]) {
        grouped[p.module] = [];
      }
      grouped[p.module]!.push(p);
    }

    return {
      all: permissions,
      grouped,
    };
  }

  /**
   * User Management: Get all users with assigned roles & branches
   */
  static async getAllUsers(search?: string, roleFilter?: string) {
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true, code: true } },
        userRoles: {
          include: {
            role: { select: { id: true, name: true, isSystem: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return users.map((u) => {
      const primaryRole = u.userRoles[0]?.role?.name || "PUBLIC_USER";
      const branchName = u.branch?.name || "Global (All Branches)";

      return {
        id: u.id,
        name: u.name || u.email.split("@")[0],
        email: u.email,
        phone: u.phone,
        birthday: u.birthday,
        role: primaryRole,
        roles: u.userRoles.map((ur) => ur.role.name),
        roleIds: u.userRoles.map((ur) => ur.role.id),
        branch: branchName,
        branchId: u.branchId,
        status: u.status,
        createdAt: u.createdAt,
      };
    });
  }

  /**
   * User Management: Create an internal staff/admin user
   */
  static async createUser(data: {
    email: string;
    password?: string;
    name?: string;
    phone?: string;
    branchId?: string | null;
    status?: string;
    roleIds?: string[];
  }) {
    const email = data.email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new AppError("A user with this email address already exists.", 400);
    }

    const passwordToHash = data.password || "SeramaaduwenStaff@2026";
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(passwordToHash, salt);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: data.name || email.split("@")[0],
        phone: data.phone || null,
        branchId: data.branchId || null,
        status: data.status || "ACTIVE",
      },
    });

    if (data.roleIds && data.roleIds.length > 0) {
      for (const roleId of data.roleIds) {
        await prisma.userRole.create({
          data: {
            userId: user.id,
            roleId,
          },
        });
      }
    }

    return user;
  }

  /**
   * User Management: Update an internal user
   */
  static async updateUser(
    id: string,
    data: {
      name?: string;
      email?: string;
      phone?: string;
      branchId?: string | null;
      status?: string;
      roleIds?: string[];
      password?: string;
    }
  ) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError("User not found.", 404);
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.branchId !== undefined) updateData.branchId = data.branchId;
    if (data.status !== undefined) updateData.status = data.status;

    if (data.password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(data.password, salt);
    }

    await prisma.user.update({
      where: { id },
      data: updateData,
    });

    // Update assigned roles if specified
    if (data.roleIds !== undefined) {
      await prisma.userRole.deleteMany({
        where: { userId: id },
      });

      for (const roleId of data.roleIds) {
        await prisma.userRole.create({
          data: {
            userId: id,
            roleId,
          },
        });
      }
    }

    return this.getAllUsers();
  }

  /**
   * User Management: Delete user
   */
  static async deleteUser(id: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError("User not found.", 404);
    }

    await prisma.user.delete({ where: { id } });
    return { success: true, message: "User deleted successfully." };
  }
}
