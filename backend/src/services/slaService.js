'use strict';

/**
 * SLA business rules (shared by the API and the worker).
 *
 * An "SLA cycle" measures the time until the first qualifying (admin/agent) response.
 * A ticket is monitored while priority IN (high, urgent) AND status IN (open, in_progress).
 *
 *  - Created as high/urgent ............... start cycle (deadline = now + org minutes)
 *  - Escalated (low/medium -> high/urgent). start a NEW cycle from the escalation time
 *  - Reopened (resolved -> open), monitored  start a NEW cycle, overdue flag reset
 *  - high <-> urgent ....................... no change (same cycle continues)
 *  - De-escalated to low/medium ............ pending job cancelled (overdue flag kept as history)
 *  - Resolved / closed ..................... pending job cancelled (overdue flag kept)
 *  - Staff comment before deadline ......... job completed ("met"); never flagged overdue
 *  - Deadline reached without response ..... worker flags overdue + notifies (exactly once per cycle)
 *  - SLA setting changed ................... applies to cycles started afterwards only
 */
const env = require('../config/env');
const { isSlaPriority } = require('../constants/ticketPriority');
const { ACTIVE_STATUSES, TICKET_STATUS } = require('../constants/ticketStatus');
const slaRepository = require('../repositories/slaRepository');
const jobRepository = require('../repositories/jobRepository');
const ticketRepository = require('../repositories/ticketRepository');

const isMonitored = (ticket) => isSlaPriority(ticket.priority) && ACTIVE_STATUSES.includes(ticket.status);

async function getResponseMinutes(db, organizationId) {
  const settings = await slaRepository.findByOrganization(db, organizationId);
  return settings ? settings.response_time_minutes : env.sla.defaultMinutes;
}

/** Arms a new cycle and mirrors the deadline on the ticket. Must run inside a transaction. */
async function startCycle(client, organizationId, ticketId) {
  const minutes = await getResponseMinutes(client, organizationId);
  const job = await jobRepository.arm(client, organizationId, ticketId, minutes);
  const ticket = await ticketRepository.update(client, organizationId, ticketId, {
    sla_due_at: job.scheduled_at,
    overdue: false,
  });
  return { job, ticket };
}

async function cancelPending(client, organizationId, ticketId) {
  return jobRepository.finishIfPending(client, organizationId, ticketId, 'cancelled');
}

/**
 * Applies SLA rules after a ticket update. `before`/`after` are ticket rows inside the
 * same transaction (ticket row already locked). Returns the possibly-updated ticket row.
 */
async function reconcileAfterUpdate(client, before, after) {
  const { organization_id: orgId, id } = after;
  if (!isMonitored(after)) {
    await cancelPending(client, orgId, id);
    return after;
  }
  const reopened = before.status === TICKET_STATUS.RESOLVED && after.status === TICKET_STATUS.OPEN;
  const escalated = !isSlaPriority(before.priority) && isSlaPriority(after.priority);
  if (reopened || escalated) {
    const { ticket } = await startCycle(client, orgId, id);
    return ticket;
  }
  return after;
}

/**
 * Called inside the comment transaction AFTER the job row has been locked and the
 * staff comment inserted. Completes the job only if the comment landed before the deadline.
 */
async function registerStaffResponse(client, job, commentCreatedAt) {
  if (!job || job.status !== 'pending') return false;
  if (new Date(commentCreatedAt) > new Date(job.scheduled_at)) return false;
  const done = await jobRepository.finishIfPending(client, job.organization_id, job.ticket_id, 'completed');
  return Boolean(done);
}

/** Human-friendly SLA summary for API responses. */
function describe(ticket) {
  if (!ticket.sla_job_status) {
    return { state: 'not_applicable', dueAt: null };
  }
  const states = {
    pending: 'on_track', completed: 'met', overdue: 'breached', cancelled: 'stopped',
  };
  return {
    state: ticket.overdue && ticket.sla_job_status !== 'pending' ? 'breached' : states[ticket.sla_job_status],
    jobStatus: ticket.sla_job_status,
    dueAt: ticket.sla_scheduled_at,
    startedAt: ticket.sla_started_at,
    processedAt: ticket.sla_processed_at,
    cycle: ticket.sla_cycle,
  };
}

module.exports = {
  isMonitored, startCycle, cancelPending, reconcileAfterUpdate, registerStaffResponse, describe,
  getResponseMinutes,
};
