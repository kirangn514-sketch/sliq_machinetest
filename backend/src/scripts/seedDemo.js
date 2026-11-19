'use strict';

/**
 * CLI entry point: `npm run seed:demo`
 * (in Docker: `docker compose exec backend npm run seed:demo`).
 *
 * Inserts the demo organizations, users and tickets defined in
 * services/demoSeedService.js. Safe to run twice: the second run does nothing.
 */
const logger = require('../utils/logger');
const { pool, waitForDatabase } = require('../config/database');
const { seedDemoData } = require('../services/demoSeedService');

async function main() {
  await waitForDatabase();
  const result = await seedDemoData();
  if (!result.created) {
    logger.info('Demo data already present - nothing to do');
    return;
  }
  result.organizations.forEach((org) => {
    logger.info('Demo organization created', {
      organization: org.name,
      tickets: org.tickets,
      users: org.users.map((u) => `${u.email} (${u.role})`),
    });
  });
  // The shared demo password is documented in README.md ("Sample data") - never logged.
  logger.info('Demo data ready - sign in with the accounts listed in README.md');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    logger.error('Demo seed failed', { error: err.message });
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
