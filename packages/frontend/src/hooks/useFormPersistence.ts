import { useCallback, useEffect, useState } from 'react';

interface PersistedEnvelope<T> {
  value: T;
  savedAt: number;
}

interface Options<T> {
  ttlMs?: number;
  exclude?: Array<keyof T & string>;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function stripExcluded<T>(value: T, exclude?: Array<keyof T & string>): T {
  if (!exclude || exclude.length === 0 || typeof value !== 'object' || value === null) {
    return value;
  }
  const copy = { ...(value as Record<string, unknown>) };
  for (const key of exclude) {
    delete copy[key];
  }
  return copy as T;
}

export function useFormPersistence<T>(
  key: string,
  initial: T,
  opts: Options<T> = {}
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const { ttlMs = DEFAULT_TTL_MS, exclude } = opts;
  const storageKey = `form:${key}`;

  const [state, setState] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return initial;
      const parsed = JSON.parse(raw) as PersistedEnvelope<T>;
      if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > ttlMs) {
        sessionStorage.removeItem(storageKey);
        return initial;
      }
      if (typeof initial === 'object' && initial !== null && typeof parsed.value === 'object' && parsed.value !== null) {
        return { ...(initial as Record<string, unknown>), ...(parsed.value as Record<string, unknown>) } as T;
      }
      return parsed.value;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      const sanitized = stripExcluded(state, exclude);
      const envelope: PersistedEnvelope<T> = { value: sanitized, savedAt: Date.now() };
      sessionStorage.setItem(storageKey, JSON.stringify(envelope));
    } catch {
      /* quota exceeded or storage disabled — fail silently */
    }
  }, [state, storageKey, exclude]);

  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return [state, setState, clear];
}
