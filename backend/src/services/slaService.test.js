'use strict';

jest.mock('../repositories/slaRepository');
jest.mock('../repositories/jobRepository');
jest.mock('../repositories/ticketRepository');

const slaRepository = require('../repositories/slaRepository');
const jobRepository = require('../repositories/jobRepository');
const ticketRepository = require('../repositories/ticketRepository');
const slaService = require('./slaService');
const { ticketRow } = require('../testUtils/factories');

const client = { query: jest.fn() };
const DUE = '2026-01-01T00:10:00.000Z';

describe('isMonitored', () => {
  it.each([
    ['high', 'open', true], ['urgent', 'in_progress', true],
    ['medium', 'open', false], ['low', 'open', false],
    ['urgent', 'resolved', false], ['high', 'closed', false],
  ])('%s/%s -> %s', (priority, status, expected) => {
    expect(slaService.isMonitored({ priority, status })).toBe(expected);
  });
});

describe('getResponseMinutes / startCycle', () => {
  it('uses the organization setting', async () => {
    slaRepository.findByOrganization.mockResolvedValue({ response_time_minutes: 15 });
    expect(await slaService.getResponseMinutes(client, 1)).toBe(15);
  });

  it('falls back to DEFAULT_SLA_MINUTES', async () => {
    slaRepository.findByOrganization.mockResolvedValue(null);
    expect(await slaService.getResponseMinutes(client, 1)).toBe(5);
  });

  it('arms the job with org minutes and mirrors the deadline on the ticket (overdue reset)', async () => {
    // Arrange
    slaRepository.findByOrganization.mockResolvedValue({ response_time_minutes: 7 });
    jobRepository.arm.mockResolvedValue({ scheduled_at: DUE, cycle: 2 });
    ticketRepository.update.mockResolvedValue(ticketRow({ sla_due_at: DUE }));
    // Act
    const { job, ticket } = await slaService.startCycle(client, 1, 100);
    // Assert
    expect(jobRepository.arm).toHaveBeenCalledWith(client, 1, 100, 7);
    expect(ticketRepository.update).toHaveBeenCalledWith(client, 1, 100, { sla_due_at: DUE, overdue: false });
    expect(job.cycle).toBe(2);
    expect(ticket.sla_due_at).toBe(DUE);
  });
});

describe('reconcileAfterUpdate', () => {
  beforeEach(() => {
    slaRepository.findByOrganization.mockResolvedValue({ response_time_minutes: 5 });
    jobRepository.arm.mockResolvedValue({ scheduled_at: DUE });
    ticketRepository.update.mockResolvedValue(ticketRow({ sla_due_at: DUE, priority: 'high' }));
  });

  const run = (before, after) => slaService.reconcileAfterUpdate(client, ticketRow(before), ticketRow(after));

  it.each([
    ['resolved before deadline', { priority: 'high', status: 'open' }, { priority: 'high', status: 'resolved' }],
    ['closed', { priority: 'urgent', status: 'resolved' }, { priority: 'urgent', status: 'closed' }],
    ['de-escalated urgent -> low', { priority: 'urgent', status: 'open' }, { priority: 'low', status: 'open' }],
  ])('cancels the pending job when %s', async (_label, before, after) => {
    const result = await run(before, after);
    expect(jobRepository.finishIfPending).toHaveBeenCalledWith(client, 1, 100, 'cancelled');
    expect(jobRepository.arm).not.toHaveBeenCalled();
    expect(result.priority).toBe(after.priority);
  });

  it('starts a NEW cycle when escalated medium -> high', async () => {
    const result = await run({ priority: 'medium', status: 'open' }, { priority: 'high', status: 'open' });
    expect(jobRepository.arm).toHaveBeenCalledWith(client, 1, 100, 5);
    expect(result.sla_due_at).toBe(DUE);
  });

  it('starts a NEW cycle when a monitored ticket is reopened', async () => {
    await run({ priority: 'urgent', status: 'resolved' }, { priority: 'urgent', status: 'open' });
    expect(jobRepository.arm).toHaveBeenCalled();
  });

  it.each([
    ['high <-> urgent', { priority: 'high', status: 'open' }, { priority: 'urgent', status: 'open' }],
    ['open -> in_progress', { priority: 'high', status: 'open' }, { priority: 'high', status: 'in_progress' }],
    ['in_progress -> open (not a reopen)', { priority: 'high', status: 'in_progress' }, { priority: 'high', status: 'open' }],
  ])('keeps the current cycle for %s', async (_label, before, after) => {
    await run(before, after);
    expect(jobRepository.arm).not.toHaveBeenCalled();
    expect(jobRepository.finishIfPending).not.toHaveBeenCalled();
  });
});

describe('registerStaffResponse', () => {
  const job = (overrides) => ({
    organization_id: 1, ticket_id: 100, status: 'pending', scheduled_at: DUE, ...overrides,
  });

  it('completes a pending job when the reply landed before the deadline', async () => {
    jobRepository.finishIfPending.mockResolvedValue({ status: 'completed' });
    await expect(slaService.registerStaffResponse(client, job(), '2026-01-01T00:09:59.000Z')).resolves.toBe(true);
    expect(jobRepository.finishIfPending).toHaveBeenCalledWith(client, 1, 100, 'completed');
  });

  it('counts a reply exactly at the deadline', async () => {
    jobRepository.finishIfPending.mockResolvedValue({});
    await expect(slaService.registerStaffResponse(client, job(), DUE)).resolves.toBe(true);
  });

  it('does not complete after the deadline', async () => {
    await expect(slaService.registerStaffResponse(client, job(), '2026-01-01T00:10:00.001Z')).resolves.toBe(false);
    expect(jobRepository.finishIfPending).not.toHaveBeenCalled();
  });

  it.each([[null], [job({ status: 'overdue' })], [job({ status: 'completed' })]])('ignores missing/non-pending jobs (%#)', async (j) => {
    await expect(slaService.registerStaffResponse(client, j, DUE)).resolves.toBe(false);
  });

  it('returns false if another transaction already finished the job', async () => {
    jobRepository.finishIfPending.mockResolvedValue(null);
    await expect(slaService.registerStaffResponse(client, job(), DUE)).resolves.toBe(false);
  });
});

describe('describe', () => {
  it('reports not_applicable without a job', () => {
    expect(slaService.describe(ticketRow())).toEqual({ state: 'not_applicable', dueAt: null });
  });

  it.each([
    ['pending', false, 'on_track'],
    ['completed', false, 'met'],
    ['overdue', true, 'breached'],
    ['cancelled', false, 'stopped'],
    ['cancelled', true, 'breached'],
  ])('job %s (overdue=%s) -> %s', (status, overdue, state) => {
    const d = slaService.describe(ticketRow({
      sla_job_status: status, overdue, sla_scheduled_at: DUE, sla_cycle: 1,
    }));
    expect(d).toEqual(expect.objectContaining({ state, jobStatus: status, dueAt: DUE, cycle: 1 }));
  });
});
