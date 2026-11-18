'use strict';

jest.mock('../config/database', () => {
  const client = { query: jest.fn() };
  return { pool: { query: jest.fn() }, withTransaction: jest.fn((work) => work(client)), client };
});
jest.mock('../repositories/notificationRepository');
jest.mock('../repositories/userRepository');
jest.mock('../repositories/slaRepository');
jest.mock('../repositories/auditRepository');

const { pool, client } = require('../config/database');
const notificationRepository = require('../repositories/notificationRepository');
const userRepository = require('../repositories/userRepository');
const slaRepository = require('../repositories/slaRepository');
const auditRepository = require('../repositories/auditRepository');
const notificationService = require('./notificationService');
const settingsService = require('./settingsService');
const audit = require('./auditService');
const { toTicketDto, toListItemDto } = require('./ticketMapper');
const { ctx, ticketRow } = require('../testUtils/factories');

describe('notificationService', () => {
  const user = ctx({ userId: 30, role: 'viewer' });

  it('lists the caller own notifications with unread state and pagination', async () => {
    // Arrange
    notificationRepository.listForUser.mockResolvedValue({
      rows: [
        { id: 1, ticket_id: 100, type: 'sla_overdue', message: 'm', created_at: 'c', read_at: null, unread: true },
        { id: 2, ticket_id: 101, type: 'ticket_assigned', message: 'n', created_at: 'c', read_at: 'r' },
      ],
      total: 12,
      unreadCount: 4,
    });
    // Act
    const result = await notificationService.list(user, { page: '2', limit: '5', unreadOnly: 'true' });
    // Assert
    expect(notificationRepository.listForUser).toHaveBeenCalledWith(pool, 1, 30, { limit: 5, offset: 5, unreadOnly: true });
    expect(result.items.map((n) => n.unread)).toEqual([true, false]);
    expect(result.unreadCount).toBe(4);
    expect(result.pagination).toEqual({
      page: 2, limit: 5, total: 12, totalPages: 3,
    });
  });

  it('uses defaults and rejects invalid paging', async () => {
    notificationRepository.listForUser.mockResolvedValue({ rows: [], total: 0, unreadCount: 0 });
    expect((await notificationService.list(user, {})).pagination).toEqual({
      page: 1, limit: 10, total: 0, totalPages: 1,
    });
    await expect(notificationService.list(user, { limit: '0' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('marks a notification read only for its recipient', async () => {
    notificationRepository.markRead.mockResolvedValue({ notification_id: 1, read_at: 'r' });
    expect(await notificationService.markRead(user, 1)).toEqual({ id: 1, readAt: 'r' });
    expect(notificationRepository.markRead).toHaveBeenCalledWith(pool, 1, 30, 1);
  });

  it('returns 404 when the notification is not the caller own (or other org)', async () => {
    notificationRepository.markRead.mockResolvedValue(null);
    await expect(notificationService.markRead(user, 1)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('marks all read', async () => {
    notificationRepository.markAllRead.mockResolvedValue(3);
    expect(await notificationService.markAllRead(user)).toEqual({ updated: 3 });
  });

  it('creates one overdue notification per ticket+cycle for all active members', async () => {
    // Arrange
    notificationRepository.createIfAbsent.mockResolvedValue({ id: 9, ticket_id: 100, type: 'sla_overdue', message: 'm' });
    userRepository.listActiveIds.mockResolvedValue([10, 20, 30]);
    // Act
    const dto = await notificationService.createOverdueNotification(client, ticketRow({ priority: 'urgent' }), 2);
    // Assert
    expect(notificationRepository.createIfAbsent).toHaveBeenCalledWith(client, expect.objectContaining({
      organizationId: 1, ticketId: 100, type: 'sla_overdue', dedupeKey: 'sla_overdue:100:2',
    }));
    expect(notificationRepository.addRecipients).toHaveBeenCalledWith(client, 1, 9, [10, 20, 30]);
    expect(dto).toEqual(expect.objectContaining({ id: 9, ticketId: 100, unread: true }));
  });

  it('does nothing when the overdue notification already exists (idempotent)', async () => {
    notificationRepository.createIfAbsent.mockResolvedValue(null);
    expect(await notificationService.createOverdueNotification(client, ticketRow(), 1)).toBeNull();
    expect(notificationRepository.addRecipients).not.toHaveBeenCalled();
  });

  it('creates an assignment notification for the assignee only', async () => {
    notificationRepository.createIfAbsent.mockResolvedValue({ id: 4, ticket_id: 100, type: 'ticket_assigned', message: 'x' });
    await notificationService.createAssignmentNotification(client, ticketRow(), 21, 'Alice');
    expect(notificationRepository.createIfAbsent.mock.calls[0][1].message).toBe('Alice assigned ticket #100 "Printer down" to you.');
    expect(notificationRepository.addRecipients).toHaveBeenCalledWith(client, 1, 4, [21]);
  });
});

describe('settingsService', () => {
  const admin = ctx();

  it('returns the organization SLA or the default when unset', async () => {
    slaRepository.findByOrganization.mockResolvedValueOnce({ response_time_minutes: 15, updated_at: 'u' }).mockResolvedValueOnce(null);
    expect(await settingsService.getSla(admin)).toEqual({ responseTimeMinutes: 15, updatedAt: 'u', monitoredPriorities: ['high', 'urgent'] });
    expect((await settingsService.getSla(admin)).responseTimeMinutes).toBe(5);
  });

  it('updates the SLA in a transaction and audits old/new values', async () => {
    slaRepository.findByOrganizationForUpdate.mockResolvedValue({ response_time_minutes: 5 });
    slaRepository.upsert.mockResolvedValue({ response_time_minutes: 30, updated_at: 'u' });
    const result = await settingsService.updateSla(admin, { responseTimeMinutes: '30' });
    expect(slaRepository.upsert).toHaveBeenCalledWith(client, 1, 30);
    expect(auditRepository.insert).toHaveBeenCalledWith(client, expect.objectContaining({
      eventType: 'SLA_SETTINGS_UPDATED', oldValue: { responseTimeMinutes: 5 }, newValue: { responseTimeMinutes: 30 },
    }));
    expect(result.responseTimeMinutes).toBe(30);
  });

  it('audits a null old value when no settings row existed', async () => {
    slaRepository.findByOrganizationForUpdate.mockResolvedValue(null);
    slaRepository.upsert.mockResolvedValue({ response_time_minutes: 3 });
    await settingsService.updateSla(admin, { responseTimeMinutes: 3 });
    expect(auditRepository.insert.mock.calls[0][1].oldValue).toEqual({ responseTimeMinutes: null });
  });

  it.each([[0], [-5], [1.5], ['abc'], [43201]])('rejects %p', async (value) => {
    await expect(settingsService.updateSla(admin, { responseTimeMinutes: value })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('auditService', () => {
  it('maps the request context onto the audit row', async () => {
    await audit.record(client, { organizationId: 1, userId: 10, ip: '1.1.1.1' }, {
      eventType: 'X', entityType: 'ticket', entityId: 5, oldValue: { a: 1 }, newValue: { a: 2 },
    });
    expect(auditRepository.insert).toHaveBeenCalledWith(client, {
      organizationId: 1, eventType: 'X', entityType: 'ticket', entityId: 5, performedBy: 10, oldValue: { a: 1 }, newValue: { a: 2 }, ipAddress: '1.1.1.1',
    });
  });

  it('records system / anonymous events with nulls', async () => {
    await audit.record(client, {}, { eventType: 'SLA_BREACHED', entityType: 'ticket' });
    expect(auditRepository.insert).toHaveBeenCalledWith(client, expect.objectContaining({
      organizationId: null, performedBy: null, ipAddress: null, entityId: null,
    }));
  });
});

describe('ticketMapper', () => {
  it('maps a full ticket without leaking raw columns', () => {
    const dto = toTicketDto(ticketRow({ assignee_id: 21, assignee_name: 'Bo', assignee_email: 'bo@x.io', assignee_active: true }));
    expect(dto.assignee).toEqual({
      id: 21, name: 'Bo', email: 'bo@x.io', active: true,
    });
    expect(dto).not.toHaveProperty('organization_id');
  });

  it('maps list items with and without assignee', () => {
    expect(toListItemDto(ticketRow()).assignee).toBeNull();
    expect(toListItemDto(ticketRow({ assignee_id: 2, assignee_name: 'X' })).assignee).toEqual({ id: 2, name: 'X' });
  });
});
