'use strict';

jest.mock('../config/database', () => {
  const client = { query: jest.fn() };
  return { pool: { query: jest.fn() }, withTransaction: jest.fn(), client };
});
jest.mock('../utils/password', () => ({ hashPassword: jest.fn() }));
jest.mock('../repositories/organizationRepository');
jest.mock('../repositories/userRepository');
jest.mock('../repositories/ticketRepository');
jest.mock('../repositories/commentRepository');
jest.mock('../repositories/slaRepository');
jest.mock('./slaService', () => ({
  isMonitored: jest.requireActual('./slaService').isMonitored,
  startCycle: jest.fn(),
  registerStaffResponse: jest.fn(),
}));
jest.mock('./auditService', () => ({ AUDIT: jest.requireActual('./auditService').AUDIT, record: jest.fn() }));

const env = require('../config/env');
const { pool, client, withTransaction } = require('../config/database');
const { hashPassword } = require('../utils/password');
const { validate } = require('../utils/validation');
const organizationRepository = require('../repositories/organizationRepository');
const userRepository = require('../repositories/userRepository');
const ticketRepository = require('../repositories/ticketRepository');
const commentRepository = require('../repositories/commentRepository');
const slaRepository = require('../repositories/slaRepository');
const slaService = require('./slaService');
const audit = require('./auditService');
const seed = require('./demoSeedService');

const ALL_USERS = seed.DEMO_ORGANIZATIONS.flatMap((o) => o.users);
const ALL_TICKETS = seed.DEMO_ORGANIZATIONS.flatMap((o) => o.tickets);
const ALL_COMMENTS = ALL_TICKETS.flatMap((t) => t.comments);
const isMonitoredSpec = (t) => ['high', 'urgent'].includes(t.priority) && ['open', 'in_progress'].includes(t.status);

let nextId;
let ticketsById;

beforeEach(() => {
  nextId = 1;
  ticketsById = {};
  withTransaction.mockImplementation((work) => work(client));
  hashPassword.mockResolvedValue('bcrypt-hash');
  userRepository.emailExistsInAnyOrganization.mockResolvedValue(false);
  organizationRepository.create.mockImplementation(async (_db, { name }) => ({ id: nextId++, name }));
  userRepository.create.mockImplementation(async (_db, u) => ({
    id: nextId++, organization_id: u.organizationId, email: u.email, role: u.role,
  }));
  ticketRepository.create.mockImplementation(async (_db, t) => {
    const row = {
      id: nextId++, organization_id: t.organizationId, priority: t.priority, status: 'open', assignee_id: t.assigneeId,
    };
    ticketsById[row.id] = row;
    return row;
  });
  ticketRepository.update.mockImplementation(async (_db, _orgId, id, changes) => {
    ticketsById[id] = { ...ticketsById[id], ...changes };
    return ticketsById[id];
  });
  commentRepository.create.mockImplementation(async () => ({ id: nextId++, created_at: '2026-01-01T00:00:01Z' }));
  slaService.startCycle.mockImplementation(async (_db, _orgId, ticketId) => ({ job: { ticket_id: ticketId, status: 'pending' } }));
});

describe('demo data definition', () => {
  it('uses a password that satisfies the signup password policy', () => {
    // Arrange / Act
    const run = () => validate({ password: seed.DEMO_PASSWORD }).password('password').result();
    // Assert
    expect(run).not.toThrow();
  });

  it('only references users that exist in the same organization', () => {
    seed.DEMO_ORGANIZATIONS.forEach((org) => {
      // Arrange
      const keys = org.users.map((u) => u.key);
      // Act
      const referenced = org.tickets.flatMap((t) => [t.createdBy, t.assignee, ...t.comments.map((c) => c.by)])
        .filter(Boolean);
      // Assert
      expect(keys).toContain('admin');
      referenced.forEach((key) => expect(keys).toContain(key));
    });
  });

  it('includes the marker account and one email shared by two organizations', () => {
    // Arrange / Act
    const emails = ALL_USERS.map((u) => u.email);
    // Assert
    expect(emails).toContain(seed.MARKER_EMAIL);
    expect(emails.filter((e) => e === 'shared@demo.test')).toHaveLength(2);
  });
});

