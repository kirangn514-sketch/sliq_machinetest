'use strict';

/**
 * Shared test helpers (only used by *.test.js files; excluded from the Docker image).
 */

/** Fake pg client/pool: queue results with `mockResult`, inspect `query.mock.calls`. */
function fakeDb(...results) {
  const query = jest.fn();
  results.forEach((r) => query.mockResolvedValueOnce(r));
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  return { query };
}

const rows = (...r) => ({ rows: r, rowCount: r.length });

const ctx = (overrides = {}) => Object.freeze({
  organizationId: 1, userId: 10, role: 'admin', name: 'Alice', ip: '127.0.0.1', ...overrides,
});

function ticketRow(overrides = {}) {
  return {
    id: 100,
    organization_id: 1,
    title: 'Printer down',
    description: 'Office printer',
    status: 'open',
    priority: 'medium',
    assignee_id: null,
    created_by: 10,
    overdue: false,
    sla_due_at: null,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    creator_name: 'Alice',
    creator_email: 'alice@example.com',
    assignee_name: null,
    assignee_email: null,
    assignee_active: null,
    sla_job_status: null,
    sla_scheduled_at: null,
    sla_cycle: null,
    sla_started_at: null,
    sla_processed_at: null,
    ...overrides,
  };
}

function userRow(overrides = {}) {
  return {
    id: 10,
    organization_id: 1,
    name: 'Alice',
    email: 'alice@example.com',
    role: 'admin',
    is_active: true,
    token_version: 0,
    organization_name: 'Org A',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Minimal Express req/res/next doubles. */
function httpDoubles({
  body = {}, params = {}, query = {}, cookies = {}, headers = {}, method = 'GET', user, ctx: c,
} = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = {
    body, params, query, cookies, method, user, ctx: c, ip: '127.0.0.1', originalUrl: '/test',
    get: (name) => lower[name.toLowerCase()],
  };
  const res = {
    statusCode: 200,
    body: undefined,
    status: jest.fn(function status(code) { this.statusCode = code; return this; }),
    json: jest.fn(function json(payload) { this.body = payload; return this; }),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

/** Temporarily sets env vars while fn runs (restores only the touched keys). */
function withEnv(overrides, fn) {
  const saved = {};
  Object.keys(overrides).forEach((k) => { saved[k] = process.env[k]; process.env[k] = overrides[k]; });
  try {
    return fn();
  } finally {
    Object.entries(saved).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
}

module.exports = {
  withEnv,
  fakeDb, rows, ctx, ticketRow, userRow, httpDoubles,
};
