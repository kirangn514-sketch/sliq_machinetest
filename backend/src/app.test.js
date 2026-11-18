'use strict';

/**
 * Exercises the real Express app (routes -> middleware -> controllers) over HTTP with the
 * service layer mocked. Verifies wiring: auth, CSRF, role gates, status codes, envelopes.
 */
jest.mock('./config/database', () => ({ pool: { query: jest.fn() }, withTransaction: jest.fn() }));
jest.mock('./services/authService');
jest.mock('./services/memberService');
jest.mock('./services/memberManagementService');
jest.mock('./services/ticketService');
jest.mock('./services/commentService');
jest.mock('./services/notificationService');
jest.mock('./services/settingsService');
jest.mock('./utils/logger');

const http = require('http');
const { pool } = require('./config/database');
const authService = require('./services/authService');
const memberService = require('./services/memberService');
const memberManagementService = require('./services/memberManagementService');
const ticketService = require('./services/ticketService');
const commentService = require('./services/commentService');
const notificationService = require('./services/notificationService');
const settingsService = require('./services/settingsService');
const AppError = require('./utils/AppError');
const app = require('./app');
const { userRow } = require('./testUtils/factories');

let server;
let base;
const CSRF = 'c'.repeat(43);
const ORIGIN = 'http://localhost:3000';

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => { server.close(resolve); }));

