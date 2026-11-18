/**
 * In-memory stand-in for the shared Socket.IO client.
 * Usage in a test file:
 *   jest.mock('../socket/socket', () => require('../testUtils/fakeSocket').mockModule());
 *   const { socket } = require('../socket/socket');  socket.trigger('ticket:created', {...});
 */
function createFakeSocket() {
  const handlers = new Map();
  const socket = {
    connected: false,
    active: false,
    on: jest.fn((event, fn) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
    }),
    off: jest.fn((event, fn) => {
      if (handlers.has(event)) handlers.get(event).delete(fn);
    }),
    connect: jest.fn(() => {
      socket.connected = true;
      socket.trigger('connect');
    }),
    disconnect: jest.fn(() => {
      socket.connected = false;
      socket.trigger('disconnect');
    }),
    /** Test helper: deliver an event to every registered listener. */
    trigger(event, payload) {
      [...(handlers.get(event) || [])].forEach((fn) => fn(payload));
    },
    listenerCount(event) {
      return handlers.has(event) ? handlers.get(event).size : 0;
    },
    reset() {
      handlers.clear();
      socket.connected = false;
      socket.active = false;
    },
  };
  return socket;
}

function mockModule() {
  const socket = createFakeSocket();
  return {
    __esModule: true,
    socket,
    default: socket,
    connectSocket: jest.fn(() => { if (!socket.connected) socket.connect(); }),
    disconnectSocket: jest.fn(() => { if (socket.connected) socket.disconnect(); }),
  };
}

module.exports = { createFakeSocket, mockModule };
