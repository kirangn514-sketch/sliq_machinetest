'use strict';

/**
 * Notifications: listing / read state for users, and creation helpers used by
 * other services and the SLA worker (inside their transactions).
 */
const { pool } = require('../config/database');
const AppError = require('../utils/AppError');
const { validate } = require('../utils/validation');
const notificationRepository = require('../repositories/notificationRepository');
const userRepository = require('../repositories/userRepository');

const TYPES = Object.freeze({
  SLA_OVERDUE: 'sla_overdue',
  TICKET_ASSIGNED: 'ticket_assigned',
});

const toDto = (n) => ({
  id: n.id,
  ticketId: n.ticket_id,
  type: n.type,
  message: n.message,
  createdAt: n.created_at,
  readAt: n.read_at || null,
  unread: n.read_at ? false : (n.unread !== undefined ? n.unread : true),
});

async function list(ctx, query) {
  const q = validate(query)
    .integer('page', { required: false, min: 1, max: 100000 })
    .integer('limit', { required: false, min: 1, max: 100 })
    .oneOf('unreadOnly', ['true', 'false'], { required: false })
    .result();
  const page = q.page || 1;
  const limit = q.limit || 10;

  const { rows, total, unreadCount } = await notificationRepository.listForUser(pool, ctx.organizationId, ctx.userId, {
    limit, offset: (page - 1) * limit, unreadOnly: q.unreadOnly === 'true',
  });
  return {
    items: rows.map(toDto),
    unreadCount,
    pagination: {
      page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function markRead(ctx, notificationId) {
  const row = await notificationRepository.markRead(pool, ctx.organizationId, ctx.userId, notificationId);
  if (!row) throw AppError.notFound('Notification not found');
  return { id: row.notification_id, readAt: row.read_at };
}

async function markAllRead(ctx) {
  const updated = await notificationRepository.markAllRead(pool, ctx.organizationId, ctx.userId);
  return { updated };
}

/** Overdue alert for every active member. Idempotent per ticket + SLA cycle. */
async function createOverdueNotification(client, ticket, cycle) {
  const notification = await notificationRepository.createIfAbsent(client, {
    organizationId: ticket.organization_id,
    ticketId: ticket.id,
    type: TYPES.SLA_OVERDUE,
    message: `SLA breached: ticket #${ticket.id} "${ticket.title}" (${ticket.priority}) has no staff response.`,
    dedupeKey: `sla_overdue:${ticket.id}:${cycle}`,
  });
  if (!notification) return null;
  const recipients = await userRepository.listActiveIds(client, ticket.organization_id);
  await notificationRepository.addRecipients(client, ticket.organization_id, notification.id, recipients);
  return toDto(notification);
}

/** Assignment alert for a single assignee. */
async function createAssignmentNotification(client, ticket, assigneeId, actorName) {
  const notification = await notificationRepository.createIfAbsent(client, {
    organizationId: ticket.organization_id,
    ticketId: ticket.id,
    type: TYPES.TICKET_ASSIGNED,
    message: `${actorName} assigned ticket #${ticket.id} "${ticket.title}" to you.`,
    dedupeKey: null,
  });
  await notificationRepository.addRecipients(client, ticket.organization_id, notification.id, [assigneeId]);
  return toDto(notification);
}

module.exports = {
  TYPES, list, markRead, markAllRead, createOverdueNotification, createAssignmentNotification,
};
