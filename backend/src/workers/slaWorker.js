'use strict';

/**
 * SliqDesk SLA worker - runs as its own process/container (`npm run worker`).
 *
 * Every SLA_POLL_INTERVAL_MS it drains due jobs from the persistent `sla_jobs` table
 * (see services/slaJobProcessor.js for the per-job transaction).
 *
 * Because state lives in PostgreSQL and claims are transactional, a crash or restart
 * simply rolls back the in-flight job, which is picked up again on the next poll.
 */
const env = require('../config/env');
const logger = require('../utils/logger');
const { pool, waitForDatabase } = require('../config/database');
const { runOnce } = require('../services/slaJobProcessor');

let running = true;
let pollTimer = null;
let currentRun = null;
const isRunning = () => running;

function scheduleNext() {
  if (!running) return;
  pollTimer = setTimeout(async () => {
    currentRun = runOnce(isRunning).catch((err) => logger.error('SLA poll failed', { error: err.message }));
    await currentRun;
    currentRun = null;
    scheduleNext();
  }, env.sla.pollIntervalMs);
}

async function start() {
  await waitForDatabase();
  logger.info('SLA worker started', { pollIntervalMs: env.sla.pollIntervalMs });
  // Process anything that became due while the worker was down, then poll.
  await runOnce(isRunning);
  scheduleNext();
}

async function shutdown(signal) {
  logger.info('SLA worker shutting down', { signal });
  running = false;
  clearTimeout(pollTimer);
  if (currentRun) await currentRun;
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  logger.error('SLA worker failed to start', { error: err.message });
  process.exit(1);
});
