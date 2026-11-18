'use strict';

/**
 * Repository tests use a fake pg client. They verify the most important property of
 * the data layer: every business query is parameterised AND scoped by organization_id.
 */
const organizationRepository = require('./organizationRepository');
const userRepository = require('./userRepository');
const invitationRepository = require('./invitationRepository');
const ticketRepository = require('./ticketRepository');
const commentRepository = require('./commentRepository');
const notificationRepository = require('./notificationRepository');
const slaRepository = require('./slaRepository');
const jobRepository = require('./jobRepository');
const auditRepository = require('./auditRepository');
const { fakeDb, rows } = require('../testUtils/factories');

const ORG = 41;
const lastCall = (db) => db.query.mock.calls[db.query.mock.calls.length - 1];

/** Asserts the SQL filters by organization_id bound as $1 and ORG is the first parameter. */
function expectOrgScoped(db) {
  db.query.mock.calls.forEach(([sql, params]) => {
    expect(sql).toMatch(/organization_id\s*=\s*\$1/);
    expect(params[0]).toBe(ORG);
  });
}

describe('tenant scoping of every org-level query', () => {
  const cases = [
    ['userRepository.reactivate', (db) => userRepository.reactivate(db, {
      organizationId: ORG, userId: 1, name: 'n', passwordHash: 'h', role: 'agent',
    })],
    ['userRepository.findAuthContext', (db) => userRepository.findAuthContext(db, ORG, 1)],
    ['userRepository.findById', (db) => userRepository.findById(db, ORG, 1)],
    ['userRepository.findByIdForUpdate', (db) => userRepository.findByIdForUpdate(db, ORG, 1)],
    ['userRepository.findByEmail', (db) => userRepository.findByEmail(db, ORG, 'a@b.io')],
    ['userRepository.listActive', (db) => userRepository.listActive(db, ORG)],
    ['userRepository.listActiveIds', (db) => userRepository.listActiveIds(db, ORG)],
    ['userRepository.lockActiveAdmins', (db) => userRepository.lockActiveAdmins(db, ORG)],
    ['userRepository.updateRole', (db) => userRepository.updateRole(db, ORG, 1, 'agent')],
    ['userRepository.deactivate', (db) => userRepository.deactivate(db, ORG, 1)],
    ['invitationRepository.revokeOpenByEmail', (db) => invitationRepository.revokeOpenByEmail(db, ORG, 'a@b.io')],
    ['invitationRepository.revoke', (db) => invitationRepository.revoke(db, ORG, 1)],
    ['invitationRepository.listPending', (db) => invitationRepository.listPending(db, ORG)],
    ['invitationRepository.markAccepted', (db) => invitationRepository.markAccepted(db, ORG, 1)],
    ['ticketRepository.findDetailById', (db) => ticketRepository.findDetailById(db, ORG, 1)],
    ['ticketRepository.findByIdForUpdate', (db) => ticketRepository.findByIdForUpdate(db, ORG, 1)],
    ['ticketRepository.findByIdForUpdateSkipLocked', (db) => ticketRepository.findByIdForUpdateSkipLocked(db, ORG, 1)],
    ['ticketRepository.update', (db) => ticketRepository.update(db, ORG, 1, { title: 't' })],
    ['ticketRepository.touch', (db) => ticketRepository.touch(db, ORG, 1)],
    ['ticketRepository.markOverdue', (db) => ticketRepository.markOverdue(db, ORG, 1)],
    ['ticketRepository.unassignAllForUser', (db) => ticketRepository.unassignAllForUser(db, ORG, 1)],
    ['ticketRepository.stats', (db) => ticketRepository.stats(db, ORG)],
    ['commentRepository.findById', (db) => commentRepository.findById(db, ORG, 1)],
    ['commentRepository.listByTicket', (db) => commentRepository.listByTicket(db, ORG, 1)],
    ['commentRepository.hasStaffResponseBetween', (db) => commentRepository.hasStaffResponseBetween(db, ORG, 1, 'a', 'b')],
    ['notificationRepository.markRead', (db) => notificationRepository.markRead(db, ORG, 1, 2)],
    ['notificationRepository.markAllRead', (db) => notificationRepository.markAllRead(db, ORG, 1)],
    ['slaRepository.findByOrganization', (db) => slaRepository.findByOrganization(db, ORG)],
    ['slaRepository.findByOrganizationForUpdate', (db) => slaRepository.findByOrganizationForUpdate(db, ORG)],
    ['jobRepository.findByTicketForUpdate', (db) => jobRepository.findByTicketForUpdate(db, ORG, 1)],
    ['jobRepository.finishIfPending', (db) => jobRepository.finishIfPending(db, ORG, 1, 'cancelled')],
  ];

  it.each(cases)('%s filters by organization_id', async (_name, call) => {
    // Arrange
    const db = fakeDb(rows({ found: false, total: 0, id: 1 }));
    // Act
    await call(db);
    // Assert
    expectOrgScoped(db);
  });
});

