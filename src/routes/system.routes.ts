import { Router } from "express";
import { SystemController } from "../controllers/system.controller";
import { authenticateJWT, requireRole } from "../middlewares/auth.middleware";

const router = Router();

// Public Health Check
router.get("/health", SystemController.getHealth);

// SuperAdmin VPS Diagnostics & Telemetry
router.get(
  "/telemetry",
  authenticateJWT,
  requireRole("Super Admin", "SUPER_ADMIN", "Admin", "ADMIN"),
  SystemController.getTelemetry
);

// SuperAdmin Recent Error Logs
router.get(
  "/errors",
  authenticateJWT,
  requireRole("Super Admin", "SUPER_ADMIN", "Admin", "ADMIN"),
  SystemController.getErrorLogs
);

// SuperAdmin Manual Backup Trigger
router.post(
  "/backup",
  authenticateJWT,
  requireRole("Super Admin", "SUPER_ADMIN"),
  SystemController.triggerBackup
);

export default router;
