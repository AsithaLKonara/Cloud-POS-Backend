import { Request, Response } from "express";
import { mediaService, UPLOADS_DIR } from "../services/media.service";
import path from "path";
import fs from "fs";
import multer from "multer";
import { randomUUID } from "crypto";

// Ensure uploads dir exists before setting up multer
mediaService.ensureUploadsDir().catch(console.error);

// Set up multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.body.folder || 'Uncategorized';
    const destDir = path.join(UPLOADS_DIR, folder);
    
    // Ensure the folder exists
    fs.mkdirSync(destDir, { recursive: true });
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  }
});

export const uploadMiddleware = multer({ storage });

export const getMediaFiles = async (req: Request, res: Response) => {
  try {
    const { folder, page = 1, limit = 20 } = req.query;
    const media = await mediaService.getMediaFiles(
      folder as string, 
      Number(page), 
      Number(limit)
    );
    res.json(media);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

export const createMediaRecord = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const folder = req.body.folder || 'Uncategorized';
    const filename = req.file.filename;
    const key = `${folder}/${filename}`;
    const publicUrl = `/api/v1/media/view?key=${encodeURIComponent(key)}`;

    const data = {
      name: req.file.originalname,
      type: req.file.mimetype,
      folder,
      size: req.file.size,
      url: publicUrl,
      key
    };

    const record = await mediaService.createMediaRecord(data);
    res.status(201).json(record);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

export const deleteMediaFile = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await mediaService.deleteMediaFile(id as string);
    res.status(204).send();
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

export const viewMediaFile = async (req: Request, res: Response) => {
  try {
    const { key } = req.query;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: "Media key is required" });
    }

    // Security: Prevent directory traversal
    const safeKey = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolutePath = path.join(UPLOADS_DIR, safeKey);

    // Check if the path is still within UPLOADS_DIR
    if (!absolutePath.startsWith(UPLOADS_DIR)) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (fs.existsSync(absolutePath)) {
      res.sendFile(absolutePath);
    } else {
      res.status(404).json({ error: "File not found" });
    }
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: "Failed to serve media file" });
  }
};

export const syncLocal = async (req: Request, res: Response) => {
  try {
    const result = await mediaService.syncLocalFiles();
    res.status(200).json(result);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || "Failed to sync local files" });
  }
};
