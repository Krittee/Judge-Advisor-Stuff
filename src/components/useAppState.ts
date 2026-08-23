"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "@/lib/types";

const EMPTY: AppState = {
  panels: [],
  teams: [],
  requests: [],
  divisions: [],
  viewer: {
    role: "team",
    name: null,
    panelId: null,
    panelName: null,
    division: null,
    canAdvance: false,
    canReadNotes: false,
    canAdminister: false,
  },
  serverTime: "",
};

/**
 * Poll /api/state and hand the result to whichever screen asked for it.
 *
 * Polling rather than websockets is a deliberate choice: it survives flaky
 * venue wifi, reconnects with no special handling, and an unchanged board
 * costs a 304. Tabs that are not visible stop polling entirely.
 */
export function useAppState(intervalMs = 4000) {
  const [state, setState] = useState<AppState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const etag = useRef<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const headers: HeadersInit = {};
      if (etag.current) headers["If-None-Match"] = etag.current;

      const res = await fetch("/api/state", { headers, cache: "no-store" });

      if (res.status === 304) {
        setOnline(true);
        return;
      }
      if (!res.ok) {
        setOnline(false);
        return;
      }

      const tag = res.headers.get("ETag");
      if (tag) etag.current = tag;
      setState((await res.json()) as AppState);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(refresh, intervalMs);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh, intervalMs]);

  return { state, loaded, online, refresh };
}

/** POST/PATCH/DELETE helper that surfaces the API's error message as-is. */
export async function call<T = unknown>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: options.method ?? "POST",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}
