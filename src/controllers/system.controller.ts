import { Request, Response, NextFunction } from "express";
import { SystemMonitorService } from "../services/system-monitor.service";
import { exec } from "child_process";
import path from "path";

export class SystemController {
  /**
   * Basic Health Check (Public endpoint for external uptime monitors & load balancers)
   * GET /api/v1/system/health
   */
  static async getHealth(req: Request, res: Response): Promise<void> {
    try {
      const telemetry = await SystemMonitorService.getSystemTelemetry();
      const isHealthy = telemetry.database.status !== "OFFLINE";

      res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? "HEALTHY" : "UNHEALTHY",
        uptimeSeconds: telemetry.uptimeSeconds,
        uptimeFormatted: telemetry.uptimeFormatted,
        timestamp: telemetry.timestamp,
        services: {
          database: telemetry.database.status,
          redis: telemetry.redis.status,
        },
      });
    } catch (error: any) {
      res.status(503).json({ status: "UNHEALTHY", error: error.message });
    }
  }

  /**
   * Deep VPS Telemetry & In-VPS Alert Diagnostics (Protected SuperAdmin view)
   * GET /api/v1/system/telemetry
   */
  static async getTelemetry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const telemetry = await SystemMonitorService.getSystemTelemetry();
      res.status(200).json({
        success: true,
        data: telemetry,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Recent System Error Logs for SuperAdmin Debugging
   * GET /api/v1/system/errors
   */
  static async getErrorLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 30;
      const logs = await SystemMonitorService.getRecentErrorLogs(limit);
      res.status(200).json({
        success: true,
        data: logs,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Manual Database Backup Trigger
   * POST /api/v1/system/backup
   */
  static async triggerBackup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const scriptPath = path.resolve(__dirname, "../../../scripts/vps-backup-db.sh");
      exec(`bash "${scriptPath}"`, (err, stdout, stderr) => {
        if (err) {
          res.status(500).json({ success: false, message: "Backup execution failed", error: stderr || err.message });
          return;
        }
        res.status(200).json({
          success: true,
          message: "Database backup completed successfully.",
          output: stdout.trim(),
        });
      });
    } catch (error) {
      next(error);
    }
  }
}
