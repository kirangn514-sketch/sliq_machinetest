'use strict';

const http = require('http');
const env = require('./config/env');
const app = require('./app');
const logger = require('./utils/logger');
const { pool, waitForDatabase } = require('./config/database');
const { initSocket, closeSocket } = require('./config/socket');
const { loadOrCreateKeys } = require('./utils/jwt');

async function start() {
  loadOrCreateKeys();
  await waitForDatabase();

  const server = http.createServer(app);
  initSocket(server);

  server.listen(env.port, () => {
    logger.info('SliqDesk API listening', { port: env.port, env: env.nodeEnv });
  });

  const shutdown = async (signal) => {
    logger.info('Shutting down API', { signal });
    server.close();
    await closeSocket();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error('API failed to start', { error: err.message });
  process.exit(1);
});
