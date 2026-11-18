'use strict';

jest.mock('../config/database', () => {
  const client = { query: jest.fn() };
  return { pool: { query: jest.fn() }, withTransaction: jest.fn((work) => work(client)), client };
});
jest.mock('../repositories/jobRepository');
jest.mock('../repositories/commentRepository');
jest.mock('../repositories/ticketRepository');
jest.mock('./notificationService');
jest.mock('./realtimeService', () => ({
  publishViaDatabase: jest.fn(),
  toOrg: (o, event, payload) => ({ room: `organization:${o}`, event, payload }),
}));
jest.mock('./auditService', () => ({ AUDIT: jest.requireActual('./auditService').AUDIT, record: jest.fn() }));
jest.mock('../utils/logger');

const { pool, client } = require('../config/database');
const jobRepository = require('../repositories/jobRepository');
const commentRepository = require('../repositories/commentRepository');
const ticketRepository = require('../repositories/ticketRepository');
const notificationService = require('./notificationService');
const realtime = require('./realtimeService');
const audit = require('./auditService');
const processor = require('./slaJobProcessor');
const { ticketRow } = require('../testUtils/factories');

const job = (overrides) => ({
  id: 1, organization_id: 1, ticket_id: 100, cycle: 2, started_at: 'start', scheduled_at: 'deadline', status: 'pending', ...overrides,
});

describe('evaluateJob', () => {
  beforeEach(() => {
    ticketRepository.markOverdue.mockResolvedValue(ticketRow({ priority: 'urgent', overdue: true, sla_due_at: 'deadline' }));
    notificationService.createOverdueNotification.mockResolvedValue({ id: 9, type: 'sla_overdue' });
    commentRepository.hasStaffResponseBetween.mockResolvedValue(false);
  });

  it('skips (retries later) when the ticket is locked by an API transaction', async () => {
    ticketRepository.findByIdForUpdateSkipLocked.mockResolvedValue(null);
    expect(await processor.evaluateJob(client, job())).toEqual({ jobId: 1, outcome: 'ticket_busy' });
    expect(jobRepository.markProcessed).not.toHaveBeenCalled();
  });

  it.each([
    ['resolved', { priority: 'high', status: 'resolved' }],
    ['closed', { priority: 'urgent', status: 'closed' }],
    ['de-prioritised', { priority: 'low', status: 'open' }],
  ])('cancels the job when the ticket was %s', async (_label, row) => {
    ticketRepository.findByIdForUpdateSkipLocked.mockResolvedValue(ticketRow(row));
    expect(await processor.evaluateJob(client, job())).toEqual({ jobId: 1, outcome: 'cancelled' });
    expect(jobRepository.markProcessed).toHaveBeenCalledWith(client, 1, 'cancelled');
    expect(ticketRepository.markOverdue).not.toHaveBeenCalled();
  });

  it('completes the job when a staff reply exists inside the cycle window', async () => {
    ticketRepository.findByIdForUpdateSkipLocked.mockResolvedValue(ticketRow({ priority: 'high' }));
    commentRepository.hasStaffResponseBetween.mockResolvedValue(true);
    expect(await processor.evaluateJob(client, job())).toEqual({ jobId: 1, outcome: 'completed' });
    expect(commentRepository.hasStaffResponseBetween).toHaveBeenCalledWith(client, 1, 100, 'start', 'deadline');
    expect(ticketRepository.markOverdue).not.toHaveBeenCalled();
  });

  it('breaches: flags overdue, notifies once per cycle, audits and publishes events in the transaction', async () => {
    // Arrange
    ticketRepository.findByIdForUpdateSkipLocked.mockResolvedValue(ticketRow({ priority: 'urgent' }));
    // Act
    const result = await processor.evaluateJob(client, job());
    // Assert
    expect(result).toEqual({ jobId: 1, outcome: 'overdue' });
    expect(ticketRepository.markOverdue).toHaveBeenCalledWith(client, 1, 100);
    expect(jobRepository.markProcessed).toHaveBeenCalledWith(client, 1, 'overdue');
    expect(notificationService.createOverdueNotification).toHaveBeenCalledWith(client, expect.objectContaining({ id: 100 }), 2);
    expect(audit.record).toHaveBeenCalledWith(client, { organizationId: 1 }, expect.objectContaining({ eventType: 'SLA_BREACHED' }));
    const events = realtime.publishViaDatabase.mock.calls[0][1];
    expect(realtime.publishViaDatabase.mock.calls[0][0]).toBe(client);
    expect(events.map((e) => e.event)).toEqual(['ticket:overdue', 'ticket:updated', 'notification:created']);
    expect(events.every((e) => e.room === 'organization:1')).toBe(true);
  });

  it('publishes no notification event when the notification already existed', async () => {
    ticketRepository.findByIdForUpdateSkipLocked.mockResolvedValue(ticketRow({ priority: 'urgent' }));
    notificationService.createOverdueNotification.mockResolvedValue(null);
    await processor.evaluateJob(client, job());
    expect(realtime.publishViaDatabase.mock.calls[0][1].map((e) => e.event)).toEqual(['ticket:overdue', 'ticket:updated']);
  });
});

