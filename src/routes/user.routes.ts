import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { authenticateJWT, requirePermission } from "../middlewares/auth.middleware";
import { auditLog } from "../middlewares/audit.middleware";
import { enforceQuota } from "../middlewares/quota.middleware";

const router = Router();

router.get("/", authenticateJWT, requirePermission("system:manage_users"), UserController.getAllUsers);
router.post("/", authenticateJWT, requirePermission("system:manage_users"), enforceQuota('USER'), auditLog('User', 'CREATE'), UserController.createUser);
router.put("/:id", authenticateJWT, requirePermission("system:manage_users"), auditLog('User', 'UPDATE'), UserController.updateUser);
router.delete("/:id", authenticateJWT, requirePermission("system:manage_users"), auditLog('User', 'DELETE'), UserController.deleteUser);

export default router;
