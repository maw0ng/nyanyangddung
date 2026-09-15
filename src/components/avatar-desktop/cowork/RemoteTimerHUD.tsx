"use client";

import { useEffect, useReducer } from "react";
import { formatElapsed } from "../timer/timerFormat";
import { TIMER_HUD_GAP, TIMER_HUD_TICK_INTERVAL_MS } from "../timer/timerHudConfig";
import { COWORK_STALE_MS } from "./coworkTimerConfig";
import { computeDisplayElapsedMs } from "./coworkTimerProjection";
import type { CoworkPublicTimerState } from "../../../lib/supabase/database.types";

/**
 * Remote counterpart of ../timer/TimerHUD.tsx (section 23/24) - same
 * visual language (reuses formatElapsed/TIMER_HUD_GAP/
 * TIMER_HUD_TICK_INTERVAL_MS directly, section 18's "공통 재사용 가능한
 * 부분") and the same self-contained local-interval tick pattern (never a
 * DB write, never a parent rerender - section 26), but sources its number
 * from a `CoworkPublicTimerState` (Realtime + DB, low frequency) instead
 * of a live TimerEngine. Deliberately a SEPARATE component from TimerHUD
 * rather than a shared "variant" prop - Local's file stays completely
 * unmodified (section 0/79's regression-safety), only the display
 * formatting/config constants are actually shared.
 *
 * Status/animation states (section 24): working/break show the elapsed
 * number; idle and stale (no state row yet, or one older than
 * COWORK_STALE_MS - section 19/20) hide the number entirely and show only
 * a label - "대기 중" / "상태 확인 중". Stale freezes the displayed number
 * rather than continuing to add live elapsed against a now-ancient
 * `runningSince` (section 19's "Timer 증가를 멈춘다").
 */
export type RemoteTimerStatus = "idle" | "working" | "break" | "stale";

export function remoteTimerStatusFor(state: CoworkPublicTimerState | null): RemoteTimerStatus {
  if (!state) return "idle";
  const isStale = Date.now() - new Date(state.updatedAt).getTime() > COWORK_STALE_MS;
  if (isStale) return "stale";
  return state.status;
}

/** Exported for reuse by the CoWork Room window's own simple text-badge
 * participant list (section 48) - same label strings, no duplication. */
export function remoteStatusLabel(status: RemoteTimerStatus): string {
  switch (status) {
    case "working":
      return "작업 중";
    case "break":
      return "휴식 중";
    case "stale":
      return "상태 확인 중";
    case "idle":
    default:
      return "대기 중";
  }
}

export default function RemoteTimerHUD({ state, scale }: { state: CoworkPublicTimerState | null; scale: number }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, TIMER_HUD_TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const status = remoteTimerStatusFor(state);
  const showNumber = status === "working" || status === "break";
  const label = remoteStatusLabel(status);
  const displayElapsedMs = state
    ? computeDisplayElapsedMs({
        // Stale freezes the number (section 19) - never keep adding live
        // elapsed against a `runningSince` from a connection that's gone
        // quiet, by simply not treating it as "working" here.
        status: status === "stale" ? "break" : state.status,
        elapsedMs: state.elapsedMs,
        runningSince: state.runningSince,
      })
    : 0;

  return (
    <div
      style={{
        marginTop: Math.round(TIMER_HUD_GAP * scale),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {showNumber && (
        <div
          style={{
            fontSize: Math.round(20 * scale),
            fontWeight: 600,
            letterSpacing: 0.5,
            color: "#ffffff",
            textShadow: "0 1px 3px rgba(0,0,0,0.55)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatElapsed(displayElapsedMs)}
        </div>
      )}
      <div
        style={{
          marginTop: Math.round(2 * scale),
          fontSize: Math.round(11 * scale),
          color: "rgba(255,255,255,0.88)",
          textShadow: "0 1px 2px rgba(0,0,0,0.5)",
        }}
      >
        {label}
      </div>
    </div>
  );
}
