"use client";

import { useEffect, useState } from "react";
import { avatarAppearanceService } from "../../../lib/supabase/avatarAppearanceService";
import type { NetworkAppearanceManifest } from "../../../lib/supabase/database.types";

/**
 * Read side of the Network Appearance Snapshot (section 33/34/38/39) - the
 * current Room's REMOTE participants' appearance manifests, keyed by
 * userId. Only fetches for `remoteUserIds` (never the whole friend list -
 * section 34), and only while `roomId` is non-null (section 31/39 - no
 * subscription at all outside an active Room).
 *
 * Realtime here only ever announces a `revision` change (section 38) -
 * never PNG bytes; RemoteAvatarInstance/remoteAppearanceApply.ts do the
 * actual asset fetch+composite once they see a manifest whose revision is
 * newer than what they've already applied.
 */
export function useCoworkRoomAppearances(
  roomId: string | null,
  remoteUserIds: string[]
): Map<string, NetworkAppearanceManifest> {
  const [manifests, setManifests] = useState<Map<string, NetworkAppearanceManifest>>(new Map());
  const idsKey = remoteUserIds.slice().sort().join(",");

  useEffect(() => {
    if (!roomId || remoteUserIds.length === 0) {
      setManifests(new Map());
      return;
    }

    let cancelled = false;
    const ids = remoteUserIds;

    // One batched `IN (...)` query for every remote participant (section
    // 18 of the CoWork appearance-sync-v2 brief - "N+1 요청을 만들지 말고
    // batch query를 사용") instead of N separate round-trips.
    async function fetchAll() {
      const res = await avatarAppearanceService.getManifests(ids);
      if (cancelled || !res.ok) return;
      setManifests((prev) => {
        const next = new Map(prev);
        for (const id of ids) {
          const manifest = res.data.get(id);
          if (manifest) next.set(id, manifest);
          else next.delete(id);
        }
        // Drop entries for anyone no longer a participant (section 35 -
        // Room membership, from the caller, is always the source of truth
        // for WHO has an Avatar; this map only ever supplies appearance
        // for ids currently passed in).
        for (const key of Array.from(next.keys())) {
          if (!ids.includes(key)) next.delete(key);
        }
        return next;
      });
    }

    void fetchAll();
    const unsubscribe = avatarAppearanceService.subscribeManifestChanges(() => {
      void fetchAll();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, idsKey]);

  return manifests;
}
