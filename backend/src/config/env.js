'use strict';

/**
 * Central, validated access to environment variables.
 * Every other module reads configuration from here, never from process.env directly.
 */
const path = require('path');

// In Docker the variables are injected by compose; locally we fall back to ../.env
require('dotenv').config({ path: process.env.DOTENV_PATH || path.resolve(__dirname, '../../../.env'), quiet: true });

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) throw new Error(`Environment variable ${name} must be an integer`);
  return value;
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';

const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  // `npm run seed:demo` is blocked in production unless this is explicitly 'true'.
  allowDemoSeed: process.env.ALLOW_DEMO_SEED === 'true',
  port: int('BACKEND_PORT', 5000),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: int('DB_PORT', 5432),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    ssl: process.env.DB_SSL === 'true',
    poolMax: int('DB_POOL_MAX', 10),
  },

  jwt: {
    expiresIn: process.env.JWT_EXPIRES_IN || '60m',
    issuer: process.env.JWT_ISSUER || 'sliqdesk',
    audience: process.env.JWT_AUDIENCE || 'sliqdesk-web',
    keysDir: process.env.JWT_KEYS_DIR || path.resolve(__dirname, '../../keys'),
    // Optional: inject PEM keys (base64-encoded) from a secret store such as Azure Key Vault.
    privateKeyB64: process.env.JWT_PRIVATE_KEY_B64 || '',
    publicKeyB64: process.env.JWT_PUBLIC_KEY_B64 || '',
  },

  cookie: {
    name: process.env.COOKIE_NAME || 'sliqdesk_token',
    csrfName: process.env.CSRF_COOKIE_NAME || 'sliqdesk_csrf',
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : nodeEnv === 'production',
  },

  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, ''),
  corsOrigins: (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),

  sla: {
    pollIntervalMs: int('SLA_POLL_INTERVAL_MS', 30000),
    defaultMinutes: int('DEFAULT_SLA_MINUTES', 5),
    batchSize: int('SLA_BATCH_SIZE', 50),
  },

  invitationExpiresHours: int('INVITATION_EXPIRES_HOURS', 72),
  bcryptRounds: int('BCRYPT_ROUNDS', 12),
  authRateLimit: {
    windowMs: int('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    max: int('AUTH_RATE_LIMIT_MAX', 20),
  },
  // PostgreSQL LISTEN/NOTIFY channel used by the worker to reach Socket.IO clients.
  eventsChannel: 'sliqdesk_events',
};

module.exports = env;
