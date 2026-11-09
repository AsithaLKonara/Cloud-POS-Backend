import { Router } from "express";
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  sendWhatsAppStatement,
  sendWhatsAppReorder
} from "../controllers/customer.controller";
import { CrmInboxController } from "../controllers/crm-inbox.controller";
import { authenticateJWT, requirePermission } from '../middlewares/auth.middleware';

const router = Router();
const inboxController = new CrmInboxController();

// Omnichannel CRM Live WhatsApp Inbox
router.get("/inbox/threads", authenticateJWT, (req, res) => inboxController.getThreads(req, res));
router.get("/inbox/threads/:phone", authenticateJWT, (req, res) => inboxController.getThreadMessages(req, res));
router.post("/inbox/threads/:phone/reply", authenticateJWT, (req, res) => inboxController.sendReply(req, res));

router.get("/", authenticateJWT, requirePermission("customers:view"), getCustomers);
router.get("/:id", authenticateJWT, requirePermission("customers:view"), getCustomerById);
router.post("/", authenticateJWT, requirePermission("customers:edit"), createCustomer);
router.put("/:id", authenticateJWT, requirePermission("customers:edit"), updateCustomer);
router.post("/:id/whatsapp-statement", authenticateJWT, sendWhatsAppStatement);
router.post("/:id/whatsapp-reorder", authenticateJWT, sendWhatsAppReorder);

export default router;
