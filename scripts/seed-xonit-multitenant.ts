import bcrypt from 'bcryptjs';
import prisma from '../src/config/prisma';
import { RoleService } from '../src/services/role.service';

async function main() {
  console.log('Seeding XONIT Enterprise Multi-Tenant demo accounts...');

  // 1. Ensure Roles Exist
  await RoleService.seedDefaultRolesAndPermissions();

  const superAdminRole = await prisma.role.findFirst({ where: { name: 'Super Admin' } });
  const tenantAdminRole = await prisma.role.findFirst({ where: { name: 'Admin' } }) || superAdminRole;
  const branchAdminRole = await prisma.role.findFirst({ where: { name: 'Branch Admin' } }) || tenantAdminRole;
  const cashierRole = await prisma.role.findFirst({ where: { name: 'Cashier' } }) || branchAdminRole;

  // 2. Tenants to Seed
  const tenantsData = [
    {
      name: 'XONIT Cloud Platform',
      slug: 'xonit-platform',
      businessType: 'GENERAL_SERVICES' as const,
      status: 'ACTIVE' as const,
      contactEmail: 'admin@xonit.space',
    },
    {
      name: 'Velvet Threads Boutique',
      slug: 'velvet-threads',
      businessType: 'RETAIL' as const,
      status: 'ACTIVE' as const,
      contactEmail: 'retail.admin@xonit.space',
    },
    {
      name: 'The Artisan Bistro & Cafe',
      slug: 'artisan-bistro',
      businessType: 'RESTAURANT_CAFE' as const,
      status: 'ACTIVE' as const,
      contactEmail: 'bistro.admin@xonit.space',
    },
    {
      name: 'Luxe Spa & Wellness Clinic',
      slug: 'luxe-spa-wellness',
      businessType: 'SALON_SPA' as const,
      status: 'ACTIVE' as const,
      contactEmail: 'salon.admin@xonit.space',
    },
    {
      name: 'Colombo Central Flagship Hub',
      slug: 'colombo-central',
      businessType: 'RETAIL' as const,
      status: 'ACTIVE' as const,
      contactEmail: 'cashier.colombo@xonit.space',
    },
  ];

  const tenantMap = new Map<string, any>();

  for (const t of tenantsData) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: t.slug },
      update: { name: t.name, businessType: t.businessType, status: t.status },
      create: {
        name: t.name,
        slug: t.slug,
        businessType: t.businessType,
        status: t.status,
      },
    });
    tenantMap.set(t.slug, tenant);
    console.log(`✓ Tenant ready: [${tenant.name}] (${tenant.slug})`);

    // Ensure main branch exists for this tenant
    const branchCode = `${t.slug.substring(0, 4).toUpperCase()}-01`;
    await prisma.branch.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: branchCode,
        },
      },
      update: {},
      create: {
        name: `${tenant.name} - Main Branch`,
        code: branchCode,
        address: 'Colombo, Sri Lanka',
        phone: '+94 11 234 5678',
        tenantId: tenant.id,
      },
    });
  }

  // 3. Dev Switcher Users to Seed
  const users = [
    {
      email: 'admin@xonit.space',
      name: 'Asitha K. (Super Admin)',
      passwordRaw: 'Admin@123456',
      tenantSlug: 'xonit-platform',
      roleId: superAdminRole?.id,
      assignBranch: false,
    },
    {
      email: 'retail.admin@xonit.space',
      name: 'Elena Rostova (Boutique Admin)',
      passwordRaw: 'Password@123',
      tenantSlug: 'velvet-threads',
      roleId: tenantAdminRole?.id,
      assignBranch: false,
    },
    {
      email: 'bistro.admin@xonit.space',
      name: 'Chef Marcus (Bistro Manager)',
      passwordRaw: 'Password@123',
      tenantSlug: 'artisan-bistro',
      roleId: tenantAdminRole?.id,
      assignBranch: false,
    },
    {
      email: 'salon.admin@xonit.space',
      name: 'Dr. Clara Vance (Spa Director)',
      passwordRaw: 'Password@123',
      tenantSlug: 'luxe-spa-wellness',
      roleId: tenantAdminRole?.id,
      assignBranch: false,
    },
    {
      email: 'branch.manager@xonit.space',
      name: 'Kamal Perera (Branch Manager)',
      passwordRaw: 'Password@123',
      tenantSlug: 'velvet-threads',
      roleId: branchAdminRole?.id,
      assignBranch: true,
    },
    {
      email: 'cashier.colombo@xonit.space',
      name: 'Kasun Bandara (Front Desk Cashier)',
      passwordRaw: 'Password@123',
      tenantSlug: 'colombo-central',
      roleId: cashierRole?.id,
      assignBranch: true,
    },
  ];

  for (const u of users) {
    const tenant = tenantMap.get(u.tenantSlug);
    const passwordHash = await bcrypt.hash(u.passwordRaw, 10);

    const branch = u.assignBranch
      ? await prisma.branch.findFirst({ where: { tenantId: tenant?.id } })
      : null;

    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        password: passwordHash,
        name: u.name,
        tenantId: tenant?.id,
        branchId: branch?.id || null,
        status: 'ACTIVE',
      },
      create: {
        email: u.email,
        password: passwordHash,
        name: u.name,
        phone: '+94 77 000 0000',
        status: 'ACTIVE',
        tenantId: tenant?.id,
        branchId: branch?.id || null,
      },
    });

    if (u.roleId) {
      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: u.roleId,
        },
      });
    }

    console.log(`✓ Dev Account Seeded: ${u.email} | Slug: ${u.tenantSlug} | Pwd: ${u.passwordRaw}`);
  }

  console.log('\nAll 5 XONIT multi-tenant accounts are ready for 1-click login!\n');
}

main()
  .catch((e) => {
    console.error('Error seeding multi-tenant accounts:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
