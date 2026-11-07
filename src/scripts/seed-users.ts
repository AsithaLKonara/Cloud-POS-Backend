import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('Seeding roles and users...');

  // Roles to create
  const rolesData = [
    { name: 'Super Admin', description: 'Full system access', isSystem: true },
    { name: 'Branch Admin', description: 'Branch-level management', isSystem: true },
    { name: 'Cashier', description: 'POS and basic sales operations', isSystem: true },
    { name: 'Online Sales', description: 'E-commerce order fulfillment', isSystem: true },
  ];

  const roles: Record<string, any> = {};

  for (const r of rolesData) {
    let role = await prisma.role.findFirst({ where: { name: r.name } });
    if (!role) {
      role = await prisma.role.create({ data: r });
      console.log(`Created role: ${r.name}`);
    }
    roles[r.name] = role;
  }

  // Users to create
  const usersData = [
    { email: 'superadmin@seramaaduwen.lk', name: 'Super Admin', role: 'Super Admin' },
    { email: 'branchadmin@seramaaduwen.lk', name: 'Branch Admin', role: 'Branch Admin' },
    { email: 'cashier@seramaaduwen.lk', name: 'Cashier', role: 'Cashier' },
    { email: 'onlinesales@seramaaduwen.lk', name: 'Online Sales', role: 'Online Sales' },
  ];

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash('Password123!', salt);

  for (const u of usersData) {
    let user = await prisma.user.findUnique({ where: { email: u.email } });
    
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: u.email,
          name: u.name,
          password: hashedPassword,
        }
      });
      console.log(`Created user: ${u.email}`);
    } else {
      console.log(`User already exists: ${u.email}, updating password...`);
      user = await prisma.user.update({
        where: { email: u.email },
        data: { password: hashedPassword }
      });
    }

    // Link user to role if not already linked
    const role = roles[u.role];
    if (role) {
      const userRole = await prisma.userRole.findUnique({
        where: { userId_roleId: { userId: user.id, roleId: role.id } }
      });
      
      if (!userRole) {
        await prisma.userRole.create({
          data: { userId: user.id, roleId: role.id }
        });
        console.log(`Assigned role ${u.role} to ${u.email}`);
      }
    }
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
