'use strict';

/**
 * JWT signing/verification with RS256.
 *
 * Key resolution order:
 *   1. JWT_PRIVATE_KEY_B64 / JWT_PUBLIC_KEY_B64 env vars (inject from a secret store, e.g. Azure Key Vault)
 *   2. PEM files in JWT_KEYS_DIR (a Docker named volume)
 *   3. Generate a new 2048-bit RSA key pair on first start and persist it to JWT_KEYS_DIR
 *
 * No signing secret ever lives in .env or in the frontend bundle.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('./logger');

let keys = null;

function loadOrCreateKeys() {
  if (keys) return keys;

  if (env.jwt.privateKeyB64 && env.jwt.publicKeyB64) {
    keys = {
      privateKey: Buffer.from(env.jwt.privateKeyB64, 'base64').toString('utf8'),
      publicKey: Buffer.from(env.jwt.publicKeyB64, 'base64').toString('utf8'),
    };
    return keys;
  }

  const privatePath = path.join(env.jwt.keysDir, 'jwt_private.pem');
  const publicPath = path.join(env.jwt.keysDir, 'jwt_public.pem');

  if (fs.existsSync(privatePath) && fs.existsSync(publicPath)) {
    keys = { privateKey: fs.readFileSync(privatePath, 'utf8'), publicKey: fs.readFileSync(publicPath, 'utf8') };
    return keys;
  }

  logger.info('Generating new RS256 key pair for JWT signing', { keysDir: env.jwt.keysDir });
  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.mkdirSync(env.jwt.keysDir, { recursive: true });
  // 'wx' fails if another process created the file first; in that case re-read it.
  try {
    fs.writeFileSync(privatePath, pair.privateKey, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(publicPath, pair.publicKey, { mode: 0o644, flag: 'wx' });
    keys = { privateKey: pair.privateKey, publicKey: pair.publicKey };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    keys = { privateKey: fs.readFileSync(privatePath, 'utf8'), publicKey: fs.readFileSync(publicPath, 'utf8') };
  }
  return keys;
}

/** Payload deliberately minimal: identity only. Role/org are re-read from the DB on every request. */
function signToken({ userId, organizationId, tokenVersion }) {
  const { privateKey } = loadOrCreateKeys();
  return jwt.sign({ org: organizationId, tv: tokenVersion }, privateKey, {
    algorithm: 'RS256',
    subject: String(userId),
    expiresIn: env.jwt.expiresIn,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}

/** Returns { userId, organizationId, tokenVersion, exp, iat } or throws. */
function verifyToken(token) {
  const { publicKey } = loadOrCreateKeys();
  const decoded = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
  const userId = Number.parseInt(decoded.sub, 10);
  if (!Number.isInteger(userId) || !Number.isInteger(decoded.org) || !Number.isInteger(decoded.tv)) {
    throw new Error('Malformed token payload');
  }
  return {
    userId, organizationId: decoded.org, tokenVersion: decoded.tv, exp: decoded.exp, iat: decoded.iat,
  };
}

let lifetimeMs = null;

/** Token lifetime in milliseconds (used for cookie maxAge); derived once from JWT_EXPIRES_IN. */
function tokenLifetimeMs() {
  if (lifetimeMs === null) {
    const decoded = jwt.decode(signToken({ userId: 0, organizationId: 0, tokenVersion: 0 }));
    lifetimeMs = (decoded.exp - decoded.iat) * 1000;
  }
  return lifetimeMs;
}

module.exports = {
  signToken, verifyToken, tokenLifetimeMs, loadOrCreateKeys,
};
