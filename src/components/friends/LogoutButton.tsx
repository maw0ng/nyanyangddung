"use client";

import { useState } from "react";
import { authService } from "../../lib/supabase/authService";
import { coworkRoomService } from "../../lib/supabase/coworkRoomService";
import * as s from "./friendsStyles";

/**
 * 로그아웃 button with a room-aware confirmation (section 27 of the
 * cowork-room brief) - logging out only ever clears the network account
 * session (never local CharacterPreset/Timer/Profile/Desktop settings, per
 * the account/friend-system brief's own section 10), but if the user
 * currently has an active co-working room, logging out would silently
 * leave it out from under any other participants still there - so this
 * checks first and asks for confirmation, then explicitly leaves the room
 * BEFORE signing out (never the reverse order, so a signOut failure can't
 * leave the room in a half-left state with no session left to retry from).
 */
export default function LogoutButton({ userId }: { userId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [hasRoom, setHasRoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    const roomRes = await coworkRoomService.getActiveRoom(userId);
    setHasRoom(roomRes.ok && !!roomRes.data);
    setConfirming(true);
  }

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    if (hasRoom) {
      const leaveRes = await coworkRoomService.leaveRoom();
      if (!leaveRes.ok) {
        setBusy(false);
        setError(leaveRes.error);
        return;
      }
    }
    const signOutRes = await authService.signOut();
    setBusy(false);
    if (!signOutRes.ok) {
      setError(signOutRes.error);
      return;
    }
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {hasRoom && (
          <span style={{ ...s.mutedText, maxWidth: 220 }}>
            현재 작업방에 참여 중입니다. 로그아웃하면 작업방에서 나가게 됩니다.
          </span>
        )}
        <button type="button" disabled={busy} style={s.button("default", busy)} onClick={() => setConfirming(false)}>
          취소
        </button>
        <button type="button" disabled={busy} style={s.button("danger", busy)} onClick={handleConfirm}>
          {busy ? "..." : "로그아웃"}
        </button>
        {error && <div style={s.errorText}>{error}</div>}
      </div>
    );
  }

  return (
    <button type="button" style={s.button()} onClick={handleClick}>
      로그아웃
    </button>
  );
}
