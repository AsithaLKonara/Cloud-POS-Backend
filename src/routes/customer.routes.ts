import { Router } from "express";
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer
} from "../controllers/customer.controller";
import { authenticateJWT, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

router.get("/", authenticateJWT, requirePermission("customers:view"), getCustomers);
router.get("/:id", authenticateJWT, requirePermission("customers:view"), getCustomerById);
router.post("/", authenticateJWT, requirePermission("customers:edit"), createCustomer);
router.put("/:id", authenticateJWT, requirePermission("customers:edit"), updateCustomer);

export default router;
