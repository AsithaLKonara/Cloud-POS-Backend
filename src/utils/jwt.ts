import jwt, { SignOptions, Secret } from "jsonwebtoken";

// Load Base64 encoded keys from environment variables and decode them
const getPrivateKey = (): Secret => {
  const base64Key = process.env.JWT_PRIVATE_KEY;
  if (!base64Key) {
    throw new Error("JWT_PRIVATE_KEY is not defined in environment variables");
  }
  return Buffer.from(base64Key, 'base64').toString('utf8');
};

const getPublicKey = (): Secret => {
  const base64Key = process.env.JWT_PUBLIC_KEY;
  if (!base64Key) {
    throw new Error("JWT_PUBLIC_KEY is not defined in environment variables");
  }
  return Buffer.from(base64Key, 'base64').toString('utf8');
};

const ACCESS_TOKEN_EXPIRY = (process.env.JWT_ACCESS_EXPIRY || "1h") as any;
const REFRESH_TOKEN_EXPIRY = (process.env.JWT_REFRESH_EXPIRY || "7d") as any;

import crypto from 'crypto';

export interface JWTPayload {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  fingerprint?: string;
  tenantId?: string | null;
  tenantSlug?: string | null;
  branchId?: string | null;
  iat?: number;
  exp?: number;
}

export function generateFingerprint(ip: string, userAgent: string): string {
  return crypto
    .createHash('sha256')
    .update(`${ip}|${userAgent}`)
    .digest('hex');
}

export function generateAccessToken(payload: JWTPayload): string {
  const privateKey = getPrivateKey();
  const options: SignOptions = { 
    expiresIn: ACCESS_TOKEN_EXPIRY,
    algorithm: 'RS256'
  };
  return jwt.sign(payload, privateKey, options);
}

export function generateRefreshToken(userId: string): string {
  const privateKey = getPrivateKey();
  const options: SignOptions = { 
    expiresIn: REFRESH_TOKEN_EXPIRY,
    algorithm: 'RS256'
  };
  return jwt.sign({ userId }, privateKey, options);
}

export function verifyAccessToken(token: string): JWTPayload {
  const publicKey = getPublicKey();
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as JWTPayload;
}

export function verifyRefreshToken(token: string): { userId: string } {
  const publicKey = getPublicKey();
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as { userId: string };
}

