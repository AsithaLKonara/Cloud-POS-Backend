import crypto from "crypto";
import bcrypt from "bcryptjs";
import { BusinessType } from "@prisma/client";
import prisma from "../config/prisma";
import { redisClient } from "../config/redis";
import { logger } from "../utils/logger";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { AppError } from "../middlewares/errorHandler";
import { validatePasswordStrength } from "../utils/password.util";
import { loyaltyService } from "./loyalty.service";

export interface RegisterInput {
  email: string;
  password: string;
  fullName?: string;
  name?: string;
  businessName?: string;
  businessType?: string;
  birthday?: string | Date | null;
  phone?: string;
  fingerprint?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  fingerprint?: string;
}

export class AuthService {
  /**
   * Helper to ensure the default PUBLIC_USER role exists
   */
  private static async getOrCreatePublicUserRole() {
    let role = await prisma.role.findFirst({
      where: {
        OR: [
          { name: "PUBLIC_USER" },
          { name: "Public User" },
        ],
      },
    });

    if (!role) {
      role = await prisma.role.create({
        data: {
          name: "PUBLIC_USER",
          description: "Default customer role with public storefront and account access",
          isSystem: true,
          status: "Active",
        },
      });
    }

    return role;
  }

  /**
   * Aggregate role names and unique permission codes for a user
   */
  public static extractUserRolesAndPermissions(user: any): { roles: string[]; permissions: string[] } {
    const roles: string[] = [];
    const permissionSet = new Set<string>();

    if (user.userRoles && Array.isArray(user.userRoles)) {
      for (const ur of user.userRoles) {
        if (ur.role) {
          roles.push(ur.role.name);
          if (ur.role.permissions && Array.isArray(ur.role.permissions)) {
            for (const rp of ur.role.permissions) {
              if (rp.permission?.code) {
                permissionSet.add(rp.permission.code);
              }
            }
          }
        }
      }
    }

    return {
      roles,
      permissions: Array.from(permissionSet),
    };
  }

