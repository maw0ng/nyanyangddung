import type { TimerSnapshot } from "../timer/TimerEngine";
import type { CoworkPublicTimerStatus } from "../../../lib/supabase/database.types";

export interface ProjectedCoworkState {
  status: CoworkPublicTimerStatus;
  elapsedMs: number;
  runningSince: string | null;
}

/**
 * Local Timer -> public CoWork projection (section 3/59 of the cowork-
 * timer-sync brief) - a small, near-pure function, kept deliberately
 * decoupled from TimerEngine/Supabase so neither ever needs to know about
 * the other. Reads ONLY `status`/`accumulatedMs`/`runningStartedAt` off
 * the snapshot - never `title`/`targetApps`/`currentIntervalApp` (section
 * 2/41's privacy guarantee: those fields are structurally never even
 * touched here, let alone sent anywhere).
 *
 * Mapping (section 3):
 *   idle                    -> idle
 *   running                 -> working
 *   manualPaused/autoPaused -> break   (never distinguished to Remote -
 *                                        section 2/71 "pause 원인을 노출
 *                                        하지 않는다")
 *
 * `elapsedMs`/`runningSince` are the exact BASELINE TimerEngine already
 * tracks internally (accumulatedMs + a running-segment start timestamp,
 * never a getElapsedMs() snapshot at call time) - so the Remote side can
 * reconstruct the same live number Local's own TimerHUD shows purely from
 * `elapsedMs + (now - runningSince)`, with no new stopwatch invented here
 * (section 4/6).
 */
export function projectTimerToCoworkState(snapshot: TimerSnapshot): ProjectedCoworkState {
  if (snapshot.status === "idle") {
    return { status: "idle", elapsedMs: 0, runningSince: null };
  }
  if (snapshot.status === "running") {
    return {
      status: "working",
      elapsedMs: snapshot.accumulatedMs,
      runningSince: snapshot.runningStartedAt !== null ? new Date(snapshot.runningStartedAt).toISOString() : null,
    };
  }
  // manualPaused | autoPaused
  return { status: "break", elapsedMs: snapshot.accumulatedMs, runningSince: null };
}

/** Live "what would Local's own TimerHUD show right now" reconstruction
 * from a projected/received state - the SAME formula both
 * useCoworkTimerSync (to detect whether a re-upsert is actually needed)
 * and RemoteTimerHUD (to render) use, so they can never disagree (section
 * 6). Clamped at 0 so a clock-skewed `runningSince` in the future never
 * produces a negative number (section 22 - deliberately no full NTP-style
 * correction, just this floor). */
export function computeDisplayElapsedMs(state: {
  status: CoworkPublicTimerStatus;
  elapsedMs: number;
  runningSince: string | null;
}): number {
  if (state.status === "working" && state.runningSince) {
    const delta = Date.now() - new Date(state.runningSince).getTime();
    return state.elapsedMs + Math.max(0, delta);
  }
  return state.elapsedMs;
}
