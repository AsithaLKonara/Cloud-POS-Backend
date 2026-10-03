import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL?.replace('?pgbouncer=true&', '?').replace('&pgbouncer=true', '').replace('pgbouncer=true', '');
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function main() {
  console.log("Seeding main branch and superadmin via pg...");
  const client = await pool.connect();

  try {
    // 1. Create Main Branch
    let branchRes = await client.query('SELECT id, name FROM "Branch" WHERE code = $1', ['MAIN']);
    let branchId = '';
    if (branchRes.rows.length === 0) {
      branchId = crypto.randomUUID();
      await client.query(`
        INSERT INTO "Branch" (id, name, code, type, "isActive", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      `, [branchId, 'Main Branch', 'MAIN', 'RETAIL', true]);
      console.log("Branch created: Main Branch");
    } else {
      branchId = branchRes.rows[0].id;
      console.log("Branch already exists: Main Branch");
    }

    // 2. Create Super Admin Role
    let roleRes = await client.query('SELECT id FROM "Role" WHERE name = $1', ['Super Admin']);
    let roleId = '';
    if (roleRes.rows.length === 0) {
      roleId = crypto.randomUUID();
      await client.query(`
        INSERT INTO "Role" (id, name, description, "isSystem", status, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      `, [roleId, 'Super Admin', 'System owner with full access', true, 'Active']);
      console.log("Role created: Super Admin");
    } else {
      roleId = roleRes.rows[0].id;
      console.log("Role already exists: Super Admin");
    }

    // 3. Create Super Admin User
    const email = 'superadmin@seramaaduwen.lk';
    let userRes = await client.query('SELECT id FROM "User" WHERE email = $1', [email]);
    let userId = '';
    const hashedPassword = await bcrypt.hash('Password123!', 10);
    if (userRes.rows.length === 0) {
      userId = crypto.randomUUID();
      await client.query(`
        INSERT INTO "User" (id, email, password, name, "branchId", status, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      `, [userId, email, hashedPassword, 'Super Admin', branchId, 'ACTIVE']);
      console.log("User created:", email);
    } else {
      userId = userRes.rows[0].id;
      await client.query(`
        UPDATE "User" SET password = $1, "branchId" = $2 WHERE id = $3
      `, [hashedPassword, branchId, userId]);
      console.log("User updated:", email);
    }

    // 4. Assign Role
    let userRoleRes = await client.query('SELECT * FROM "UserRole" WHERE "userId" = $1 AND "roleId" = $2', [userId, roleId]);
    if (userRoleRes.rows.length === 0) {
      await client.query(`
        INSERT INTO "UserRole" ("userId", "roleId", "createdAt")
        VALUES ($1, $2, NOW())
      `, [userId, roleId]);
      console.log("Role assigned to user");
    } else {
      console.log("Role already assigned to user");
    }

    console.log("Seeding complete!");
  } finally {
    client.release();
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
