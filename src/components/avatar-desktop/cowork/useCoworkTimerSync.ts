"use client";

import { useEffect, useRef } from "react";
import type { TimerSnapshot } from "../timer/TimerEngine";
import { coworkMemberStateService } from "../../../lib/supabase/coworkMemberStateService";
import { projectTimerToCoworkState } from "./coworkTimerProjection";
import { COWORK_HEARTBEAT_MS } from "./coworkTimerConfig";

/**
 * Write-side of CoWork timer sync (sections 0/9/10/16/21/35/54) - the ONLY
 * place a Local TimerEngine snapshot is ever turned into a
 * cowork_member_states row. Fires:
 *   - Immediately on every meaningful `snapshot` transition (section 9) -
 *     `snapshot` itself only ever changes at Start/Pause/Resume/Stop/
 *     auto-pause/auto-resume, never once a second (TimerEngine's own
 *     design - see TimerEngine.ts), so no extra debouncing is needed here
 *     (section 35's "상태 전환은 즉시" is already exactly what this does).
 *   - Immediately the instant `roomId` becomes non-null (Room join/restore
 *     - section 16), with whatever the Timer's CURRENT state already is -
 *     an already-37-minutes-in timer is reflected to Remote immediately,
 *     never starting from 0.
 *   - On a low-frequency heartbeat while in a Room and not idle (section
 *     10) - stale-detection/reconnect purposes only, never a Timer tick.
 *   - On the browser's `online` event (section 21) - reconnect
 *     reconciliation, without waiting up to COWORK_HEARTBEAT_MS for the
 *     next heartbeat.
 *
 * Entirely fire-and-forget (section 54): coworkMemberStateService already
 * logs failures internally and returns a result this hook doesn't even
 * inspect - a Supabase outage here can never block/undo a Local Timer
 * action or surface an error to the user. This hook never mutates
 * TimerEngine in either direction (section 0's one-way "Local Timer ->
 * Public Projection").
 */
export function useCoworkTimerSync(roomId: string | null, snapshot: TimerSnapshot) {
  // Only the heartbeat/online-reconnect effects need this - they fire
  // asynchronously, later than the render that set them up, so they must
  // read whatever the Timer's state is AT THAT MOMENT rather than whatever
  // it was when their interval/listener was created.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (!roomId) return;
    void coworkMemberStateService.upsertOwnState(roomId, projectTimerToCoworkState(snapshot));
  }, [roomId, snapshot]);

  useEffect(() => {
    const activeRoomId = roomId;
    if (!activeRoomId || snapshot.status === "idle") return;
    const id = setInterval(() => {
      void coworkMemberStateService.upsertOwnState(activeRoomId, projectTimerToCoworkState(snapshotRef.current));
    }, COWORK_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [roomId, snapshot.status]);

  useEffect(() => {
    const activeRoomId = roomId;
    if (!activeRoomId) return;
    const handleOnline = () => {
      void coworkMemberStateService.upsertOwnState(activeRoomId, projectTimerToCoworkState(snapshotRef.current));
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [roomId]);
}