describe('processNextJob', () => {
  it('claims with the skip list and returns "none" when nothing is due', async () => {
    jobRepository.claimNextDue.mockResolvedValue(null);
    expect(await processor.processNextJob([7])).toBe('none');
    expect(jobRepository.claimNextDue).toHaveBeenCalledWith(client, [7]);
  });

  it('tags processing errors with the job id', async () => {
    jobRepository.claimNextDue.mockResolvedValue(job({ id: 42 }));
    ticketRepository.findByIdForUpdateSkipLocked.mockRejectedValue(new Error('boom'));
    await expect(processor.processNextJob([])).rejects.toMatchObject({ message: 'boom', jobId: 42 });
  });
});

describe('runOnce', () => {
  beforeEach(() => {
    ticketRepository.findByIdForUpdateSkipLocked.mockResolvedValue(ticketRow({ priority: 'high', status: 'resolved' }));
  });

  it('drains due jobs until none are left', async () => {
    jobRepository.claimNextDue
      .mockResolvedValueOnce(job({ id: 1 }))
      .mockResolvedValueOnce(job({ id: 2 }))
      .mockResolvedValueOnce(null);
    expect(await processor.runOnce()).toBe(2);
  });

  it('stops at SLA_BATCH_SIZE', async () => {
    jobRepository.claimNextDue.mockResolvedValue(job());
    expect(await processor.runOnce()).toBe(5);
  });

  it('stops when the worker is shutting down', async () => {
    jobRepository.claimNextDue.mockResolvedValue(job());
    expect(await processor.runOnce(() => false)).toBe(0);
    expect(jobRepository.claimNextDue).not.toHaveBeenCalled();
  });

  it('skips busy tickets for the rest of the run', async () => {
    ticketRepository.findByIdForUpdateSkipLocked.mockResolvedValueOnce(null);
    jobRepository.claimNextDue.mockResolvedValueOnce(job({ id: 3 })).mockResolvedValueOnce(null);
    await processor.runOnce();
    expect(jobRepository.claimNextDue.mock.calls[1][1]).toEqual([3]);
  });

  it('records a failing job, skips it and keeps processing others', async () => {
    // Arrange
    jobRepository.claimNextDue
      .mockResolvedValueOnce(job({ id: 8 }))
      .mockResolvedValueOnce(job({ id: 9 }))
      .mockResolvedValueOnce(null);
    ticketRepository.findByIdForUpdateSkipLocked.mockRejectedValueOnce(new Error('bad row'));
    jobRepository.recordFailure.mockResolvedValue();
    // Act
    const processed = await processor.runOnce();
    // Assert
    expect(jobRepository.recordFailure).toHaveBeenCalledWith(pool, 8, 'bad row');
    expect(jobRepository.claimNextDue.mock.calls[1][1]).toEqual([8]);
    expect(processed).toBe(1);
  });

  it('survives a failure while recording the failure', async () => {
    jobRepository.claimNextDue.mockResolvedValueOnce(job({ id: 8 })).mockResolvedValueOnce(null);
    ticketRepository.findByIdForUpdateSkipLocked.mockRejectedValueOnce(new Error('bad row'));
    jobRepository.recordFailure.mockRejectedValue(new Error('db gone'));
    await expect(processor.runOnce()).resolves.toBe(0);
  });

  it('ends the run when claiming itself fails (e.g. database down)', async () => {
    jobRepository.claimNextDue.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await processor.runOnce()).toBe(0);
    expect(jobRepository.claimNextDue).toHaveBeenCalledTimes(1);
    expect(jobRepository.recordFailure).not.toHaveBeenCalled();
  });
});