  /**
   * Public Customer Registration
   */
  static async registerPublicUser(input: RegisterInput) {
    const email = input.email.trim().toLowerCase();

    // Check email uniqueness
    const existing = await prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new AppError("An account with this email address already exists.", 400);
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(input.password, salt);

    // Get default PUBLIC_USER role
    const publicRole = await this.getOrCreatePublicUserRole();

    // Parse birthday if provided
    let birthdayDate: Date | null = null;
    if (input.birthday) {
      const parsed = new Date(input.birthday);
      if (!isNaN(parsed.getTime())) {
        birthdayDate = parsed;
      }
    }

    const displayName = input.fullName || input.name || email.split("@")[0];

    // Multi-tenant business merchant registration support
    let tenantId: string | null = null;
    let branchId: string | null = null;
    let assignedRoleId = publicRole.id;

    if (input.businessName && input.businessName.trim()) {
      const bName = input.businessName.trim();
      const slug = bName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || `tenant-${Date.now()}`;
      
      let finalSlug = slug;
      const existingTenant = await prisma.tenant.findUnique({ where: { slug: finalSlug } });
      if (existingTenant) {
        finalSlug = `${slug}-${Math.floor(100 + Math.random() * 900)}`;
      }

      const rawType = (input.businessType || 'RETAIL').toUpperCase().replace(/\s+/g, '_');
      const validBusinessType = Object.values(BusinessType).includes(rawType as any)
        ? (rawType as BusinessType)
        : BusinessType.RETAIL;

      const tenant = await prisma.tenant.create({
        data: {
          name: bName,
          slug: finalSlug,
          businessType: validBusinessType,
          status: 'ACTIVE',
          subscriptionTier: 'TRIAL',
        },
      });
      tenantId = tenant.id;

      // Create primary store branch
      const branch = await prisma.branch.create({
        data: {
          tenantId: tenant.id,
          name: `${bName} - Main Store`,
          code: `MAIN-01`,
          address: 'Colombo, Sri Lanka',
          type: validBusinessType as string,
        },
      });
      branchId = branch.id;

      // Assign Branch Admin role for merchant dashboard control
      const adminRole = await prisma.role.findFirst({
        where: {
          OR: [{ name: 'Branch Admin' }, { name: 'Super Admin' }, { name: 'Admin' }],
        },
      });
      if (adminRole) {
        assignedRoleId = adminRole.id;
      }
    }

    // Create User & assign role
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: displayName,
        birthday: birthdayDate,
        phone: input.phone || null,
        status: "ACTIVE",
        tenantId,
        branchId,
        userRoles: {
          create: {
            roleId: assignedRoleId,
          },
        },
      },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
        branch: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    // Also mirror this user to the Customer table for the Admin Dashboard
    let customer = await prisma.customer.findFirst({ where: { email } });
    if (customer) {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          firstName: displayName?.split(' ')[0] || "Unknown",
          lastName: displayName?.split(' ').slice(1).join(' ') || "",
          phone: input.phone || customer.phone || "0000000000",
          isGuest: false,
        },
      });
    } else {
      customer = await prisma.customer.create({
        data: {
          email,
          firstName: displayName?.split(' ')[0] || "Unknown",
          lastName: displayName?.split(' ').slice(1).join(' ') || "",
          phone: input.phone || "0000000000",
          isGuest: false,
        },
      });
    }

    try {
      await loyaltyService.migrateGuestOrders(customer.id, customer.email, customer.phone);
    } catch (err) {
      console.error("Failed to migrate guest orders for new user:", err);
    }

    const { roles, permissions } = this.extractUserRolesAndPermissions(user);

    // Generate JWT Tokens
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      roles,
      permissions,
      fingerprint: input.fingerprint,
    });

    const refreshToken = generateRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt,
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        birthday: user.birthday,
        phone: user.phone,
        status: user.status,
        tenantId: user.tenantId,
        branchId: user.branchId,
        branch: user.branch,
        roles,
        permissions,
      },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Forgot Password - generate reset token & OTP with 15m expiration
   */
  static async forgotPassword(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return {
        success: true,
        message: "If an account exists with this email, password reset instructions have been sent.",
      };
    }

    if (user.status === "SUSPENDED") {
      throw new AppError("This account is suspended. Please contact platform support.", 403);
    }

    // Generate 6-digit verification code & 32-byte hex token
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const resetToken = crypto.randomBytes(32).toString("hex");

    const payload = JSON.stringify({
      userId: user.id,
      email: user.email,
      otp,
      createdAt: new Date().toISOString(),
    });

    try {
      await redisClient.setex(`auth:pwd-reset:${resetToken}`, 900, payload);
      await redisClient.setex(`auth:pwd-reset-otp:${email}`, 900, resetToken);
    } catch (err) {
      logger.error("Failed to store password reset token in Redis", { error: err });
    }

    logger.info(`[AuthService] Password reset token generated for [${email}] OTP: [${otp}]`);

    return {
      success: true,
      message: "Password reset instructions dispatched.",
      email: user.email,
      resetToken,
      otp,
      expiresIn: 900,
    };
  }

  /**
   * Reset Password with OTP verification
   */
  static async resetPassword(input: {
    email?: string;
    resetToken?: string;
    otp?: string;
    newPassword: string;
  }) {
    let { email, resetToken, otp, newPassword } = input;
    if (email) email = email.trim().toLowerCase();

    // Validate password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.isValid) {
      throw new AppError(validation.message || "Password does not meet complexity requirements", 400);
    }

    // If resetToken not provided but email + OTP provided, look up resetToken
    if (!resetToken && email) {
      try {
        const storedToken = await redisClient.get(`auth:pwd-reset-otp:${email}`);
        if (storedToken) resetToken = storedToken;
      } catch (err) {
        logger.warn("Redis lookup failed for reset OTP", { error: err });
      }
    }

    if (!resetToken) {
      throw new AppError("Invalid or expired password reset request. Please request a new code.", 400);
    }

    let rawPayload: string | null = null;
    try {
      rawPayload = await redisClient.get(`auth:pwd-reset:${resetToken}`);
    } catch (err) {
      logger.error("Redis error fetching reset token", { error: err });
    }

    if (!rawPayload) {
      throw new AppError("Reset code or token has expired or is invalid. Please request a new code.", 400);
    }

    const tokenData = JSON.parse(rawPayload);

    // If OTP was provided, verify it matches
    if (otp && tokenData.otp && tokenData.otp !== otp.trim()) {
      throw new AppError("Invalid 6-digit verification code. Please check and try again.", 400);
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update user in database
    await prisma.user.update({
      where: { id: tokenData.userId },
      data: {
        password: hashedPassword,
      },
    });

    // Cleanup Redis keys
    try {
      await redisClient.del(`auth:pwd-reset:${resetToken}`);
      if (tokenData.email) {
        await redisClient.del(`auth:pwd-reset-otp:${tokenData.email}`);
      }
    } catch (err) {
      logger.warn("Failed to clean up Redis reset keys", { error: err });
    }

    // Invalidate old refresh tokens
    try {
      await prisma.refreshToken.deleteMany({
        where: { userId: tokenData.userId },
      });
    } catch (err) {
      logger.warn("Failed to invalidate refresh tokens on password reset", { error: err });
    }

    logger.info(`[AuthService] Password reset successfully completed for user [${tokenData.email}]`);

    return {
      success: true,
      message: "Password updated successfully. You can now sign in with your new credentials.",
    };
  }

  /**
   * User Login
   */
  static async loginUser(input: LoginInput) {
    const email = input.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
        branch: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    if (!user) {
      throw new AppError("Invalid email or password.", 401);
    }

    if (user.status === "SUSPENDED") {
      throw new AppError("Your account has been suspended. Please contact support.", 403);
    }

    const isMatch = await bcrypt.compare(input.password, user.password);
    if (!isMatch) {
      throw new AppError("Invalid email or password.", 401);
    }

    const { roles, permissions } = this.extractUserRolesAndPermissions(user);

    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      roles,
      permissions,
      fingerprint: input.fingerprint,
      branchId: user.branchId || null,
    });

    const refreshToken = generateRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Clean old expired tokens and store new
    try {
      await prisma.refreshToken.deleteMany({
        where: {
          userId: user.id,
          expiresAt: { lt: new Date() },
        },
      });
    } catch {
      // Ignore
    }

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt,
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        birthday: user.birthday,
        phone: user.phone,
        status: user.status,
        branchId: user.branchId,
        branch: user.branch,
        roles,
        permissions,
      },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refresh Access Token
   */
  static async refreshAccessToken(token: string, fingerprint?: string) {
    if (!token) {
      throw new AppError("Refresh token is required.", 400);
    }

    let payload: { userId: string };
    try {
      payload = verifyRefreshToken(token);
    } catch (err) {
      throw new AppError("Invalid or expired refresh token.", 401);
    }

    const stored = await prisma.refreshToken.findUnique({
      where: { token },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: {
                  include: {
                    permissions: {
                      include: {
                        permission: true,
                      },
                    },
                  },
                },
              },
            },
            branch: {
              select: { id: true, name: true, code: true },
            },
          },
        },
      },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError("Refresh token has expired or is invalid.", 401);
    }

    const user = stored.user;
    if (user.status === "SUSPENDED") {
      throw new AppError("User account is suspended.", 403);
    }

    const { roles, permissions } = this.extractUserRolesAndPermissions(user);

    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      roles,
      permissions,
      fingerprint,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        branchId: user.branchId,
        branch: user.branch,
        roles,
        permissions,
      },
    };
  }

  /**
   * Logout (revoke refresh token)
   */
  static async logoutUser(token?: string, userId?: string) {
    if (token) {
      await prisma.refreshToken.deleteMany({
        where: { token },
      });
    } else if (userId) {
      await prisma.refreshToken.deleteMany({
        where: { userId },
      });
    }

    return { success: true, message: "Logged out successfully." };
  }

  /**
   * Get Current User Profile & Permissions
   */
  static async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        branch: {
          select: { id: true, name: true, code: true },
        },
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new AppError("User not found.", 404);
    }

    const { roles, permissions } = this.extractUserRolesAndPermissions(user);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      birthday: user.birthday,
      phone: user.phone,
      status: user.status,
      branchId: user.branchId,
      branch: user.branch,
      roles,
      permissions,
      createdAt: user.createdAt,
    };
  }
}