describe('organization / user repositories', () => {
  it('creates an organization', async () => {
    const db = fakeDb(rows({ id: 1, name: 'A' }));
    expect(await organizationRepository.create(db, { name: 'A' })).toEqual({ id: 1, name: 'A' });
    expect(lastCall(db)[1]).toEqual(['A']);
  });

  it('finds an organization or null', async () => {
    expect(await organizationRepository.findById(fakeDb(rows({ id: 1 })), 1)).toEqual({ id: 1 });
    expect(await organizationRepository.findById(fakeDb(), 1)).toBeNull();
  });

  it('creates users with bound parameters only', async () => {
    const db = fakeDb(rows({ id: 2 }));
    await userRepository.create(db, {
      organizationId: ORG, name: "O'Brien", email: 'o@b.io', passwordHash: 'h', role: 'admin',
    });
    const [sql, params] = lastCall(db);
    expect(sql).not.toContain("O'Brien");
    expect(params).toEqual([ORG, "O'Brien", 'o@b.io', 'h', 'admin']);
  });

  it('only exposes password_hash through the login lookup', async () => {
    const db = fakeDb(rows());
    await userRepository.findById(db, ORG, 1);
    await userRepository.listActive(db, ORG);
    db.query.mock.calls.forEach(([sql]) => expect(sql).not.toContain('password_hash'));
    await userRepository.findActiveCredentialsByEmail(db, 'a@b.io');
    expect(lastCall(db)[0]).toContain('password_hash');
    expect(lastCall(db)[0]).toContain('u.is_active');
  });

  it('deactivation bumps token_version (revokes JWTs)', async () => {
    const db = fakeDb(rows({ id: 1 }));
    await userRepository.deactivate(db, ORG, 1);
    expect(lastCall(db)[0]).toMatch(/token_version = u\.token_version \+ 1/);
  });

  it('maps id lists', async () => {
    expect(await userRepository.listActiveIds(fakeDb(rows({ id: 1 }, { id: 2 })), ORG)).toEqual([1, 2]);
    expect(await userRepository.lockActiveAdmins(fakeDb(rows({ id: 3 })), ORG)).toEqual([3]);
  });

  it('returns null when an update matched nothing', async () => {
    expect(await userRepository.updateRole(fakeDb(), ORG, 1, 'agent')).toBeNull();
    expect(await userRepository.reactivate(fakeDb(), {})).toBeNull();
    expect(await userRepository.findAuthContext(fakeDb(), ORG, 1)).toBeNull();
    expect(await userRepository.findByEmail(fakeDb(), ORG, 'x')).toBeNull();
    expect(await userRepository.findByIdForUpdate(fakeDb(), ORG, 1)).toBeNull();
    expect(await userRepository.deactivate(fakeDb(), ORG, 1)).toBeNull();
  });
});

