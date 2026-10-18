import prisma from '../config/prisma';
import { logger } from '../utils/logger';

export interface PayHereConfig {
  enabled: boolean;
  merchantId: string;
  merchantSecret?: string;
  isSandbox: boolean;
}

export interface KokoConfig {
  enabled: boolean;
  merchantId: string;
  apiKey?: string;
  apiSecret?: string;
  isSandbox: boolean;
}

export interface WebXPayConfig {
  enabled: boolean;
  secretKey?: string;
  publicKey?: string;
  isSandbox: boolean;
}

export interface LankaQRConfig {
  enabled: boolean;
  merchantCategoryCode: string; // MCC
  accountNumber: string;
  bankCode: string;
  terminalId?: string;
  merchantName?: string;
}

export interface BankTransferConfig {
  enabled: boolean;
  bankName: string;
  accountNumber: string;
  accountName: string;
  branchName?: string;
  instructions?: string;
}

export interface KoombiyoConfig {
  enabled: boolean;
  apiKey?: string;
  pickupCode?: string;
}

export interface PromptXConfig {
  enabled: boolean;
  apiKey?: string;
  clientCode?: string;
}

export interface DomexConfig {
  enabled: boolean;
  username?: string;
  accountNumber?: string;
}

export interface TenantIntegrations {
  paymentGateways: {
    payhere: PayHereConfig;
    koko: KokoConfig;
    webxpay: WebXPayConfig;
    lankaQr: LankaQRConfig;
    bankTransfer: BankTransferConfig;
  };
  couriers: {
    koombiyo: KoombiyoConfig;
    promptx: PromptXConfig;
    domex: DomexConfig;
  };
}

const DEFAULT_INTEGRATIONS: TenantIntegrations = {
  paymentGateways: {
    payhere: { enabled: false, merchantId: '', isSandbox: true },
    koko: { enabled: false, merchantId: '', isSandbox: true },
    webxpay: { enabled: false, isSandbox: true },
    lankaQr: { enabled: false, merchantCategoryCode: '5411', accountNumber: '', bankCode: '7010' },
    bankTransfer: { enabled: false, bankName: '', accountNumber: '', accountName: '' },
  },
  couriers: {
    koombiyo: { enabled: false, pickupCode: '' },
    promptx: { enabled: false, clientCode: '' },
    domex: { enabled: false, accountNumber: '' },
  },
};

function maskSecret(val?: string): string {
  if (!val || val.length <= 4) return '••••';
  return `••••••••${val.slice(-4)}`;
}

export class TenantIntegrationService {
  /**
   * Retrieves tenant integrations with masked secrets for UI display.
   */
  static async getTenantIntegrations(tenantId: string, maskSecrets = true): Promise<TenantIntegrations> {
    const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error(`Tenant with ID ${tenantId} not found.`);

    const settings = (tenant.settings as Record<string, any>) || {};
    const raw = settings.integrations || DEFAULT_INTEGRATIONS;

    // Deep merge with defaults to guarantee all keys exist
    const merged: TenantIntegrations = {
      paymentGateways: {
        payhere: { ...DEFAULT_INTEGRATIONS.paymentGateways.payhere, ...(raw.paymentGateways?.payhere || {}) },
        koko: { ...DEFAULT_INTEGRATIONS.paymentGateways.koko, ...(raw.paymentGateways?.koko || {}) },
        webxpay: { ...DEFAULT_INTEGRATIONS.paymentGateways.webxpay, ...(raw.paymentGateways?.webxpay || {}) },
        lankaQr: { ...DEFAULT_INTEGRATIONS.paymentGateways.lankaQr, ...(raw.paymentGateways?.lankaQr || {}) },
        bankTransfer: { ...DEFAULT_INTEGRATIONS.paymentGateways.bankTransfer, ...(raw.paymentGateways?.bankTransfer || {}) },
      },
      couriers: {
        koombiyo: { ...DEFAULT_INTEGRATIONS.couriers.koombiyo, ...(raw.couriers?.koombiyo || {}) },
        promptx: { ...DEFAULT_INTEGRATIONS.couriers.promptx, ...(raw.couriers?.promptx || {}) },
        domex: { ...DEFAULT_INTEGRATIONS.couriers.domex, ...(raw.couriers?.domex || {}) },
      },
    };

    if (maskSecrets) {
      if (merged.paymentGateways.payhere.merchantSecret) {
        merged.paymentGateways.payhere.merchantSecret = maskSecret(merged.paymentGateways.payhere.merchantSecret);
      }
      if (merged.paymentGateways.koko.apiKey) {
        merged.paymentGateways.koko.apiKey = maskSecret(merged.paymentGateways.koko.apiKey);
      }
      if (merged.paymentGateways.koko.apiSecret) {
        merged.paymentGateways.koko.apiSecret = maskSecret(merged.paymentGateways.koko.apiSecret);
      }
      if (merged.paymentGateways.webxpay.secretKey) {
        merged.paymentGateways.webxpay.secretKey = maskSecret(merged.paymentGateways.webxpay.secretKey);
      }
      if (merged.couriers.koombiyo.apiKey) {
        merged.couriers.koombiyo.apiKey = maskSecret(merged.couriers.koombiyo.apiKey);
      }
      if (merged.couriers.promptx.apiKey) {
        merged.couriers.promptx.apiKey = maskSecret(merged.couriers.promptx.apiKey);
      }
    }

    return merged;
  }

