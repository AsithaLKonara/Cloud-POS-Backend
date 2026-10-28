import prisma from "../config/prisma";
import { AppError } from "../middlewares/errorHandler";

export interface SettingInput {
  key: string;
  value: string;
}

export class SettingService {
  /**
   * Get all settings (Admin)
   */
  static async getAllSettings() {
    return prisma.setting.findMany({
      orderBy: { group: 'asc' }
    });
  }

  /**
   * Get only public settings (Storefront)
   */
  static async getPublicSettings() {
    return prisma.setting.findMany({
      where: { isPublic: true },
      orderBy: { group: 'asc' }
    });
  }

  /**
   * Bulk update settings
   */
  static async bulkUpdateSettings(settings: SettingInput[]) {
    // We use a transaction to safely update all keys
    return prisma.$transaction(async (tx) => {
      const updatedSettings = [];
      for (const setting of settings) {
        const updated = await tx.setting.update({
          where: { key: setting.key },
          data: { value: setting.value },
        });
        updatedSettings.push(updated);
      }
      return updatedSettings;
    });
  }

  /**
   * Seed default settings if they don't exist
   */
  static async seedDefaultSettings() {
    const defaults = [
      // General
      { key: "store_name", value: "Store Dispatch Hub", type: "string", group: "general", isPublic: true },
      { key: "support_email", value: "support@xonitspace.com", type: "string", group: "general", isPublic: true },
      { key: "support_phone", value: "+94 77 123 4567", type: "string", group: "general", isPublic: true },
      // Currency & Tax
      { key: "default_currency", value: "LKR", type: "string", group: "currency", isPublic: true },
      { key: "tax_rate", value: "15", type: "number", group: "currency", isPublic: false },
      // Notifications
      { key: "email_new_orders", value: "true", type: "boolean", group: "notifications", isPublic: false },
      { key: "email_low_stock", value: "false", type: "boolean", group: "notifications", isPublic: false },
    ];

    for (const def of defaults) {
      await prisma.setting.upsert({
        where: { key: def.key },
        update: {}, // Don't override if it already exists
        create: def,
      });
    }
  }
}
