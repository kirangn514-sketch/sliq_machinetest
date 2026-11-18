'use strict';

const { Pool } = require('pg');
const env = require('./env');
const logger = require('../utils/logger');

const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  max: env.db.poolMax,
  ssl: env.db.ssl ? { rejectUnauthorized: true } : false,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message });
});

/**
 * Runs `work(client)` inside a single transaction.
 * Commits on success, rolls back on any thrown error and always releases the client.
 */
async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('Rollback failed', { error: rollbackErr.message });
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Retries the initial connection so containers can start in any order. */
async function waitForDatabase({ retries = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      logger.warn('Database not ready, retrying', { attempt, error: err.message });
      await new Promise((resolve) => { setTimeout(resolve, delayMs); });
    }
  }
  throw new Error('Could not connect to PostgreSQL');
}

module.exports = { pool, withTransaction, waitForDatabase };
