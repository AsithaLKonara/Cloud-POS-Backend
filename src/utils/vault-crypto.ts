import crypto from 'crypto';

/**
 * Vault Encryption Utilities
 * Uses AES-256-GCM with Envelope Key Derivation (HKDF) per tenant.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const MASTER_KEY_INFO = 'xonit-vault-tenant-v1';

/**
 * Derives a tenant-specific 256-bit encryption key using HKDF-SHA256.
 */
function deriveTenantKey(tenantId: string): Buffer {
  const masterKey = process.env.VAULT_MASTER_KEY || process.env.JWT_SECRET || 'xonit-master-entropy-key-32-bytes-secure';
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      masterKey,
      tenantId, // Salt with tenantId for absolute tenant key isolation
      MASTER_KEY_INFO,
      32 // 256 bits
    )
  );
}

export interface EncryptedPayload {
  ciphertext: string; // Base64
  iv: string;         // Base64
  authTag: string;    // Base64
}

/**
 * Encrypts a plaintext string or serialized JSON object for a specific tenant.
 */
export function encryptVaultSecret(plaintext: string, tenantId: string): EncryptedPayload {
  if (!tenantId) {
    throw new Error('Tenant ID is strictly required for vault encryption isolation.');
  }

  const key = deriveTenantKey(tenantId);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag().toString('base64');

  return {
    ciphertext: encrypted,
    iv: iv.toString('base64'),
    authTag,
  };
}

/**
 * Decrypts a ciphertext payload for a specific tenant using AES-256-GCM.
 * Throws an error if the payload was tampered with or decrypted with the wrong tenant key.
 */
export function decryptVaultSecret(payload: EncryptedPayload, tenantId: string): string {
  if (!tenantId) {
    throw new Error('Tenant ID is strictly required for vault decryption isolation.');
  }

  const key = deriveTenantKey(tenantId);
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(payload.ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypts a JavaScript object (e.g. gateway credentials) into base64 strings.
 */
export function encryptVaultJson<T = any>(data: T, tenantId: string): EncryptedPayload {
  return encryptVaultSecret(JSON.stringify(data), tenantId);
}

/**
 * Decrypts a ciphertext payload back into a parsed JavaScript object.
 */
export function decryptVaultJson<T = any>(payload: EncryptedPayload, tenantId: string): T {
  const jsonString = decryptVaultSecret(payload, tenantId);
  return JSON.parse(jsonString);
}

/**
 * Masks a sensitive secret key for UI display (e.g., ••••••••a1b2).
 */
export function maskSecretValue(secret?: string | null): string {
  if (!secret) return '';
  if (secret.length <= 4) return '••••';
  return `••••••••${secret.slice(-4)}`;
}
