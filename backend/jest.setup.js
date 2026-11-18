'use strict';

/**
 * Runs before every test file (before any module is required).
 * Provides deterministic, isolated configuration: no real .env, no real database,
 * fast bcrypt, and a throw-away directory for RS256 keys.
 */
const os = require('os');
const path = require('path');

process.env.DOTENV_PATH = path.join(__dirname, '__no_such_env_file__');
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DB_NAME = 'sliqdesk_test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.BCRYPT_ROUNDS = '4';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:5173';
process.env.JWT_KEYS_DIR = path.join(os.tmpdir(), `sliqdesk-jest-keys-${process.pid}`);
process.env.DEFAULT_SLA_MINUTES = '5';
process.env.SLA_BATCH_SIZE = '5';
