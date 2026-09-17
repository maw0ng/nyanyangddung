"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadRoomLayout,
  saveParticipantPosition,
  removeParticipantPositions,
  type LayoutPosition,
} from "./coworkLocalLayoutStorage";

/**
 * React-state layer over coworkLocalLayoutStorage.ts (section 18/19/20 of
 * the free-placement brief). Holds ONLY the userIds the user has actually
 * dragged at least once, for the CURRENTLY active room - every other
 * participant simply has no entry and falls back to whatever default grid
 * position the caller computes (assignParticipantGrid/flattenParticipantGrid,
 * unchanged), so a participant-count change (someone joins/leaves) never
 * has to "reset" anyone: it just recomputes defaults for the un-dragged
 * participants, while every already-dragged one keeps reading its own
 * override from this map regardless of how the underlying grid math would
 * have placed it (section 19/20 - "자동 layout이 그 위치를 계속 덮어쓰지
 * 않는다").
 */
export function useCoworkLocalLayout(roomId: string | null) {
  const [overrides, setOverrides] = useState<Record<string, LayoutPosition>>({});
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  // Reload whenever the active room itself changes (leave + rejoin a
  // DIFFERENT room, or restore a different room on app restart) - section
  // 19's "같은 roomId에 다시 들어갔을 때... 복원" and section 30's "CharacterPreset과
  // 섞이지 않아야 한다" (this never touches CharacterPreset at all, only its
  // own roomId-scoped localStorage slice).
  useEffect(() => {
    setOverrides(roomId ? loadRoomLayout(roomId) : {});
  }, [roomId]);

  const getPosition = useCallback(
    (userId: string, fallback: LayoutPosition): LayoutPosition => overrides[userId] ?? fallback,
    [overrides]
  );

  const setPosition = useCallback((userId: string, position: LayoutPosition) => {
    const currentRoomId = roomIdRef.current;
    if (!currentRoomId) return;
    setOverrides((prev) => ({ ...prev, [userId]: position }));
    saveParticipantPosition(currentRoomId, userId, position);
  }, []);

  /** Feature - "CoWork 친구 Avatar 위치 초기화": drops exactly the given
   * userIds' overrides (never a blanket clear - see coworkLocalLayoutStorage's
   * own removeParticipantPositions doc comment for why), so the next render
   * naturally falls back to the caller's default grid position for those
   * userIds via getPosition's own `overrides[userId] ?? fallback`. Any userId
   * NOT passed in (the local user, in every real caller) keeps its own
   * override completely untouched. */
  const resetOverrides = useCallback((userIds: string[]) => {
    const currentRoomId = roomIdRef.current;
    if (!currentRoomId || userIds.length === 0) return;
    setOverrides((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const userId of userIds) {
        if (userId in next) {
          delete next[userId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    removeParticipantPositions(currentRoomId, userIds);
  }, []);

  return { getPosition, setPosition, resetOverrides };
}
