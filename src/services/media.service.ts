import { MediaFile } from "@prisma/client";
import prisma from '../config/prisma';
import fs from 'fs/promises';
import path from 'path';

// Define the root uploads directory
export const UPLOADS_DIR = path.resolve(process.cwd(), process.env.STORAGE_PATH || 'uploads');

export const mediaService = {
  /**
   * Ensure uploads directory exists
   */
  async ensureUploadsDir(): Promise<void> {
    try {
      await fs.access(UPLOADS_DIR);
    } catch {
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
    }
  },

  /**
   * List all media files
   */
  async getMediaFiles(folder?: string, page: number = 1, limit: number = 20): Promise<{ data: MediaFile[], total: number, page: number, totalPages: number }> {
    const where = folder && folder !== 'All' ? { folder } : {};
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.mediaFile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.mediaFile.count({ where })
    ]);
    
    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  },

  /**
   * Save file and Create Media Record
   * The actual file is handled by multer, we just need to register it in DB and move it if necessary
   */
  async createMediaRecord(data: {
    name: string;
    type: string;
    folder: string;
    size: number;
    dimensions?: string;
    url: string;
    key: string;
  }): Promise<MediaFile> {
    return prisma.mediaFile.create({
      data
    });
  },

  /**
   * Delete media file
   */
  async deleteMediaFile(id: string): Promise<void> {
    const media = await prisma.mediaFile.findUnique({ where: { id } });
    if (!media) throw new Error("Media file not found");

    // Attempt to delete from local disk
    try {
      const filePath = path.join(UPLOADS_DIR, media.key);
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
         console.warn("Failed to delete local file, continuing with DB deletion:", error);
      }
    }

    // Delete from DB
    await prisma.mediaFile.delete({ where: { id } });
  },

  /**
   * Sync from Local Directory
   * Pulls all files from the local uploads folder and registers them in the database if missing
   */
  async syncLocalFiles(): Promise<{ added: number }> {
    await this.ensureUploadsDir();
    let addedCount = 0;

    async function walkDir(dir: string): Promise<string[]> {
      let results: string[] = [];
      const list = await fs.readdir(dir);
      for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(await walkDir(filePath));
        } else {
          results.push(filePath);
        }
      }
      return results;
    }

    const allFiles = await walkDir(UPLOADS_DIR);
    
    const existingFiles = await prisma.mediaFile.findMany({
      select: { key: true }
    });
    const existingKeys = new Set(existingFiles.map(f => f.key));

    const createData = [];

    for (const filePath of allFiles) {
      // Relative path from UPLOADS_DIR
      const relativeKey = path.relative(UPLOADS_DIR, filePath).split(path.sep).join('/');
      
      if (!existingKeys.has(relativeKey)) {
        const stat = await fs.stat(filePath);
        const parts = relativeKey.split('/');
        const filename = parts.pop() || relativeKey;
        const folder = parts.length > 0 ? parts.join('/') : 'Uncategorized';
        
        const ext = filename.split('.').pop()?.toLowerCase();
        let type = 'image/jpeg';
        if (ext === 'png') type = 'image/png';
        if (ext === 'webp') type = 'image/webp';
        if (ext === 'svg') type = 'image/svg+xml';
        if (ext === 'mp4') type = 'video/mp4';

        const publicUrl = `/api/v1/media/view?key=${encodeURIComponent(relativeKey)}`;

        createData.push({
          name: filename,
          type,
          folder,
          size: stat.size,
          url: publicUrl,
          key: relativeKey
        });
      }
    }

    if (createData.length > 0) {
      await prisma.mediaFile.createMany({
        data: createData,
        skipDuplicates: true
      });
      addedCount = createData.length;
    }

    return { added: addedCount };
  }
};
