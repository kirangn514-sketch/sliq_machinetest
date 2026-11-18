'use strict';

jest.mock('../config/database', () => {
  const client = { query: jest.fn() };
  return { pool: { query: jest.fn() }, withTransaction: jest.fn((work) => work(client)), client };
});
jest.mock('../repositories/ticketRepository');
jest.mock('../repositories/commentRepository');
jest.mock('../repositories/jobRepository');
jest.mock('./slaService', () => ({
  registerStaffResponse: jest.fn(),
  describe: jest.requireActual('./slaService').describe,
}));
jest.mock('./realtimeService', () => ({
  emit: jest.fn(),
  toOrg: (o, event, payload) => ({ room: `organization:${o}`, event, payload }),
}));
jest.mock('./auditService', () => ({ AUDIT: jest.requireActual('./auditService').AUDIT, record: jest.fn() }));

const { pool, client } = require('../config/database');
const ticketRepository = require('../repositories/ticketRepository');
const commentRepository = require('../repositories/commentRepository');
const jobRepository = require('../repositories/jobRepository');
const slaService = require('./slaService');
const realtime = require('./realtimeService');
const audit = require('./auditService');
const commentService = require('./commentService');
const { ctx, ticketRow } = require('../testUtils/factories');

const commentRow = (overrides) => ({
  id: 1, ticket_id: 100, user_id: 20, message: 'On it', is_staff_response: true, created_at: 'now', author_name: 'Agnes', author_role: 'agent', ...overrides,
});

describe('listComments', () => {
  it('lists comments of a ticket in the caller organization', async () => {
    ticketRepository.findDetailById.mockResolvedValue(ticketRow());
    commentRepository.listByTicket.mockResolvedValue([commentRow()]);
    const result = await commentService.listComments(ctx({ role: 'viewer' }), 100);
    expect(commentRepository.listByTicket).toHaveBeenCalledWith(pool, 1, 100);
    expect(result).toEqual([expect.objectContaining({ id: 1, author: { id: 20, name: 'Agnes', role: 'agent' } })]);
  });

  it('returns 404 for a ticket in another organization', async () => {
    ticketRepository.findDetailById.mockResolvedValue(null);
    await expect(commentService.listComments(ctx(), 999)).rejects.toMatchObject({ statusCode: 404 });
    expect(commentRepository.listByTicket).not.toHaveBeenCalled();
  });
});

describe('addComment', () => {
  const agent = ctx({ role: 'agent', userId: 20 });

  beforeEach(() => {
    ticketRepository.findByIdForUpdate.mockResolvedValue(ticketRow({ priority: 'urgent' }));
    ticketRepository.findDetailById.mockResolvedValue(ticketRow());
    jobRepository.findByTicketForUpdate.mockResolvedValue({ status: 'pending' });
    commentRepository.create.mockResolvedValue(commentRow());
    slaService.registerStaffResponse.mockResolvedValue(true);
  });

  it('locks ticket then SLA job, saves the comment, registers the SLA response and emits', async () => {
    // Act
    const result = await commentService.addComment(agent, 100, { message: '  On it  ' });
    // Assert
    const order = [
      ticketRepository.findByIdForUpdate.mock.invocationCallOrder[0],
      jobRepository.findByTicketForUpdate.mock.invocationCallOrder[0],
      commentRepository.create.mock.invocationCallOrder[0],
      slaService.registerStaffResponse.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(commentRepository.create).toHaveBeenCalledWith(client, {
      organizationId: 1, ticketId: 100, userId: 20, message: 'On it', isStaffResponse: true,
    });
    expect(slaService.registerStaffResponse).toHaveBeenCalledWith(client, { status: 'pending' }, 'now');
    expect(ticketRepository.touch).toHaveBeenCalledWith(client, 1, 100);
    expect(audit.record).toHaveBeenCalledWith(client, agent, expect.objectContaining({
      eventType: 'COMMENT_CREATED', newValue: { ticketId: 100, length: 5, slaMet: true },
    }));
    expect(realtime.emit).toHaveBeenCalledWith([
      expect.objectContaining({ room: 'organization:1', event: 'comment:created', payload: { ticketId: 100, comment: result } }),
      expect.objectContaining({ event: 'ticket:updated' }),
    ]);
  });

  it('does not lock or touch the SLA job for non-staff authors', async () => {
    commentRepository.create.mockResolvedValue(commentRow({ is_staff_response: false }));
    await commentService.addComment(ctx({ role: 'viewer' }), 100, { message: 'hi' });
    expect(jobRepository.findByTicketForUpdate).not.toHaveBeenCalled();
    expect(commentRepository.create.mock.calls[0][1].isStaffResponse).toBe(false);
    expect(slaService.registerStaffResponse).toHaveBeenCalledWith(client, null, 'now');
  });

  it('rejects comments on closed tickets', async () => {
    ticketRepository.findByIdForUpdate.mockResolvedValue(ticketRow({ status: 'closed' }));
    await expect(commentService.addComment(agent, 100, { message: 'late' }))
      .rejects.toMatchObject({ statusCode: 409, errorCode: 'TICKET_CLOSED' });
    expect(commentRepository.create).not.toHaveBeenCalled();
  });

  it('returns 404 for tickets of another organization', async () => {
    ticketRepository.findByIdForUpdate.mockResolvedValue(null);
    await expect(commentService.addComment(agent, 999, { message: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it.each([[''], ['   '], ['x'.repeat(5001)], [undefined]])('validates the message (%#)', async (message) => {
    await expect(commentService.addComment(agent, 100, { message })).rejects.toMatchObject({ statusCode: 400 });
    expect(ticketRepository.findByIdForUpdate).not.toHaveBeenCalled();
  });
});
