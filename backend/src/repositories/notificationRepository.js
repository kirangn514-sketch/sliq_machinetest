'use strict';

/**
 * Notification data access. Reads are scoped by organization AND recipient user.
 */

/**
 * Idempotent insert: returns null when a notification with the same dedupe_key
 * already exists for the organization (e.g. a second worker processing the same breach).
 */
async function createIfAbsent(db, {
  organizationId, ticketId, type, message, dedupeKey,
}) {
  const { rows } = await db.query(
    `INSERT INTO notifications (organization_id, ticket_id, type, message, dedupe_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ON CONSTRAINT uq_notifications_dedupe DO NOTHING
     RETURNING id, organization_id, ticket_id, type, message, created_at`,
    [organizationId, ticketId, type, message, dedupeKey || null],
  );
  return rows[0] || null;
}

async function addRecipients(db, organizationId, notificationId, userIds) {
  if (userIds.length === 0) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO notification_recipients (notification_id, user_id, organization_id)
     SELECT $2, u.id, $1
       FROM users u
      WHERE u.organization_id = $1 AND u.id = ANY($3::int[]) AND u.is_active
     ON CONFLICT DO NOTHING`,
    [organizationId, notificationId, userIds],
  );
  return rowCount;
}

async function listForUser(db, organizationId, userId, { limit, offset, unreadOnly }) {
  const unreadClause = unreadOnly ? 'AND r.read_at IS NULL' : '';
  const base = `FROM notification_recipients r
                JOIN notifications n ON n.organization_id = r.organization_id AND n.id = r.notification_id
               WHERE r.organization_id = $1 AND r.user_id = $2 ${unreadClause}`;

  const count = await db.query(`SELECT COUNT(*)::int AS total ${base}`, [organizationId, userId]);
  const unread = await db.query(
    `SELECT COUNT(*)::int AS unread FROM notification_recipients
      WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL`,
    [organizationId, userId],
  );
  const { rows } = await db.query(
    `SELECT n.id, n.ticket_id, n.type, n.message, n.created_at, r.read_at,
            (r.read_at IS NULL) AS unread
       ${base}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $3 OFFSET $4`,
    [organizationId, userId, limit, offset],
  );
  return { rows, total: count.rows[0].total, unreadCount: unread.rows[0].unread };
}

async function markRead(db, organizationId, userId, notificationId) {
  const { rows } = await db.query(
    `UPDATE notification_recipients
        SET read_at = COALESCE(read_at, NOW())
      WHERE organization_id = $1 AND user_id = $2 AND notification_id = $3
      RETURNING notification_id, read_at`,
    [organizationId, userId, notificationId],
  );
  return rows[0] || null;
}

async function markAllRead(db, organizationId, userId) {
  const { rowCount } = await db.query(
    `UPDATE notification_recipients SET read_at = NOW()
      WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL`,
    [organizationId, userId],
  );
  return rowCount;
}

module.exports = {
  createIfAbsent, addRecipients, listForUser, markRead, markAllRead,
};
