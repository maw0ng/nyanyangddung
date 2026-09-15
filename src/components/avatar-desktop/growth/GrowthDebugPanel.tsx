"use client";

import type { GrowthEngine } from "./GrowthEngine";

/**
 * Dev-only Growth debug helper (section 29) - lets a developer cross a
 * level-up threshold without waiting real hours. Routes through
 * GrowthEngine.devAddExp(), which itself only ever calls the same
 * addWorkMs() path a real committed timer segment does, so it can't
 * desync growth bookkeeping. The caller (DesktopAvatarScene) only renders
 * this when `process.env.NODE_ENV !== "production"` - same gate as
 * ../DesktopDebugOverlay.tsx - so it never ships in the packaged app and
 * never appears for a real user.
 */
export default function GrowthDebugPanel({ engine }: { engine: GrowthEngine }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 4,
        right: 4,
        display: "flex",
        gap: 4,
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={() => engine.devAddExp(1)}
        style={{
          fontSize: 10,
          fontFamily: "monospace",
          color: "#9ad1ff",
          background: "rgba(0,0,0,0.45)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 4,
          padding: "2px 5px",
          cursor: "pointer",
        }}
      >
        +1 EXP
      </button>
      <button
        type="button"
        onClick={() => engine.devAddExp(60)}
        style={{
          fontSize: 10,
          fontFamily: "monospace",
          color: "#9ad1ff",
          background: "rgba(0,0,0,0.45)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: 4,
          padding: "2px 5px",
          cursor: "pointer",
        }}
      >
        +60 EXP
      </button>
    </div>
  );
}
