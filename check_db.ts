import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();
const connectionString = process.env.DATABASE_URL?.replace('?pgbouncer=true&', '?').replace('&pgbouncer=true', '').replace('pgbouncer=true', '');
const pool = new Pool({ connectionString, ssl: false }); // Disable SSL for localhost

async function main() {
  const client = await pool.connect();
  const res = await client.query('SELECT id, email, password FROM "User"');
  console.log("Users in DB:", res.rows);
  client.release();
}
main().finally(() => pool.end());
