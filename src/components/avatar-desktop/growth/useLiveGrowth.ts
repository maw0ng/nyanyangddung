"use client";

import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type { GrowthEngine } from "./GrowthEngine";
import type { TimerEngine, TimerSnapshot } from "../timer/TimerEngine";
import { calculateGrowth } from "./growthConfig";
import type { GrowthProgress } from "./growthTypes";
import { TIMER_HUD_TICK_INTERVAL_MS } from "../timer/timerHudConfig";

/**
 * Computes the "effective" (section 10) growth state - the committed
 * GrowthEngine.totalWorkMs plus whatever running segment TimerEngine has
 * accrued but not yet committed - and re-derives it live while the timer
 * is running, without ever writing anything to storage itself (section 10:
 * "이 값을 매초 DB에 저장하지 않는다. UI 표시만 실시간 계산").
 *
 * Deliberately a hook that any leaf component can call independently
 * (AvatarProfileHUDLive, ProfileMenuSection) rather than lifted state in
 * DesktopAvatarScene - each caller ticks its own local re-render, all
 * reading the same two engines, so they can never show different numbers
 * from each other, but none of this ticking ever reaches
 * DesktopAvatarScene itself (section 9 - no per-second rerender of the
 * whole Avatar/R3F tree).
 *
 * `onLevelUp`, if given, fires at most once per level increase, the
 * moment the LIVE (not just committed) level crosses a threshold -
 * edge-detected against the previous render's level, and explicitly
 * suppressed on this hook's very first real observation after
 * GrowthEngine finishes loading (section 16 wants an immediate level
 * display and celebration while running; without this guard, a returning
 * high-level user would see a false "LEVEL UP" the moment their saved
 * profile loads in).
 */
export function useLiveGrowth(
  growthEngine: GrowthEngine,
  timerEngine: TimerEngine,
  onLevelUp?: (newLevel: number) => void
): { nickname: string; growth: GrowthProgress } {
  const committed = useSyncExternalStore(
    (cb) => growthEngine.subscribe(cb),
    () => growthEngine.getSnapshot(),
    () => growthEngine.getSnapshot()
  );
  const timerSnapshot = useSyncExternalStore<TimerSnapshot>(
    (cb) => timerEngine.subscribe(cb),
    () => timerEngine.getSnapshot(),
    () => timerEngine.getSnapshot()
  );

  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (timerSnapshot.status !== "running") return;
    const id = setInterval(tick, TIMER_HUD_TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [timerSnapshot.status]);

  // Exactly the same "live delta since last commit" formula documented in
  // TimerHUD/TimerFloatingMenuSection: getElapsedMs() includes the live
  // running segment, snapshot.accumulatedMs only ever changes at the same
  // commit points GrowthEngine.addWorkMs is fed from, so the two are
  // always in lockstep except for whatever hasn't been committed yet.
  const liveDeltaMs = Math.max(0, timerEngine.getElapsedMs() - timerSnapshot.accumulatedMs);
  const effectiveTotalWorkMs = committed.totalWorkMs + liveDeltaMs;
  const growth = calculateGrowth(effectiveTotalWorkMs);

  const lastLevelRef = useRef<number | null>(null);
  useEffect(() => {
    if (!committed.loaded) return;
    if (lastLevelRef.current === null) {
      lastLevelRef.current = growth.level;
      return;
    }
    if (growth.level > lastLevelRef.current) {
      onLevelUp?.(growth.level);
    }
    lastLevelRef.current = growth.level;
    // onLevelUp intentionally excluded - callers may pass a fresh closure
    // each render (DesktopAvatarScene's useCallback keeps it stable
    // anyway); re-subscribing this effect on that alone would risk
    // double-firing if it ever weren't memoized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [growth.level, committed.loaded]);

  return { nickname: committed.nickname, growth };
}
