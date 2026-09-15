"use client";

import { useState } from "react";
import type { CoworkResult } from "../../lib/supabase/coworkRoomService";
import { normalizeRoomCode } from "../../lib/supabase/coworkRoomService";
import type { CoworkRoom } from "../../lib/supabase/database.types";
import * as s from "./coworkStyles";

/**
 * The "no active room yet" screen (section 1/2) - a create button and a
 * code-entry+join form, nothing else. Deliberately no room list/browse UI
 * anywhere (section 0 - Room Code is the only discovery mechanism, by
 * design).
 */
export default function CreateJoinPanel({
  onCreate,
  onJoin,
  endedNotice,
  onDismissEndedNotice,
}: {
  onCreate: () => Promise<CoworkResult<CoworkRoom>>;
  onJoin: (code: string) => Promise<CoworkResult<CoworkRoom>>;
  endedNotice: boolean;
  onDismissEndedNotice: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    const res = await onCreate();
    setCreating(false);
    if (!res.ok) setCreateError(res.error);
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (joining || !code.trim()) return;
    setJoining(true);
    setJoinError(null);
    const res = await onJoin(code);
    setJoining(false);
    if (!res.ok) {
      setJoinError(res.error);
      return;
    }
    setCode("");
  }

  return (
    <div>
      <h1 style={{ fontSize: 16, marginTop: 0 }}>같이 작업하기</h1>

      {endedNotice && (
        <div style={{ ...s.card, borderColor: "#4a3f2a" }}>
          <div style={{ fontSize: 13 }}>작업방이 종료되었습니다.</div>
          <button type="button" style={{ ...s.button(), marginTop: 8 }} onClick={onDismissEndedNotice}>
            확인
          </button>
        </div>
      )}

      <div style={s.card}>
        <button type="button" disabled={creating} style={{ ...s.button("primary", creating), width: "100%" }} onClick={handleCreate}>
          {creating ? "작업방 만드는 중..." : "작업방 만들기"}
        </button>
        {createError && <div style={s.errorText}>{createError}</div>}
      </div>

      <div style={s.card}>
        <div style={s.sectionTitle}>방 코드</div>
        <form onSubmit={handleJoin}>
          <input
            style={{ ...s.input, textTransform: "uppercase", fontFamily: "monospace", letterSpacing: 1 }}
            placeholder="H7KM-4Q2P"
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
          />
          {joinError && <div style={s.errorText}>{joinError}</div>}
          <button
            type="submit"
            disabled={joining || !code.trim()}
            style={{ ...s.button("default", joining || !code.trim()), width: "100%", marginTop: 4 }}
          >
            {joining ? "입장 중..." : "입장"}
          </button>
        </form>
      </div>
    </div>
  );
}
