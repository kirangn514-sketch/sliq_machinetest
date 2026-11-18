'use strict';

/**
 * Socket.IO configuration.
 *
 * - Authenticates the handshake with the SAME HttpOnly JWT cookie as the REST API and
 *   re-validates the user against the database (active flag, token version).
 * - The server decides the rooms: `organization:<orgId>` and `user:<userId>`.
 *   Clients cannot join rooms themselves - there is no "subscribe" handler at all.
 * - Sockets are disconnected when their JWT expires; the client reconnects with the
 *   (sliding-renewed) cookie or is sent to login.
 * - LISTENs on PostgreSQL NOTIFY to relay events produced by the SLA worker.
 */
const { Server } = require('socket.io');
const { Client } = require('pg');
const cookie = require('cookie');
const env = require('./env');
const logger = require('../utils/logger');
const authService = require('../services/authService');
const realtime = require('../services/realtimeService');
const { orgRoom, userRoom } = require('../constants/events');

let io = null;
let listener = null;
let stopping = false;

function isAllowedOrigin(origin) {
  return !origin || env.corsOrigins.includes(origin.replace(/\/$/, ''));
}

async function authenticateSocket(socket, next) {
  try {
    const cookies = cookie.parse(socket.request.headers.cookie || '');
    const token = cookies[env.cookie.name];
    if (!token) return next(new Error('unauthorized'));
    const { user, claims } = await authService.resolveSession(token);
    socket.data.user = {
      id: user.id, organizationId: user.organization_id, role: user.role,
    };
    socket.data.expiresAt = claims.exp * 1000;
    return next();
  } catch (err) {
    return next(new Error('unauthorized'));
  }
}

function onConnection(socket) {
  const { user, expiresAt } = socket.data;
  socket.join(orgRoom(user.organizationId));
  socket.join(userRoom(user.id));

  // Per-connection expiry guard (connection lifecycle, not business scheduling).
  const ttl = Math.max(0, expiresAt - Date.now());
  const expiryTimer = setTimeout(() => socket.disconnect(true), Math.min(ttl, 2147483647));
  socket.on('disconnect', () => clearTimeout(expiryTimer));
}

async function startDatabaseListener(attempt = 1) {
  if (stopping) return;
  listener = new Client({
    host: env.db.host,
    port: env.db.port,
    database: env.db.database,
    user: env.db.user,
    password: env.db.password,
    ssl: env.db.ssl ? { rejectUnauthorized: true } : false,
  });

  let retried = false;
  const retry = () => {
    if (stopping || retried) return;
    retried = true;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
    logger.warn('Realtime DB listener lost, reconnecting', { delayMs: delay });
    setTimeout(() => startDatabaseListener(attempt + 1), delay);
  };

  listener.on('notification', (msg) => {
    try {
      const evt = JSON.parse(msg.payload);
      realtime.emit([evt]);
    } catch (err) {
      logger.warn('Ignoring malformed realtime notification', { error: err.message });
    }
  });
  listener.on('error', (err) => {
    logger.error('Realtime DB listener error', { error: err.message });
    listener.removeAllListeners('end');
    listener.end().catch(() => {});
    retry();
  });
  listener.on('end', retry);

  try {
    await listener.connect();
    await listener.query(`LISTEN ${env.eventsChannel}`);
    logger.info('Listening for worker events', { channel: env.eventsChannel });
  } catch (err) {
    listener.removeAllListeners();
    retry();
  }
}

function initSocket(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: env.corsOrigins, credentials: true },
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers.origin)),
  });
  io.use(authenticateSocket);
  io.on('connection', onConnection);
  realtime.setServer(io);
  startDatabaseListener();
  return io;
}

async function closeSocket() {
  stopping = true;
  if (listener) {
    listener.removeAllListeners();
    await listener.end().catch(() => {});
  }
  if (io) await new Promise((resolve) => { io.close(() => resolve()); });
}

module.exports = {
  initSocket,
  closeSocket,
  // exported for unit tests
  isAllowedOrigin,
  authenticateSocket,
  onConnection,
};
