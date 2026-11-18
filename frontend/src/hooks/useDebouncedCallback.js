import { useCallback, useEffect, useRef } from 'react';

/** Collapses bursts of calls (e.g. many realtime events) into one call after `delay` ms. */
export function useDebouncedCallback(fn, delay = 300) {
  const fnRef = useRef(fn);
  const timer = useRef(null);
  fnRef.current = fn;

  useEffect(() => () => clearTimeout(timer.current), []);

  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]);
}

export default useDebouncedCallback;
