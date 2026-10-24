import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authenticateJWT } from "../middlewares/auth.middleware";
import { loginRateLimiter, registerRateLimiter } from "../middlewares/rateLimiter.middleware";
import { checkHoneypot } from "../middlewares/honeypot.middleware";
import { verifyTurnstile } from "../middlewares/turnstile.middleware";
import { checkLoginLockout } from "../middlewares/loginAttempt.middleware";

const router = Router();

router.post("/register", checkHoneypot, verifyTurnstile, registerRateLimiter, AuthController.register);
router.post("/login", checkHoneypot, verifyTurnstile, loginRateLimiter, checkLoginLockout, AuthController.login);
router.post("/forgot-password", checkHoneypot, loginRateLimiter, AuthController.forgotPassword);
router.post("/reset-password", checkHoneypot, loginRateLimiter, AuthController.resetPassword);
router.post("/refresh", AuthController.refresh);
router.post("/logout", AuthController.logout);
router.get("/me", authenticateJWT, AuthController.getMe);
router.get("/csrf", AuthController.getCSRFToken);

export default router;