function asRole(role) {
  authService.resolveSession.mockResolvedValue({
    user: userRow({ role, id: 10 }),
    claims: { iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
  });
}

async function call(method, path, { body, auth = true, csrf = true, origin = ORIGIN } = {}) {
  const cookies = [];
  if (auth) cookies.push('sliqdesk_token=tok');
  if (csrf) cookies.push(`sliqdesk_csrf=${CSRF}`);
  const headers = { 'Content-Type': 'application/json', Cookie: cookies.join('; ') };
  if (csrf) headers['X-CSRF-Token'] = CSRF;
  if (origin) headers.Origin = origin;
  const res = await fetch(`${base}${path}`, { method, headers, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

describe('health and fallbacks', () => {
  it('reports healthy when the database answers', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await call('GET', '/api/health', { auth: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'ok', database: 'up' });
  });

  it('returns 503 when the database is down', async () => {
    pool.query.mockRejectedValue(new Error('down'));
    expect((await call('GET', '/api/v1/health', { auth: false })).status).toBe(503);
  });

  it('returns a 404 envelope for unknown routes', async () => {
    const res = await call('GET', '/api/v1/nope', { auth: false });
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('ROUTE_NOT_FOUND');
  });

  it('sets security headers and hides x-powered-by', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await call('GET', '/api/health', { auth: false });
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers CORS only for allowed origins', async () => {
    const ok = await fetch(`${base}/api/health`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const bad = await fetch(`${base}/api/health`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('auth routes', () => {
  it('issues a CSRF cookie', async () => {
    const res = await call('GET', '/api/v1/auth/csrf', { auth: false, csrf: false });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/sliqdesk_csrf=/);
  });

  it('signup sets an HttpOnly auth cookie and returns 201', async () => {
    authService.signup.mockResolvedValue({ user: { id: 1 }, token: 'jwt' });
    const res = await call('POST', '/api/v1/auth/signup', { auth: false, body: { organizationName: 'A' } });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ user: { id: 1 } });
    expect(res.headers.get('set-cookie')).toMatch(/sliqdesk_token=jwt;.*HttpOnly/i);
    expect(authService.signup).toHaveBeenCalledWith({ organizationName: 'A' }, { ip: expect.any(String) });
  });

  it('login returns 200 and never echoes the token in the body', async () => {
    authService.login.mockResolvedValue({ user: { id: 1 }, token: 'jwt' });
    const res = await call('POST', '/api/auth/login', { auth: false, body: { email: 'a@b.io', password: 'p' } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('jwt');
  });

  it('surfaces service errors through the error middleware', async () => {
    authService.login.mockRejectedValue(AppError.unauthorized('Invalid email or password'));
    const res = await call('POST', '/api/v1/auth/login', { auth: false, body: {} });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(expect.objectContaining({ success: false, message: 'Invalid email or password', errorCode: 'UNAUTHORIZED' }));
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await call('POST', '/api/v1/auth/login', { auth: false, csrf: false, body: {} });
    expect(res.status).toBe(403);
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `sliqdesk_csrf=${CSRF}`, 'X-CSRF-Token': CSRF },
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });

  it('me requires authentication', async () => {
    expect((await call('GET', '/api/v1/auth/me', { auth: false })).status).toBe(401);
  });

  it('me returns the current user from the database', async () => {
    asRole('agent');
    const res = await call('GET', '/api/v1/auth/me');
    expect(res.body.data.user).toEqual({
      id: 10, name: 'Alice', email: 'alice@example.com', role: 'agent', organization: { id: 1, name: 'Org A' },
    });
  });

  it('logout clears the cookie and audits when authenticated', async () => {
    asRole('viewer');
    const res = await call('POST', '/api/v1/auth/logout');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/sliqdesk_token=;/);
    expect(authService.recordLogout).toHaveBeenCalledWith(expect.objectContaining({ userId: 10, organizationId: 1 }));
  });

  it('logout still clears an expired session cookie', async () => {
    authService.resolveSession.mockRejectedValue(AppError.unauthorized());
    const res = await call('POST', '/api/v1/auth/logout');
    expect(res.status).toBe(200);
    expect(authService.recordLogout).not.toHaveBeenCalled();
  });

  it('invitation preview / accept', async () => {
    memberService.previewInvitation.mockResolvedValue({ email: 'b@x.io' });
    memberService.acceptInvitation.mockResolvedValue({ user: { id: 2 }, token: 'jwt' });
    expect((await call('POST', '/api/v1/auth/invitations/preview', { auth: false, body: { token: 't' } })).body.data).toEqual({ email: 'b@x.io' });
    const accept = await call('POST', '/api/v1/auth/invitations/accept', { auth: false, body: { token: 't', password: 'p' } });
    expect(accept.status).toBe(201);
    expect(accept.headers.get('set-cookie')).toMatch(/sliqdesk_token=jwt/);
  });
});

describe('role gates (route level)', () => {
  const matrix = [
    ['POST', '/api/v1/tickets', ['admin', 'agent'], () => ticketService.createTicket.mockResolvedValue({ id: 1 }), 201],
    ['PUT', '/api/v1/tickets/1', ['admin', 'agent'], () => ticketService.updateTicket.mockResolvedValue({ id: 1 }), 200],
    ['POST', '/api/v1/tickets/1/comments', ['admin', 'agent'], () => commentService.addComment.mockResolvedValue({ id: 1 }), 201],
    ['GET', '/api/v1/members', ['admin'], () => memberService.listMembers.mockResolvedValue({ members: [] }), 200],
    ['POST', '/api/v1/members', ['admin'], () => memberManagementService.inviteMember.mockResolvedValue({}), 201],
    ['PUT', '/api/v1/members/2/role', ['admin'], () => memberManagementService.changeRole.mockResolvedValue({}), 200],
    ['DELETE', '/api/v1/members/2', ['admin'], () => memberManagementService.removeMember.mockResolvedValue({}), 200],
    ['DELETE', '/api/v1/members/invitations/2', ['admin'], () => memberManagementService.revokeInvitation.mockResolvedValue({}), 200],
    ['PUT', '/api/v1/settings/sla', ['admin'], () => settingsService.updateSla.mockResolvedValue({}), 200],
  ];
  const cases = matrix.flatMap(([method, path, allowed, arrange, okStatus]) => ['admin', 'agent', 'viewer']
    .map((role) => [method, path, role, allowed.includes(role), arrange, okStatus]));

  it.each(cases)('%s %s as %s -> allowed=%s', async (method, path, role, allowed, arrange, okStatus) => {
    // Arrange
    asRole(role);
    arrange();
    // Act
    const res = await call(method, path, { body: {} });
    // Assert
    expect(res.status).toBe(allowed ? okStatus : 403);
  });

  it.each([
    ['GET', '/api/v1/tickets', () => ticketService.listTickets.mockResolvedValue({ items: [] })],
    ['GET', '/api/v1/tickets/stats', () => ticketService.getStats.mockResolvedValue({ total: 0 })],
    ['GET', '/api/v1/tickets/5', () => ticketService.getTicket.mockResolvedValue({ id: 5 })],
    ['GET', '/api/v1/tickets/5/comments', () => commentService.listComments.mockResolvedValue([])],
    ['GET', '/api/v1/members/directory', () => memberService.directory.mockResolvedValue([])],
    ['GET', '/api/v1/notifications', () => notificationService.list.mockResolvedValue({ items: [] })],
    ['PATCH', '/api/v1/notifications/3/read', () => notificationService.markRead.mockResolvedValue({ id: 3 })],
    ['PATCH', '/api/v1/notifications/read-all', () => notificationService.markAllRead.mockResolvedValue({ updated: 0 })],
    ['GET', '/api/v1/settings/sla', () => settingsService.getSla.mockResolvedValue({})],
  ])('viewer may %s %s', async (method, path, arrange) => {
    asRole('viewer');
    arrange();
    expect((await call(method, path)).status).toBe(200);
  });

  it('requires authentication on business routes', async () => {
    for (const path of ['/api/v1/tickets', '/api/v1/members/directory', '/api/v1/notifications', '/api/v1/settings/sla']) {
      expect((await call('GET', path, { auth: false })).status).toBe(401);
    }
  });
});

describe('controllers pass tenant context and parsed ids', () => {
  it('passes req.ctx (org from identity) and numeric ids, ignoring body organizationId', async () => {
    // Arrange
    asRole('admin');
    ticketService.updateTicket.mockResolvedValue({ id: 7 });
    // Act
    await call('PUT', '/api/v1/tickets/7', { body: { title: 'x', organizationId: 999 } });
    // Assert
    const [ctxArg, idArg, bodyArg] = ticketService.updateTicket.mock.calls[0];
    expect(ctxArg).toEqual(expect.objectContaining({ organizationId: 1, userId: 10, role: 'admin' }));
    expect(idArg).toBe(7);
    expect(bodyArg).toEqual({ title: 'x' });
  });

  it('turns non-numeric ids into 404 without calling services', async () => {
    asRole('admin');
    const res = await call('GET', '/api/v1/tickets/abc');
    expect(res.status).toBe(404);
    expect(ticketService.getTicket).not.toHaveBeenCalled();
  });

  it('passes the ticket id to nested comment routes', async () => {
    asRole('agent');
    commentService.listComments.mockResolvedValue([]);
    await call('GET', '/api/v1/tickets/12/comments');
    expect(commentService.listComments).toHaveBeenCalledWith(expect.any(Object), 12);
  });

  it('passes query strings to list endpoints', async () => {
    asRole('viewer');
    ticketService.listTickets.mockResolvedValue({ items: [] });
    await call('GET', '/api/v1/tickets?status=open&page=2');
    expect(ticketService.listTickets).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ status: 'open', page: '2' }));
  });
});
