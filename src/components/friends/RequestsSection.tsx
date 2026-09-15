"use client";

import { useState } from "react";
import { friendService } from "../../lib/supabase/friendService";
import type { FriendRequestItem } from "../../lib/supabase/database.types";
import * as s from "./friendsStyles";

/**
 * Incoming (section 19) + outgoing (section 20) pending requests. Each row
 * tracks its own busy state so accepting/rejecting/cancelling one request
 * disables only that row's buttons, not the whole list, and a request
 * that's mid-flight can't be double-actioned (section 40).
 */
export default function RequestsSection({
  incoming,
  outgoing,
  onChanged,
}: {
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept(requestId: string) {
    setBusyId(requestId);
    setError(null);
    const res = await friendService.acceptFriendRequest(requestId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
  }

  async function handleReject(requestId: string) {
    setBusyId(requestId);
    setError(null);
    const res = await friendService.rejectFriendRequest(requestId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
  }

  async function handleCancel(requestId: string) {
    setBusyId(requestId);
    setError(null);
    const res = await friendService.cancelFriendRequest(requestId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
  }

  if (incoming.length === 0 && outgoing.length === 0) return null;

  return (
    <div style={s.card}>
      {incoming.length > 0 && (
        <>
          <div style={s.sectionTitle}>{`받은 요청 ${incoming.length}`}</div>
          {incoming.map((req) => (
            <div
              key={req.requestId}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}
            >
              <div>
                <div style={{ fontSize: 13 }}>{req.profile.nickname}</div>
                <div style={s.mutedText}>{`Lv.${req.profile.level}`}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  disabled={busyId === req.requestId}
                  style={s.button("primary", busyId === req.requestId)}
                  onClick={() => handleAccept(req.requestId)}
                >
                  수락
                </button>
                <button
                  type="button"
                  disabled={busyId === req.requestId}
                  style={s.button("default", busyId === req.requestId)}
                  onClick={() => handleReject(req.requestId)}
                >
                  거절
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {outgoing.length > 0 && (
        <>
          <div style={{ ...s.sectionTitle, marginTop: incoming.length > 0 ? 12 : 0 }}>
            {`보낸 요청 ${outgoing.length}`}
          </div>
          {outgoing.map((req) => (
            <div
              key={req.requestId}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}
            >
              <div>
                <div style={{ fontSize: 13 }}>{req.profile.nickname}</div>
                <div style={s.mutedText}>요청 대기 중</div>
              </div>
              <button
                type="button"
                disabled={busyId === req.requestId}
                style={s.button("default", busyId === req.requestId)}
                onClick={() => handleCancel(req.requestId)}
              >
                요청 취소
              </button>
            </div>
          ))}
        </>
      )}

      {error && <div style={s.errorText}>{error}</div>}
    </div>
  );
}
