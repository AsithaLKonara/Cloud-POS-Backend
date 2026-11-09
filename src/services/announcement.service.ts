import prisma from '../config/prisma';
import crypto from 'crypto';

export interface BroadcastAnnouncement {
  id: string;
  title: string;
  message: string;
  type: 'INFO' | 'MAINTENANCE' | 'CRITICAL_ALERT' | 'NEW_FEATURE';
  targetAudience: 'ALL_TENANTS' | 'TIER_SPECIFIC' | 'BUSINESS_TYPE';
  targetTier?: 'STARTER' | 'GROWTH' | 'ENTERPRISE';
  targetBusinessType?: string;
  isSticky: boolean;
  isActive: boolean;
  actionUrl?: string;
  actionLabel?: string;
  startsAt: string;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export class AnnouncementService {
  /**
   * Get all broadcast announcements (SuperAdmin)
   */
  static async getAllAnnouncements(): Promise<BroadcastAnnouncement[]> {
    const settings = await prisma.setting.findMany({
      where: {
        group: 'platform_broadcasts',
      },
      orderBy: { updatedAt: 'desc' },
    });

    const items: BroadcastAnnouncement[] = [];
    for (const s of settings) {
      try {
        const parsed = JSON.parse(s.value);
        items.push(parsed);
      } catch (err) {
        // ignore malformed rows
      }
    }

    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Create a new announcement (SuperAdmin)
   */
  static async createAnnouncement(payload: Partial<BroadcastAnnouncement>, superAdminUser: any): Promise<BroadcastAnnouncement> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const announcement: BroadcastAnnouncement = {
      id,
      title: payload.title || 'Platform Announcement',
      message: payload.message || '',
      type: payload.type || 'INFO',
      targetAudience: payload.targetAudience || 'ALL_TENANTS',
      targetTier: payload.targetTier,
      targetBusinessType: payload.targetBusinessType,
      isSticky: Boolean(payload.isSticky),
      isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
      actionUrl: payload.actionUrl || '',
      actionLabel: payload.actionLabel || '',
      startsAt: payload.startsAt || now,
      expiresAt: payload.expiresAt || null,
      createdAt: now,
      updatedAt: now,
      createdBy: superAdminUser?.email || 'SuperAdmin',
    };

    await prisma.setting.create({
      data: {
        key: `broadcast:${id}`,
        value: JSON.stringify(announcement),
        group: 'platform_broadcasts',
        type: 'json',
        description: `Broadcast: ${announcement.title}`,
        isPublic: true,
      },
    });

    // Audit Log
    await prisma.auditLog.create({
      data: {
        userId: superAdminUser?.id,
        action: 'SUPERADMIN_CREATE_ANNOUNCEMENT',
        entity: 'ANNOUNCEMENT',
        entityId: id,
        newData: announcement as any,
        userAgent: 'SuperAdmin Web Console',
      },
    });

    return announcement;
  }

  /**
   * Update an announcement (SuperAdmin)
   */
  static async updateAnnouncement(id: string, updates: Partial<BroadcastAnnouncement>, superAdminUser: any): Promise<BroadcastAnnouncement> {
    const settingKey = `broadcast:${id}`;
    const existing = await prisma.setting.findUnique({
      where: { key: settingKey },
    });

    if (!existing) {
      throw new Error(`Announcement ${id} not found.`);
    }

    const current: BroadcastAnnouncement = JSON.parse(existing.value);
    const updated: BroadcastAnnouncement = {
      ...current,
      ...updates,
      id, // protect id
      updatedAt: new Date().toISOString(),
    };

    await prisma.setting.update({
      where: { key: settingKey },
      data: {
        value: JSON.stringify(updated),
        description: `Broadcast: ${updated.title}`,
      },
    });

    // Audit Log
    await prisma.auditLog.create({
      data: {
        userId: superAdminUser?.id,
        action: 'SUPERADMIN_UPDATE_ANNOUNCEMENT',
        entity: 'ANNOUNCEMENT',
        entityId: id,
        oldData: current as any,
        newData: updated as any,
        userAgent: 'SuperAdmin Web Console',
      },
    });

    return updated;
  }

  /**
   * Toggle announcement active status
   */
  static async toggleActive(id: string, superAdminUser: any): Promise<BroadcastAnnouncement> {
    const settingKey = `broadcast:${id}`;
    const existing = await prisma.setting.findUnique({
      where: { key: settingKey },
    });

    if (!existing) {
      throw new Error(`Announcement ${id} not found.`);
    }

    const current: BroadcastAnnouncement = JSON.parse(existing.value);
    const updated: BroadcastAnnouncement = {
      ...current,
      isActive: !current.isActive,
      updatedAt: new Date().toISOString(),
    };

    await prisma.setting.update({
      where: { key: settingKey },
      data: {
        value: JSON.stringify(updated),
      },
    });

    // Audit Log
    await prisma.auditLog.create({
      data: {
        userId: superAdminUser?.id,
        action: 'SUPERADMIN_TOGGLE_ANNOUNCEMENT',
        entity: 'ANNOUNCEMENT',
        entityId: id,
        oldData: { isActive: current.isActive },
        newData: { isActive: updated.isActive },
        userAgent: 'SuperAdmin Web Console',
      },
    });

    return updated;
  }

  /**
   * Delete an announcement
   */
  static async deleteAnnouncement(id: string, superAdminUser: any): Promise<{ id: string }> {
    const settingKey = `broadcast:${id}`;
    const existing = await prisma.setting.findUnique({
      where: { key: settingKey },
    });

    if (!existing) {
      throw new Error(`Announcement ${id} not found.`);
    }

    await prisma.setting.delete({
      where: { key: settingKey },
    });

    // Audit Log
    await prisma.auditLog.create({
      data: {
        userId: superAdminUser?.id,
        action: 'SUPERADMIN_DELETE_ANNOUNCEMENT',
        entity: 'ANNOUNCEMENT',
        entityId: id,
        oldData: JSON.parse(existing.value),
        userAgent: 'SuperAdmin Web Console',
      },
    });

    return { id };
  }

  /**
   * Get active broadcast announcements for a specific tenant (or public)
   */
  static async getActiveAnnouncementsForTenant(tenantId?: string): Promise<BroadcastAnnouncement[]> {
    const all = await this.getAllAnnouncements();
    const now = Date.now();

    let tenant: any = null;
    if (tenantId) {
      tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { subscriptionTier: true, businessType: true },
      });
    }

    const tenantTier = (tenant?.subscriptionTier || 'STARTER').toUpperCase();
    const tenantBusinessType = tenant?.businessType || 'RETAIL';

    return all.filter((a) => {
      if (!a.isActive) return false;

      // Time validity
      const starts = new Date(a.startsAt).getTime();
      if (starts > now) return false;

      if (a.expiresAt) {
        const expires = new Date(a.expiresAt).getTime();
        if (expires < now) return false;
      }

      // Audience filtering
      if (a.targetAudience === 'ALL_TENANTS') return true;
      if (a.targetAudience === 'TIER_SPECIFIC') {
        return a.targetTier ? a.targetTier.toUpperCase() === tenantTier : true;
      }
      if (a.targetAudience === 'BUSINESS_TYPE') {
        return a.targetBusinessType ? a.targetBusinessType === tenantBusinessType : true;
      }

      return true;
    });
  }
}

