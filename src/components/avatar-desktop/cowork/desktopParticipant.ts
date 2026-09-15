"use client";

import { useMemo } from "react";
import type { CoworkRoomMemberView } from "../../../lib/supabase/database.types";

/**
 * Minimal Desktop-rendering view model (section 3 of the Desktop-avatar-
 * rendering brief) - deliberately does NOT carry email/foreground app/
 * window title/totalWorkMs/raw CharacterPreset data. `isLocal` is decided
 * by comparing `userId` to `auth.uid()` (section 56), never by matching on
 * the nickname string.
 */
export interface DesktopParticipant {
  userId: string;
  nickname: string;
  level: number;
  isLocal: boolean;
  /** Stable sort key for remotes (section 18) - meaningless for the local
   * entry (never sorted against anything). */
  joinedAt: string;
}

/**
 * Room member list (source of truth: cowork_room_members via
 * coworkRoomService - section 2, no separate participant DB) -> the
 * Desktop grid's participant list. Always includes exactly one `isLocal`
 * entry, even if the room-member fetch hasn't resolved `self` yet or the
 * user isn't in a room at all (section 58 - the Local Avatar must never
 * disappear because of Room/network state), and always uses the LIVE
 * local nickname/level passed in (from GrowthEngine, via the caller) - not
 * whatever the network's cowork_room_members row happens to say about
 * `self`, since Local's own HUD already reads GrowthEngine directly and
 * must never regress to the slower Supabase-synced copy (section 4/35).
 */
export function useDesktopParticipants(
  members: CoworkRoomMemberView[] | null,
  localUserId: string | null,
  localNickname: string,
  localLevel: number
): DesktopParticipant[] {
  return useMemo(() => {
    const localEntry: DesktopParticipant = {
      userId: localUserId ?? "local",
      nickname: localNickname,
      level: localLevel,
      isLocal: true,
      joinedAt: "",
    };
    if (!members || members.length === 0) return [localEntry];

    const remotes: DesktopParticipant[] = members
      .filter((m) => m.userId !== localUserId)
      .map((m) => ({ userId: m.userId, nickname: m.nickname, level: m.level, isLocal: false, joinedAt: m.joinedAt }));

    // Defensive cap - the DB's maxMembers constraint already prevents this,
    // but never let a rendering bug try to create a 5th avatar.
    return [...remotes, localEntry].slice(0, 4);
  }, [members, localUserId, localNickname, localLevel]);
}
