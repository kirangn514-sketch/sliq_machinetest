'use strict';

const { withEnv } = require('../testUtils/factories');

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const jsonwebtoken = require('jsonwebtoken');

/** Loads a fresh copy of jwt.js with the given env overrides. */
function loadJwt(envOverrides = {}) {
  let mod;
  withEnv(envOverrides, () => {
    jest.isolateModules(() => { mod = require('./jwt'); });
  });
  return mod;
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sliqdesk-jwt-'));

describe('jwt key management', () => {
  it('generates and persists an RS256 key pair on first use', () => {
    // Arrange
    const dir = path.join(tmpDir(), 'keys');
    const jwt = loadJwt({ JWT_KEYS_DIR: dir });
    // Act
    const keys = jwt.loadOrCreateKeys();
    // Assert
    expect(keys.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(fs.readFileSync(path.join(dir, 'jwt_public.pem'), 'utf8')).toBe(keys.publicKey);
    expect(jwt.loadOrCreateKeys()).toBe(keys); // cached
  });

  it('re-uses keys already present on disk (survives restarts)', () => {
    const dir = tmpDir();
    const first = loadJwt({ JWT_KEYS_DIR: dir });
    const token = first.signToken({ userId: 1, organizationId: 2, tokenVersion: 0 });
    const second = loadJwt({ JWT_KEYS_DIR: dir });
    expect(second.verifyToken(token).userId).toBe(1);
  });

  it('prefers injected base64 keys (secret store) over files', () => {
    // Arrange
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const dir = tmpDir();
    const jwt = loadJwt({
      JWT_KEYS_DIR: dir,
      JWT_PRIVATE_KEY_B64: Buffer.from(pair.privateKey).toString('base64'),
      JWT_PUBLIC_KEY_B64: Buffer.from(pair.publicKey).toString('base64'),
    });
    // Act
    const keys = jwt.loadOrCreateKeys();
    // Assert
    expect(keys.publicKey).toBe(pair.publicKey);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('reads the files written by a concurrent process when creation races (EEXIST)', () => {
    // Arrange: another process wins the race between existsSync and writeFileSync
    const dir = tmpDir();
    const winner = loadJwt({ JWT_KEYS_DIR: dir });
    const winnerKeys = winner.loadOrCreateKeys();
    const exists = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const loser = loadJwt({ JWT_KEYS_DIR: dir });
    // Act
    const keys = loser.loadOrCreateKeys();
    // Assert
    expect(keys.publicKey).toBe(winnerKeys.publicKey);
    exists.mockRestore();
  });

  it('propagates unexpected filesystem errors', () => {
    const dir = tmpDir();
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { const e = new Error('disk full'); e.code = 'ENOSPC'; throw e; });
    const jwt = loadJwt({ JWT_KEYS_DIR: dir });
    expect(() => jwt.loadOrCreateKeys()).toThrow('disk full');
  });
});

describe('jwt sign/verify', () => {
  const jwt = loadJwt({ JWT_KEYS_DIR: tmpDir() });

  it('round-trips identity claims only', () => {
    // Act
    const token = jwt.signToken({ userId: 5, organizationId: 9, tokenVersion: 3 });
    const claims = jwt.verifyToken(token);
    // Assert
    expect(claims).toEqual(expect.objectContaining({ userId: 5, organizationId: 9, tokenVersion: 3 }));
    expect(jsonwebtoken.decode(token, { complete: true }).header.alg).toBe('RS256');
    expect(Object.keys(jsonwebtoken.decode(token))).not.toContain('role');
  });

  it('rejects tokens signed with another key', () => {
    const other = loadJwt({ JWT_KEYS_DIR: tmpDir() });
    const forged = other.signToken({ userId: 1, organizationId: 1, tokenVersion: 0 });
    expect(() => jwt.verifyToken(forged)).toThrow();
  });

  it('rejects HS256/none algorithm downgrade attempts', () => {
    const forged = jsonwebtoken.sign({ org: 1, tv: 0 }, 'secret', {
      algorithm: 'HS256', subject: '1', issuer: 'sliqdesk', audience: 'sliqdesk-web',
    });
    expect(() => jwt.verifyToken(forged)).toThrow();
  });

  it('rejects expired tokens', () => {
    const { privateKey } = jwt.loadOrCreateKeys();
    const expired = jsonwebtoken.sign({ org: 1, tv: 0, exp: Math.floor(Date.now() / 1000) - 10 }, privateKey, {
      algorithm: 'RS256', subject: '1', issuer: 'sliqdesk', audience: 'sliqdesk-web',
    });
    expect(() => jwt.verifyToken(expired)).toThrow(/expired/);
  });

  it('rejects tokens with malformed identity claims', () => {
    const { privateKey } = jwt.loadOrCreateKeys();
    const bad = jsonwebtoken.sign({ org: 'x', tv: 0 }, privateKey, {
      algorithm: 'RS256', subject: '1', issuer: 'sliqdesk', audience: 'sliqdesk-web', expiresIn: '5m',
    });
    expect(() => jwt.verifyToken(bad)).toThrow('Malformed token payload');
  });

  it('derives the token lifetime from JWT_EXPIRES_IN and caches it', () => {
    const custom = loadJwt({ JWT_KEYS_DIR: tmpDir(), JWT_EXPIRES_IN: '15m' });
    expect(custom.tokenLifetimeMs()).toBe(15 * 60 * 1000);
    expect(custom.tokenLifetimeMs()).toBe(15 * 60 * 1000);
  });
});
