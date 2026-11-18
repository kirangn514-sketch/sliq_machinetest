'use strict';

/**
 * Persistent SLA job queue (table sla_jobs). One row per ticket that is re-armed
 * for each SLA cycle (cycle counter increments), which keeps UNIQUE(organization_id, ticket_id).
 */

/**
 * Starts a new SLA cycle for the ticket: inserts the job or re-arms the existing one.
 * The deadline is computed in SQL from the database clock to avoid app/DB clock skew.
 */
async function arm(db, organizationId, ticketId, minutes) {
  const { rows } = await db.query(
    `INSERT INTO sla_jobs (organization_id, ticket_id, cycle, started_at, scheduled_at, status)
     VALUES ($1, $2, 1, NOW(), NOW() + make_interval(mins => $3), 'pending')
     ON CONFLICT ON CONSTRAINT uq_sla_jobs_org_ticket DO UPDATE
        SET cycle = sla_jobs.cycle + 1,
            started_at = NOW(),
            scheduled_at = NOW() + make_interval(mins => $3),
            status = 'pending',
            attempts = 0,
            last_error = NULL,
            processed_at = NULL
     RETURNING *`,
    [organizationId, ticketId, minutes],
  );
  return rows[0];
}

async function findByTicketForUpdate(db, organizationId, ticketId) {
  const { rows } = await db.query(
    'SELECT * FROM sla_jobs WHERE organization_id = $1 AND ticket_id = $2 FOR UPDATE',
    [organizationId, ticketId],
  );
  return rows[0] || null;
}

/** Moves a pending job to a terminal status. Returns the row or null if it was not pending. */
async function finishIfPending(db, organizationId, ticketId, status) {
  const { rows } = await db.query(
    `UPDATE sla_jobs SET status = $3, processed_at = NOW()
      WHERE organization_id = $1 AND ticket_id = $2 AND status = 'pending'
      RETURNING *`,
    [organizationId, ticketId, status],
  );
  return rows[0] || null;
}

/**
 * Worker claim: locks ONE due job; rows locked by other workers are skipped,
 * so concurrent workers never process the same job.
 */
async function claimNextDue(db, skipIds = []) {
  const { rows } = await db.query(
    `SELECT * FROM sla_jobs
      WHERE status = 'pending' AND scheduled_at <= NOW()
        AND NOT (id = ANY($1::int[]))
      ORDER BY scheduled_at, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    [skipIds],
  );
  return rows[0] || null;
}

async function markProcessed(db, jobId, status) {
  await db.query(
    "UPDATE sla_jobs SET status = $2, processed_at = NOW() WHERE id = $1 AND status = 'pending'",
    [jobId, status],
  );
}

async function recordFailure(db, jobId, message) {
  await db.query(
    `UPDATE sla_jobs SET attempts = attempts + 1, last_error = left($2, 1000)
      WHERE id = $1`,
    [jobId, message],
  );
}

module.exports = {
  arm, findByTicketForUpdate, finishIfPending, claimNextDue, markProcessed, recordFailure,
};
