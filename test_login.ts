import { AuthService } from './src/services/auth.service';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  try {
    const res = await AuthService.loginUser({
      email: 'superadmin@seramaaduwen.lk',
      password: 'Password123!',
      fingerprint: 'test-fingerprint'
    });
    console.log("Login successful! Token length:", res.accessToken.length);
  } catch (err) {
    console.error("Login failed:", err.message || err);
  }
}
main();
