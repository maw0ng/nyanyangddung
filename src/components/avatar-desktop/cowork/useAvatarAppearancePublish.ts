"use client";

import { useCallback, useEffect, useRef } from "react";
import { characterPresetStorage } from "../../hair-prototype/characterPresetStorage";
import { buildAppearanceOverlay, buildHairOverlay, filterCustomizationMorphs } from "../../hair-prototype/appearanceOverlay";
import { DEFAULT_TOON_SETTINGS } from "../../hair-prototype/toonStyle";
import { avatarAppearanceService } from "../../../lib/supabase/avatarAppearanceService";
import type { NetworkCosmeticHead } from "../../../lib/supabase/database.types";
import { devLog } from "../../../lib/devLog";

/** Debounce between "character changed" and the actual publish (section
 * 24/25) - never per-stroke/per-slider-tick, only after edits settle. */
const PUBLISH_DEBOUNCE_MS = 2000;

/**
 * Write side of the Network Appearance Snapshot (sections 1/23/26/27/54) -
 * builds the flattened overlays + filtered morph values from whatever the
 * LOCAL active CharacterPreset currently is (characterPresetStorage - the
 * IndexedDB source of truth, completely unmodified by this file - section
 * 2/32) and publishes them via avatarAppearanceService. Only ever reads
 * local storage; NEVER writes back to it (Local's own Avatar rendering
 * stays fully decoupled from the network - section 32).
 *
 * Publish triggers (section 9's cowork-timer-sync analogue, applied to
 * appearance):
 *   - `markDirty()` - called by the caller (DesktopAvatarScene) from the
 *     EXISTING desktopAPI.onCharacterPresetUpdated listener (the same
 *     signal the Editor already sends after a CharacterPreset save/switch
 *     - no new IPC channel invented) - debounced (section 25).
 *   - Room join/restore, but only ONCE per app session (section 16/72) -
 *     an already-customized character must be reflected to Remote right
 *     away, without needing to re-publish on every re-join once the
 *     session has already published at least once.
 *
 * Entirely fire-and-forget/best-effort (section 26/27/54): a publish
 * failure leaves the dirty flag set for the next trigger to retry, never
 * surfaces to the user, and never touches local CharacterPreset/Timer/EXP.
 */
