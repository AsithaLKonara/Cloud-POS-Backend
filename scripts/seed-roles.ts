import prisma from '../src/config/prisma';
import bcrypt from 'bcryptjs';

const MODULE_GROUPS = [
  {
    group: "Orders & Fulfillment",
    modules: [
      { label: "Orders — View", code: "orders:view", action: "View" },
      { label: "Orders — Create", code: "orders:create", action: "Create" },
      { label: "Orders — Edit Status", code: "orders:edit_status", action: "Edit" },
      { label: "Orders — Cancel / Refund", code: "orders:cancel_refund", action: "Delete" },
      { label: "Returns & RMA — View", code: "returns:view", action: "View" },
      { label: "Returns & RMA — Approve / Reject", code: "returns:approve_reject", action: "Edit" },
      { label: "Returns & RMA — Issue Refund", code: "returns:issue_refund", action: "Edit" },
      { label: "Shipping — View Queue", code: "shipping:view_queue", action: "View" },
      { label: "Shipping — Dispatch (Fardar)", code: "shipping:dispatch_fardar", action: "Create" },
      { label: "Shipping — Print Labels", code: "shipping:print_labels", action: "View" },
    ],
  },
  {
    group: "Point of Sale (POS)",
    modules: [
      { label: "POS — Open / Close Shift", code: "pos:shift_open_close", action: "Edit" },
      { label: "POS — Sales Mode", code: "pos:sales_mode", action: "Create" },
      { label: "POS — Returns Mode", code: "pos:returns_mode", action: "Create" },
      { label: "POS — Exchange Mode", code: "pos:exchange_mode", action: "Create" },
      { label: "POS — Dispatch Mode", code: "pos:dispatch_mode", action: "Create" },
      { label: "POS — Hold & Resume Sale", code: "pos:hold_resume", action: "Edit" },
      { label: "POS — Apply Discounts", code: "pos:apply_discounts", action: "Edit" },
      { label: "POS — View Sales History", code: "pos:view_sales_history", action: "View" },
    ],
  },
  {
    group: "Catalog & Products",
    modules: [
      { label: "Products — View", code: "products:view", action: "View" },
      { label: "Products — Create", code: "products:create", action: "Create" },
      { label: "Products — Edit", code: "products:edit", action: "Edit" },
      { label: "Products — Delete", code: "products:delete", action: "Delete" },
      { label: "Categories — Manage", code: "categories:manage", action: "Edit" },
      { label: "Collections — Manage", code: "collections:manage", action: "Edit" },
    ],
  },
  {
    group: "Inventory",
    modules: [
      { label: "Inventory — View Stock Levels", code: "inventory:view_stock", action: "View" },
      { label: "Inventory — Receive Stock (PO)", code: "inventory:receive_po", action: "Create" },
      { label: "Inventory — Stock Transfers", code: "inventory:stock_transfers", action: "Edit" },
      { label: "Inventory — Report Damage / Loss", code: "inventory:report_damage", action: "Create" },
      { label: "Inventory — Adjust Stock", code: "inventory:adjust_stock", action: "Edit" },
    ],
  },
  {
    group: "Payments",
    modules: [
      { label: "Payments — View Transactions", code: "payments:view_transactions", action: "View" },
      { label: "Payments — Process Refund", code: "payments:process_refund", action: "Edit" },
      { label: "Payments — Retry Failed Payment", code: "payments:retry_failed", action: "Edit" },
      { label: "Payments — View Gateway Reports", code: "payments:view_gateway_reports", action: "View" },
    ],
  },
  {
    group: "Customers & Loyalty",
    modules: [
      { label: "Customers — View", code: "customers:view", action: "View" },
      { label: "Customers — Edit", code: "customers:edit", action: "Edit" },
      { label: "Customers — Suspend", code: "customers:suspend", action: "Delete" },
      { label: "Loyalty — View Points", code: "loyalty:view_points", action: "View" },
      { label: "Loyalty — Adjust Points", code: "loyalty:adjust_points", action: "Edit" },
      { label: "Loyalty — Manage Tiers", code: "loyalty:manage_tiers", action: "Edit" },
    ],
  },
  {
    group: "Promotions & Marketing",
    modules: [
      { label: "Promotions — View", code: "promotions:view", action: "View" },
      { label: "Promotions — Create Coupon", code: "promotions:create_coupon", action: "Create" },
      { label: "Promotions — Create Campaign", code: "promotions:create_campaign", action: "Create" },
      { label: "Promotions — Deactivate", code: "promotions:deactivate", action: "Delete" },
    ],
  },
  {
    group: "Reviews",
    modules: [
      { label: "Reviews — View", code: "reviews:view", action: "View" },
      { label: "Reviews — Approve", code: "reviews:approve", action: "Edit" },
      { label: "Reviews — Reject", code: "reviews:reject", action: "Delete" },
      { label: "Reviews — Reply", code: "reviews:reply", action: "Create" },
    ],
  },
  {
    group: "Reports & Analytics",
    modules: [
      { label: "Reports — View Dashboard", code: "reports:view_dashboard", action: "View" },
      { label: "Reports — Export Data", code: "reports:export_data", action: "View" },
      { label: "Reports — View Financial", code: "reports:view_financial", action: "View" },
    ],
  },
  {
    group: "Content Management (CMS)",
    modules: [
      { label: "CMS — View", code: "cms:view", action: "View" },
      { label: "CMS — Edit Hero Slides", code: "cms:edit_hero", action: "Edit" },
      { label: "CMS — Edit Promo Banners", code: "cms:edit_promo", action: "Edit" },
      { label: "CMS — Edit Homepage Layout", code: "cms:edit_homepage", action: "Edit" },
      { label: "CMS — Edit Static Pages", code: "cms:edit_static", action: "Edit" },
    ],
  },
  {
    group: "Media Library",
    modules: [
      { label: "Media — View Library", code: "media:view_library", action: "View" },
      { label: "Media — Upload Files", code: "media:upload", action: "Create" },
      { label: "Media — Delete Files", code: "media:delete", action: "Delete" },
      { label: "Media — Assign to Sections", code: "media:assign", action: "Edit" },
    ],
  },
  {
    group: "Branches",
    modules: [
      { label: "Branches — View", code: "branches:view", action: "View" },
      { label: "Branches — Create", code: "branches:create", action: "Create" },
      { label: "Branches — Edit", code: "branches:edit", action: "Edit" },
      { label: "Branches — Delete", code: "branches:delete", action: "Delete" },
    ],
  },
  {
    group: "System Administration",
    modules: [
      { label: "System — View Audit Logs", code: "system:view_audit_logs", action: "View" },
      { label: "System — Manage Users", code: "system:manage_users", action: "Edit" },
      { label: "System — Manage Roles", code: "system:manage_roles", action: "Edit" },
      { label: "System — Platform Settings", code: "system:platform_settings", action: "Edit" },
    ],
  },
];

