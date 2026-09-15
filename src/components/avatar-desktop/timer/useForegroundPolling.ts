"use client";

import { useEffect, useRef } from "react";
import type { TimerEngine } from "./TimerEngine";

/** Polling cadence while an appTracking timer is active (section 17 - "대략
 * 500ms ~ 1000ms 정도, 상수로 분리"). Never polled on every animation frame. */
export const FOREGROUND_POLL_INTERVAL_MS = 750;

/**
 * Drives TimerEngine.reportForegroundApp() from window.desktopAPI while
 * (and only while) an appTracking timer is actually active - idle/manual
 * timers, and appTracking timers the user hasn't started yet, do zero OS
 * polling (section 17). Stops immediately on mode/status leaving that
 * condition, on unmount, or when window.desktopAPI isn't present (plain
 * browser - section 44), never throwing either way.
 */
export function useForegroundPolling(engine: TimerEngine, mode: string, status: string) {
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const active = mode === "appTracking" && status !== "idle";

  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined" || !window.desktopAPI?.getForegroundApp) return;

    let cancelled = false;

    async function poll() {
      try {
        const app = await window.desktopAPI!.getForegroundApp();
        if (!cancelled) engineRef.current.reportForegroundApp(app);
      } catch {
        if (!cancelled) engineRef.current.reportForegroundApp(null, { detectionFailed: true });
      }
    }

    poll();
    const id = setInterval(poll, FOREGROUND_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);
}
