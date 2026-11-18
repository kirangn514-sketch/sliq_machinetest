'use strict';

const { withEnv } = require('../testUtils/factories');

function loadEnv(overrides) {
  let env;
  withEnv(overrides, () => { jest.isolateModules(() => { env = require('./env'); }); });
  return env;
}

describe('env', () => {
  it('reads and normalises configuration', () => {
    // Act
    const env = loadEnv({
      BACKEND_PORT: '6000', FRONTEND_URL: 'http://app.test/', CORS_ORIGINS: 'http://a.test/, http://b.test', DB_SSL: 'true',
    });
    // Assert
    expect(env.port).toBe(6000);
    expect(env.frontendUrl).toBe('http://app.test');
    expect(env.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
    expect(env.db.ssl).toBe(true);
    expect(env.isProduction).toBe(false);
  });

  it('falls back to defaults for empty values', () => {
    const env = loadEnv({ BACKEND_PORT: '', JWT_EXPIRES_IN: '' });
    expect(env.port).toBe(5000);
    expect(env.jwt.expiresIn).toBe('60m');
  });

  it('fails fast on missing required variables and non-integers', () => {
    expect(() => loadEnv({ DB_NAME: '' })).toThrow('Missing required environment variable DB_NAME');
    expect(() => loadEnv({ BACKEND_PORT: 'abc' })).toThrow('BACKEND_PORT must be an integer');
  });

  it('uses FRONTEND_URL as CORS origin when CORS_ORIGINS is not set', () => {
    let env;
    const saved = process.env.CORS_ORIGINS;
    delete process.env.CORS_ORIGINS;
    try {
      env = loadEnv({ FRONTEND_URL: 'http://only.test' });
    } finally {
      process.env.CORS_ORIGINS = saved;
    }
    expect(env.corsOrigins).toEqual(['http://only.test']);
  });
});

describe('database.withTransaction / waitForDatabase', () => {
  function loadDatabase() {
    const client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    const poolInstance = { connect: jest.fn().mockResolvedValue(client), query: jest.fn(), on: jest.fn() };
    let db;
    jest.isolateModules(() => {
      jest.doMock('pg', () => ({ Pool: jest.fn(() => poolInstance) }));
      jest.doMock('../utils/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
      db = require('./database');
    });
    return { db, client, poolInstance };
  }

  it('commits and releases on success', async () => {
    // Arrange
    const { db, client } = loadDatabase();
    // Act
    const result = await db.withTransaction(async (c) => { await c.query('X'); return 42; });
    // Assert
    expect(result).toBe(42);
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'X', 'COMMIT']);
    expect(client.release).toHaveBeenCalled();
  });

  it('rolls back, rethrows and releases on failure', async () => {
    const { db, client } = loadDatabase();
    await expect(db.withTransaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalled();
  });

  it('still releases when the rollback itself fails', async () => {
    const { db, client } = loadDatabase();
    client.query.mockImplementation(async (sql) => { if (sql === 'ROLLBACK') throw new Error('conn lost'); });
    await expect(db.withTransaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(client.release).toHaveBeenCalled();
  });

  it('retries until the database is reachable', async () => {
    const { db, poolInstance } = loadDatabase();
    poolInstance.query.mockRejectedValueOnce(new Error('not ready')).mockResolvedValueOnce({});
    await db.waitForDatabase({ retries: 3, delayMs: 1 });
    expect(poolInstance.query).toHaveBeenCalledTimes(2);
  });

  it('gives up after the configured retries', async () => {
    const { db, poolInstance } = loadDatabase();
    poolInstance.query.mockRejectedValue(new Error('down'));
    await expect(db.waitForDatabase({ retries: 2, delayMs: 1 })).rejects.toThrow('Could not connect to PostgreSQL');
  });

  it('logs pool errors instead of crashing', () => {
    const { poolInstance } = loadDatabase();
    const handler = poolInstance.on.mock.calls.find(([evt]) => evt === 'error')[1];
    expect(() => handler(new Error('idle client error'))).not.toThrow();
  });
});