async function main() {
  console.log("Starting Roles & Permissions Seeding...");

  // 1. Seed Permissions
  console.log("Seeding Permissions...");
  for (const group of MODULE_GROUPS) {
    for (const mod of group.modules) {
      await prisma.permission.upsert({
        where: { code: mod.code },
        update: {
          module: group.group,
          action: mod.action,
          description: mod.label,
        },
        create: {
          code: mod.code,
          module: group.group,
          action: mod.action,
          description: mod.label,
        },
      });
    }
  }

  // 2. Define Roles
  const rolesToCreate = [
    {
      name: "Super Admin",
      description: "Full system access. Bypasses all permission checks.",
      isSystem: true,
      permissions: MODULE_GROUPS.flatMap(g => g.modules.map(m => m.code))
    },
    {
      name: "ADMIN",
      description: "Tenant Owner & Store Administrator. Full operational access across the tenant.",
      isSystem: true,
      permissions: MODULE_GROUPS.flatMap(g => g.modules.map(m => m.code))
    },
    {
      name: "Tenant Admin",
      description: "Full Tenant Administrator access across all operational modules.",
      isSystem: true,
      permissions: MODULE_GROUPS.flatMap(g => g.modules.map(m => m.code))
    },
    {
      name: "Branch Admin",
      description: "Manages a specific branch operations, staff, and inventory.",
      isSystem: true,
      permissions: [
        "orders:view", "orders:create", "orders:edit_status", "orders:cancel_refund",
        "returns:view", "returns:approve_reject", "returns:issue_refund",
        "pos:shift_open_close", "pos:sales_mode", "pos:returns_mode", "pos:exchange_mode", "pos:dispatch_mode", "pos:hold_resume", "pos:apply_discounts", "pos:view_sales_history",
        "customers:view", "customers:edit",
        "loyalty:view_points",
        "inventory:view_stock", "inventory:receive_po", "inventory:stock_transfers", "inventory:report_damage", "inventory:adjust_stock",
        "reports:view_dashboard", "reports:export_data",
        "branches:view",
      ]
    },
    {
      name: "Branch Cashier",
      description: "Handles POS operations and customer checkout.",
      isSystem: true,
      permissions: [
        "pos:shift_open_close", "pos:sales_mode", "pos:returns_mode", "pos:exchange_mode", "pos:dispatch_mode", "pos:hold_resume", "pos:view_sales_history",
        "customers:view",
        "loyalty:view_points",
      ]
    },
    {
      name: "Online Sales",
      description: "Manages ecommerce orders, promotions, and customer support.",
      isSystem: true,
      permissions: [
        "orders:view", "orders:edit_status", "orders:cancel_refund",
        "returns:view", "returns:approve_reject", "returns:issue_refund",
        "shipping:view_queue", "shipping:dispatch_fardar", "shipping:print_labels",
        "customers:view", "customers:edit",
        "loyalty:view_points", "loyalty:adjust_points",
        "promotions:view", "promotions:create_coupon", "promotions:create_campaign", "promotions:deactivate",
        "reviews:view", "reviews:approve", "reviews:reject", "reviews:reply",
        "products:view",
        "reports:view_dashboard"
      ]
    }
  ];

  // 3. Seed Roles & Assign Permissions
  console.log("Seeding Roles and linking permissions...");
  const roleCache: Record<string, string> = {};
  for (const roleDef of rolesToCreate) {
    let role = await prisma.role.findUnique({ where: { name: roleDef.name } });
    if (!role) {
      role = await prisma.role.create({
        data: {
          name: roleDef.name,
          description: roleDef.description,
          isSystem: roleDef.isSystem,
        }
      });
    }

    roleCache[role.name] = role.id;

    // Clear existing permissions for role
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    // Find all permission IDs for this role
    const permissions = await prisma.permission.findMany({
      where: { code: { in: roleDef.permissions } }
    });

    // Link new permissions
    if (permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissions.map(p => ({
          roleId: role!.id,
          permissionId: p.id,
        })),
        skipDuplicates: true,
      });
    }
  }

  // 4. Seed Default Users
  console.log("Seeding Default Users...");
  const defaultPassword = await bcrypt.hash("Password123!", 10);
  const usersToCreate = [
    { name: "Super Admin", email: "superadmin@seramaaduwen.lk", roleName: "Super Admin" },
    { name: "Branch Admin", email: "branchadmin@seramaaduwen.lk", roleName: "Branch Admin" },
    { name: "Branch Cashier", email: "cashier@seramaaduwen.lk", roleName: "Branch Cashier" },
    { name: "Online Sales", email: "onlinesales@seramaaduwen.lk", roleName: "Online Sales" },
  ];

  for (const userDef of usersToCreate) {
    let user = await prisma.user.findUnique({ where: { email: userDef.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: userDef.name,
          email: userDef.email,
          password: defaultPassword,
          status: "ACTIVE",
        }
      });
    }

    const roleId = roleCache[userDef.roleName];
    if (roleId) {
      // Ensure user has this role
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {},
        create: {
          userId: user.id,
          roleId,
        }
      });
    }
  }

  console.log("Seeding complete! ✨");
}

main()
  .catch((e) => {
    console.error("Error seeding data:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
