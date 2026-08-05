'use client';

import { useEffect, useState } from 'react';

/**
 * A text draft that survives navigation. The value is mirrored to localStorage,
 * so text typed in one place (Ask Brain, Actions, …) is still there after
 * switching tabs from the sidebar and coming back. Setting an empty value (e.g.
 * after submit) clears the stored draft.
 *
 * `key` should be stable for the same input surface — pass a per-conversation
 * key where drafts must not bleed between conversations.
 */
export function useDraft(key: string): [string, (value: string) => void] {
  const storageKey = `draft:${key}`;
  const [value, setValue] = useState('');

  // Restore on mount and whenever the key changes (client-only).
  useEffect(() => {
    try {
      setValue(window.localStorage.getItem(storageKey) ?? '');
    } catch {
      setValue('');
    }
  }, [storageKey]);

  const update = (next: string) => {
    setValue(next);
    try {
      if (next) window.localStorage.setItem(storageKey, next);
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Ignore unavailable / quota-exceeded storage — drafting still works in-memory.
    }
  };

  return [value, update];
}

/**
 * Like {@link useDraft} but for a small nullable token (e.g. an armed slash
 * command) rather than free text. Persists across navigation via localStorage.
 * `allowed` guards restore so a stale/invalid stored value is ignored.
 */
export function usePersistentToken<T extends string>(
  key: string,
  allowed: readonly T[],
): [T | null, (value: T | null) => void] {
  const storageKey = `token:${key}`;
  const [value, setValue] = useState<T | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      setValue(stored && (allowed as readonly string[]).includes(stored) ? (stored as T) : null);
    } catch {
      setValue(null);
    }
    // `allowed` is a stable module-level constant at every call site, so it is
    // intentionally omitted from the dependency list.
  }, [storageKey]);

  const update = (next: T | null) => {
    setValue(next);
    try {
      if (next) window.localStorage.setItem(storageKey, next);
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Ignore unavailable / quota-exceeded storage.
    }
  };

  return [value, update];
}
