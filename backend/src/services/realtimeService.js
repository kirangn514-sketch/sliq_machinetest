'use strict';

/**
 * Real-time event publishing.
 *
 * - In the API process, config/socket.js registers the Socket.IO server and events are
 *   emitted directly to rooms (after the DB transaction commits).
 * - The worker has no Socket.IO server. It publishes with PostgreSQL NOTIFY inside its
 *   transaction; NOTIFY is only delivered on COMMIT, and the API process LISTENs and
 *   re-emits to the right room. No event can leak from a rolled-back transaction.
 *
 * Events are always addressed to `organization:<id>` or `user:<id>` rooms - never broadcast.
 */
const env = require('../config/env');
const logger = require('../utils/logger');
const { orgRoom, userRoom } = require('../constants/events');

const ROOM_PATTERN = /^(organization|user):\d+$/;
let io = null;

function setServer(server) {
  io = server;
}

const toOrg = (organizationId, event, payload) => ({ room: orgRoom(organizationId), event, payload });
const toUser = (userId, event, payload) => ({ room: userRoom(userId), event, payload });

/** Emits locally through Socket.IO. Invalid rooms are dropped (defence in depth). */
function emit(events) {
  if (!io || !Array.isArray(events)) return;
  events.forEach(({ room, event, payload }) => {
    if (!ROOM_PATTERN.test(room)) {
      logger.warn('Refusing to emit to invalid room', { room, event });
      return;
    }
    io.to(room).emit(event, payload);
  });
}

/** Worker-side: queue events via NOTIFY inside the caller's transaction. */
async function publishViaDatabase(db, events) {
  for (const evt of events) {
    const message = JSON.stringify(evt);
    if (Buffer.byteLength(message) > 7900) {
      logger.warn('Realtime payload too large for NOTIFY, sending reference only', { event: evt.event });
      evt.payload = { id: evt.payload && evt.payload.id, truncated: true };
    }
    await db.query('SELECT pg_notify($1, $2)', [env.eventsChannel, JSON.stringify(evt)]);
  }
}

/** Force-disconnects every socket of a user (e.g. after removal). */
function disconnectUser(userId) {
  if (!io) return;
  io.in(userRoom(userId)).disconnectSockets(true);
}

module.exports = {
  setServer, emit, publishViaDatabase, disconnectUser, toOrg, toUser, ROOM_PATTERN,
};
