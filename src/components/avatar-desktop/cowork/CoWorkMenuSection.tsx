"use client";

/**
 * Floating-menu room summary (section 17/42 of the cowork-room brief) -
 * shown at the top of the menu INSTEAD of the plain "같이 작업하기" item
 * whenever the user currently has an active room (see DesktopMenu.tsx's
 * `hasCoworkRoom` prop). Deliberately minimal: room code + member count +
 * [작업방 보기]/[작업방 나가기] - the full participant list/copy button
 * live in the separate CoWork window (section 43), never crammed in here.
 */

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

export default function CoWorkMenuSection({
  roomCode,
  memberCount,
  onOpenWindow,
  onLeave,
  leaving,
}: {
  roomCode: string;
  memberCount: number;
  onOpenWindow: () => void;
  onLeave: () => void;
  leaving: boolean;
}) {
  return (
    <div style={{ padding: "6px 4px" }}>
      <div style={{ fontSize: 11, color: "#9aa0aa" }}>{`같이 작업 중 · ${memberCount}명`}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
        {roomCode}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button type="button" style={rowButtonStyle} onClick={onOpenWindow}>
          작업방 보기
        </button>
        <button
          type="button"
          disabled={leaving}
          style={{ ...rowButtonStyle, opacity: leaving ? 0.5 : 1, cursor: leaving ? "default" : "pointer" }}
          onClick={onLeave}
        >
          {leaving ? "나가는 중..." : "작업방 나가기"}
        </button>
      </div>
    </div>
  );
}
