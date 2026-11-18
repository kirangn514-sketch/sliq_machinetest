'use strict';

/**
 * Comment data access. The composite FK (organization_id, ticket_id) guarantees a
 * comment can only reference a ticket of the same organization.
 */

const SELECT_WITH_AUTHOR = `
  SELECT cm.id, cm.organization_id, cm.ticket_id, cm.user_id, cm.message,
         cm.is_staff_response, cm.created_at,
         u.name AS author_name, u.email AS author_email, u.role AS author_role
    FROM comments cm
    JOIN users u ON u.organization_id = cm.organization_id AND u.id = cm.user_id`;

async function create(db, {
  organizationId, ticketId, userId, message, isStaffResponse,
}) {
  const { rows } = await db.query(
    `INSERT INTO comments (organization_id, ticket_id, user_id, message, is_staff_response, created_at)
     VALUES ($1, $2, $3, $4, $5, clock_timestamp())
     RETURNING id`,
    [organizationId, ticketId, userId, message, isStaffResponse],
  );
  return findById(db, organizationId, rows[0].id);
}

async function findById(db, organizationId, commentId) {
  const { rows } = await db.query(
    `${SELECT_WITH_AUTHOR} WHERE cm.organization_id = $1 AND cm.id = $2`,
    [organizationId, commentId],
  );
  return rows[0] || null;
}

async function listByTicket(db, organizationId, ticketId) {
  const { rows } = await db.query(
    `${SELECT_WITH_AUTHOR}
      WHERE cm.organization_id = $1 AND cm.ticket_id = $2
      ORDER BY cm.created_at ASC, cm.id ASC`,
    [organizationId, ticketId],
  );
  return rows;
}

/** True if a staff (admin/agent) comment exists within the SLA window [from, to]. */
async function hasStaffResponseBetween(db, organizationId, ticketId, from, to) {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM comments
        WHERE organization_id = $1 AND ticket_id = $2 AND is_staff_response
          AND created_at >= $3 AND created_at <= $4
     ) AS found`,
    [organizationId, ticketId, from, to],
  );
  return rows[0].found;
}

module.exports = {
  create, findById, listByTicket, hasStaffResponseBetween,
};
