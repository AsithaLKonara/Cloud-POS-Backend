import prisma from '../config/prisma';

export interface FeatureDefinition {
  key: string;
  name: string;
  description: string;
  category: 'AI & Automation' | 'Developer & APIs' | 'Fintech & Payments' | 'Enterprise ERP' | 'Supply Chain' | 'Hospitality' | 'Hardware & POS' | 'Communications';
  minTier: 'STARTER' | 'GROWTH' | 'ENTERPRISE';
  defaultEnabled: boolean;
}

export const FEATURE_CATALOG: FeatureDefinition[] = [
  {
    key: 'GEMINI_AI_COPILOT',
    name: 'Gemini AI Copilot',
    description: 'Natural language inventory, sales analytics, and automated chat assistant powered by Google Gemini',
    category: 'AI & Automation',
    minTier: 'ENTERPRISE',
    defaultEnabled: true,
  },
  {
    key: 'HEADLESS_DEVELOPER_API',
    name: 'Headless Developer API',
    description: 'External eCommerce storefront, webhooks, and REST API access with API key governance',
    category: 'Developer & APIs',
    minTier: 'ENTERPRISE',
    defaultEnabled: true,
  },
  {
    key: 'KOKO_PAYMENT_GATEWAY',
    name: 'Koko BNPL Gateway',
    description: 'Buy-Now-Pay-Later 3-installment gateway for online and POS checkouts',
    category: 'Fintech & Payments',
    minTier: 'GROWTH',
    defaultEnabled: true,
  },
  {
    key: 'LANKA_QR_PAYMENT',
    name: 'LankaQR Payment Engine',
    description: 'Central Bank of Sri Lanka EMVCo standard dynamic LankaQR generation',
    category: 'Fintech & Payments',
    minTier: 'GROWTH',
    defaultEnabled: true,
  },
  {
    key: 'SMS_OTP_GATEWAY',
    name: 'Automated SMS Gateway',
    description: 'Customer digital receipt notifications and staff two-factor OTP verification',
    category: 'Communications',
    minTier: 'GROWTH',
    defaultEnabled: true,
  },
  {
    key: 'ERP_GENERAL_LEDGER',
    name: 'ERP General Ledger & Accounting',
    description: 'Double-entry bookkeeping, chart of accounts, and AP/AR aging reports',
    category: 'Enterprise ERP',
    minTier: 'GROWTH',
    defaultEnabled: true,
  },
  {
    key: 'ADVANCED_STOCKTAKING',
    name: 'Advanced Physical Stocktaking',
    description: 'Multi-device barcode counting sessions, discrepancy variance auditing, and write-offs',
    category: 'Supply Chain',
    minTier: 'GROWTH',
    defaultEnabled: true,
  },
  {
    key: 'MULTI_BRANCH_TRANSFER',
    name: 'Inter-Branch Stock Movement',
    description: 'Branch-to-branch transfer requisitions, dispatch manifests, and receipt verification',
    category: 'Supply Chain',
    minTier: 'GROWTH',
    defaultEnabled: true,
  },
  {
    key: 'RESTAURANT_KOT_TABLES',
    name: 'Restaurant Tables & KOT Routing',
    description: 'Floor plan table layout management and split-order Kitchen Order Ticket routing',
    category: 'Hospitality',
    minTier: 'GROWTH',
    defaultEnabled: true,
  },
  {
    key: 'BARCODE_THERMAL_PRINT',
    name: 'Hardware Thermal & Barcode Print',
    description: 'Zero-click silent thermal receipt printing via hardware bridge service',
    category: 'Hardware & POS',
    minTier: 'STARTER',
    defaultEnabled: true,
  },
];

const TIER_LEVELS: Record<string, number> = {
  FREE_TRIAL: 1,
  STARTER: 1,
  STANDARD: 2,
  GROWTH: 2,
  PROFESSIONAL: 2,
  ENTERPRISE: 3,
};

export class FeatureFlagService {
  /**
   * Get all global feature flags with their current platform status
   */
  static async getAllGlobalFlags() {
    const settings = await prisma.setting.findMany({
      where: {
        group: 'feature_flags',
      },
    });

    const settingsMap = new Map<string, string>();
    for (const s of settings) {
      settingsMap.set(s.key, s.value);
    }

    return FEATURE_CATALOG.map((def) => {
      const settingKey = `flag:${def.key}`;
      const rawVal = settingsMap.get(settingKey);
      const isGloballyEnabled = rawVal !== undefined ? rawVal === 'true' : def.defaultEnabled;

      return {
        ...def,
        isGloballyEnabled,
        settingKey,
      };
    });
  }

