import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import authService from '../services/authService';
import { socket, connectSocket, disconnectSocket } from '../socket/socket';

const AuthContext = createContext(null);

/**
 * Holds the authenticated user for UI purposes only. The backend re-checks identity,
 * role and organization on every request - nothing here is a security boundary.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const userRef = useRef(null);
  userRef.current = user;

  const refresh = useCallback(async () => {
    try {
      const me = await authService.me();
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Any 401 from the API means the session is gone (expired, removed, logged out elsewhere).
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, []);

  // Socket lifecycle follows the session.
  useEffect(() => {
    if (!user) {
      disconnectSocket();
      return undefined;
    }
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err) => {
      setConnected(false);
      if (err && err.message === 'unauthorized') refresh(); // re-validates the session
    };
    // Role changes / removals: reload who I am.
    const onMembersChanged = (payload) => {
      if (!payload || !payload.userId || payload.userId === userRef.current?.id) refresh();
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('members:changed', onMembersChanged);
    connectSocket();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('members:changed', onMembersChanged);
    };
    // Only reconnect when the identity changes, not on every user-object refresh.
  }, [user?.id, refresh]);

  const login = useCallback(async (credentials) => {
    const loggedIn = await authService.login(credentials);
    setUser(loggedIn);
    return loggedIn;
  }, []);

  const signup = useCallback(async (payload) => {
    const created = await authService.signup(payload);
    setUser(created);
    return created;
  }, []);

  const acceptInvitation = useCallback(async (payload) => {
    const accepted = await authService.acceptInvitation(payload);
    setUser(accepted);
    return accepted;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      disconnectSocket();
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({
    user, loading, connected, login, signup, logout, refresh, acceptInvitation,
  }), [user, loading, connected, login, signup, logout, refresh, acceptInvitation]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
