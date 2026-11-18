jest.mock('socket.io-client', () => {
  const client = {
    connected: false, active: false, connect: jest.fn(), disconnect: jest.fn(),
  };
  return { io: jest.fn(() => client), client };
});

const { io, client } = require('socket.io-client');
const { socket, connectSocket, disconnectSocket } = require('./socket');

// captured at module load (clearMocks resets call history before each test)
const ioCalls = io.mock.calls.slice();

describe('socket client', () => {
  it('is a single same-origin client using cookies, connecting only on demand', () => {
    expect(socket).toBe(client);
    expect(ioCalls).toHaveLength(1);
    expect(ioCalls[0][0]).toEqual(expect.objectContaining({
      path: '/socket.io', withCredentials: true, autoConnect: false, reconnection: true,
    }));
  });

  it('connects only when not already connected', () => {
    client.connected = false;
    connectSocket();
    expect(client.connect).toHaveBeenCalledTimes(1);
    client.connected = true;
    connectSocket();
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ connected: true, active: false }, 1],
    [{ connected: false, active: true }, 1],
    [{ connected: false, active: false }, 0],
  ])('disconnects when %j', (state, calls) => {
    Object.assign(client, state);
    disconnectSocket();
    expect(client.disconnect).toHaveBeenCalledTimes(calls);
  });
});
