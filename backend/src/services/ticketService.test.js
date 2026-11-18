'use strict';

jest.mock('../config/database', () => {
  const client = { query: jest.fn() };
  return { pool: { query: jest.fn() }, withTransaction: jest.fn((work) => work(client)), client };
});
jest.mock('../repositories/ticketRepository');
jest.mock('../repositories/userRepository');
jest.mock('../repositories/commentRepository');
jest.mock('./slaService', () => ({
  startCycle: jest.fn(),
  reconcileAfterUpdate: jest.fn(),
  describe: jest.requireActual('./slaService').describe,
}));
jest.mock('./notificationService');
jest.mock('./realtimeService', () => ({
  emit: jest.fn(),
  toOrg: (o, event, payload) => ({ room: `organization:${o}`, event, payload }),
  toUser: (u, event, payload) => ({ room: `user:${u}`, event, payload }),
}));
jest.mock('./auditService', () => ({ AUDIT: jest.requireActual('./auditService').AUDIT, record: jest.fn() }));

const { pool, client } = require('../config/database');
const ticketRepository = require('../repositories/ticketRepository');
const userRepository = require('../repositories/userRepository');
const commentRepository = require('../repositories/commentRepository');
const slaService = require('./slaService');
const notificationService = require('./notificationService');
const realtime = require('./realtimeService');
const audit = require('./auditService');
const ticketService = require('./ticketService');
const { ctx, ticketRow, userRow } = require('../testUtils/factories');

const admin = ctx({ role: 'admin', userId: 10 });
const agent = ctx({ role: 'agent', userId: 20, name: 'Agnes' });
const viewer = ctx({ role: 'viewer', userId: 30 });

const staffUser = (id, role = 'agent') => userRow({ id, role, is_active: true });