export function useAvatarAppearancePublish(roomId: string | null, userId: string | null) {
  const dirtyRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPublishedRevisionRef = useRef(0);
  const publishingRef = useRef(false);
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const doPublish = useCallback(async () => {
    const activeRoomId = roomIdRef.current;
    const activeUserId = userIdRef.current;
    if (!activeRoomId || !activeUserId || publishingRef.current) return;
    publishingRef.current = true;
    try {
      const activeId = characterPresetStorage.getActiveCharacterId();
      const list = await characterPresetStorage.listCharacters();
      const target = (activeId && list.find((c) => c.id === activeId)) || list[0] || null;
      if (!target) return;
      const record = await characterPresetStorage.getCharacter(target.id);
      if (!record) return;
      const { appearance } = record;

      const [hairOverlay, faceBaseOverlay, faceEyeOverlay] = await Promise.all([
        buildHairOverlay(appearance.hair.layers),
        buildAppearanceOverlay(appearance.face.base),
        buildAppearanceOverlay(appearance.face.eye),
      ]);
      const topsOverlays: Record<string, Blob> = {};
      for (const [material, surface] of Object.entries(appearance.clothing.materials)) {
        const blob = await buildAppearanceOverlay(surface);
        if (blob) topsOverlays[material] = blob;
      }
      // [MorphTrace:ExportInput]/[MorphTrace:ExportOutput] (diagnostic -
      // "Remote Avatar Morph 동기화 안 됨") - compares the raw CharacterPreset
      // morphValues this publish pass read from IndexedDB against what
      // survives filterCustomizationMorphs' allowlist/clamp, so an
      // allowlist-miss (Editor uses a key filterCustomizationMorphs doesn't
      // recognize) shows up as a count/key drop right here.
      devLog(
        "[MorphTrace:ExportInput] count=", Object.keys(appearance.morphValues ?? {}).length,
        "nonZero=", Object.fromEntries(Object.entries(appearance.morphValues ?? {}).filter(([, v]) => v !== 0))
      );
      const morphValues = filterCustomizationMorphs(appearance.morphValues);
      devLog(
        "[MorphTrace:ExportOutput] count=", Object.keys(morphValues).length,
        "nonZero=", Object.fromEntries(Object.entries(morphValues).filter(([, v]) => v !== 0))
      );

      // Toon (bug fix - per-user Network Appearance data, not a
      // Local-only preference): the SAME field the Editor now saves into
      // CharacterPreset (types.ts's CharacterAppearance.toon) - a preset
      // saved before this field existed falls back to
      // DEFAULT_TOON_SETTINGS, never the CURRENT publisher device's own
      // unrelated app-wide leftover.
      const toonSettings = appearance.toon ?? DEFAULT_TOON_SETTINGS;

      // Cosmetics (CoWork appearance-sync-v2 brief section 6/26/40) - reuses
      // the exact same appearance.cosmetics the local Editor/Desktop Avatar
      // already read/wrote in the accessory turn, never a re-derivation.
      // `cosmeticHead` carries the SAVED transform as-is (already tuned
      // against the animated/Idle Head-bone orientation - section 29, never
      // re-solved here); its own paint (if any) is flattened the exact same
      // way Hair/Face/Tops are, reading the FIRST (v1: only) material entry
      // of that cosmetic's own customization (section 27).
      const equippedHead = appearance.cosmetics?.equipped.head ?? null;
      const cosmeticHead: NetworkCosmeticHead | null = equippedHead
        ? {
            cosmeticId: equippedHead.cosmeticId,
            position: equippedHead.transform.position,
            rotation: equippedHead.transform.rotation,
            scale: equippedHead.transform.scale,
          }
        : null;
      const cosmeticCustomization = equippedHead
        ? appearance.cosmetics?.customizations[equippedHead.cosmeticId] ?? null
        : null;
      const cosmeticSurface = cosmeticCustomization
        ? Object.values(cosmeticCustomization.materials)[0] ?? null
        : null;
      const cosmeticOverlay = await buildAppearanceOverlay(cosmeticSurface);

      // Fresh read to seed the revision counter (section 15) - the RPC's
      // own `p_revision <= current` rejection is the final race backstop
      // (section 27/29), this is just to start from the right number
      // across app sessions/devices.
      const manifestRes = await avatarAppearanceService.getManifest(activeUserId);
      const current = manifestRes.ok && manifestRes.data ? manifestRes.data.revision : 0;
      const nextRevision = Math.max(current, lastPublishedRevisionRef.current) + 1;

      const res = await avatarAppearanceService.publishOwnAppearance(
        activeUserId,
        nextRevision,
        { hairOverlay, faceBaseOverlay, faceEyeOverlay, topsOverlays, cosmeticHead, cosmeticOverlay },
        morphValues,
        toonSettings
      );
      if (res.ok) {
        lastPublishedRevisionRef.current = res.data;
        dirtyRef.current = false;
        devLog(
          "[NetworkAppearancePublish] userId=", activeUserId,
          "revision=", res.data,
          "morphCount=", Object.keys(morphValues).length,
          "hasToon=", !!appearance.toon
        );
      }
      // On failure, dirtyRef is left as-is - the next markDirty()/room-join
      // naturally retries with the latest local appearance (section 27 -
      // "최신 상태 우선", no need to replay every intermediate revision).
    } catch (err) {
      console.error("[useAvatarAppearancePublish]", err);
    } finally {
      publishingRef.current = false;
    }
  }, []);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void doPublish();
    }, PUBLISH_DEBOUNCE_MS);
  }, [doPublish]);

  useEffect(() => {
    if (!roomId || !userId) return;
    if (lastPublishedRevisionRef.current > 0) return; // already published this app session
    void doPublish();
  }, [roomId, userId, doPublish]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return { markDirty };
}
