import { useState, useCallback } from 'react';

/**
 * Like useState, but persists to localStorage.
 * @param key localStorage key
 * @param fallback value when nothing is stored (or a factory function)
 * @param serialize convert value to string for storage (default: String)
 * @param deserialize convert stored string to value (default: identity cast)
 */
export function useLocalStorage<T>(
  key: string,
  fallback: T | (() => T),
  serialize: (v: T) => string = String as (v: T) => string,
  deserialize?: (raw: string) => T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    if (stored !== null && deserialize) {
      return deserialize(stored);
    }
    if (stored !== null) {
      return stored as unknown as T;
    }
    return typeof fallback === 'function' ? (fallback as () => T)() : fallback;
  });

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setState(prev => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
      localStorage.setItem(key, serialize(next));
      return next;
    });
  }, [key, serialize]);

  return [state, setValue];
}
