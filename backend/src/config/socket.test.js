'use strict';

jest.mock('../services/authService', () => ({ resolveSession: jest.fn() }));
jest.mock('../utils/logger');
jest.mock('socket.io', () => {
  const instance = {
    use: jest.fn(), on: jest.fn(), close: jest.fn((cb) => cb()),
  };
  return { Server: jest.fn(() => instance), instance };
});
jest.mock('pg', () => {
  const clients = [];
  const Client = jest.fn(() => {
    const handlers = {};
    const c = {
      handlers,
      on: jest.fn((evt, fn) => { handlers[evt] = fn; }),
      connect: jest.fn().mockResolvedValue(),
      query: jest.fn().mockResolvedValue(),
      end: jest.fn().mockResolvedValue(),
      removeAllListeners: jest.fn(),
    };
    clients.push(c);
    return c;
  });
  return { Client, clients };
});
jest.mock('../services/realtimeService', () => ({ setServer: jest.fn(), emit: jest.fn() }));

const { Server, instance: ioInstance } = require('socket.io');
const pg = require('pg');
const authService = require('../services/authService');
const realtime = require('../services/realtimeService');
const socketConfig = require('./socket');
const { userRow } = require('../testUtils/factories');

function fakeSocket(cookie) {
  const handlers = {};
  return {
    request: { headers: cookie === undefined ? {} : { cookie } },
    data: {},
    join: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn((evt, fn) => { handlers[evt] = fn; }),
    handlers,
  };
}

describe('isAllowedOrigin', () => {
  it.each([
    [undefined, true], ['http://localhost:3000', true], ['http://localhost:3000/', true],
    ['http://localhost:5173', true], ['https://evil.example', false],
  ])('%p -> %p', (origin, expected) => {
    expect(socketConfig.isAllowedOrigin(origin)).toBe(expected);
  });
});

describe('authenticateSocket', () => {
  it('authenticates with the same cookie + DB re-validation as REST', async () => {
    // Arrange
    const socket = fakeSocket('a=b; sliqdesk_token=tok');
    authService.resolveSession.mockResolvedValue({ user: userRow({ role: 'agent' }), claims: { exp: 2000 } });
    const next = jest.fn();
    // Act
    await socketConfig.authenticateSocket(socket, next);
    // Assert
    expect(authService.resolveSession).toHaveBeenCalledWith('tok');
    expect(socket.data.user).toEqual({ id: 10, organizationId: 1, role: 'agent' });
    expect(socket.data.expiresAt).toBe(2000000);
    expect(next).toHaveBeenCalledWith();
  });

  it.each([[undefined], ['other=1']])('rejects handshakes without the auth cookie (%p)', async (cookie) => {
    const next = jest.fn();
    await socketConfig.authenticateSocket(fakeSocket(cookie), next);
    expect(next).toHaveBeenCalledWith(new Error('unauthorized'));
    expect(authService.resolveSession).not.toHaveBeenCalled();
  });

  it('rejects invalid / revoked sessions', async () => {
    authService.resolveSession.mockRejectedValue(new Error('Session is no longer valid'));
    const next = jest.fn();
    await socketConfig.authenticateSocket(fakeSocket('sliqdesk_token=old'), next);
    expect(next).toHaveBeenCalledWith(new Error('unauthorized'));
  });
});

