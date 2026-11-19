'use strict';

/**
 * Optional demo data for local testing and demos: `npm run seed:demo`.
 *
 * Creates two organizations with a user for every role, tickets in every status,
 * staff comments and live SLA timers - all in ONE transaction (all or nothing).
 *  - Idempotent: does nothing when the demo admin account already exists.
 *  - Blocked when NODE_ENV=production (the demo password is public) unless
 *    ALLOW_DEMO_SEED=true is set explicitly.
 * It uses the same repositories and SLA rules as the API, so the data behaves like real data.
 */
const env = require('../config/env');
const { pool, withTransaction } = require('../config/database');
const { hashPassword } = require('../utils/password');
const { STAFF_ROLES } = require('../constants/roles');
const { TICKET_STATUS } = require('../constants/ticketStatus');
const organizationRepository = require('../repositories/organizationRepository');
const userRepository = require('../repositories/userRepository');
const ticketRepository = require('../repositories/ticketRepository');
const commentRepository = require('../repositories/commentRepository');
const slaRepository = require('../repositories/slaRepository');
const slaService = require('./slaService');
const audit = require('./auditService');

/** Public on purpose (documented in README). Never seed it into a real deployment. */
const DEMO_PASSWORD = 'Demo@1234';
/** If this account exists, the demo data is considered already seeded. */
const MARKER_EMAIL = 'admin@acme.test';

const DEMO_ORGANIZATIONS = Object.freeze([
  {
    name: 'Acme Corp',
    users: [
      { key: 'admin', name: 'Alice Admin', email: 'admin@acme.test', role: 'admin' },
      { key: 'agent', name: 'Andy Agent', email: 'agent@acme.test', role: 'agent' },
      { key: 'agent2', name: 'Bella Agent', email: 'agent2@acme.test', role: 'agent' },
      { key: 'viewer', name: 'Victor Viewer', email: 'viewer@acme.test', role: 'viewer' },
      { key: 'shared', name: 'Sam Shared', email: 'shared@demo.test', role: 'agent' },
    ],
    tickets: [
      {
        title: 'Customer portal login fails with error 500',
        description: 'Since this morning several customers get "500 Internal Server Error" after entering their password on the portal.',
        priority: 'urgent', status: 'open', assignee: 'agent', createdBy: 'admin', comments: [],
      },
      {
        title: 'Invoice PDF shows the wrong VAT amount',
        description: 'Invoices for EU customers show 18% VAT instead of 20%. Example: invoice INV-2026-0142.',
        priority: 'high', status: 'in_progress', assignee: 'agent', createdBy: 'admin',
        comments: [
          { by: 'agent', message: 'Reproduced on staging. The tax rate is read from an old settings table - working on a fix.' },
        ],
      },
      {
        title: 'CSV export times out for large reports',
        description: 'Exporting the yearly sales report (about 200k rows) to CSV stops after 30 seconds with a timeout.',
        priority: 'high', status: 'open', assignee: null, createdBy: 'agent2', comments: [],
      },
      {
        title: 'Password reset email not received',
        description: 'A customer requested a password reset three times but no email arrived (spam folder checked).',
        priority: 'medium', status: 'resolved', assignee: 'agent2', createdBy: 'agent',
        comments: [
          { by: 'agent2', message: 'The address was on the bounce list. Removed it and the reset email arrived.' },
        ],
      },
      {
        title: 'Add a dark mode to the dashboard',
        description: 'Feature request from several users who work night shifts.',
        priority: 'low', status: 'open', assignee: null, createdBy: 'agent2', comments: [],
      },
      {
        title: 'Update the company logo on the login page',
        description: 'Marketing sent the new logo. Please replace the old one on the login page.',
        priority: 'low', status: 'closed', assignee: 'agent2', createdBy: 'admin',
        comments: [
          { by: 'agent2', message: 'Logo replaced and deployed.' },
          { by: 'admin', message: 'Looks good, closing.' },
        ],
      },
    ],
  },
  {
    name: 'Globex Ltd',
    users: [
      { key: 'admin', name: 'Grace Admin', email: 'admin@globex.test', role: 'admin' },
      { key: 'shared', name: 'Sam Shared', email: 'shared@demo.test', role: 'viewer' },
    ],
    tickets: [
      {
        title: 'VPN disconnects every hour',
        description: 'Remote staff lose the VPN connection roughly every 60 minutes and must reconnect manually.',
        priority: 'medium', status: 'open', assignee: 'admin', createdBy: 'admin', comments: [],
      },
    ],
  },
]);

