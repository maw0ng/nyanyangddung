"use client";

import { useState } from "react";
import type { CoworkResult } from "../../lib/supabase/coworkRoomService";
import type { CoworkRoom, CoworkRoomMemberView } from "../../lib/supabase/database.types";
import { useCoworkRoomStates } from "../avatar-desktop/cowork/useCoworkRoomStates";
import { remoteTimerStatusFor, remoteStatusLabel } from "../avatar-desktop/cowork/RemoteTimerHUD";
import * as s from "./coworkStyles";

/**
 * The "inside an active room" screen (section 17) - room code + copy,
 * participant list, and a leave button. Kept deliberately simple, not a
 * full SNS-style room screen, matching this app's existing Friends window
 * convention (see MyProfileCard.tsx). Each row now also shows a simple
 * text-only status badge (section 48 of the cowork-timer-sync brief -
 * "UI가 복잡해지면 Room Window는 간단한 text badge만") reusing the exact
 * same read-side hook and status labels the Desktop grid's RemoteTimerHUD
 * uses - no separate fetch/subscribe logic duplicated here.
 */
export default function RoomView({
  room,
  members,
  onLeave,
}: {
  room: CoworkRoom;
  members: CoworkRoomMemberView[];
  onLeave: () => Promise<CoworkResult<void>>;
}) {
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const memberStates = useCoworkRoomStates(room.id);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable/denied - non-fatal, the code is still
      // visible on screen to copy by hand. Works identically in the
      // Electron renderer (Chromium) and a plain browser tab - no
      // Electron-specific IPC needed for this (section 28).
    }
  }

  async function handleLeave() {
    setLeaving(true);
    setLeaveError(null);
    const res = await onLeave();
    setLeaving(false);
    if (!res.ok) {
      setLeaveError(res.error);
      return;
    }
    setConfirmingLeave(false);
  }

  return (
    <div>
      <h1 style={{ fontSize: 16, marginTop: 0 }}>{`같이 작업 중 · ${members.length} / ${room.maxMembers}명`}</h1>

      <div style={s.card}>
        <div style={s.sectionTitle}>방 코드</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 15,
              letterSpacing: 1,
              padding: "6px 10px",
              background: "#14161b",
              border: "1px solid #3a3f4b",
              borderRadius: 6,
              flex: 1,
            }}
          >
            {room.roomCode}
          </div>
          <button type="button" style={s.button()} onClick={handleCopy}>
            복사
          </button>
        </div>
        {copied && <div style={{ ...s.mutedText, marginTop: 6, color: "#7fd490" }}>방 코드가 복사되었습니다.</div>}
      </div>

      <div style={s.card}>
        <div style={s.sectionTitle}>참가자</div>
        {members.length === 0 && <div style={s.mutedText}>불러오는 중...</div>}
        {members.map((m) => (
          <div
            key={m.userId}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}
          >
            <div style={{ fontSize: 13 }}>{m.nickname}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={s.mutedText}>{remoteStatusLabel(remoteTimerStatusFor(memberStates.get(m.userId) ?? null))}</span>
              <span style={s.mutedText}>{`Lv.${m.level}`}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={s.card}>
        {confirmingLeave ? (
          <div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>작업방에서 나갈까요?</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                disabled={leaving}
                style={s.button("default", leaving)}
                onClick={() => setConfirmingLeave(false)}
              >
                취소
              </button>
              <button type="button" disabled={leaving} style={s.button("danger", leaving)} onClick={handleLeave}>
                {leaving ? "나가는 중..." : "작업방 나가기"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" style={{ ...s.button(), width: "100%" }} onClick={() => setConfirmingLeave(true)}>
            작업방 나가기
          </button>
        )}
        {leaveError && <div style={s.errorText}>{leaveError}</div>}
      </div>
    </div>
  );
}
