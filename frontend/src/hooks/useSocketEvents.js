import { useEffect, useRef } from 'react';
import socket from '../socket/socket';

/**
 * Subscribes to Socket.IO events while the component is mounted.
 * `handlers` is an object { eventName: fn }. The latest handlers are always used
 * without re-subscribing on every render.
 *
 * `onReconnect` runs after the socket RE-connects (not the first connect) so pages can
 * refetch anything missed while offline.
 */
export function useSocketEvents(handlers, onReconnect) {
  const handlersRef = useRef(handlers);
  const reconnectRef = useRef(onReconnect);
  handlersRef.current = handlers;
  reconnectRef.current = onReconnect;

  const eventNames = Object.keys(handlers).sort().join('|');

  useEffect(() => {
    const names = eventNames ? eventNames.split('|') : [];
    const listeners = names.map((name) => {
      const fn = (payload) => handlersRef.current[name] && handlersRef.current[name](payload);
      socket.on(name, fn);
      return [name, fn];
    });

    let hasConnectedBefore = socket.connected;
    const onConnect = () => {
      if (hasConnectedBefore && reconnectRef.current) reconnectRef.current();
      hasConnectedBefore = true;
    };
    socket.on('connect', onConnect);

    return () => {
      listeners.forEach(([name, fn]) => socket.off(name, fn));
      socket.off('connect', onConnect);
    };
  }, [eventNames]);
}

export default useSocketEvents;
