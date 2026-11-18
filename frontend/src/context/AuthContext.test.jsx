import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import authService from '../services/authService';

jest.mock('../services/authService', () => ({
  __esModule: true,
  default: {
    me: jest.fn(), login: jest.fn(), signup: jest.fn(), logout: jest.fn(), acceptInvitation: jest.fn(),
  },
}));
jest.mock('../socket/socket', () => require('../testUtils/fakeSocket').mockModule());

const socketModule = require('../socket/socket');

const { socket } = socketModule;

const alice = { id: 10, name: 'Alice', role: 'admin', organization: { id: 1, name: 'Acme' } };

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider });
}

beforeEach(() => socket.reset());

describe('AuthProvider', () => {
  it('restores the session from /auth/me and connects the socket', async () => {
    // Arrange
    authService.me.mockResolvedValue(alice);
    // Act
    const { result } = renderAuth();
    // Assert
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual(alice);
    expect(socketModule.connectSocket).toHaveBeenCalled();
    expect(result.current.connected).toBe(true);
  });

  it('ends loading with no user when there is no session', async () => {
    authService.me.mockRejectedValue(new Error('401'));
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(socketModule.connectSocket).not.toHaveBeenCalled();
  });

  it('login / signup / acceptInvitation set the user', async () => {
    authService.me.mockRejectedValue(new Error('401'));
    authService.login.mockResolvedValue(alice);
    authService.signup.mockResolvedValue({ ...alice, id: 11 });
    authService.acceptInvitation.mockResolvedValue({ ...alice, id: 12 });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.login({ email: 'a', password: 'b' }));
    expect(result.current.user.id).toBe(10);
    await act(() => result.current.signup({}));
    expect(result.current.user.id).toBe(11);
    await act(() => result.current.acceptInvitation({}));
    expect(result.current.user.id).toBe(12);
  });

  it('logout clears the user and disconnects the socket even if the request fails', async () => {
    // Arrange
    authService.me.mockResolvedValue(alice);
    authService.logout.mockRejectedValue(new Error('network'));
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.user).toEqual(alice));
    // Act
    await act(async () => { await result.current.logout().catch(() => {}); });
    // Assert
    expect(result.current.user).toBeNull();
    expect(socketModule.disconnectSocket).toHaveBeenCalled();
  });

  it('signs out when any API call broadcasts auth:unauthorized', async () => {
    authService.me.mockResolvedValue(alice);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.user).toEqual(alice));
    act(() => { window.dispatchEvent(new CustomEvent('auth:unauthorized')); });
    expect(result.current.user).toBeNull();
  });

  it('tracks socket connection state', async () => {
    authService.me.mockResolvedValue(alice);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.connected).toBe(true));
    act(() => { socket.trigger('disconnect'); });
    expect(result.current.connected).toBe(false);
    act(() => { socket.trigger('connect'); });
    expect(result.current.connected).toBe(true);
  });

  it('re-validates the session when the socket handshake is unauthorized', async () => {
    authService.me.mockResolvedValue(alice);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.user).toEqual(alice));
    authService.me.mockRejectedValue(new Error('401'));
    await act(async () => { socket.trigger('connect_error', new Error('unauthorized')); });
    expect(result.current.user).toBeNull();
  });

  it('ignores non-auth socket errors', async () => {
    authService.me.mockResolvedValue(alice);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.user).toEqual(alice));
    const calls = authService.me.mock.calls.length;
    act(() => { socket.trigger('connect_error', new Error('xhr poll error')); socket.trigger('connect_error'); });
    expect(authService.me.mock.calls.length).toBe(calls);
    expect(result.current.connected).toBe(false);
  });

  it('refreshes the user on members:changed for self or org-wide changes only', async () => {
    authService.me.mockResolvedValue(alice);
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.user).toEqual(alice));
    const base = authService.me.mock.calls.length;

    await act(async () => { socket.trigger('members:changed', { userId: 99 }); });
    expect(authService.me.mock.calls.length).toBe(base);

    authService.me.mockResolvedValue({ ...alice, role: 'agent' });
    await act(async () => { socket.trigger('members:changed', { userId: 10 }); });
    expect(result.current.user.role).toBe('agent');

    await act(async () => { socket.trigger('members:changed', {}); });
    await act(async () => { socket.trigger('members:changed'); });
    expect(authService.me.mock.calls.length).toBe(base + 3);
  });

  it('detaches socket listeners and disconnects when the user logs out', async () => {
    authService.me.mockResolvedValue(alice);
    authService.logout.mockResolvedValue();
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.user).toEqual(alice));
    await act(() => result.current.logout());
    expect(socket.listenerCount('members:changed')).toBe(0);
    expect(socket.listenerCount('connect_error')).toBe(0);
  });
});

describe('useAuth', () => {
  it('throws outside the provider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used inside <AuthProvider>');
  });

  it('renders children', async () => {
    authService.me.mockRejectedValue(new Error('401'));
    render(<AuthProvider><p>child</p></AuthProvider>);
    expect(screen.getByText('child')).toBeInTheDocument();
    await waitFor(() => expect(authService.me).toHaveBeenCalled());
  });
});
