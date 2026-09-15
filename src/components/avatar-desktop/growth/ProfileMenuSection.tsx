"use client";

import { useEffect, useState } from "react";
import type { GrowthEngine } from "./GrowthEngine";
import type { TimerEngine } from "../timer/TimerEngine";
import { useLiveGrowth } from "./useLiveGrowth";
import { NICKNAME_MAX_LENGTH } from "./growthConfig";

const rowButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 0",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "#eef0f4",
  fontSize: 12,
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  ...rowButtonStyle,
  background: "rgba(122,168,255,0.25)",
  border: "1px solid rgba(122,168,255,0.5)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "#eef0f4",
  fontSize: 12,
  marginBottom: 6,
};

/**
 * Read-only profile summary at the top of the floating menu (section 23),
 * with an inline "✎" edit affordance for the nickname (section 3) - kept
 * self-contained (its own `editing` step state, reset when the menu
 * closes) rather than threading a new boolean through
 * DesktopAvatarScene/DesktopMenu, matching this project's existing
 * convention of colocating a feature's own small wizard state inside its
 * own menu-section component (see ../timer/TimerFloatingMenuSection.tsx).
 *
 * Uses the SAME useLiveGrowth hook (and therefore the exact same live
 * numbers) as AvatarProfileHUDLive, so the menu can never show a different
 * level/EXP than the HUD does at the same instant.
 */
export default function ProfileMenuSection({
  growthEngine,
  timerEngine,
  open,
}: {
  growthEngine: GrowthEngine;
  timerEngine: TimerEngine;
  open: boolean;
}) {
  const { nickname, growth } = useLiveGrowth(growthEngine, timerEngine);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setError(null);
    }
  }, [open]);

  if (editing) {
    return (
      <div style={{ padding: "4px" }}>
        <div style={{ fontSize: 11, color: "#9aa0aa", marginBottom: 4 }}>닉네임</div>
        <input
          style={inputStyle}
          value={draft}
          maxLength={NICKNAME_MAX_LENGTH}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <div style={{ fontSize: 11, color: "#ff9b9b", marginBottom: 6 }}>{error}</div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            style={rowButtonStyle}
            onClick={() => {
              setDraft(nickname);
              setError(null);
              setEditing(false);
            }}
          >
            취소
          </button>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => {
              const result = growthEngine.setNickname(draft);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setEditing(false);
            }}
          >
            저장
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "6px 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#eef0f4",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {nickname}
        </div>
        <button
          type="button"
          onClick={() => {
            setDraft(nickname);
            setEditing(true);
          }}
          title="닉네임 변경"
          style={{
            background: "transparent",
            border: "none",
            color: "#9ad1ff",
            fontSize: 11,
            cursor: "pointer",
            padding: "0 0 0 8px",
          }}
        >
          닉네임 변경
        </button>
      </div>
      <div style={{ fontSize: 11, color: "#9aa0aa", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
        {`Lv.${growth.level} · ${growth.currentExp}/${growth.requiredExp} EXP`}
      </div>
      <div
        style={{
          marginTop: 4,
          width: "100%",
          height: 4,
          borderRadius: 2,
          background: "rgba(255,255,255,0.1)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(1, growth.progress)) * 100}%`,
            height: "100%",
            borderRadius: 2,
            background: "#7aa8ff",
          }}
        />
      </div>
    </div>
  );
}
