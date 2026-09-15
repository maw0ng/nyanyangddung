"use client";

import { useAuthSession } from "../../lib/supabase/useAuthSession";
import { useCoWorkRoom } from "../../lib/supabase/useCoWorkRoom";
import { isSupabaseConfigured } from "../../lib/supabase/client";
import AuthView from "../friends/AuthView";
import CreateJoinPanel from "./CreateJoinPanel";
import RoomView from "./RoomView";
import * as s from "./coworkStyles";

/**
 * Top-level CoWork window content - mirrors FriendsApp.tsx's own state
 * machine (not-configured / not-logged-in / loading / content), reusing
 * the SAME generic AuthView the Friends window already uses (section 5 -
 * login is required for create/join, but this is not a new auth flow, just
 * the existing one shown from a second window). Renders one of four
 * states:
 *   1. Supabase not configured (section 5's "not logged in" still requires
 *      Supabase to be configured in the first place - offline/unconfigured
 *      Desktop Pet must still be usable elsewhere).
 *   2. Not logged in -> "같이 작업 기능을 사용하려면 로그인이 필요합니다." +
 *      AuthView (section 5).
 *   3. No active room -> CreateJoinPanel (section 1/2).
 *   4. Active room -> RoomView (section 17).
 */
export default function CoWorkApp() {
  const { session, checked, userId } = useAuthSession();
  const room = useCoWorkRoom(userId);

  if (!isSupabaseConfigured()) {
    return (
      <div style={s.page}>
        <h1 style={{ fontSize: 16, marginTop: 0 }}>같이 작업하기</h1>
        <div style={s.card}>
          <div style={{ fontSize: 13 }}>계정 기능을 사용할 수 없습니다.</div>
          <div style={s.mutedText}>Supabase 설정이 필요합니다 (.env.local).</div>
        </div>
      </div>
    );
  }

  if (!checked) {
    return (
      <div style={s.page}>
        <h1 style={{ fontSize: 16, marginTop: 0 }}>같이 작업하기</h1>
        <div style={s.mutedText}>불러오는 중...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={s.page}>
        <h1 style={{ fontSize: 16, marginTop: 0 }}>같이 작업하기</h1>
        <div style={{ fontSize: 13, marginBottom: 12, color: "#9aa0aa" }}>
          같이 작업 기능을 사용하려면 로그인이 필요합니다.
        </div>
        <AuthView />
      </div>
    );
  }

  return (
    <div style={s.page}>
      {room.error && <div style={s.errorText}>{room.error}</div>}
      {room.loading ? (
        <div style={s.mutedText}>불러오는 중...</div>
      ) : room.room ? (
        <RoomView room={room.room} members={room.members} onLeave={room.leaveRoom} />
      ) : (
        <CreateJoinPanel
          onCreate={room.createRoom}
          onJoin={room.joinRoom}
          endedNotice={room.endedNotice}
          onDismissEndedNotice={room.dismissEndedNotice}
        />
      )}
    </div>
  );
}