function assertSeedingAllowed() {
  if (env.isProduction && !env.allowDemoSeed) {
    throw new Error(
      'Refusing to seed demo data with NODE_ENV=production (the demo password is public). '
      + 'Set ALLOW_DEMO_SEED=true to override.',
    );
  }
}

async function createUsers(client, organizationId, users, passwordHash) {
  const byKey = {};
  for (const user of users) {
    byKey[user.key] = await userRepository.create(client, {
      organizationId, name: user.name, email: user.email, passwordHash, role: user.role,
    });
  }
  return byKey;
}

/** Staff comments count as SLA responses, exactly like comments made through the API. */
async function addComments(client, ticket, comments, usersByKey, job) {
  for (const spec of comments) {
    const author = usersByKey[spec.by];
    const isStaff = STAFF_ROLES.includes(author.role);
    const comment = await commentRepository.create(client, {
      organizationId: ticket.organization_id,
      ticketId: ticket.id,
      userId: author.id,
      message: spec.message,
      isStaffResponse: isStaff,
    });
    if (isStaff) await slaService.registerStaffResponse(client, job, comment.created_at);
  }
}

async function createTicket(client, organizationId, spec, usersByKey) {
  let ticket = await ticketRepository.create(client, {
    organizationId,
    title: spec.title,
    description: spec.description,
    priority: spec.priority,
    assigneeId: spec.assignee ? usersByKey[spec.assignee].id : null,
    createdBy: usersByKey[spec.createdBy].id,
  });
  if (spec.status !== TICKET_STATUS.OPEN) {
    ticket = await ticketRepository.update(client, organizationId, ticket.id, { status: spec.status });
  }
  // High/urgent tickets that are still open get a real SLA timer (org default minutes).
  const job = slaService.isMonitored(ticket)
    ? (await slaService.startCycle(client, organizationId, ticket.id)).job
    : null;
  await addComments(client, ticket, spec.comments, usersByKey, job);
  return ticket;
}

async function seedOrganization(client, spec, passwordHash) {
  const org = await organizationRepository.create(client, { name: spec.name });
  await slaRepository.createDefault(client, org.id, env.sla.defaultMinutes);
  const usersByKey = await createUsers(client, org.id, spec.users, passwordHash);
  for (const ticket of spec.tickets) await createTicket(client, org.id, ticket, usersByKey);

  await audit.record(client, { organizationId: org.id, userId: usersByKey.admin.id }, {
    eventType: audit.AUDIT.DEMO_DATA_SEEDED,
    entityType: 'organization',
    entityId: org.id,
    newValue: { users: spec.users.length, tickets: spec.tickets.length },
  });
  return {
    id: org.id,
    name: org.name,
    tickets: spec.tickets.length,
    users: spec.users.map(({ name, email, role }) => ({ name, email, role })),
  };
}

/**
 * Seeds the demo organizations. Returns { created: false } when they already exist.
 * `organizations` is injectable for tests; production code uses DEMO_ORGANIZATIONS.
 */
async function seedDemoData({ organizations = DEMO_ORGANIZATIONS } = {}) {
  assertSeedingAllowed();
  if (await userRepository.emailExistsInAnyOrganization(pool, MARKER_EMAIL)) {
    return { created: false, organizations: [] };
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const created = await withTransaction(async (client) => {
    const result = [];
    for (const spec of organizations) result.push(await seedOrganization(client, spec, passwordHash));
    return result;
  });
  return { created: true, organizations: created };
}

module.exports = {
  seedDemoData, DEMO_ORGANIZATIONS, DEMO_PASSWORD, MARKER_EMAIL,
};
