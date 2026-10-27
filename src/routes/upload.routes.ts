import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { optionalAuth } from '../middlewares/auth.middleware';

const router = Router();

// Base uploads directory
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer Disk Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subfolder = (req.body.folder || req.query.folder || '').toString().replace(/[^a-zA-Z0-9_\-\/]/g, '');
    const destDir = subfolder ? path.join(UPLOADS_DIR, subfolder) : UPLOADS_DIR;
    fs.mkdirSync(destDir, { recursive: true });
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 30);
    const uniqueId = randomUUID().substring(0, 8);
    cb(null, `${Date.now()}-${uniqueId}-${cleanName}${ext}`);
  }
});

// File filter for safety
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'application/pdf',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not supported. Allowed: images, PDF, CSV, Excel.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB
  }
});

/**
 * POST /api/v1/upload (and /upload)
 * Accepts single file ('file' or 'image') or multiple files ('files')
 */
router.post(
  '/',
  optionalAuth,
  upload.fields([
    { name: 'file', maxCount: 10 },
    { name: 'image', maxCount: 10 },
    { name: 'files', maxCount: 20 },
    { name: 'upload', maxCount: 10 }
  ]),
  (req: Request, res: Response): void => {
    try {
      const filesMap = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const uploadedFiles: Express.Multer.File[] = [];

      if (filesMap) {
        Object.values(filesMap).forEach(arr => {
          if (Array.isArray(arr)) {
            uploadedFiles.push(...arr);
          }
        });
      }

      if (uploadedFiles.length === 0) {
        res.status(400).json({ success: false, message: 'No file uploaded. Please specify file, image, or files field.' });
        return;
      }

      const subfolder = (req.body.folder || req.query.folder || '').toString().replace(/[^a-zA-Z0-9_\-\/]/g, '');

      const results = uploadedFiles.map(f => {
        const relativeUrl = subfolder ? `/uploads/${subfolder}/${f.filename}` : `/uploads/${f.filename}`;
        return {
          filename: f.filename,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          url: relativeUrl,
          path: relativeUrl
        };
      });

      // If single file was uploaded, return both convenient top-level and data structure
      if (results.length === 1 && results[0]) {
        const single = results[0];
        res.status(201).json({
          success: true,
          url: single.url,
          filename: single.filename,
          size: single.size,
          mimetype: single.mimetype,
          data: single
        });
        return;
      }

      res.status(201).json({
        success: true,
        count: results.length,
        files: results,
        data: results
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'File upload failed' });
    }
  }
);

/**
 * GET /api/v1/upload
 * Lists stored files in the uploads bucket
 */
router.get('/', optionalAuth, (req: Request, res: Response) => {
  try {
    const subfolder = (req.query.folder || '').toString().replace(/[^a-zA-Z0-9_\-\/]/g, '');
    const targetDir = subfolder ? path.join(UPLOADS_DIR, subfolder) : UPLOADS_DIR;

    if (!fs.existsSync(targetDir)) {
      res.json({ success: true, files: [] });
      return;
    }

    const items = fs.readdirSync(targetDir, { withFileTypes: true });
    const files = items
      .filter(item => item.isFile() && !item.name.startsWith('.'))
      .map(item => {
        const filePath = path.join(targetDir, item.name);
        const stats = fs.statSync(filePath);
        const relativeUrl = subfolder ? `/uploads/${subfolder}/${item.name}` : `/uploads/${item.name}`;
        return {
          filename: item.name,
          url: relativeUrl,
          size: stats.size,
          modifiedAt: stats.mtime
        };
      });

    res.json({
      success: true,
      total: files.length,
      files
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/v1/upload/:filename
 * Removes a file from the bucket
 */
router.delete('/:filename', optionalAuth, (req: Request, res: Response): void => {
  try {
    const rawParam = req.params.filename;
    const paramFilename = Array.isArray(rawParam) ? rawParam[0] : rawParam;
    if (!paramFilename) {
      res.status(400).json({ success: false, message: 'Filename parameter is required.' });
      return;
    }
    const filename = path.basename(paramFilename);
    const subfolder = (req.query.folder || '').toString().replace(/[^a-zA-Z0-9_\-\/]/g, '');
    const targetFile = subfolder ? path.join(UPLOADS_DIR, subfolder, filename) : path.join(UPLOADS_DIR, filename);

    if (fs.existsSync(targetFile)) {
      fs.unlinkSync(targetFile);
      res.json({ success: true, message: `File ${filename} removed.` });
      return;
    }

    res.status(404).json({ success: false, message: 'File not found.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