describe('invitationRepository', () => {
  it('stores the token hash, never a raw token column', async () => {
    const db = fakeDb(rows({ id: 1 }));
    await invitationRepository.create(db, {
      organizationId: ORG, name: 'n', email: 'e', role: 'agent', tokenHash: 'abc', expiresAt: 'x', invitedBy: 1,
    });
    expect(lastCall(db)[0]).toContain('token_hash');
    expect(lastCall(db)[1]).toContain('abc');
  });

  it('looks up valid tokens with optional row lock', async () => {
    const db = fakeDb(rows({ id: 1 }), rows());
    expect(await invitationRepository.findValidByTokenHash(db, 'h', { forUpdate: true })).toEqual({ id: 1 });
    expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE OF i');
    expect(db.query.mock.calls[0][0]).toMatch(/expires_at > NOW\(\)/);
    expect(await invitationRepository.findValidByTokenHash(db, 'h')).toBeNull();
    expect(db.query.mock.calls[1][0]).not.toContain('FOR UPDATE');
  });

  it('returns revoke row count / null', async () => {
    expect(await invitationRepository.revokeOpenByEmail(fakeDb({ rowCount: 2 }), ORG, 'e')).toBe(2);
    expect(await invitationRepository.revoke(fakeDb(), ORG, 1)).toBeNull();
  });
});

describe('ticketRepository', () => {
  it('buildFilters only concatenates whitelisted columns; values are bound', () => {
    // Act
    const { where, params } = ticketRepository.buildFilters(ORG, {
      status: "open'; DROP TABLE tickets;--", priority: 'high', assigneeId: 5, overdue: true, search: '50%_off\\',
    });
    // Assert
    expect(where).toBe("t.organization_id = $1 AND t.status = $2 AND t.priority = $3 AND t.assignee_id = $4 AND t.overdue = $5 AND (t.title ILIKE $6 ESCAPE '\\')");
    expect(where).not.toContain('DROP');
    expect(params).toEqual([ORG, "open'; DROP TABLE tickets;--", 'high', 5, true, '%50\\%\\_off\\\\%']);
  });

  it('buildFilters supports unassigned and no filters', () => {
    expect(ticketRepository.buildFilters(ORG, { assigneeId: 'unassigned' }).where).toBe('t.organization_id = $1 AND t.assignee_id IS NULL');
    expect(ticketRepository.buildFilters(ORG, {})).toEqual({ where: 't.organization_id = $1', params: [ORG] });
  });

  it('list counts and pages with bound limit/offset', async () => {
    const db = fakeDb(rows({ total: 7 }), rows({ id: 1 }));
    const result = await ticketRepository.list(db, ORG, { status: 'open' }, { limit: 10, offset: 20 });
    expect(result).toEqual({ rows: [{ id: 1 }], total: 7 });
    expect(db.query.mock.calls[1][0]).toContain('LIMIT $3 OFFSET $4');
    expect(db.query.mock.calls[1][1]).toEqual([ORG, 'open', 10, 20]);
  });

  it('update ignores non-whitelisted columns and bumps version', async () => {
    const db = fakeDb(rows({ id: 1 }));
    await ticketRepository.update(db, ORG, 1, { title: 't', organization_id: 2, 'id = 1; --': 'x' });
    const [sql, params] = lastCall(db);
    expect(sql).toContain('SET title = $3, version = version + 1');
    expect(sql.split('WHERE')[0]).not.toContain('organization_id'); // tenant column is never updatable
    expect(params).toEqual([ORG, 1, 't']);
  });

  it('create binds every value', async () => {
    const db = fakeDb(rows({ id: 1 }));
    await ticketRepository.create(db, {
      organizationId: ORG, title: 't', description: 'd', priority: 'low', assigneeId: null, createdBy: 2,
    });
    expect(lastCall(db)[1]).toEqual([ORG, 't', 'd', 'low', null, 2]);
  });

  it('maps unassigned ids and nulls', async () => {
    expect(await ticketRepository.unassignAllForUser(fakeDb(rows({ id: 4 })), ORG, 1)).toEqual([4]);
    expect(await ticketRepository.findDetailById(fakeDb(), ORG, 1)).toBeNull();
    expect(await ticketRepository.findByIdForUpdate(fakeDb(), ORG, 1)).toBeNull();
    expect(await ticketRepository.findByIdForUpdateSkipLocked(fakeDb(), ORG, 1)).toBeNull();
    expect(await ticketRepository.update(fakeDb(), ORG, 1, {})).toBeNull();
    expect(await ticketRepository.markOverdue(fakeDb(), ORG, 1)).toBeNull();
  });

  it('the worker lock never waits', async () => {
    const db = fakeDb(rows({ id: 1 }));
    await ticketRepository.findByIdForUpdateSkipLocked(db, ORG, 1);
    expect(lastCall(db)[0]).toContain('FOR UPDATE SKIP LOCKED');
  });
});

