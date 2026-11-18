'use strict';

/**
 * Minimal structured JSON logger (stdout/stderr) so containers produce
 * machine-readable logs. Never pass passwords, tokens or hashes as meta.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = process.env.LOG_LEVEL === 'silent' ? Infinity : (LEVELS[process.env.LOG_LEVEL] || LEVELS.info);

function write(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...(meta || {}) });
  if (LEVELS[level] >= LEVELS.warn) process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

module.exports = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
