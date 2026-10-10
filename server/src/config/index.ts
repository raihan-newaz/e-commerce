import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: process.env.ENV_FILE || path.resolve(__dirname, '../../.env') });

const isDev = process.env.NODE_ENV !== 'production';
const publicOrigin = (process.env.PUBLIC_ORIGIN || (isDev ? 'http://localhost:3000' : '')).replace(/\/$/, '');
if (!isDev && !publicOrigin) throw new Error('PUBLIC_ORIGIN is required in production');
const builderStorefrontOrigin = (publicOrigin).replace(/\/$/, '');
if (builderStorefrontOrigin) {
  const url = new URL(builderStorefrontOrigin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== builderStorefrontOrigin) throw new Error('BUILDER_STOREFRONT_ORIGIN must be an HTTP(S) origin without a path or credentials');
}
const jwtSecret = process.env.JWT_SECRET || (isDev ? 'development-only-change-me-nix-2026' : '');
if (!jwtSecret || (!isDev && jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be set to a unique value of at least 32 characters in production');
}
const dataEncryptionKey = process.env.DATA_ENCRYPTION_KEY || (isDev ? jwtSecret : '');
if (!dataEncryptionKey || (!isDev && dataEncryptionKey.length < 32)) {
  throw new Error('DATA_ENCRYPTION_KEY must be set to a unique value of at least 32 characters in production');
}

const configuredClientUrls = (process.env.CLIENT_URL || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const developmentClientUrls = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

export const config = {
  builderStorefrontOrigin,
  publicOrigin,
  integrationsEnabled: process.env.INTEGRATIONS_ENABLED === 'true',
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  apiHost: process.env.API_HOST || '127.0.0.1',
  jwtSecret,
  dataEncryptionKey,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrls: Array.from(new Set([
    ...configuredClientUrls,
    ...(publicOrigin ? [publicOrigin] : []),
    ...(isDev ? developmentClientUrls : []),
  ])),
  isDev,
  cookieName: 'nix_session',
  customerCookieName: 'nix_customer_session',
};
