"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { TimerEngine, type TimerSnapshot } from "./TimerEngine";
import { timerStorage } from "./timerStorage";

/** Low-frequency (section 33) fallback checkpoint, independent of any real
 * state change, purely so a hard crash/kill can't lose more than this much
 * of an in-progress appTracking interval on restart (see
 * TimerEngine.hydrateFromSaved). Deliberately NOT a per-second write. */
const CHECKPOINT_INTERVAL_MS = 60_000;

/**
 * Owns the single TimerEngine instance for the Desktop Avatar window (lazy
 * singleton via useRef, same StrictMode-safe construction-at-render-time
 * pattern AvatarAnimationScene.tsx uses for its AvatarAnimationController),
 * wires its onPersist/onSessionComplete callbacks to timerStorage.ts, and
 * restores any previously in-progress timer once on mount - deferred one
 * macrotask past React 18 StrictMode's dev-only double mount/unmount/mount,
 * for the identical reason DesktopAvatarScene's own CharacterPreset-load
 * effect and DesktopInteractionLayer's mesh-collection effect defer theirs.
 *
 * `snapshot` only changes on meaningful transitions (TimerEngine.notify()),
 * never once a second - per-second display refresh is TimerHUD's own
 * concern (section 45: timer digits must not rerender the whole Avatar).
 */
export interface UseTimerEngineOptions {
  /** Wired straight through to TimerEngine's own option of the same name -
   * see TimerEngine.ts's doc comment on it. Only ever consumed once, at
   * this hook's lazy first-render construction of the engine (React hooks
   * may be called with a fresh closure each render, but since the growth
   * engine reference that closure reads is itself a stable singleton - see
   * useGrowthEngine.ts - which specific render's closure got captured here
   * doesn't matter). */
  onActiveMsCommitted?: (deltaMs: number) => void;
}

export function useTimerEngine(options: UseTimerEngineOptions = {}) {
  const engineRef = useRef<TimerEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new TimerEngine({
      onPersist: (state) => {
        void timerStorage.saveActiveState(state);
      },
      onSessionComplete: (session) => {
        void timerStorage.saveSession(session);
      },
      onActiveMsCommitted: options.onActiveMsCommitted,
    });
  }
  const engine = engineRef.current;

  const snapshot = useSyncExternalStore<TimerSnapshot>(
    (onStoreChange) => engine.subscribe(onStoreChange),
    () => engine.getSnapshot(),
    () => engine.getSnapshot()
  );

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    const timer = setTimeout(() => {
      if (restoredRef.current) return;
      restoredRef.current = true;
      (async () => {
        const saved = await timerStorage.loadActiveState();
        if (saved) engine.hydrateFromSaved(saved);
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [engine]);

  useEffect(() => {
    if (snapshot.status === "idle") return;
    const id = setInterval(() => engine.checkpoint(), CHECKPOINT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [engine, snapshot.status]);

  return { engine, snapshot };
}