describe('onConnection', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('joins ONLY the server-derived organization and user rooms', () => {
    // Arrange
    const socket = fakeSocket('');
    socket.data = { user: { id: 10, organizationId: 1 }, expiresAt: Date.now() + 60000 };
    // Act
    socketConfig.onConnection(socket);
    // Assert
    expect(socket.join.mock.calls).toEqual([['organization:1'], ['user:10']]);
  });

  it('disconnects when the JWT expires, and clears the timer on disconnect', () => {
    const socket = fakeSocket('');
    socket.data = { user: { id: 10, organizationId: 1 }, expiresAt: Date.now() + 1000 };
    socketConfig.onConnection(socket);
    jest.advanceTimersByTime(1001);
    expect(socket.disconnect).toHaveBeenCalledWith(true);

    const other = fakeSocket('');
    other.data = { user: { id: 11, organizationId: 1 }, expiresAt: Date.now() + 1000 };
    socketConfig.onConnection(other);
    other.handlers.disconnect();
    jest.advanceTimersByTime(2000);
    expect(other.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects immediately when already expired', () => {
    const socket = fakeSocket('');
    socket.data = { user: { id: 10, organizationId: 1 }, expiresAt: Date.now() - 5 };
    socketConfig.onConnection(socket);
    jest.advanceTimersByTime(0);
    expect(socket.disconnect).toHaveBeenCalled();
  });
});

describe('initSocket / database listener / closeSocket', () => {
  const flush = () => new Promise((resolve) => { setImmediate(resolve); });

  it('wires auth, origin check, realtime server and LISTEN', async () => {
    // Act
    socketConfig.initSocket({});
    await flush();
    // Assert
    const opts = Server.mock.calls[0][1];
    expect(opts.path).toBe('/socket.io');
    expect(opts.cors).toEqual({ origin: ['http://localhost:3000', 'http://localhost:5173'], credentials: true });
    const cb = jest.fn();
    opts.allowRequest({ headers: { origin: 'https://evil.example' } }, cb);
    expect(cb).toHaveBeenCalledWith(null, false);
    expect(ioInstance.use).toHaveBeenCalledWith(socketConfig.authenticateSocket);
    expect(ioInstance.on).toHaveBeenCalledWith('connection', socketConfig.onConnection);
    expect(realtime.setServer).toHaveBeenCalledWith(ioInstance);
    expect(pg.clients[0].query).toHaveBeenCalledWith('LISTEN sliqdesk_events');
  });

  it('relays valid NOTIFY payloads and ignores malformed ones', () => {
    const listener = pg.clients[0];
    const evt = { room: 'organization:1', event: 'ticket:overdue', payload: { id: 1 } };
    listener.handlers.notification({ payload: JSON.stringify(evt) });
    expect(realtime.emit).toHaveBeenCalledWith([evt]);
    expect(() => listener.handlers.notification({ payload: '{nope' })).not.toThrow();
  });

  it('reconnects with backoff after an error (only once per failure)', async () => {
    jest.useFakeTimers();
    const before = pg.clients.length;
    const listener = pg.clients[0];
    listener.handlers.error(new Error('connection terminated'));
    listener.handlers.end();
    jest.advanceTimersByTime(30000);
    jest.useRealTimers();
    await flush();
    expect(pg.clients.length).toBe(before + 1);
    expect(listener.end).toHaveBeenCalled();
  });

  it('retries when the initial connect fails', async () => {
    jest.useFakeTimers();
    pg.Client.mockImplementationOnce(() => ({
      on: jest.fn(), connect: jest.fn().mockRejectedValue(new Error('refused')), query: jest.fn(), end: jest.fn().mockResolvedValue(), removeAllListeners: jest.fn(),
    }));
    const before = pg.clients.length;
    const latest = pg.clients[pg.clients.length - 1];
    latest.handlers.end();
    jest.advanceTimersByTime(30000);
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(30000);
    jest.useRealTimers();
    await flush();
    expect(pg.clients.length).toBeGreaterThanOrEqual(before + 1);
  });

  it('closes the listener and server and stops reconnecting', async () => {
    jest.useFakeTimers();
    await socketConfig.closeSocket();
    const count = pg.Client.mock.calls.length;
    pg.clients[pg.clients.length - 1].handlers.end?.();
    jest.advanceTimersByTime(60000);
    jest.useRealTimers();
    expect(ioInstance.close).toHaveBeenCalled();
    expect(pg.Client.mock.calls.length).toBe(count);
  });
});
