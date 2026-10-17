import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import compression from "compression";
import { logger } from "./utils/logger";
import { errorHandler, AppError } from "./middlewares/errorHandler";
import { globalApiLimiter } from "./middlewares/rateLimiter.middleware";
import { csrfMiddleware } from "./middlewares/csrf.middleware";
import { registerScheduledJobs } from "./jobs/scheduler";
import { initFardarSync } from "./cron/fardarSync.cron";
import { sanitizeMiddleware } from "./middlewares/sanitize.middleware";
import { emergencyKillSwitch } from "./middlewares/killSwitch.middleware";
import { phoneNormalizerMiddleware } from "./middlewares/phone.middleware";
import { tenantMiddleware } from "./middlewares/tenant.middleware";

// Import Routers
import productRoutes from "./routes/product.routes";
import orderRoutes from "./routes/order.routes";
import categoryRoutes from "./routes/category.routes";
import customerRoutes from "./routes/customer.routes";
import collectionRoutes from "./routes/collection.routes";
import inventoryRoutes from "./routes/inventory.routes";
import cartRoutes from "./routes/cart.routes";
import checkoutRoutes from "./routes/checkout.routes";
import posRoutes from "./routes/pos.routes";
import cmsRoutes from "./routes/cms.routes";
import paymentRoutes from "./routes/payment.routes";
import promotionRoutes from "./routes/promotion.routes";
import mediaRoutes from "./routes/media.routes";
import reviewRoutes from "./routes/review.routes";
import analyticsRoutes from "./routes/analytics.routes";
import returnRoutes from "./routes/return.routes";
import wishlistRoutes from "./routes/wishlist.routes";
import addressRoutes from "./routes/address.routes";
import reportRoutes from "./routes/report.routes";
import authRoutes from "./routes/auth.routes";
import roleRoutes from "./routes/role.routes";
import userRoutes from "./routes/user.routes";
import settingRoutes from "./routes/setting.routes";
import otpRoutes from "./routes/otp.routes";
import notificationRoutes from "./routes/notification.routes";
import loyaltyRoutes from "./routes/loyalty.routes";
import auditRoutes from "./routes/audit.routes";
import feedRoutes from "./routes/feed.routes";
import expenseRoutes from "./routes/expense.routes";
import pnlRoutes from "./routes/pnl.routes";
import tenantRoutes from "./routes/tenant.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import tenantIntegrationRoutes from "./routes/tenant-integration.routes";
import { RoleService } from "./services/role.service";
import { SettingService } from "./services/setting.service";
dotenv.config();

const app = express();
app.set('trust proxy', 1); // Trust the first proxy (e.g. Cloudflare) to accurately read X-Forwarded-For

// Middlewares
// Hardened Helmet Configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline often needed for basic apps, adjust if strict
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"], // Allow images from https (our S3 proxy redirects to AWS)
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Can break images from S3 if true without proper CORS
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allows loading images cross-origin
  dnsPrefetchControl: { allow: false },
  frameguard: { action: "deny" }, // Prevents clickjacking
  hidePoweredBy: true, // Removes X-Powered-By header
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true, // Adds X-XSS-Protection
}));
app.use(compression());
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowed = [
      process.env.FRONTEND_URL,
      process.env.ADMIN_URL
    ].filter(Boolean) as string[];
    
    if (allowed.includes(origin) || origin.endsWith('.up.railway.app') || 
        (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL.replace('https://', 'https://www.'))) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true
}));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply CSRF Protection to all routes
app.use(csrfMiddleware);

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// API Routes
const API_PREFIX = "/api/v1";

app.use(API_PREFIX, globalApiLimiter);
app.use(API_PREFIX, sanitizeMiddleware);
app.use(API_PREFIX, emergencyKillSwitch);
app.use(API_PREFIX, phoneNormalizerMiddleware);
app.use(API_PREFIX, tenantMiddleware);

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/roles`, roleRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/settings`, settingRoutes);
app.use(`${API_PREFIX}/products`, productRoutes);
app.use(`${API_PREFIX}/orders`, orderRoutes);
app.use(`${API_PREFIX}/categories`, categoryRoutes);
app.use(`${API_PREFIX}/customers`, customerRoutes);
app.use(`${API_PREFIX}/collections`, collectionRoutes);
app.use(`${API_PREFIX}/inventory`, inventoryRoutes);
app.use(`${API_PREFIX}/cart`, cartRoutes);
app.use(`${API_PREFIX}/checkout`, checkoutRoutes);
app.use(`${API_PREFIX}/pos`, posRoutes);
app.use(`${API_PREFIX}/cms`, cmsRoutes);
app.use(`${API_PREFIX}/payments`, paymentRoutes);
app.use(`${API_PREFIX}/promotions`, promotionRoutes);
app.use(`${API_PREFIX}/loyalty`, loyaltyRoutes);
app.use(`${API_PREFIX}/media`, mediaRoutes);
app.use(`${API_PREFIX}/reviews`, reviewRoutes);
app.use(`${API_PREFIX}/loyalty`, loyaltyRoutes);
app.use(`${API_PREFIX}/analytics`, analyticsRoutes);
app.use(`${API_PREFIX}/returns`, returnRoutes);
app.use(`${API_PREFIX}/wishlist`, wishlistRoutes);
app.use(`${API_PREFIX}/addresses`, addressRoutes);
app.use(`${API_PREFIX}/reports`, reportRoutes);
app.use(`${API_PREFIX}/otp`, otpRoutes);
app.use(`${API_PREFIX}/notifications`, notificationRoutes);
app.use(`${API_PREFIX}/audit`, auditRoutes);
app.use(`${API_PREFIX}/feed`, feedRoutes);
app.use(`${API_PREFIX}/expenses`, expenseRoutes);
app.use(`${API_PREFIX}/pnl`, pnlRoutes);
app.use(`${API_PREFIX}/tenants`, tenantRoutes);
app.use(`${API_PREFIX}/subscriptions`, subscriptionRoutes);
app.use(`${API_PREFIX}/integrations`, tenantIntegrationRoutes);

// Health Check
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "OK", timestamp: new Date() });
});

// 404 Route Not Found
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT as number, '0.0.0.0', async () => {
  logger.info(`Server is running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`);
  // try {
  //   await RoleService.seedDefaultRolesAndPermissions();
  //   await SettingService.seedDefaultSettings();
  //   logger.info("Default roles & permissions verified/seeded successfully.");
  // } catch (err) {
  //   logger.error("Failed to seed default roles and permissions on startup", err);
  // }

  // Register background cron jobs
  registerScheduledJobs();
  initFardarSync();
});

export default app;

