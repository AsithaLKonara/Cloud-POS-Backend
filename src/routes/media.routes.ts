import { Router } from "express";
import { getMediaFiles, createMediaRecord, deleteMediaFile, viewMediaFile, syncLocal, uploadMiddleware } from "../controllers/media.controller";
import { authenticateJWT, requirePermission } from '../middlewares/auth.middleware';

const router = Router();

router.get("/view", viewMediaFile); // Public, serves file directly

router.post("/sync-s3", authenticateJWT, requirePermission("media:upload"), syncLocal); // Keep the route path for frontend compatibility, but logic is syncLocal
router.get("/", authenticateJWT, requirePermission("media:view_library"), getMediaFiles);
router.post("/upload", authenticateJWT, requirePermission("media:upload"), uploadMiddleware.single('file'), createMediaRecord);
router.post("/", authenticateJWT, requirePermission("media:upload"), uploadMiddleware.single('file'), createMediaRecord); // Fallback if frontend uses root path
router.delete("/:id", authenticateJWT, requirePermission("media:delete"), deleteMediaFile);

export default router;