  /**
   * SuperAdmin toggle for a global master switch
   */
  static async updateGlobalFlag(key: string, isEnabled: boolean, superAdminUser: any) {
    const featureDef = FEATURE_CATALOG.find((f) => f.key === key);
    if (!featureDef) {
      throw new Error(`Unknown feature flag: ${key}`);
    }

    const settingKey = `flag:${key}`;
    const prev = await prisma.setting.findUnique({
      where: { key: settingKey },
    });

    const updated = await prisma.setting.upsert({
      where: { key: settingKey },
      update: {
        value: String(isEnabled),
        type: 'boolean',
        group: 'feature_flags',
        description: `Master switch for ${featureDef.name}`,
        updatedAt: new Date(),
      },
      create: {
        key: settingKey,
        value: String(isEnabled),
        type: 'boolean',
        group: 'feature_flags',
        description: `Master switch for ${featureDef.name}`,
        isPublic: true,
      },
    });

    // Record audit event
    await prisma.auditLog.create({
      data: {
        userId: superAdminUser?.id,
        action: 'SUPERADMIN_UPDATE_GLOBAL_FEATURE_FLAG',
        entity: 'FEATURE_FLAG',
        entityId: key,
        oldData: { isEnabled: prev ? prev.value === 'true' : featureDef.defaultEnabled },
        newData: { isEnabled },
        userAgent: 'SuperAdmin Web Console',
      },
    });

    return {
      ...featureDef,
      isGloballyEnabled: isEnabled,
      settingKey,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Get calculated entitlements for a specific tenant
   */
  static async getTenantEntitlements(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        subscriptionTier: true,
        settings: true,
      },
    });

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const globalFlags = await this.getAllGlobalFlags();
    const globalFlagsMap = new Map<string, boolean>();
    for (const f of globalFlags) {
      globalFlagsMap.set(f.key, f.isGloballyEnabled);
    }

    const tenantSettings = (tenant.settings as any) || {};
    const featureOverrides: Record<string, boolean | null> = tenantSettings.featureOverrides || {};

    const tenantTier = (tenant.subscriptionTier || 'STARTER').toUpperCase();
    const tenantTierLevel = TIER_LEVELS[tenantTier] ?? 1;

    const entitlements = FEATURE_CATALOG.map((def) => {
      const isGloballyEnabled = globalFlagsMap.get(def.key) ?? def.defaultEnabled;
      const override = featureOverrides[def.key];
      const minLevel = TIER_LEVELS[def.minTier] ?? 1;
      const tierIncluded = tenantTierLevel >= minLevel;

      let effective = false;
      let source: 'GLOBAL_DISABLED' | 'OVERRIDE_ENABLED' | 'OVERRIDE_DISABLED' | 'TIER_INCLUDED' | 'TIER_EXCLUDED' = 'TIER_EXCLUDED';
      let reason = '';

      if (!isGloballyEnabled) {
        effective = false;
        source = 'GLOBAL_DISABLED';
        reason = 'Platform master switch is currently disabled by Super Admin';
      } else if (override === true) {
        effective = true;
        source = 'OVERRIDE_ENABLED';
        reason = 'Explicit override grant for this tenant';
      } else if (override === false) {
        effective = false;
        source = 'OVERRIDE_DISABLED';
        reason = 'Explicit override revocation for this tenant';
      } else {
        effective = tierIncluded;
        source = tierIncluded ? 'TIER_INCLUDED' : 'TIER_EXCLUDED';
        reason = tierIncluded
          ? `Included with ${tenantTier} subscription tier`
          : `Requires ${def.minTier} tier or higher`;
      }

      return {
        key: def.key,
        name: def.name,
        description: def.description,
        category: def.category,
        minTier: def.minTier,
        isGloballyEnabled,
        override: override ?? null, // true, false, or null (inherited)
        tierIncluded,
        effective,
        source,
        reason,
      };
    });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        subscriptionTier: tenant.subscriptionTier,
      },
      entitlements,
      overrides: featureOverrides,
    };
  }

  /**
   * SuperAdmin update per-tenant entitlement overrides
   */
  static async updateTenantEntitlements(
    tenantId: string,
    overrides: Record<string, boolean | null>,
    superAdminUser: any
  ) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, settings: true },
    });

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const currentSettings = (tenant.settings as any) || {};
    const currentOverrides = currentSettings.featureOverrides || {};

    // Clean overrides: retain only valid keys from FEATURE_CATALOG and boolean values; null deletes override
    const updatedOverrides: Record<string, boolean> = { ...currentOverrides };
    for (const [key, val] of Object.entries(overrides)) {
      if (!FEATURE_CATALOG.some((f) => f.key === key)) continue;
      if (val === true || val === false) {
        updatedOverrides[key] = val;
      } else if (val === null || val === undefined) {
        delete updatedOverrides[key];
      }
    }

    const newSettings = {
      ...currentSettings,
      featureOverrides: updatedOverrides,
    };

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: newSettings,
      },
    });

    // Record audit event
    await prisma.auditLog.create({
      data: {
        userId: superAdminUser?.id,
        tenantId,
        action: 'SUPERADMIN_UPDATE_TENANT_ENTITLEMENTS',
        entity: 'TENANT',
        entityId: tenantId,
        oldData: { featureOverrides: currentOverrides },
        newData: { featureOverrides: updatedOverrides },
        userAgent: 'SuperAdmin Web Console',
      },
    });

    return this.getTenantEntitlements(tenantId);
  }

  /**
   * Check if a specific feature is currently available to a tenant
   */
  static async isFeatureAllowed(tenantId: string, featureKey: string): Promise<boolean> {
    const entitlements = await this.getTenantEntitlements(tenantId);
    const item = entitlements.entitlements.find((e) => e.key === featureKey);
    return item?.effective ?? false;
  }
}