describe('createTicket', () => {
  beforeEach(() => {
    ticketRepository.create.mockImplementation(async (_db, d) => ticketRow({
      id: 100, priority: d.priority, assignee_id: d.assigneeId, created_by: d.createdBy,
    }));
    ticketRepository.findDetailById.mockImplementation(async () => ticketRow({ id: 100, assignee_id: 21, assignee_name: 'Bo' }));
    notificationService.createAssignmentNotification.mockResolvedValue({ id: 9, type: 'ticket_assigned' });
  });

  it('applies defaults and takes org + creator from the authenticated context', async () => {
    // Act
    const dto = await ticketService.createTicket(agent, {
      title: ' Printer ', description: 'down', organizationId: 99, createdBy: 1,
    });
    // Assert
    expect(ticketRepository.create).toHaveBeenCalledWith(client, {
      organizationId: 1, title: 'Printer', description: 'down', priority: 'medium', assigneeId: null, createdBy: 20,
    });
    expect(slaService.startCycle).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(client, agent, expect.objectContaining({ eventType: 'TICKET_CREATED' }));
    expect(realtime.emit).toHaveBeenCalledWith([expect.objectContaining({ room: 'organization:1', event: 'ticket:created' })]);
    expect(dto.id).toBe(100);
  });

  it.each(['high', 'urgent'])('starts an SLA cycle for %s tickets', async (priority) => {
    await ticketService.createTicket(agent, { title: 't', description: 'd', priority });
    expect(slaService.startCycle).toHaveBeenCalledWith(client, 1, 100);
  });

  it('validates the assignee belongs to the same org and is staff, then notifies them', async () => {
    // Arrange
    userRepository.findById.mockResolvedValue(staffUser(21));
    // Act
    await ticketService.createTicket(agent, { title: 't', description: 'd', assigneeId: 21 });
    // Assert
    expect(userRepository.findById).toHaveBeenCalledWith(client, 1, 21);
    expect(notificationService.createAssignmentNotification).toHaveBeenCalledWith(client, expect.objectContaining({ id: 100 }), 21, 'Agnes');
    expect(realtime.emit.mock.calls[0][0]).toContainEqual(expect.objectContaining({ room: 'user:21', event: 'notification:created' }));
  });

  it('does not notify when assigning to yourself', async () => {
    userRepository.findById.mockResolvedValue(staffUser(20));
    await ticketService.createTicket(agent, { title: 't', description: 'd', assigneeId: 20 });
    expect(notificationService.createAssignmentNotification).not.toHaveBeenCalled();
  });

  it.each([
    ['another organization (not found)', null],
    ['an inactive member', userRow({ id: 21, role: 'agent', is_active: false })],
    ['a viewer', userRow({ id: 21, role: 'viewer' })],
  ])('rejects assigning to %s', async (_label, found) => {
    userRepository.findById.mockResolvedValue(found);
    await expect(ticketService.createTicket(agent, { title: 't', description: 'd', assigneeId: 21 }))
      .rejects.toMatchObject({ statusCode: 400, details: { fields: { assigneeId: expect.any(String) } } });
    expect(ticketRepository.create).not.toHaveBeenCalled();
  });

  it('validates required fields and priority values', async () => {
    await expect(ticketService.createTicket(agent, { title: '', description: 'd', priority: 'critical' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('listTickets', () => {
  beforeEach(() => {
    ticketRepository.list.mockResolvedValue({ rows: [ticketRow()], total: 23 });
  });

  it('defaults to page 1 / limit 10 and returns pagination metadata', async () => {
    // Act
    const result = await ticketService.listTickets(viewer, {});
    // Assert
    expect(ticketRepository.list).toHaveBeenCalledWith(pool, 1, expect.any(Object), { limit: 10, offset: 0 });
    expect(result.pagination).toEqual({
      page: 1, limit: 10, total: 23, totalPages: 3,
    });
    expect(result.items[0]).toEqual(expect.objectContaining({ id: 100, assignee: null }));
  });

  it('passes validated filters and computes the offset', async () => {
    await ticketService.listTickets(viewer, {
      page: '3', limit: '5', status: 'open', priority: 'urgent', assigneeId: '7', overdue: 'true', search: 'vpn',
    });
    expect(ticketRepository.list).toHaveBeenCalledWith(pool, 1, {
      status: 'open', priority: 'urgent', assigneeId: 7, overdue: true, search: 'vpn',
    }, { limit: 5, offset: 10 });
  });

  it('supports the "unassigned" assignee filter and overdue=false', async () => {
    await ticketService.listTickets(viewer, { assigneeId: 'unassigned', overdue: 'false' });
    expect(ticketRepository.list.mock.calls[0][2]).toEqual(expect.objectContaining({ assigneeId: 'unassigned', overdue: false }));
  });

  it('always reports at least one page', async () => {
    ticketRepository.list.mockResolvedValue({ rows: [], total: 0 });
    expect((await ticketService.listTickets(viewer)).pagination.totalPages).toBe(1);
  });

  it.each([
    [{ page: '0' }], [{ limit: '101' }], [{ status: "open' OR 1=1" }], [{ priority: 'x' }], [{ assigneeId: 'abc' }], [{ overdue: 'yes' }],
  ])('rejects invalid query %j with 400', async (query) => {
    await expect(ticketService.listTickets(viewer, query)).rejects.toMatchObject({ statusCode: 400 });
    expect(ticketRepository.list).not.toHaveBeenCalled();
  });
});

describe('getTicket / getStats', () => {
  it('returns ticket details with comments', async () => {
    ticketRepository.findDetailById.mockResolvedValue(ticketRow());
    commentRepository.listByTicket.mockResolvedValue([{
      id: 1, ticket_id: 100, user_id: 10, message: 'hi', is_staff_response: true, created_at: 'c', author_name: 'A', author_role: 'admin',
    }]);
    const result = await ticketService.getTicket(viewer, 100);
    expect(ticketRepository.findDetailById).toHaveBeenCalledWith(pool, 1, 100);
    expect(result.comments[0]).toEqual(expect.objectContaining({ message: 'hi', author: { id: 10, name: 'A', role: 'admin' } }));
    expect(result.sla).toEqual({ state: 'not_applicable', dueAt: null });
  });

  it('returns 404 for tickets of another organization', async () => {
    ticketRepository.findDetailById.mockResolvedValue(null);
    await expect(ticketService.getTicket(viewer, 999)).rejects.toMatchObject({ statusCode: 404 });
    expect(commentRepository.listByTicket).not.toHaveBeenCalled();
  });

  it('returns organization-scoped stats', async () => {
    ticketRepository.stats.mockResolvedValue({ total: 2 });
    expect(await ticketService.getStats(viewer)).toEqual({ total: 2 });
    expect(ticketRepository.stats).toHaveBeenCalledWith(pool, 1);
  });
});

describe('updateTicket', () => {
  const lock = (overrides) => ticketRepository.findByIdForUpdate.mockResolvedValue(ticketRow(overrides));

  beforeEach(() => {
    ticketRepository.update.mockImplementation(async (_db, _o, _id, changes) => ticketRow({ ...changes }));
    ticketRepository.findDetailById.mockResolvedValue(ticketRow({ status: 'in_progress', assignee_id: 21, assignee_name: 'Bo' }));
    notificationService.createAssignmentNotification.mockResolvedValue({ id: 5 });
  });

  describe('permissions (checked against the locked row)', () => {
    it.each([
      ['admin, ticket assigned to someone else', admin, { assignee_id: 99 }],
      ['agent, ticket assigned to self', agent, { assignee_id: 20 }],
      ['agent, unassigned ticket', agent, { assignee_id: null }],
    ])('allows %s', async (_label, who, row) => {
      lock(row);
      await expect(ticketService.updateTicket(who, 100, { title: 'New' })).resolves.toBeDefined();
      expect(ticketRepository.findByIdForUpdate).toHaveBeenCalledWith(client, 1, 100);
    });

    it.each([
      ["agent, another agent's ticket", agent, { assignee_id: 21 }],
      ['viewer, unassigned ticket', viewer, { assignee_id: null }],
    ])('forbids %s', async (_label, who, row) => {
      lock(row);
      await expect(ticketService.updateTicket(who, 100, { title: 'New' })).rejects.toMatchObject({ statusCode: 403 });
      expect(ticketRepository.update).not.toHaveBeenCalled();
    });
  });

  it('returns 404 for tickets outside the organization', async () => {
    ticketRepository.findByIdForUpdate.mockResolvedValue(null);
    await expect(ticketService.updateTicket(admin, 100, { title: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('treats closed tickets as immutable', async () => {
    lock({ status: 'closed' });
    await expect(ticketService.updateTicket(admin, 100, { status: 'open' }))
      .rejects.toMatchObject({ statusCode: 409, errorCode: 'TICKET_CLOSED' });
  });

  it('detects concurrent modification with the version field', async () => {
    lock({ version: 4 });
    await expect(ticketService.updateTicket(admin, 100, { title: 'x', version: 3 }))
      .rejects.toMatchObject({ statusCode: 409, errorCode: 'STALE_TICKET' });
  });

  it.each([['open', 'closed'], ['in_progress', 'closed'], ['resolved', 'in_progress']])(
    'rejects invalid transition %s -> %s',
    async (from, to) => {
      lock({ status: from });
      await expect(ticketService.updateTicket(admin, 100, { status: to }))
        .rejects.toMatchObject({ statusCode: 400, errorCode: 'INVALID_STATUS_TRANSITION' });
    },
  );

  it('updates only changed fields, reconciles SLA, audits and emits', async () => {
    // Arrange
    lock({ status: 'open', priority: 'medium', title: 'Same' });
    // Act
    await ticketService.updateTicket(admin, 100, {
      title: 'Same', description: 'New desc', status: 'in_progress', priority: 'high', version: 1,
    });
    // Assert
    const changes = ticketRepository.update.mock.calls[0][3];
    expect(changes).toEqual({ description: 'New desc', status: 'in_progress', priority: 'high' });
    expect(slaService.reconcileAfterUpdate).toHaveBeenCalledWith(client, expect.objectContaining({ priority: 'medium' }), expect.objectContaining({ priority: 'high' }));
    expect(audit.record).toHaveBeenCalledWith(client, admin, expect.objectContaining({
      eventType: 'TICKET_UPDATED',
      oldValue: { description: 'Office printer', status: 'open', priority: 'medium' },
      newValue: changes,
    }));
    expect(realtime.emit).toHaveBeenCalledWith([expect.objectContaining({ event: 'ticket:updated' })]);
  });

  it('returns the current ticket without writing when nothing changed', async () => {
    lock({ title: 'Same' });
    await ticketService.updateTicket(admin, 100, { title: 'Same' });
    expect(ticketRepository.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(realtime.emit).not.toHaveBeenCalled();
  });

  it('validates and notifies a new assignee', async () => {
    lock({ assignee_id: null });
    userRepository.findById.mockResolvedValue(staffUser(21));
    await ticketService.updateTicket(agent, 100, { assigneeId: 21 });
    expect(userRepository.findById).toHaveBeenCalledWith(client, 1, 21);
    expect(ticketRepository.update.mock.calls[0][3]).toEqual({ assignee_id: 21 });
    expect(realtime.emit.mock.calls[0][0]).toContainEqual(expect.objectContaining({ room: 'user:21', event: 'notification:created' }));
  });

  it('allows unassigning without an assignee lookup', async () => {
    lock({ assignee_id: 20 });
    await ticketService.updateTicket(agent, 100, { assigneeId: null });
    expect(userRepository.findById).not.toHaveBeenCalled();
    expect(ticketRepository.update.mock.calls[0][3]).toEqual({ assignee_id: null });
    expect(notificationService.createAssignmentNotification).not.toHaveBeenCalled();
  });

  it('rejects an empty update and invalid assignee', async () => {
    await expect(ticketService.updateTicket(admin, 100, { version: 1 })).rejects.toMatchObject({ statusCode: 400 });
    lock({});
    userRepository.findById.mockResolvedValue(userRow({ role: 'viewer' }));
    await expect(ticketService.updateTicket(admin, 100, { assigneeId: 30 })).rejects.toMatchObject({ statusCode: 400 });
  });
});
