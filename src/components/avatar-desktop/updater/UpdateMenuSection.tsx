"use client";

/**
 * Manual update check UI (section 20) - lives inside the floating menu's
 * "설정" panel, next to AvatarScaleSettings (see DesktopAvatarScene.tsx),
 * matching this app's existing "small block, own section title" convention
 * (AvatarScaleSettings/CoWorkMenuSection). Shows exactly the states
 * useAppUpdater/electron/updater.ts can produce - never invents an
 * additional UI-only state.
 */

const rowButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 0",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "#eef0f4",
  fontSize: 12,
  cursor: "pointer",
};

function statusLine(state: UpdateState): string | null {
  switch (state.status) {
    case "checking":
      return "업데이트 확인 중...";
    case "available":
      return `새 버전 발견됨 (${state.availableVersion ?? ""})`;
    case "downloading":
      return `다운로드 중... ${state.progressPercent ?? 0}%`;
    case "downloaded":
      return `업데이트 준비됨 (${state.availableVersion ?? ""})`;
    case "upToDate":
      return "최신 버전입니다.";
    case "error":
      return "업데이트 확인에 실패했습니다.";
    case "idle":
    default:
      return null;
  }
}

export default function UpdateMenuSection({
  state,
  onCheck,
  onInstall,
}: {
  state: UpdateState;
  onCheck: () => void;
  onInstall: () => void;
}) {
  const busy = state.status === "checking" || state.status === "downloading";
  const line = statusLine(state);

  return (
    <div style={{ padding: "6px 4px" }}>
      <div style={{ fontSize: 11, color: "#9aa0aa", marginBottom: 4 }}>업데이트</div>
      <div style={{ fontSize: 12, color: "#eef0f4", marginBottom: 6, fontVariantNumeric: "tabular-nums" }}>
        {`현재 버전 ${state.currentVersion}`}
      </div>
      {line && <div style={{ fontSize: 11, color: "#9aa0aa", marginBottom: 6 }}>{line}</div>}
      {state.status === "downloaded" ? (
        <button type="button" style={rowButtonStyle} onClick={onInstall}>
          지금 재시작
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          style={{ ...rowButtonStyle, opacity: busy ? 0.5 : 1, cursor: busy ? "default" : "pointer" }}
          onClick={onCheck}
        >
          업데이트 확인
        </button>
      )}
    </div>
  );
}
