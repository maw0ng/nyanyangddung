"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { coworkRoomService } from "./coworkRoomService";
import type { CoworkResult } from "./coworkRoomService";
import type { CoworkRoom, CoworkRoomMemberView } from "./database.types";
import { devLog } from "../devLog";

export interface CoWorkRoomState {
  room: CoworkRoom | null;
  members: CoworkRoomMemberView[];
  loading: boolean;
  error: string | null;
  /** True right after this hook discovers (via a realtime-triggered
   * refresh) that a room it was showing has become `status: "ended"` -
   * section 56. NOT set for the caller's own explicit leaveRoom() call,
   * which already resolves synchronously in the UI that called it and
   * needs no separate notice. Cleared by dismissEndedNotice() or the next
   * successful createRoom/joinRoom. */
  endedNotice: boolean;
}

const EMPTY: CoWorkRoomState = { room: null, members: [], loading: true, error: null, endedNotice: false };

/**
 * Thin state layer over coworkRoomService (section 41) - the DB is the
 * source of truth, this is UI cache only. Restores the caller's current
 * active room on mount/login (section 26), subscribes to Realtime member-
 * join/leave/room-status events ONLY while a room is active (section 53),
 * and tears that subscription down on room change/leave/unmount/logout
 * (section 54 - `userId` changing, e.g. on logout or account switch, resets
 * everything and unsubscribes before anything else).
 *
 * Used by BOTH the Desktop window (for the floating menu's room summary)
 * and the CoWork window (for the full room UI) - each holds its own
 * independent instance/subscription, matching this app's existing
 * multi-window convention (see useAuthSession.ts's own doc comment) rather
 * than relaying room state over IPC between windows.
 */
export function useCoWorkRoom(userId: string | null) {
  const [state, setState] = useState<CoWorkRoomState>(EMPTY);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const lastRoomIdRef = useRef<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  const stopSubscription = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const roomRes = await coworkRoomService.getActiveRoom(userId);
    if (!roomRes.ok) {
      setState((prev) => ({ ...prev, loading: false, error: roomRes.error }));
      return;
    }

    const room = roomRes.data;
    if (!room) {
      // No active membership anymore. If we previously knew a room and it
      // has since transitioned to "ended", surface that specifically
      // (section 56) - this is the "someone else's leave ended the room I
      // was in" / "another window of mine left" case, distinct from this
      // hook's own leaveRoom() below (which already resolves its own UI
      // synchronously and skips this notice).
      const prevRoomId = lastRoomIdRef.current;
      stopSubscription();
      lastRoomIdRef.current = null;
      if (prevRoomId) {
        const prevRoomRes = await coworkRoomService.getRoomById(prevRoomId);
        if (prevRoomRes.ok && prevRoomRes.data.status === "ended") {
          setState({ room: null, members: [], loading: false, error: null, endedNotice: true });
          return;
        }
      }
      setState({ room: null, members: [], loading: false, error: null, endedNotice: false });
      return;
    }

    lastRoomIdRef.current = room.id;
    const membersRes = await coworkRoomService.getRoomMembers(room.id);
    devLog(
      "[CoWork] initial members count=",
      membersRes.ok ? membersRes.data.length : "(fetch failed)",
      membersRes.ok ? "" : membersRes.error
    );
    setState({
      room,
      members: membersRes.ok ? membersRes.data : [],
      loading: false,
      error: membersRes.ok ? null : membersRes.error,
      endedNotice: false,
    });

    if (!unsubscribeRef.current) {
      unsubscribeRef.current = coworkRoomService.subscribeToRoom(room.id, () => refreshRef.current());
      devLog("[CoWork] realtime subscribed room=", room.id);
    }
  }, [userId, stopSubscription]);

  useEffect(() => {
    refreshRef.current = () => void refresh();
  }, [refresh]);

  useEffect(() => {
    // Account switch/login/logout: never leave a previous account's room
    // visible under a new one (mirrors useFriendsData's own section-47
    // reset-on-userId-change convention).
    stopSubscription();
    lastRoomIdRef.current = null;
    if (!userId) {
      setState({ room: null, members: [], loading: false, error: null, endedNotice: false });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    void refresh();
    return () => stopSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const createRoom = useCallback(async (): Promise<CoworkResult<CoworkRoom>> => {
    const res = await coworkRoomService.createRoom();
    if (res.ok) await refresh();
    return res;
  }, [refresh]);

  const joinRoom = useCallback(
    async (code: string): Promise<CoworkResult<CoworkRoom>> => {
      const res = await coworkRoomService.joinRoom(code);
      if (res.ok) await refresh();
      return res;
    },
    [refresh]
  );

  /** Explicit "작업방 나가기" (section 25 - never triggered by merely
   * closing the app). Resolves this hook's own state immediately on
   * success rather than waiting for the realtime round-trip, and
   * deliberately does not set endedNotice - the caller already knows they
   * left on purpose. */
  const leaveRoom = useCallback(async (): Promise<CoworkResult<void>> => {
    const res = await coworkRoomService.leaveRoom();
    if (res.ok) {
      stopSubscription();
      lastRoomIdRef.current = null;
      setState({ room: null, members: [], loading: false, error: null, endedNotice: false });
    }
    return res;
  }, [stopSubscription]);

  const dismissEndedNotice = useCallback(() => {
    setState((prev) => ({ ...prev, endedNotice: false }));
  }, []);

  return { ...state, createRoom, joinRoom, leaveRoom, refresh, dismissEndedNotice };
}
