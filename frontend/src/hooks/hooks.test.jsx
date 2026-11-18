import { act, renderHook } from '@testing-library/react';
import useSocketEvents from './useSocketEvents';
import useDebouncedCallback from './useDebouncedCallback';

jest.mock('../socket/socket', () => require('../testUtils/fakeSocket').mockModule());

const { socket } = require('../socket/socket');

beforeEach(() => socket.reset());

describe('useSocketEvents', () => {
  it('subscribes on mount, uses the latest handler, and unsubscribes on unmount', () => {
    // Arrange
    const first = jest.fn();
    const second = jest.fn();
    const { rerender, unmount } = renderHook(({ fn }) => useSocketEvents({ 'ticket:created': fn }), {
      initialProps: { fn: first },
    });
    // Act
    rerender({ fn: second });
    socket.trigger('ticket:created', { id: 1 });
    // Assert
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ id: 1 });
    expect(socket.listenerCount('ticket:created')).toBe(1); // no re-subscription per render
    unmount();
    expect(socket.listenerCount('ticket:created')).toBe(0);
    expect(socket.listenerCount('connect')).toBe(0);
  });

  it('calls onReconnect only on RE-connects, not on the first connect', () => {
    const onReconnect = jest.fn();
    renderHook(() => useSocketEvents({}, onReconnect));
    socket.trigger('connect');
    expect(onReconnect).not.toHaveBeenCalled();
    socket.trigger('connect');
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('treats a connect as a reconnect if the socket was already connected at mount', () => {
    socket.connected = true;
    const onReconnect = jest.fn();
    renderHook(() => useSocketEvents({ x: jest.fn() }, onReconnect));
    socket.trigger('connect');
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('tolerates a missing reconnect callback and removed handlers', () => {
    const handlers = { a: jest.fn() };
    const { rerender } = renderHook(({ h }) => useSocketEvents(h), { initialProps: { h: handlers } });
    socket.trigger('connect');
    socket.trigger('connect');
    rerender({ h: { a: undefined } });
    expect(() => socket.trigger('a', 1)).not.toThrow();
  });

  it('re-subscribes when the event set changes', () => {
    const { rerender } = renderHook(({ h }) => useSocketEvents(h), { initialProps: { h: { a: jest.fn() } } });
    rerender({ h: { b: jest.fn() } });
    expect(socket.listenerCount('a')).toBe(0);
    expect(socket.listenerCount('b')).toBe(1);
  });
});

describe('useDebouncedCallback', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('collapses bursts into one call with the latest args', () => {
    // Arrange
    const fn = jest.fn();
    const { result } = renderHook(() => useDebouncedCallback(fn, 300));
    // Act
    act(() => { result.current(1); result.current(2); result.current(3); });
    act(() => { jest.advanceTimersByTime(299); });
    expect(fn).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    // Assert
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('cancels pending calls on unmount and uses a default delay', () => {
    const fn = jest.fn();
    const { result, unmount } = renderHook(() => useDebouncedCallback(fn));
    act(() => { result.current(); });
    unmount();
    jest.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