describe('commentRepository', () => {
  it('inserts with the DB clock and returns the comment with author', async () => {
    const db = fakeDb(rows({ id: 9 }), rows({ id: 9, author_name: 'A' }));
    const result = await commentRepository.create(db, {
      organizationId: ORG, ticketId: 1, userId: 2, message: 'm', isStaffResponse: true,
    });
    expect(db.query.mock.calls[0][0]).toContain('clock_timestamp()');
    expect(result).toEqual({ id: 9, author_name: 'A' });
    expect(await commentRepository.findById(fakeDb(), ORG, 1)).toBeNull();
  });

  it('checks staff responses inside the window', async () => {
    expect(await commentRepository.hasStaffResponseBetween(fakeDb(rows({ found: true })), ORG, 1, 'a', 'b')).toBe(true);
  });
});

describe('notificationRepository', () => {
  it('creates idempotently via the dedupe constraint', async () => {
    const db = fakeDb(rows());
    expect(await notificationRepository.createIfAbsent(db, {
      organizationId: ORG, ticketId: 1, type: 't', message: 'm', dedupeKey: 'k',
    })).toBeNull();
    expect(lastCall(db)[0]).toContain('ON CONFLICT ON CONSTRAINT uq_notifications_dedupe DO NOTHING');
    expect(await notificationRepository.createIfAbsent(fakeDb(rows({ id: 1 })), { organizationId: ORG })).toEqual({ id: 1 });
  });

  it('adds only active same-org recipients and skips empty lists', async () => {
    const db = fakeDb({ rowCount: 2 });
    expect(await notificationRepository.addRecipients(db, ORG, 1, [1, 2])).toBe(2);
    expect(lastCall(db)[0]).toMatch(/u\.organization_id = \$1 AND u\.id = ANY\(\$3::int\[\]\) AND u\.is_active/);
    const empty = fakeDb();
    expect(await notificationRepository.addRecipients(empty, ORG, 1, [])).toBe(0);
    expect(empty.query).not.toHaveBeenCalled();
  });

  it('lists a user own notifications (org + user scoped), optionally unread only', async () => {
    const db = fakeDb(rows({ total: 3 }), rows({ unread: 1 }), rows({ id: 1 }));
    const result = await notificationRepository.listForUser(db, ORG, 5, { limit: 10, offset: 0, unreadOnly: true });
    expect(result).toEqual({ rows: [{ id: 1 }], total: 3, unreadCount: 1 });
    db.query.mock.calls.forEach(([sql, params]) => {
      expect(sql).toMatch(/organization_id = \$1 AND (r\.)?user_id = \$2/);
      expect(params.slice(0, 2)).toEqual([ORG, 5]);
    });
    expect(db.query.mock.calls[0][0]).toContain('r.read_at IS NULL');
    const all = fakeDb(rows({ total: 0 }), rows({ unread: 0 }), rows());
    await notificationRepository.listForUser(all, ORG, 5, { limit: 10, offset: 0, unreadOnly: false });
    expect(all.query.mock.calls[0][0]).not.toContain('r.read_at IS NULL');
  });

  it('markRead / markAllRead return results', async () => {
    expect(await notificationRepository.markRead(fakeDb(rows({ notification_id: 1 })), ORG, 1, 1)).toEqual({ notification_id: 1 });
    expect(await notificationRepository.markAllRead(fakeDb({ rowCount: 4 }), ORG, 1)).toBe(4);
  });
});

