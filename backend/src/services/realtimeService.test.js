'use strict';

jest.mock('../utils/logger');

const logger = require('../utils/logger');

function load() {
  let mod;
  jest.isolateModules(() => { mod = require('./realtimeService'); });
  return mod;
}

function fakeIo() {
  const roomEmit = jest.fn();
  const disconnectSockets = jest.fn();
  return {
    emit: jest.fn(), roomEmit, disconnectSockets, to: jest.fn(() => ({ emit: roomEmit })), in: jest.fn(() => ({ disconnectSockets })),
  };
}

describe('realtimeService', () => {
  it('builds org and user addressed events', () => {
    const realtime = load();
    expect(realtime.toOrg(1, 'e', { a: 1 })).toEqual({ room: 'organization:1', event: 'e', payload: { a: 1 } });
    expect(realtime.toUser(2, 'e', null)).toEqual({ room: 'user:2', event: 'e', payload: null });
  });

  it('is a no-op before the Socket.IO server is registered (e.g. in the worker)', () => {
    const realtime = load();
    expect(() => realtime.emit([realtime.toOrg(1, 'e', {})])).not.toThrow();
    expect(() => realtime.disconnectUser(1)).not.toThrow();
  });

  it('emits each event only to its own room', () => {
    // Arrange
    const realtime = load();
    const io = fakeIo();
    realtime.setServer(io);
    // Act
    realtime.emit([realtime.toOrg(1, 'ticket:created', { id: 1 }), realtime.toUser(5, 'notification:created', { id: 2 })]);
    // Assert
    expect(io.to).toHaveBeenNthCalledWith(1, 'organization:1');
    expect(io.to).toHaveBeenNthCalledWith(2, 'user:5');
    expect(io.roomEmit).toHaveBeenCalledWith('ticket:created', { id: 1 });
    expect(io.emit).not.toHaveBeenCalled(); // never a global broadcast
  });

  it.each([['*'], ['organization:*'], ['organization:1 OR 1'], ['admin']])('refuses to emit to invalid room %p', (room) => {
    const realtime = load();
    const io = fakeIo();
    realtime.setServer(io);
    realtime.emit([{ room, event: 'x', payload: {} }]);
    expect(io.to).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('ignores non-array input', () => {
    const realtime = load();
    const io = fakeIo();
    realtime.setServer(io);
    realtime.emit(undefined);
    expect(io.to).not.toHaveBeenCalled();
  });

  it('disconnects all sockets of a removed user', () => {
    const realtime = load();
    const io = fakeIo();
    realtime.setServer(io);
    realtime.disconnectUser(7);
    expect(io.in).toHaveBeenCalledWith('user:7');
    expect(io.disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('publishes worker events through pg_notify inside the caller transaction', async () => {
    const realtime = load();
    const db = { query: jest.fn() };
    await realtime.publishViaDatabase(db, [realtime.toOrg(1, 'ticket:overdue', { id: 9 })]);
    expect(db.query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', ['sliqdesk_events', JSON.stringify({ room: 'organization:1', event: 'ticket:overdue', payload: { id: 9 } })]);
  });

  it('truncates payloads that exceed the NOTIFY limit', async () => {
    const realtime = load();
    const db = { query: jest.fn() };
    await realtime.publishViaDatabase(db, [realtime.toOrg(1, 'big', { id: 3, blob: 'x'.repeat(9000) })]);
    expect(JSON.parse(db.query.mock.calls[0][1][1]).payload).toEqual({ id: 3, truncated: true });
  });
});
