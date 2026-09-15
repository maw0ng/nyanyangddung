"use client";

import { useState } from "react";
import { friendService } from "../../lib/supabase/friendService";
import type { FriendListItem } from "../../lib/supabase/database.types";
import * as s from "./friendsStyles";

/**
 * Friend list (section 21) - deliberately no online/working/timer info
 * yet (that's Realtime Presence, a later phase - section 49); each row is
 * just nickname + level. Clicking "삭제" asks for confirmation inline
 * (section 22) before actually calling removeFriend - never a silent
 * one-click delete.
 */
export default function FriendsList({
  friends,
  onChanged,
}: {
  friends: FriendListItem[];
  onChanged: () => void;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirmDelete(userId: string) {
    setBusyId(userId);
    setError(null);
    const res = await friendService.removeFriend(userId);
    setBusyId(null);
    setConfirmingId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
  }

  return (
    <div style={s.card}>
      <div style={s.sectionTitle}>{`친구 ${friends.length}`}</div>
      {friends.length === 0 && <div style={s.mutedText}>아직 친구가 없습니다.</div>}
      {friends.map((friend) => (
        <div key={friend.userId} style={{ padding: "6px 0" }}>
          {confirmingId === friend.userId ? (
            <div>
              <div style={{ fontSize: 13, marginBottom: 6 }}>{`${friend.nickname}님을 친구에서 삭제할까요?`}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  style={s.button("default", busyId === friend.userId)}
                  disabled={busyId === friend.userId}
                  onClick={() => setConfirmingId(null)}
                >
                  취소
                </button>
                <button
                  type="button"
                  style={s.button("danger", busyId === friend.userId)}
                  disabled={busyId === friend.userId}
                  onClick={() => handleConfirmDelete(friend.userId)}
                >
                  삭제
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13 }}>{friend.nickname}</div>
                <div style={s.mutedText}>{`Lv.${friend.level}`}</div>
              </div>
              <button type="button" style={s.button()} onClick={() => setConfirmingId(friend.userId)}>
                친구 삭제
              </button>
            </div>
          )}
        </div>
      ))}
      {error && <div style={s.errorText}>{error}</div>}
    </div>
  );
}
