"use client";

import { useCallback, useEffect, useState } from "react";
import { friendService } from "../../lib/supabase/friendService";
import { profileService } from "../../lib/supabase/profileService";
import type { FriendListItem, FriendRequestItem, PublicProfile } from "../../lib/supabase/database.types";

interface FriendsData {
  myProfile: PublicProfile | null;
  incoming: FriendRequestItem[];
  outgoing: FriendRequestItem[];
  friends: FriendListItem[];
  loading: boolean;
  error: string | null;
}

const EMPTY: FriendsData = { myProfile: null, incoming: [], outgoing: [], friends: [], loading: true, error: null };

/**
 * Loads everything the Friends screen needs for the CURRENT account, and
 * re-loads from scratch whenever `userId` changes (section 47 - switching
 * accounts must never leave the previous account's friends/requests
 * visible; a changed userId is exactly what drives this effect to refetch,
 * naturally discarding the old state first via the loading reset below).
 * `userId` is `null` when logged out, in which case this simply returns
 * the empty/loading-false state without calling Supabase at all.
 */
export function useFriendsData(userId: string | null) {
  const [data, setData] = useState<FriendsData>(EMPTY);

  const reload = useCallback(async () => {
    if (!userId) {
      setData({ ...EMPTY, loading: false });
      return;
    }
    setData((prev) => ({ ...prev, loading: true, error: null }));
    const [profileRes, incomingRes, outgoingRes, friendsRes] = await Promise.all([
      profileService.getMyProfile(userId),
      friendService.getIncomingRequests(userId),
      friendService.getOutgoingRequests(userId),
      friendService.getFriends(userId),
    ]);

    const firstError = [profileRes, incomingRes, outgoingRes, friendsRes].find((r) => !r.ok);
    if (firstError && !firstError.ok) {
      setData((prev) => ({ ...prev, loading: false, error: firstError.error }));
      return;
    }

    setData({
      myProfile: profileRes.ok ? profileRes.data : null,
      incoming: incomingRes.ok ? incomingRes.data : [],
      outgoing: outgoingRes.ok ? outgoingRes.data : [],
      friends: friendsRes.ok ? friendsRes.data : [],
      loading: false,
      error: null,
    });
  }, [userId]);

  useEffect(() => {
    // Reset immediately on userId change (account switch/login/logout) so
    // a stale previous account's data never flashes (section 47), then
    // load the new account's data.
    setData({ ...EMPTY, loading: userId !== null });
    void reload();
  }, [userId, reload]);

  return { ...data, reload };
}
