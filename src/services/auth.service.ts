import bcrypt from "bcryptjs";
import prisma from "../config/prisma";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../utils/jwt";
import { AppError } from "../middlewares/errorHandler";
import { loyaltyService } from "./loyalty.service";

export interface RegisterInput {
  email: string;
  password: string;
  fullName?: string;
  name?: string;
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

    // Create User & assign PUBLIC_USER role
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: displayName,
        birthday: birthdayDate,
        phone: input.phone || null,
        status: "ACTIVE",
        userRoles: {
          create: {
            roleId: publicRole.id,
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
        roles,
        permissions,
      },
      accessToken,
      refreshToken,
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
