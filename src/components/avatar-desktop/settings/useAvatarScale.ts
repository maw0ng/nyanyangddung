"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AVATAR_SCALE_DEFAULT, clampAvatarScale } from "../desktopAvatarLayout";

/**
 * Owns the live avatarScale value driving Desktop Mode's whole layout.
 * Reads the persisted scale once on mount (mirrors ../timer's/../growth's
 * own getX()-on-mount pattern); the actual BrowserWindow resize/
 * persistence goes through two separate desktopAPI calls with very
 * different call frequencies (section 9/33 of the Avatar Scale brief):
 *
 *  - previewAvatarScale(next): updates React state IMMEDIATELY (so the
 *    Canvas/HUD re-render this same tick - "즉시 반영"), and schedules
 *    (rAF-coalesced, at most once per frame regardless of how many times
 *    this is called within it) a `resizeAvatarWindow` IPC call so the
 *    BrowserWindow grows/shrinks to keep up without clipping. Call this on
 *    every slider `onChange`.
 *  - commitAvatarScale(): persists the LAST previewed value to disk via
 *    `setAvatarScale`. Call this once, on slider release (pointerup/
 *    keyup) or a quick-preset click - never per-tick.
 *
 * Absent/no-op outside Electron (section 28) - previewAvatarScale still
 * updates local React state (so the Canvas resizes locally even in a
 * plain browser tab), it just never reaches any window/disk.
 */
export function useAvatarScale() {
  const [avatarScale, setAvatarScaleState] = useState(AVATAR_SCALE_DEFAULT);
  const pendingScaleRef = useRef(AVATAR_SCALE_DEFAULT);
  const rafScheduledRef = useRef(false);

  useEffect(() => {
    window.desktopAPI?.getAvatarScale().then((saved) => {
      if (typeof saved === "number") {
        const clamped = clampAvatarScale(saved);
        pendingScaleRef.current = clamped;
        setAvatarScaleState(clamped);
      }
    });
  }, []);

  const scheduleResize = useCallback(() => {
    if (rafScheduledRef.current) return;
    rafScheduledRef.current = true;
    requestAnimationFrame(() => {
      rafScheduledRef.current = false;
      window.desktopAPI?.resizeAvatarWindow(pendingScaleRef.current);
    });
  }, []);

  const previewAvatarScale = useCallback(
    (next: number) => {
      const clamped = clampAvatarScale(next);
      pendingScaleRef.current = clamped;
      setAvatarScaleState(clamped);
      scheduleResize();
    },
    [scheduleResize]
  );

  const commitAvatarScale = useCallback(() => {
    window.desktopAPI?.setAvatarScale(pendingScaleRef.current);
  }, []);

  return { avatarScale, previewAvatarScale, commitAvatarScale };
}
