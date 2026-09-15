"use client";

import { useEffect, useRef, useState } from "react";
import { coworkMemberStateService } from "../../../lib/supabase/coworkMemberStateService";
import type { CoworkPublicTimerState } from "../../../lib/supabase/database.types";

/**
 * Read-side of CoWork timer sync (section 31/33/34) - the current Room's
 * member timer/status states, keyed by userId. `null`/empty whenever
 * `roomId` is null (no active Room - subscription torn down immediately,
 * section 31).
 *
 * Out-of-order/race handling (section 33/34): every Realtime event (join/
 * leave/update, no payload parsed - see coworkMemberStateService's own
 * doc comment) triggers a fresh SELECT of the whole room's states rather
 * than applying the event's own row data - Postgres always serves the
 * latest COMMITTED row on that SELECT, so an out-of-order Realtime
 * notification can never cause an older state to be applied on top of a
 * newer one; there is nothing "old" to apply in the first place. A
 * monotonic fetch-sequence guard additionally discards a slow HTTP
 * response that a newer fetch has since superseded (the initial fetch,
 * the reconcile-after-subscribe fetch, and any Realtime-triggered fetch
 * are all the same code path). Same "fetch -> subscribe -> fetch once
 * more to close the race window" pattern the brief itself describes in
 * section 33.
 */
export function useCoworkRoomStates(roomId: string | null): Map<string, CoworkPublicTimerState> {
  const [states, setStates] = useState<Map<string, CoworkPublicTimerState>>(new Map());
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    if (!roomId) {
      setStates(new Map());
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const activeRoomId = roomId;

    async function fetchAndApply() {
      const mySeq = ++fetchSeqRef.current;
      const res = await coworkMemberStateService.getRoomStates(activeRoomId);
      if (cancelled || mySeq !== fetchSeqRef.current || !res.ok) return;
      setStates(new Map(res.data.map((s) => [s.userId, s])));
    }

    (async () => {
      await fetchAndApply();
      if (cancelled) return;
      unsubscribe = coworkMemberStateService.subscribeToRoomStates(activeRoomId, () => {
        void fetchAndApply();
      });
      // Closes the initial-fetch/subscribe race (section 33): anything
      // that changed between the fetch above and the subscription
      // actually going live is picked up by this one extra reconcile.
      await fetchAndApply();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      setStates(new Map());
    };
  }, [roomId]);

  return states;
}
