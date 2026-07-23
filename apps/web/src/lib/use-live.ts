'use client';

import { useEffect, useRef } from 'react';
import { liveEventsUrl, type LiveEvent } from './api';

/**
 * Subscribe to the org-wide realtime feed and run `onRefresh` when an event of
 * one of `types` arrives (use `['*']` for any). Debounced so a burst of
 * pipeline events triggers a single refresh, and auto-reconnects. The socket
 * is opened once for the component's lifetime — callers pass a stable list of
 * types; changing callbacks are tracked via refs so we never reconnect
 * needlessly.
 */
/**
 * Like {@link useLiveRefresh} but hands the raw event to the callback (no
 * debounce) — for surfaces that need the event type/label per occurrence, e.g.
 * a live activity toast. Opens one socket for the component's lifetime.
 */
export function useLiveEvent(types: string[], onEvent: (event: LiveEvent) => void): void {
  const callback = useRef(onEvent);
  callback.current = onEvent;
  const typeSet = useRef(new Set(types));
  const key = types.join(',');
  useEffect(() => {
    typeSet.current = new Set(types);
  }, [key, types]);

  useEffect(() => {
    const url = liveEventsUrl();
    if (!url) return;

    let closed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      socket = new WebSocket(url);
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as LiveEvent;
          if (typeSet.current.has('*') || typeSet.current.has(event.type)) {
            callback.current(event);
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2500);
      };
      socket.onerror = () => socket?.close();
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);
}

export function useLiveRefresh(
  types: string[],
  onRefresh: () => void,
  options: { debounceMs?: number } = {},
): void {
  const callback = useRef(onRefresh);
  callback.current = onRefresh;
  const typeSet = useRef(new Set(types));
  const key = types.join(',');
  useEffect(() => {
    typeSet.current = new Set(types);
  }, [key, types]);

  const debounceMs = options.debounceMs ?? 600;

  useEffect(() => {
    const url = liveEventsUrl();
    if (!url) return;

    let closed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      socket = new WebSocket(url);
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as LiveEvent;
          if (typeSet.current.has('*') || typeSet.current.has(event.type)) {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => callback.current(), debounceMs);
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2500);
      };
      socket.onerror = () => socket?.close();
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (debounce) clearTimeout(debounce);
      socket?.close();
    };
  }, [debounceMs]);
}
