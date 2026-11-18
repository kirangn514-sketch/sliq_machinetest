import { io } from 'socket.io-client';

/**
 * Single shared Socket.IO connection (same origin; Nginx/Vite proxy /socket.io).
 * Authentication is the HttpOnly cookie sent with the handshake - the client never
 * chooses rooms; the server joins it to its own organization and user rooms.
 */
export const socket = io({
  path: '/socket.io',
  withCredentials: true,
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  transports: ['websocket', 'polling'],
});

export function connectSocket() {
  if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
  if (socket.connected || socket.active) socket.disconnect();
}

export default socket;