describe('seedDemoData', () => {
  it('refuses to run in production unless explicitly allowed', async () => {
    // Arrange
    jest.replaceProperty(env, 'isProduction', true);
    jest.replaceProperty(env, 'allowDemoSeed', false);
    // Act / Assert
    await expect(seed.seedDemoData()).rejects.toThrow(/ALLOW_DEMO_SEED/);
    expect(userRepository.emailExistsInAnyOrganization).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('runs in production when ALLOW_DEMO_SEED=true', async () => {
    // Arrange
    jest.replaceProperty(env, 'isProduction', true);
    jest.replaceProperty(env, 'allowDemoSeed', true);
    // Act
    const result = await seed.seedDemoData();
    // Assert
    expect(result.created).toBe(true);
  });

  it('does nothing when the demo data already exists', async () => {
    // Arrange
    userRepository.emailExistsInAnyOrganization.mockResolvedValue(true);
    // Act
    const result = await seed.seedDemoData();
    // Assert
    expect(result).toEqual({ created: false, organizations: [] });
    expect(userRepository.emailExistsInAnyOrganization).toHaveBeenCalledWith(pool, seed.MARKER_EMAIL);
    expect(hashPassword).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('creates every organization, SLA default and user inside one transaction with one bcrypt hash', async () => {
    // Act
    const result = await seed.seedDemoData();
    // Assert
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(hashPassword).toHaveBeenCalledWith(seed.DEMO_PASSWORD);
    expect(organizationRepository.create.mock.calls.map(([, o]) => o.name)).toEqual(['Acme Corp', 'Globex Ltd']);
    expect(slaRepository.createDefault).toHaveBeenCalledTimes(2);
    expect(slaRepository.createDefault).toHaveBeenCalledWith(client, expect.any(Number), env.sla.defaultMinutes);
    expect(userRepository.create).toHaveBeenCalledTimes(ALL_USERS.length);
    userRepository.create.mock.calls.forEach(([db, u]) => {
      expect(db).toBe(client);
      expect(u.passwordHash).toBe('bcrypt-hash');
    });
    expect(result.created).toBe(true);
    expect(result.organizations.map((o) => o.name)).toEqual(['Acme Corp', 'Globex Ltd']);
    expect(result.organizations[0].users).toContainEqual({ name: 'Alice Admin', email: 'admin@acme.test', role: 'admin' });
    expect(JSON.stringify(result)).not.toContain(seed.DEMO_PASSWORD);
  });

  it('creates the shared email in two different organizations (login shows the organization picker)', async () => {
    // Act
    await seed.seedDemoData();
    // Assert
    const orgIds = userRepository.create.mock.calls
      .filter(([, u]) => u.email === 'shared@demo.test')
      .map(([, u]) => u.organizationId);
    expect(new Set(orgIds).size).toBe(2);
  });

  it('creates tickets with assignee, status and SLA timers only for monitored tickets', async () => {
    // Act
    await seed.seedDemoData();
    // Assert
    expect(ticketRepository.create).toHaveBeenCalledTimes(ALL_TICKETS.length);
    const unassigned = ticketRepository.create.mock.calls.filter(([, t]) => t.assigneeId === null);
    expect(unassigned).toHaveLength(ALL_TICKETS.filter((t) => !t.assignee).length);
    const statusUpdates = ticketRepository.update.mock.calls.map(([, , , changes]) => changes.status);
    expect(statusUpdates).toEqual(ALL_TICKETS.filter((t) => t.status !== 'open').map((t) => t.status));
    expect(slaService.startCycle).toHaveBeenCalledTimes(ALL_TICKETS.filter(isMonitoredSpec).length);
  });

  it('stores staff comments as SLA responses for the ticket\'s running SLA job', async () => {
    // Act
    await seed.seedDemoData();
    // Assert
    expect(commentRepository.create).toHaveBeenCalledTimes(ALL_COMMENTS.length);
    commentRepository.create.mock.calls.forEach(([, c]) => expect(c.isStaffResponse).toBe(true));
    expect(slaService.registerStaffResponse).toHaveBeenCalledTimes(ALL_COMMENTS.length);
    const withJob = slaService.registerStaffResponse.mock.calls.filter(([, job]) => job !== null);
    expect(withJob).toHaveLength(1); // only the in-progress high ticket has comments AND a timer
    expect(withJob[0][1]).toEqual(expect.objectContaining({ status: 'pending' }));
    expect(withJob[0][2]).toBe('2026-01-01T00:00:01Z');
  });

  it('does not count a non-staff comment as an SLA response', async () => {
    // Arrange
    const organizations = [{
      name: 'Test Org',
      users: [
        { key: 'admin', name: 'A', email: 'a@t.test', role: 'admin' },
        { key: 'viewer', name: 'V', email: 'v@t.test', role: 'viewer' },
      ],
      tickets: [{
        title: 't', description: 'd', priority: 'urgent', status: 'open', assignee: null, createdBy: 'admin',
        comments: [{ by: 'viewer', message: 'hello' }],
      }],
    }];
    // Act
    await seed.seedDemoData({ organizations });
    // Assert
    expect(commentRepository.create).toHaveBeenCalledWith(client, expect.objectContaining({ isStaffResponse: false }));
    expect(slaService.registerStaffResponse).not.toHaveBeenCalled();
  });

  it('writes one DEMO_DATA_SEEDED audit entry per organization, performed by its admin', async () => {
    // Act
    await seed.seedDemoData();
    // Assert
    expect(audit.record).toHaveBeenCalledTimes(seed.DEMO_ORGANIZATIONS.length);
    audit.record.mock.calls.forEach(([db, actor, entry]) => {
      expect(db).toBe(client);
      expect(actor.userId).toEqual(expect.any(Number));
      expect(entry).toEqual(expect.objectContaining({ eventType: 'DEMO_DATA_SEEDED', entityType: 'organization' }));
    });
  });

  it('propagates a failure so the transaction rolls back', async () => {
    // Arrange
    ticketRepository.create.mockRejectedValue(new Error('insert failed'));
    // Act / Assert
    await expect(seed.seedDemoData()).rejects.toThrow('insert failed');
  });
});
