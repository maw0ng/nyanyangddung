"use client";

/**
 * Remote-avatar click popup (section 26) - deliberately minimal: nickname/
 * Lv + a one-line "같은 작업방 참가자" label, nothing else. No DM/친구추가/
 * 강퇴/프로필 상세/Timer history - explicitly out of scope this phase.
 * Closes on outside click via the backdrop, matching the Floating Menu's
 * own "click elsewhere closes it" feel without sharing any of its code
 * (section 27 - Local's Floating Menu must stay completely unaffected by
 * this).
 */
export default function ParticipantPopup({
  nickname,
  level,
  onClose,
}: {
  nickname: string;
  level: number;
  onClose: () => void;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 40 }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 41,
          minWidth: 160,
          padding: "12px 14px",
          borderRadius: 10,
          background: "rgba(24,24,28,0.92)",
          border: "1px solid rgba(255,255,255,0.14)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          color: "#eef0f4",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>{nickname}</div>
        <div style={{ fontSize: 12, color: "#9ad1ff", marginTop: 2 }}>{`Lv.${level}`}</div>
        <div style={{ fontSize: 11, color: "#9aa0aa", marginTop: 8 }}>같은 작업방 참가자</div>
      </div>
    </>
  );
}
