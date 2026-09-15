"use client";

/**
 * Pure presentational "위 HUD" (section 4/5/14/15) - nickname, level,
 * current/required EXP, and a thin progress bar, styled to match the
 * Desktop Pet aesthetic (small text, thin bar, faint shadow only - no big
 * opaque panel). Deliberately takes plain primitive props rather than a
 * GrowthEngine/TimerEngine instance (section 27 - "props 개념으로 재사용
 * 가능하게 만든다") so a future friend's HUD can reuse this exact
 * component fed from Supabase/realtime data instead of the local engines;
 * the live-ticking/level-up-detection logic that produces these props for
 * the LOCAL user lives one layer up, in useLiveGrowth.ts +
 * AvatarProfileHUDLive.tsx.
 *
 * pointer-events: none throughout (section 24) - purely decorative, same
 * reasoning as ../timer/TimerHUD.tsx.
 */
export interface AvatarProfileHUDProps {
  nickname: string;
  level: number;
  /** Omit (or leave `minimal`) for a nickname+Lv-only HUD - used by remote
   * Room participants (Desktop-avatar-rendering brief, section 9/51), who
   * don't have a live currentExp/requiredExp/progress to show yet. */
  currentExp?: number;
  requiredExp?: number;
  /** 0..1 */
  progress?: number;
  /** True to render just nickname + Lv, no EXP row/bar (section 9/51 -
   * remote participants). Defaults to false (the original, full local
   * HUD) so every existing call site is unaffected. */
  minimal?: boolean;
  /** hudScale (section 12 of the Avatar Scale brief) - independent of and
   * more conservative than avatarScale, so this stays readable at 50% and
   * doesn't dominate the screen at 150%. Defaults to 1 for any future
   * caller (e.g. a not-yet-built friend HUD) that doesn't care about
   * Desktop Mode's own scale clamping. */
  scale?: number;
}

export default function AvatarProfileHUD({
  nickname,
  level,
  currentExp,
  requiredExp,
  progress,
  minimal = false,
  scale = 1,
}: AvatarProfileHUDProps) {
  const clampedProgress = Math.max(0, Math.min(1, progress ?? 0));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
        userSelect: "none",
        maxWidth: "100%",
      }}
    >
      <div
        style={{
          fontSize: Math.round(12 * scale),
          fontWeight: 600,
          color: "#ffffff",
          textShadow: "0 1px 2px rgba(0,0,0,0.55)",
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {nickname}
      </div>
      <div
        style={{
          marginTop: 1,
          fontSize: Math.round(11 * scale),
          color: "rgba(255,255,255,0.92)",
          textShadow: "0 1px 2px rgba(0,0,0,0.5)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {minimal ? `Lv.${level}` : `Lv.${level} · ${currentExp}/${requiredExp}`}
      </div>
      {!minimal && (
        <div
          style={{
            marginTop: 3,
            width: Math.round(84 * scale),
            height: 4,
            borderRadius: 2,
            background: "rgba(255,255,255,0.28)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${clampedProgress * 100}%`,
              height: "100%",
              borderRadius: 2,
              background: "#8fd3ff",
            }}
          />
        </div>
      )}
    </div>
  );
}
