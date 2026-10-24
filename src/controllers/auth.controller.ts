import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { AuthRequest } from "../middlewares/auth.middleware";
import { validatePasswordStrength } from "../utils/password.util";
import { trackFailedLogin } from "../middlewares/loginAttempt.middleware";
import { redisClient } from "../config/redis";
import { logger } from "../utils/logger";
import { generateFingerprint } from "../utils/jwt";
import { getAdaptiveCookieOptions } from "../utils/cookie-helper";

const setTokenCookies = (req: Request, res: Response, accessToken: string, refreshToken: string) => {
  res.cookie("laural_access_token", accessToken, getAdaptiveCookieOptions(req, {
    httpOnly: true,
    maxAge: 60 * 60 * 1000, // 1 hour
  }));

  res.cookie("laural_refresh_token", refreshToken, getAdaptiveCookieOptions(req, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  }));
};

export class AuthController {
  static async register(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { email, password, fullName, name, birthday, phone } = req.body;

      if (!email || !password) {
        res.status(400).json({
          success: false,
          message: "Email and password are required.",
        });
        return;
      }

      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.isValid) {
        res.status(400).json({
          success: false,
          message: passwordValidation.message,
        });
        return;
      }

      const forwarded = req.headers['x-forwarded-for'] as string | undefined;
      const ip = (forwarded ? forwarded.split(',')[0]?.trim() : undefined) ||
                 req.socket?.remoteAddress || 'unknown';
      const userAgent = (req.headers['user-agent'] as string) || 'unknown';
      const fingerprint = generateFingerprint(ip, userAgent);

      const result = await AuthService.registerPublicUser({
        email,
        password,
        fullName: fullName || name,
        birthday,
        phone,
        fingerprint,
      });

      setTokenCookies(req, res, result.accessToken, result.refreshToken);

      res.status(201).json({
        success: true,
        message: "Registration successful.",
        data: { user: result.user },
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req: AuthRequest, res: Response, next: NextFunction) {
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    const ip = (forwarded ? forwarded.split(',')[0]?.trim() : undefined) ||
               req.socket?.remoteAddress || 'unknown';
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({
          success: false,
          message: "Email and password are required.",
        });
        return;
      }

      const userAgent = (req.headers['user-agent'] as string) || 'unknown';
      const fingerprint = generateFingerprint(ip, userAgent);

      const result = await AuthService.loginUser({ email, password, fingerprint });

      // Clear failure counters on successful login
      try {
        await redisClient.del(`login:failures:${ip}`);
        await redisClient.del(`login:locked:${ip}`);
        await redisClient.del(`login:alerted:${ip}`);
      } catch (err) {
        logger.warn('Failed to clear Redis login counters', { error: err });
      }
      logger.info('Successful login', { email, ip });

      setTokenCookies(req, res, result.accessToken, result.refreshToken);

      res.status(200).json({
        success: true,
        message: "Login successful.",
        data: { user: result.user },
      });
    } catch (error) {
      // Track failure before propagating
      const { email } = req.body;
      await trackFailedLogin(ip, email || 'unknown');
      next(error);
    }
  }

  static async refresh(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const refreshToken =
        req.cookies?.laural_refresh_token ||
        req.body?.refreshToken ||
        (req.headers["x-refresh-token"] as string) ||
        req.query?.refreshToken;

      if (!refreshToken) {
        res.status(400).json({
          success: false,
          message: "Refresh token is required.",
        });
        return;
      }

      const forwarded = req.headers['x-forwarded-for'] as string | undefined;
      const ip = (forwarded ? forwarded.split(',')[0]?.trim() : undefined) ||
                 req.socket?.remoteAddress || 'unknown';
      const userAgent = (req.headers['user-agent'] as string) || 'unknown';
      const fingerprint = generateFingerprint(ip, userAgent);

      const result = await AuthService.refreshAccessToken(refreshToken as string, fingerprint);

      setTokenCookies(req, res, result.accessToken, refreshToken as string);

      res.status(200).json({
        success: true,
        message: "Token refreshed successfully.",
        data: { user: result.user },
      });
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const refreshToken = req.cookies?.laural_refresh_token || req.body?.refreshToken;
      const userId = req.user?.userId;

      if (refreshToken || userId) {
        try {
          await AuthService.logoutUser(refreshToken, userId);
        } catch (e: any) {
          logger.warn(`Failed to revoke refresh token in database on logout: ${e?.message}`);
        }
      }

      const cookieOptions = getAdaptiveCookieOptions(req, {
        httpOnly: true,
        path: "/",
      });

      res.clearCookie("laural_access_token", cookieOptions);
      res.clearCookie("laural_refresh_token", cookieOptions);
      res.clearCookie("laural_role", { ...cookieOptions, httpOnly: false });

      res.status(200).json({
        success: true,
        message: "Logged out successfully.",
      });
    } catch (error) {
      next(error);
    }
  }

  static async getMe(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user?.userId) {
        res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
        return;
      }

      const user = await AuthService.getMe(req.user.userId);

      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getCSRFToken(req: Request, res: Response, next: NextFunction) {
    try {
      // The csrfMiddleware attaches the token to the request object.
      const csrfToken = (req as any).csrfToken;
      
      if (!csrfToken) {
        return res.status(500).json({
          success: false,
          message: "CSRF protection is not configured properly."
        });
      }

      res.status(200).json({
        success: true,
        data: { csrfToken },
      });
    } catch (error) {
      next(error);
    }
  }
}
