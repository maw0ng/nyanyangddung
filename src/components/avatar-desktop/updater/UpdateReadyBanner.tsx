"use client";

/**
 * Small proactive "새 버전이 준비되었습니다" notice (section 19) - shown
 * only while state.status === "downloaded" and the user hasn't already
 * dismissed THIS version (see DesktopAvatarScene.tsx's dismissal state,
 * keyed by availableVersion so a later update re-shows even if an earlier
 * one was dismissed). Never a modal/dialog - a single compact row with two
 * text actions, matching this app's existing "no bounding box, minimal
 * chrome" HUD language (LevelUpBanner/AvatarProfileHUD). Never auto-installs
 * (section 14) - "지금 재시작" is the only path to installUpdate().
 */
export default function UpdateReadyBanner({
  scale = 1,
  onRestart,
  onDismiss,
}: {
  scale?: number;
  onRestart: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: Math.round(6 * scale),
        padding: `${Math.round(4 * scale)}px ${Math.round(8 * scale)}px`,
        borderRadius: 8,
        background: "rgba(24,24,28,0.85)",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        userSelect: "none",
      }}
    >
      <span style={{ fontSize: Math.round(11 * scale), color: "#eef0f4" }}>새 버전이 준비되었습니다</span>
      <button
        type="button"
        onClick={onRestart}
        style={{
          fontSize: Math.round(11 * scale),
          fontWeight: 600,
          color: "#7aa8ff",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        지금 재시작
      </button>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          fontSize: Math.round(11 * scale),
          color: "#9aa0aa",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        나중에
      </button>
    </div>
  );
}
