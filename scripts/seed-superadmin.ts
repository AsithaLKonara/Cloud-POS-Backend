import bcrypt from "bcryptjs";
import prisma from "../src/config/prisma";
import { RoleService } from "../src/services/role.service";
import { SettingService } from "../src/services/setting.service";

async function main() {
  console.log("Starting manual database seed...");

  try {
    // 1. Seed Roles, Permissions, and Settings
    console.log("Seeding roles and settings...");
    await RoleService.seedDefaultRolesAndPermissions();
    await SettingService.seedDefaultSettings();

    // 2. Create the requested super admin
    const superAdminRole = await prisma.role.findUnique({
      where: { name: "Super Admin" },
    });

    if (!superAdminRole) {
      throw new Error("Super Admin role not found. Role seeding may have failed.");
    }

    const adminEmail = "superadmin@seramaaduwen.lk";
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (existingAdmin) {
      console.log(`Super admin ${adminEmail} already exists.`);
    } else {
      console.log(`Creating super admin: ${adminEmail}`);
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("Password@123", salt);

      await prisma.user.create({
        data: {
          email: adminEmail,
          password: hashedPassword,
          name: "Super Admin",
          phone: "+94700000000",
          status: "ACTIVE",
          userRoles: {
            create: {
              roleId: superAdminRole.id,
            },
          },
        },
      });
      console.log("Super admin created successfully.");
    }

    console.log("Seed completed successfully!");
  } catch (error) {
    console.error("Error during manual seed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
