"use client";

import { useAuthSession } from "../../lib/supabase/useAuthSession";
import { isSupabaseConfigured } from "../../lib/supabase/client";
import { useFriendsData } from "./useFriendsData";
import AuthView from "./AuthView";
import MyProfileCard from "./MyProfileCard";
import AddFriendPanel from "./AddFriendPanel";
import RequestsSection from "./RequestsSection";
import FriendsList from "./FriendsList";
import LogoutButton from "./LogoutButton";
import * as s from "./friendsStyles";

/**
 * Top-level Friends window content (section 26) - deliberately simple:
 * 내 프로필 -> 친구 코드로 추가 -> 받은/보낸 요청 -> 친구 목록, no attempt
 * at a full SNS-style screen. Renders one of three states:
 *   1. Supabase not configured at all (section 11 - offline/unconfigured
 *      Desktop Pet must still be usable elsewhere; this window alone shows
 *      the explanation).
 *   2. Not logged in -> AuthView (section 3/27/28).
 *   3. Logged in -> the actual friends screen (section 21/26), with a
 *      로그아웃 button that only clears the network session (section 10 -
 *      never touches local CharacterPreset/Timer/Profile/Desktop settings,
 *      none of which this window even imports).
 */
export default function FriendsApp() {
  const { session, checked, userId } = useAuthSession();
  const data = useFriendsData(userId);

  if (!isSupabaseConfigured()) {
    return (
      <div style={s.page}>
        <h1 style={{ fontSize: 16, marginTop: 0 }}>친구</h1>
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
        <h1 style={{ fontSize: 16, marginTop: 0 }}>친구</h1>
        <div style={s.mutedText}>불러오는 중...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={s.page}>
        <h1 style={{ fontSize: 16, marginTop: 0 }}>친구</h1>
        <div style={{ fontSize: 13, marginBottom: 12, color: "#9aa0aa" }}>
          친구 기능을 사용하려면 로그인이 필요합니다.
        </div>
        <AuthView />
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>친구</h1>
        <LogoutButton userId={userId!} />
      </div>

      {data.error && <div style={s.errorText}>{data.error}</div>}

      <MyProfileCard profile={data.myProfile} />
      <AddFriendPanel myUserId={userId!} onRequestSent={data.reload} />
      <RequestsSection incoming={data.incoming} outgoing={data.outgoing} onChanged={data.reload} />
      <FriendsList friends={data.friends} onChanged={data.reload} />
    </div>
  );
}
