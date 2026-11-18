'use strict';

/**
 * SLA job processing (used by the worker process in workers/slaWorker.js).
 *
 * Each job is processed in its own transaction:
 *   1. SELECT ... FOR UPDATE SKIP LOCKED  -> concurrent workers never claim the same job
 *   2. Lock the ticket with SKIP LOCKED     -> never waits on (or deadlocks with) API transactions
 *   3. Re-check applicability (priority/status) and qualifying staff responses
 *   4. Flag overdue + idempotent notification (dedupe key per ticket + cycle) + audit
 *   5. pg_notify realtime events (delivered only if the transaction commits)
 */
const env = require('../config/env');
const logger = require('../utils/logger');
const { pool, withTransaction } = require('../config/database');
const jobRepository = require('../repositories/jobRepository');
const commentRepository = require('../repositories/commentRepository');
const ticketRepository = require('../repositories/ticketRepository');
const slaService = require('./slaService');
const notificationService = require('./notificationService');
const audit = require('./auditService');
const realtime = require('./realtimeService');
const { EVENTS } = require('../constants/events');

/** Marks the ticket overdue, notifies every member once per cycle, audits and publishes events. */
async function breach(client, job, ticket) {
  const overdueTicket = await ticketRepository.markOverdue(client, job.organization_id, job.ticket_id);
  await jobRepository.markProcessed(client, job.id, 'overdue');
  const notification = await notificationService.createOverdueNotification(client, overdueTicket, job.cycle);
  await audit.record(client, { organizationId: job.organization_id }, {
    eventType: audit.AUDIT.SLA_BREACHED,
    entityType: 'ticket',
    entityId: job.ticket_id,
    oldValue: { overdue: ticket.overdue },
    newValue: { overdue: true, cycle: job.cycle, deadline: job.scheduled_at },
  });

  const payload = {
    id: overdueTicket.id,
    title: overdueTicket.title,
    priority: overdueTicket.priority,
    status: overdueTicket.status,
    overdue: true,
    slaDueAt: overdueTicket.sla_due_at,
  };
  const events = [
    realtime.toOrg(job.organization_id, EVENTS.TICKET_OVERDUE, payload),
    realtime.toOrg(job.organization_id, EVENTS.TICKET_UPDATED, payload),
  ];
  if (notification) events.push(realtime.toOrg(job.organization_id, EVENTS.NOTIFICATION_CREATED, notification));
  await realtime.publishViaDatabase(client, events);
}

/** Decides the outcome of a claimed, due job. Runs inside the claiming transaction. */
async function evaluateJob(client, job) {
  const ticket = await ticketRepository.findByIdForUpdateSkipLocked(client, job.organization_id, job.ticket_id);
  if (!ticket) return { jobId: job.id, outcome: 'ticket_busy' }; // retry on a later poll

  // Ticket resolved/closed or de-prioritised since the job was armed.
  if (!slaService.isMonitored(ticket)) {
    await jobRepository.markProcessed(client, job.id, 'cancelled');
    return { jobId: job.id, outcome: 'cancelled' };
  }

  // Defensive re-check: a staff response inside this cycle's window means the SLA was met.
  const responded = await commentRepository.hasStaffResponseBetween(
    client, job.organization_id, job.ticket_id, job.started_at, job.scheduled_at,
  );
  if (responded) {
    await jobRepository.markProcessed(client, job.id, 'completed');
    return { jobId: job.id, outcome: 'completed' };
  }

  await breach(client, job, ticket);
  return { jobId: job.id, outcome: 'overdue' };
}

/** Claims and processes at most one due job. Returns 'none' when nothing is due. */
async function processNextJob(skipIds) {
  return withTransaction(async (client) => {
    const job = await jobRepository.claimNextDue(client, skipIds);
    if (!job) return 'none';
    try {
      return await evaluateJob(client, job);
    } catch (err) {
      err.jobId = job.id; // lets runOnce record the failure and move on to other jobs
      throw err;
    }
  });
}

/**
 * Drains up to SLA_BATCH_SIZE due jobs. A failing job is recorded and skipped so it
 * cannot block the queue; a failure to claim (e.g. DB down) ends the run.
 * `shouldContinue` lets the worker stop cleanly on shutdown.
 */
async function runOnce(shouldContinue = () => true) {
  const skipIds = [];
  let processed = 0;
  while (shouldContinue() && processed < env.sla.batchSize) {
    let result;
    try {
      result = await processNextJob(skipIds);
    } catch (err) {
      logger.error('SLA job processing failed', { jobId: err.jobId, error: err.message });
      if (!err.jobId) break;
      skipIds.push(err.jobId);
      await jobRepository.recordFailure(pool, err.jobId, err.message).catch(() => {});
      continue;
    }
    if (result === 'none') break;
    processed += 1;
    if (result.outcome === 'ticket_busy') skipIds.push(result.jobId);
    else logger.info('SLA job processed', result);
  }
  return processed;
}

module.exports = {
  breach, evaluateJob, processNextJob, runOnce,
};
