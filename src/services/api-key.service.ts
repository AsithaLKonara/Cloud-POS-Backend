import crypto from 'crypto';
import prisma from '../config/prisma';
import { logger } from '../utils/logger';

export interface CreateApiKeyDto {
  name: string;
  scopes: string[];
  allowedOrigins?: string[];
  allowedIps?: string[];
  rateLimitPerMin?: number;
  expiresAt?: Date | string | null;
}

export class ApiKeyService {
  /**
   * Generates a new Client ID and API Key pair for a tenant.
   * NOTE: The raw secret key is returned ONLY once in this response!
   */
  static async createApiKey(tenantId: string, data: CreateApiKeyDto) {
    const tenant = await (prisma as any).tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error(`Tenant with ID ${tenantId} not found.`);

    // Generate credentials
    const clientId = `xcl_live_${crypto.randomBytes(12).toString('hex')}`;
    const rawSecret = `xak_live_${crypto.randomBytes(24).toString('hex')}`;
    const secretPrefix = rawSecret.slice(0, 16);
    const hashedSecret = crypto.createHash('sha256').update(rawSecret).digest('hex');

    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;

    const apiKey = await (prisma as any).tenantApiKey.create({
      data: {
        tenantId,
        name: data.name || 'External Headless API Key',
        clientId,
        hashedSecret,
        secretPrefix,
        scopes: data.scopes && data.scopes.length > 0 ? data.scopes : ['catalog:read', 'orders:create'],
        status: 'ACTIVE',
        rateLimitPerMin: data.rateLimitPerMin || 120,
        allowedOrigins: data.allowedOrigins || [],
        allowedIps: data.allowedIps || [],
        expiresAt,
      },
    });

    logger.info(`Generated Headless API Key [${clientId}] for tenant [${tenant.name}]`);

    return {
      id: apiKey.id,
      name: apiKey.name,
      clientId: apiKey.clientId,
      secret: rawSecret, // RETURNED ONLY ONCE
      secretKey: rawSecret, // alias
      secretPrefix: apiKey.secretPrefix,
      scopes: apiKey.scopes,
      status: apiKey.status,
      rateLimitPerMin: apiKey.rateLimitPerMin,
      allowedOrigins: apiKey.allowedOrigins,
      allowedIps: apiKey.allowedIps,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  /**
   * Lists all API keys for a tenant without exposing secrets.
   */
  static async listApiKeys(tenantId: string) {
    return (prisma as any).tenantApiKey.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        clientId: true,
        secretPrefix: true,
        scopes: true,
        status: true,
        rateLimitPerMin: true,
        allowedOrigins: true,
        allowedIps: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revokes an existing API Key immediately.
   */
  static async revokeApiKey(tenantId: string, apiKeyId: string) {
    const key = await (prisma as any).tenantApiKey.findFirst({
      where: { id: apiKeyId, tenantId },
    });
    if (!key) throw new Error('API Key not found or does not belong to this tenant.');

    return (prisma as any).tenantApiKey.update({
      where: { id: apiKeyId },
      data: { status: 'REVOKED' },
    });
  }

  /**
   * Verifies incoming Client ID and API Key credentials in constant-time with detailed failure diagnostics.
   */
  static async verifyApiKeyDetailed(clientId: string, rawSecret: string): Promise<{ apiKey: any | null; error?: string }> {
    if (!clientId || !rawSecret) {
      return { apiKey: null, error: 'X-Client-Id and X-Api-Key headers are required.' };
    }

    const apiKey = await (prisma as any).tenantApiKey.findUnique({
      where: { clientId },
      include: { tenant: true },
    });

    if (!apiKey) {
      return { apiKey: null, error: `No API Key found matching Client ID [${clientId}].` };
    }

    if (apiKey.status === 'REVOKED') {
      return { apiKey: null, error: 'This API Key has been revoked in Tenant Settings.' };
    }

    if (apiKey.status === 'EXPIRED' || (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date())) {
      if (apiKey.status !== 'EXPIRED') {
        await (prisma as any).tenantApiKey.update({
          where: { id: apiKey.id },
          data: { status: 'EXPIRED' },
        }).catch(() => {});
      }
      return { apiKey: null, error: 'This API Key has expired.' };
    }

    if (apiKey.status !== 'ACTIVE') {
      return { apiKey: null, error: `This API Key is currently ${apiKey.status.toLowerCase()}.` };
    }

    // Verify secret hash using constant-time comparison
    const incomingHash = crypto.createHash('sha256').update(rawSecret).digest('hex');
    const storedHashBuffer = Buffer.from(apiKey.hashedSecret, 'hex');
    const incomingHashBuffer = Buffer.from(incomingHash, 'hex');

    if (storedHashBuffer.length !== incomingHashBuffer.length || !crypto.timingSafeEqual(storedHashBuffer, incomingHashBuffer)) {
      return { apiKey: null, error: 'Invalid API secret key.' };
    }

    // Asynchronously bump last used timestamp
    (prisma as any).tenantApiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    return { apiKey, error: undefined };
  }

  /**
   * Verifies incoming Client ID and API Key credentials in constant-time.
   */
  static async verifyApiKey(clientId: string, rawSecret: string) {
    const { apiKey } = await this.verifyApiKeyDetailed(clientId, rawSecret);
    return apiKey;
  }
}