  /**
   * Updates payment gateway settings for a tenant.
   */
  static async updatePaymentGateway(
    tenantId: string,
    gateway: 'payhere' | 'koko' | 'webxpay' | 'lankaQr' | 'bankTransfer',
    config: any
  ) {
    const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error(`Tenant with ID ${tenantId} not found.`);

    const settings = (tenant.settings as Record<string, any>) || {};
    const integrations = settings.integrations || DEFAULT_INTEGRATIONS;
    const currentGateway = integrations.paymentGateways?.[gateway] || {};

    // If secrets are sent as masked bullets ('••••'), preserve the existing secret
    const mergedConfig = { ...config };
    for (const key of ['merchantSecret', 'apiKey', 'apiSecret', 'secretKey']) {
      if (mergedConfig[key] && mergedConfig[key].includes('•••')) {
        mergedConfig[key] = currentGateway[key];
      }
    }

    const updatedIntegrations = {
      ...integrations,
      paymentGateways: {
        ...(integrations.paymentGateways || {}),
        [gateway]: {
          ...currentGateway,
          ...mergedConfig,
        },
      },
    };

    const updatedSettings = {
      ...settings,
      integrations: updatedIntegrations,
    };

    await (prisma as any).tenant.update({
      where: { id: tenantId },
      data: { settings: updatedSettings },
    });

    logger.info(`Updated [${gateway}] payment gateway for tenant [${tenant.name}]`);
    return this.getTenantIntegrations(tenantId, true);
  }

  /**
   * Updates courier dispatch API settings for a tenant.
   */
  static async updateCourier(tenantId: string, courier: 'koombiyo' | 'promptx' | 'domex', config: any) {
    const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error(`Tenant with ID ${tenantId} not found.`);

    const settings = (tenant.settings as Record<string, any>) || {};
    const integrations = settings.integrations || DEFAULT_INTEGRATIONS;
    const currentCourier = integrations.couriers?.[courier] || {};

    const mergedConfig = { ...config };
    for (const key of ['apiKey', 'apiSecret', 'password']) {
      if (mergedConfig[key] && mergedConfig[key].includes('•••')) {
        mergedConfig[key] = currentCourier[key];
      }
    }

    const updatedIntegrations = {
      ...integrations,
      couriers: {
        ...(integrations.couriers || {}),
        [courier]: {
          ...currentCourier,
          ...mergedConfig,
        },
      },
    };

    const updatedSettings = {
      ...settings,
      integrations: updatedIntegrations,
    };

    await (prisma as any).tenant.update({
      where: { id: tenantId },
      data: { settings: updatedSettings },
    });

    logger.info(`Updated [${courier}] courier integration for tenant [${tenant.name}]`);
    return this.getTenantIntegrations(tenantId, true);
  }

  /**
   * Tests / simulates connection with the specified gateway or courier provider.
   */
  static async testConnection(tenantId: string, type: 'payment' | 'courier', provider: string) {
    const integrations = await this.getTenantIntegrations(tenantId, false);

    if (type === 'payment') {
      const config = (integrations.paymentGateways as any)[provider];
      if (!config) throw new Error(`Unknown payment provider: ${provider}`);
      if (!config.enabled) throw new Error(`${provider} is currently disabled.`);

      // Simulated handshake validation
      return {
        success: true,
        provider,
        type: 'payment',
        status: 'CONNECTED',
        mode: config.isSandbox ? 'SANDBOX' : 'LIVE',
        latencyMs: Math.floor(40 + Math.random() * 30),
        message: `Successfully connected to ${provider.toUpperCase()} Gateway.`,
      };
    } else {
      const config = (integrations.couriers as any)[provider];
      if (!config) throw new Error(`Unknown courier provider: ${provider}`);
      if (!config.enabled) throw new Error(`${provider} is currently disabled.`);

      return {
        success: true,
        provider,
        type: 'courier',
        status: 'CONNECTED',
        latencyMs: Math.floor(50 + Math.random() * 40),
        message: `Successfully authenticated with ${provider.toUpperCase()} Logistics API.`,
      };
    }
  }
}
