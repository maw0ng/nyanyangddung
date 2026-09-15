"use client";

import { AVATAR_SCALE_PRESETS } from "../desktopAvatarLayout";

const presetButtonStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "5px 0",
  borderRadius: 6,
  border: active ? "1px solid rgba(122,168,255,0.6)" : "1px solid rgba(255,255,255,0.14)",
  background: active ? "rgba(122,168,255,0.22)" : "rgba(255,255,255,0.06)",
  color: "#eef0f4",
  fontSize: 11,
  cursor: "pointer",
});

interface AvatarScaleSettingsProps {
  avatarScale: number;
  onChange: (scale: number) => void;
  onCommit: () => void;
}

/**
 * "캐릭터 크기" slider + quick presets (section 8/30) - lives inside the
 * floating menu's "설정" panel (see DesktopMenu.tsx), not a new settings
 * window. `onChange` fires live on every slider movement (so the avatar
 * visibly resizes immediately - section 9); `onCommit` fires only on
 * release/preset-click and is what actually persists to disk (section 7 -
 * never write-per-tick).
 */
export default function AvatarScaleSettings({ avatarScale, onChange, onCommit }: AvatarScaleSettingsProps) {
  const percent = Math.round(avatarScale * 100);

  return (
    <div style={{ padding: "6px 4px" }}>
      <div style={{ fontSize: 11, color: "#9aa0aa", marginBottom: 4 }}>캐릭터 크기</div>
      <input
        type="range"
        min={50}
        max={150}
        step={5}
        value={percent}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        style={{ width: "100%" }}
      />
      <div
        style={{
          textAlign: "center",
          fontSize: 12,
          color: "#eef0f4",
          fontVariantNumeric: "tabular-nums",
          marginBottom: 6,
        }}
      >
        {percent}%
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {AVATAR_SCALE_PRESETS.map((preset) => {
          const active = Math.abs(avatarScale - preset) < 0.001;
          return (
            <button
              key={preset}
              type="button"
              style={presetButtonStyle(active)}
              onClick={() => {
                onChange(preset);
                onCommit();
              }}
            >
              {Math.round(preset * 100)}%
            </button>
          );
        })}
      </div>
    </div>
  );
}
