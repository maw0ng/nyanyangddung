"use client";

import { useEffect, useReducer } from "react";
import type { TimerEngine } from "./TimerEngine";
import { formatElapsed, statusLabel } from "./timerFormat";
import { TIMER_HUD_GAP, TIMER_HUD_TICK_INTERVAL_MS } from "./timerHudConfig";

/**
 * "캐릭터 발 바로 아래" status readout - no buttons, no opaque card, just
 * time + status floating under the character like part of the same
 * Desktop Pet. Ticks on its own local interval, reading
 * TimerEngine.getElapsedMs() fresh each time, entirely decoupled from
 * DesktopAvatarScene's own (rare, transition-only) rerenders - this is the
 * ONLY thing in the whole Desktop Avatar window that re-renders every
 * second, and it's a small DOM node outside the Canvas, so it never
 * touches R3F/the character/CanvasTexture/Morph/AnimationMixer.
 *
 * Deliberately NOT position:fixed/absolute with its own top/left - it must
 * be rendered as the next child directly below AvatarViewport inside
 * DesktopAvatarArea (see DesktopAvatarScene.tsx), so normal flex flow
 * glues it under the character's actual box and keeps it horizontally
 * centered on the character, not on the (resizable, and therefore
 * variable-width) BrowserWindow as a whole. Only the gap above it is a
 * tunable constant (TIMER_HUD_GAP).
 *
 * pointer-events: none throughout - purely decorative, so it can never
 * interfere with DesktopInteractionLayer's 3D raycast hit-testing or the
 * click-through state machine, which never look at this DOM node at all.
 */
/** `scale` is the Avatar Scale brief's `hudScale` (section 12) - deliberately
 * NOT the same as avatarScale (clamped to a narrower 0.8-1.25 range - see
 * ../desktopAvatarLayout.ts) so the HUD stays readable at 50% avatar size
 * and doesn't dominate the screen at 150%. */
export default function TimerHUD({ engine, scale }: { engine: TimerEngine; scale: number }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const id = setInterval(tick, TIMER_HUD_TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const snapshot = engine.getSnapshot();
  if (snapshot.status === "idle") return null;

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
        {formatElapsed(engine.getElapsedMs())}
      </div>
      <div
        style={{
          marginTop: Math.round(2 * scale),
          fontSize: Math.round(11 * scale),
          color: "rgba(255,255,255,0.88)",
          textShadow: "0 1px 2px rgba(0,0,0,0.5)",
        }}
      >
        {statusLabel(snapshot.status)}
      </div>
    </div>
  );
}
