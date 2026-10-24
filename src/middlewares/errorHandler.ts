import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import prisma from "../config/prisma";
import { requestContext } from "../context/RequestContext";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;

  constructor(message: string, statusCode: number, isOperational = true, code?: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    Error.captureStackTrace(this);
  }
}

/**
 * Extracts a clear, user-friendly human-readable message from raw system/database errors.
 */
function resolveHumanReadableMessage(err: any): { statusCode: number; message: string; errorCode?: string } {
  // 1. Explicit Operational AppError
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, message: err.message, errorCode: err.code };
  }

  // 2. Prisma Database Errors
  if (err?.code) {
    switch (err.code) {
      case "P2002": {
        const fields = Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : "field";
        return {
          statusCode: 409,
          message: `A record with this ${fields} already exists. Please use a unique value.`,
          errorCode: "DUPLICATE_ENTRY",
        };
      }
      case "P2025":
        return {
          statusCode: 404,
          message: "The requested record was not found or has already been deleted.",
          errorCode: "NOT_FOUND",
        };
      case "P2003":
        return {
          statusCode: 409,
          message: "This record is currently linked to other transactions or data and cannot be deleted.",
          errorCode: "FOREIGN_KEY_VIOLATION",
        };
      case "P2000":
        return {
          statusCode: 400,
          message: "One of the provided values exceeds the maximum allowed character limit.",
          errorCode: "VALUE_TOO_LONG",
        };
      default:
        break;
    }
  }

  // 3. JWT and Authentication Errors
  if (err.name === "TokenExpiredError") {
    return {
      statusCode: 401,
      message: "Your session has expired. Please sign in again to continue.",
      errorCode: "TOKEN_EXPIRED",
    };
  }
  if (err.name === "JsonWebTokenError") {
    return {
      statusCode: 401,
      message: "Invalid authentication credentials. Please log in again.",
      errorCode: "INVALID_TOKEN",
    };
  }

  // 4. File Upload (Multer) Errors
  if (err.code === "LIMIT_FILE_SIZE") {
    return {
      statusCode: 400,
      message: "The uploaded file exceeds the 10MB file size limit.",
      errorCode: "FILE_TOO_LARGE",
    };
  }

  // 5. Payload / JSON Syntax Errors
  if (err instanceof SyntaxError && "body" in err) {
    return {
      statusCode: 400,
      message: "Invalid JSON format received in request body. Please check the request formatting.",
      errorCode: "MALFORMED_JSON",
    };
  }

  // 6. Generic or Fallback
  const isDev = process.env.NODE_ENV === "development";
  return {
    statusCode: err.statusCode || 500,
    message: isDev
      ? err.message || "An unexpected error occurred."
      : "An unexpected system error occurred. Our operations team has been notified.",
    errorCode: "INTERNAL_ERROR",
  };
}

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { statusCode, message, errorCode } = resolveHumanReadableMessage(err);
  const isDev = process.env.NODE_ENV === "development";

  // Contextual data
  const ctx = requestContext.getStore();
  const tenantId = ctx?.tenantId || (req as any).tenantId || null;
  const userId = ctx?.userId || (req as any).user?.userId || null;
  const forwarded = req.headers["x-forwarded-for"] as string | undefined;
  const ip = (forwarded ? forwarded.split(",")[0]?.trim() : undefined) || req.socket?.remoteAddress || req.ip || "unknown";

  // Log to winston
  logger.error(`[${req.method}] ${req.originalUrl} - Status: ${statusCode} - Msg: ${err.message || message}`, {
    stack: err.stack,
    ip,
    tenantId,
    userId,
    errorCode,
  });

  // Track exceptions in VPS database (Asynchronous fire-and-forget for 500s and unexpected failures)
  if (statusCode >= 400) {
    (async () => {
      try {
        await (prisma as any).systemErrorLog.create({
          data: {
            statusCode,
            message: err.message || message,
            humanReadable: message,
            stack: err.stack || null,
            path: req.originalUrl,
            method: req.method,
            ip,
            userAgent: req.headers["user-agent"] || null,
            tenantId,
            userId,
            metadata: {
              errorCode,
              body: req.method !== "GET" ? sanitizeBody(req.body) : null,
              query: req.query,
            },
          },
        });
      } catch (dbErr) {
        // Guard against recursive logging failure if DB is unreachable
        logger.warn("Failed to record error log to database", { error: dbErr });
      }
    })();
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      code: errorCode,
      ...(isDev && { stack: err.stack, rawMessage: err.message }),
    },
  });
};

/**
 * Remove sensitive passwords and secrets before persisting to log
 */
function sanitizeBody(body: any): any {
  if (!body || typeof body !== "object") return body;
  const clean = { ...body };
  const sensitiveKeys = ["password", "secret", "apiKey", "merchantSecret", "token", "cvv", "creditCard"];
  for (const k of Object.keys(clean)) {
    if (sensitiveKeys.some((s) => k.toLowerCase().includes(s.toLowerCase()))) {
      clean[k] = "[REDACTED]";
    }
  }
  return clean;
}