describe('slaRepository', () => {
  it('creates defaults, finds and upserts settings', async () => {
    expect(await slaRepository.createDefault(fakeDb(rows({ organization_id: ORG })), ORG, 5)).toEqual({ organization_id: ORG });
    expect(await slaRepository.createDefault(fakeDb(), ORG, 5)).toBeNull();
    expect(await slaRepository.findByOrganization(fakeDb(), ORG)).toBeNull();
    expect(await slaRepository.findByOrganizationForUpdate(fakeDb(rows({ a: 1 })), ORG)).toEqual({ a: 1 });
    const db = fakeDb(rows({ response_time_minutes: 9 }));
    expect(await slaRepository.upsert(db, ORG, 9)).toEqual({ response_time_minutes: 9 });
    expect(lastCall(db)[1]).toEqual([ORG, 9]);
  });
});

describe('jobRepository', () => {
  it('arms/re-arms a cycle using the DB clock', async () => {
    const db = fakeDb(rows({ id: 1, cycle: 2 }));
    expect(await jobRepository.arm(db, ORG, 1, 5)).toEqual({ id: 1, cycle: 2 });
    const [sql, params] = lastCall(db);
    expect(sql).toContain('cycle = sla_jobs.cycle + 1');
    expect(sql).toContain('make_interval(mins => $3)');
    expect(params).toEqual([ORG, 1, 5]);
  });

  it('claims one due job with SKIP LOCKED, excluding skipped ids', async () => {
    const db = fakeDb(rows({ id: 3 }));
    expect(await jobRepository.claimNextDue(db, [1, 2])).toEqual({ id: 3 });
    const [sql, params] = lastCall(db);
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("status = 'pending' AND scheduled_at <= NOW()");
    expect(params).toEqual([[1, 2]]);
    expect(await jobRepository.claimNextDue(fakeDb())).toBeNull();
  });

  it('only finishes pending jobs', async () => {
    const db = fakeDb();
    expect(await jobRepository.finishIfPending(db, ORG, 1, 'completed')).toBeNull();
    expect(lastCall(db)[0]).toContain("status = 'pending'");
    await jobRepository.markProcessed(db, 1, 'overdue');
    expect(lastCall(db)).toEqual([expect.stringContaining("status = 'pending'"), [1, 'overdue']]);
  });

  it('records failures and finds jobs', async () => {
    const db = fakeDb();
    await jobRepository.recordFailure(db, 1, 'boom');
    expect(lastCall(db)[1]).toEqual([1, 'boom']);
    expect(await jobRepository.findByTicketForUpdate(fakeDb(rows({ id: 1 })), ORG, 1)).toEqual({ id: 1 });
  });
});

describe('auditRepository', () => {
  it('serialises old/new values to JSON and keeps nulls', async () => {
    const db = fakeDb();
    await auditRepository.insert(db, {
      organizationId: ORG, eventType: 'E', entityType: 't', entityId: 1, performedBy: 2, oldValue: { a: 1 }, newValue: null, ipAddress: 'ip',
    });
    expect(lastCall(db)[1]).toEqual([ORG, 'E', 't', 1, 2, '{"a":1}', null, 'ip']);
    await auditRepository.insert(db, { eventType: 'E', entityType: 't' });
    expect(lastCall(db)[1]).toEqual([null, 'E', 't', null, null, null, null, null]);
  });
});
