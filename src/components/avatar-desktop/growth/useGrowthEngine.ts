"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { GrowthEngine, type GrowthSnapshot } from "./GrowthEngine";
import { profileStorage } from "./profileStorage";
import { DEFAULT_NICKNAME } from "./growthConfig";
import { USER_PROFILE_SCHEMA_VERSION, type UserProfile } from "./growthTypes";

/**
 * Owns the single GrowthEngine instance for the Desktop Avatar window -
 * same lazy-singleton-via-useRef + useSyncExternalStore shape as
 * ../timer/useTimerEngine.ts. Restores (or seeds a brand-new) UserProfile
 * once on mount, deferred one macrotask past React 18 StrictMode's
 * dev-only double mount for the same reason every other deferred-load
 * effect in this codebase does (see DesktopAvatarScene.tsx's
 * CharacterPreset-load effect).
 *
 * `snapshot` only changes on real nickname/totalWorkMs changes (rare -
 * pause/autoPause/end/nickname-save), never once a second; the live,
 * ticking "current EXP while running" display is a separate concern
 * (useLiveGrowth.ts), deliberately NOT computed here so this hook's
 * caller (DesktopAvatarScene) never re-renders every second.
 */
export function useGrowthEngine() {
  const engineRef = useRef<GrowthEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new GrowthEngine({
      onPersist: (profile) => {
        void profileStorage.saveProfile(profile);
      },
    });
  }
  const engine = engineRef.current;

  const snapshot = useSyncExternalStore<GrowthSnapshot>(
    (onStoreChange) => engine.subscribe(onStoreChange),
    () => engine.getSnapshot(),
    () => engine.getSnapshot()
  );

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    const timer = setTimeout(() => {
      if (restoredRef.current) return;
      restoredRef.current = true;
      (async () => {
        const saved = await profileStorage.loadProfile();
        if (saved) {
          engine.hydrate(saved);
          return;
        }
        const now = Date.now();
        const fresh: UserProfile = {
          schemaVersion: USER_PROFILE_SCHEMA_VERSION,
          nickname: DEFAULT_NICKNAME,
          totalWorkMs: 0,
          createdAt: now,
          updatedAt: now,
        };
        engine.hydrate(fresh);
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [engine]);

  return { engine, snapshot };
}
