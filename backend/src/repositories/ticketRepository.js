'use strict';

/**
 * Ticket data access. EVERY query filters on organization_id.
 */

const DETAIL_SELECT = `
  SELECT t.id, t.organization_id, t.title, t.description, t.status, t.priority,
         t.assignee_id, t.created_by, t.overdue, t.sla_due_at, t.version,
         t.created_at, t.updated_at,
         c.name  AS creator_name,  c.email AS creator_email,
         a.name  AS assignee_name, a.email AS assignee_email, a.is_active AS assignee_active,
         j.status AS sla_job_status, j.scheduled_at AS sla_scheduled_at, j.cycle AS sla_cycle,
         j.started_at AS sla_started_at, j.processed_at AS sla_processed_at
    FROM tickets t
    JOIN users c ON c.organization_id = t.organization_id AND c.id = t.created_by
    LEFT JOIN users a ON a.organization_id = t.organization_id AND a.id = t.assignee_id
    LEFT JOIN sla_jobs j ON j.organization_id = t.organization_id AND j.ticket_id = t.id`;

async function create(db, {
  organizationId, title, description, priority, assigneeId, createdBy,
}) {
  const { rows } = await db.query(
    `INSERT INTO tickets (organization_id, title, description, priority, assignee_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [organizationId, title, description, priority, assigneeId, createdBy],
  );
  return rows[0];
}

async function findDetailById(db, organizationId, ticketId) {
  const { rows } = await db.query(
    `${DETAIL_SELECT} WHERE t.organization_id = $1 AND t.id = $2`,
    [organizationId, ticketId],
  );
  return rows[0] || null;
}

/** Row-locks the ticket for the remainder of the transaction (concurrency control). */
async function findByIdForUpdate(db, organizationId, ticketId) {
  const { rows } = await db.query(
    'SELECT * FROM tickets WHERE organization_id = $1 AND id = $2 FOR UPDATE',
    [organizationId, ticketId],
  );
  return rows[0] || null;
}

/** Worker variant: never waits for a lock held by an API transaction (returns null instead). */
async function findByIdForUpdateSkipLocked(db, organizationId, ticketId) {
  const { rows } = await db.query(
    'SELECT * FROM tickets WHERE organization_id = $1 AND id = $2 FOR UPDATE SKIP LOCKED',
    [organizationId, ticketId],
  );
  return rows[0] || null;
}

/**
 * Builds a WHERE clause from whitelisted filters only. Values are always bound
 * parameters; only fixed column names are concatenated.
 */
function buildFilters(organizationId, filters) {
  const clauses = ['t.organization_id = $1'];
  const params = [organizationId];
  const add = (sqlWithPlaceholder, value) => {
    params.push(value);
    clauses.push(sqlWithPlaceholder.replace('?', `$${params.length}`));
  };

  if (filters.status) add('t.status = ?', filters.status);
  if (filters.priority) add('t.priority = ?', filters.priority);
  if (filters.assigneeId === 'unassigned') clauses.push('t.assignee_id IS NULL');
  else if (Number.isInteger(filters.assigneeId)) add('t.assignee_id = ?', filters.assigneeId);
  if (typeof filters.overdue === 'boolean') add('t.overdue = ?', filters.overdue);
  if (filters.search) add("(t.title ILIKE ? ESCAPE '\\')", `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);

  return { where: clauses.join(' AND '), params };
}

async function list(db, organizationId, filters, { limit, offset }) {
  const { where, params } = buildFilters(organizationId, filters);

  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM tickets t WHERE ${where}`, params);

  const pageParams = [...params, limit, offset];
  const { rows } = await db.query(
    `SELECT t.id, t.title, t.status, t.priority, t.assignee_id, t.created_by, t.overdue,
            t.sla_due_at, t.created_at, t.updated_at,
            a.name AS assignee_name, c.name AS creator_name
       FROM tickets t
       JOIN users c ON c.organization_id = t.organization_id AND c.id = t.created_by
       LEFT JOIN users a ON a.organization_id = t.organization_id AND a.id = t.assignee_id
      WHERE ${where}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    pageParams,
  );
  return { rows, total: countResult.rows[0].total };
}

/**
 * Updates only the provided, whitelisted columns and bumps the version.
 * `changes` keys must be column names from ALLOWED_UPDATE_COLUMNS.
 */
const ALLOWED_UPDATE_COLUMNS = ['title', 'description', 'status', 'priority', 'assignee_id', 'overdue', 'sla_due_at'];

async function update(db, organizationId, ticketId, changes) {
  const columns = Object.keys(changes).filter((key) => ALLOWED_UPDATE_COLUMNS.includes(key));
  const params = [organizationId, ticketId];
  const sets = columns.map((column) => {
    params.push(changes[column]);
    return `${column} = $${params.length}`;
  });
  sets.push('version = version + 1');

  const { rows } = await db.query(
    `UPDATE tickets SET ${sets.join(', ')}
      WHERE organization_id = $1 AND id = $2
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/** Touch updated_at (e.g. after a new comment). */
async function touch(db, organizationId, ticketId) {
  await db.query(
    'UPDATE tickets SET updated_at = NOW() WHERE organization_id = $1 AND id = $2',
    [organizationId, ticketId],
  );
}

async function markOverdue(db, organizationId, ticketId) {
  const { rows } = await db.query(
    `UPDATE tickets SET overdue = TRUE, version = version + 1
      WHERE organization_id = $1 AND id = $2
      RETURNING *`,
    [organizationId, ticketId],
  );
  return rows[0] || null;
}

/** Clears assignment of every ticket assigned to a removed member. Returns affected ids. */
async function unassignAllForUser(db, organizationId, userId) {
  const { rows } = await db.query(
    `UPDATE tickets SET assignee_id = NULL, version = version + 1
      WHERE organization_id = $1 AND assignee_id = $2
      RETURNING id`,
    [organizationId, userId],
  );
  return rows.map((r) => r.id);
}

async function stats(db, organizationId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int                                          AS total,
            COUNT(*) FILTER (WHERE status = 'open')::int           AS open,
            COUNT(*) FILTER (WHERE status = 'in_progress')::int    AS in_progress,
            COUNT(*) FILTER (WHERE status = 'resolved')::int       AS resolved,
            COUNT(*) FILTER (WHERE status = 'closed')::int         AS closed,
            COUNT(*) FILTER (WHERE overdue)::int                   AS overdue
       FROM tickets
      WHERE organization_id = $1`,
    [organizationId],
  );
  return rows[0];
}

module.exports = {
  create,
  findDetailById,
  findByIdForUpdate,
  findByIdForUpdateSkipLocked,
  buildFilters,
  list,
  update,
  touch,
  markOverdue,
  unassignAllForUser,
  stats,
};
