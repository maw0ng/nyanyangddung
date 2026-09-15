"use client";

/** How long the banner stays mounted (section 17) - matches the CSS
 * animation's own total duration below. Kept as a named export so
 * DesktopAvatarScene's setTimeout that unmounts this component uses the
 * exact same number instead of a second, potentially-drifting constant. */
export const LEVEL_UP_BANNER_DURATION_MS = 2200;

/**
 * Small "LEVEL UP! / Lv.N" pop-and-fade (section 17) - a plain CSS
 * @keyframes animation, no particle/animation library. Rendered as a flex
 * child directly above AvatarViewport (between it and AvatarProfileHUD) in
 * DesktopAvatarScene.tsx, so while mounted it briefly occupies its own
 * layout space rather than needing precise absolute-position math against
 * a variable-height ProfileHUD; it unmounts itself (via the parent's
 * setTimeout) well before that's ever visually awkward.
 *
 * pointer-events: none, same as every other Desktop HUD element (section
 * 24) - purely decorative.
 */
export default function LevelUpBanner({ level, scale = 1 }: { level: number; scale?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
        userSelect: "none",
        animation: `miniwaffleLevelUpPop ${LEVEL_UP_BANNER_DURATION_MS}ms ease-out forwards`,
      }}
    >
      <style>{`
        @keyframes miniwaffleLevelUpPop {
          0% { opacity: 0; transform: scale(0.8) translateY(4px); }
          15% { opacity: 1; transform: scale(1.08) translateY(0); }
          25% { transform: scale(1); }
          75% { opacity: 1; }
          100% { opacity: 0; transform: scale(1) translateY(-4px); }
        }
      `}</style>
      <div
        style={{
          fontSize: Math.round(12 * scale),
          fontWeight: 700,
          letterSpacing: 1,
          color: "#ffe58a",
          textShadow: "0 1px 3px rgba(0,0,0,0.6)",
        }}
      >
        LEVEL UP!
      </div>
      <div
        style={{
          fontSize: Math.round(14 * scale),
          fontWeight: 700,
          color: "#ffffff",
          textShadow: "0 1px 3px rgba(0,0,0,0.6)",
        }}
      >
        {`Lv.${level}`}
      </div>
    </div>
  );
}
