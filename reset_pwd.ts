import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL?.replace('?pgbouncer=true&', '?').replace('&pgbouncer=true', '').replace('pgbouncer=true', '');
const pool = new Pool({ connectionString, ssl: false });

async function main() {
  const client = await pool.connect();
  const hashedPassword = await bcrypt.hash('Serama@1998@', 10);
  await client.query('UPDATE "User" SET password = $1 WHERE email = $2', [hashedPassword, 'superadmin@seramaaduwen.lk']);
  console.log("Password updated to Serama@1998@");
  client.release();
}
main().finally(() => pool.end());
