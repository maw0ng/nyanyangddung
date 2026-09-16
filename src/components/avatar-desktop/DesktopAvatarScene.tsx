"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import MiniWaffleHairScene, {
  type MiniWaffleHairSceneHandle,
} from "../hair-prototype/MiniWaffleHairScene";
import FacePaintScene, { type FacePaintSceneHandle } from "../hair-prototype/FacePaintScene";
import TopsPaintScene, { type TopsPaintSceneHandle } from "../hair-prototype/TopsPaintScene";
import ToonStyleController from "../hair-prototype/ToonStyleController";
import AvatarAnimationScene, {
  type AvatarAnimationSceneHandle,
} from "../hair-prototype/AvatarAnimationScene";
import type { AvatarAnimationState } from "../hair-prototype/avatarAnimation";
import { characterPresetStorage } from "../hair-prototype/characterPresetStorage";
import { DEFAULT_TOON_SETTINGS, lightIntensitiesFor } from "../hair-prototype/toonStyle";
import {
  INITIAL_FACE_DEBUG_INFO,
  emptyCharacterCosmetics,
  type CosmeticCustomization,
  type DebugInfo,
  type FaceDebugInfo,
  type HistoryStatus,
  type TopsDebugInfo,
} from "../hair-prototype/types";
import CosmeticAttachmentScene, {
  type CosmeticAttachmentSceneHandle,
} from "../hair-prototype/cosmetics/CosmeticAttachmentScene";
import CosmeticPaintScene, {
  type CosmeticPaintSceneHandle,
} from "../hair-prototype/cosmetics/CosmeticPaintScene";
import type { CosmeticMaterialSurface } from "../hair-prototype/cosmetics/cosmeticAttachment";
import type { CosmeticTransform } from "../hair-prototype/cosmetics/cosmeticRegistry";
import {
  DESKTOP_CAMERA_FOV,
  DESKTOP_CAMERA_POSITION,
  DESKTOP_CAMERA_TARGET,
} from "./desktopCameraConfig";
import { computeDesktopAvatarLayout } from "./desktopAvatarLayout";
import DesktopChrome from "./DesktopChrome";
import DesktopInteractionLayer, {
  type DesktopInteractionDebugInfo,
} from "./DesktopInteractionLayer";
import DesktopMenu from "./DesktopMenu";
import DesktopDebugOverlay from "./DesktopDebugOverlay";
import { useTimerEngine } from "./timer/useTimerEngine";
import { useForegroundPolling } from "./timer/useForegroundPolling";
import TimerHUD from "./timer/TimerHUD";
import TimerFloatingMenuSection from "./timer/TimerFloatingMenuSection";
import type { TimerStatus } from "./timer/timerTypes";
import { useGrowthEngine } from "./growth/useGrowthEngine";
import AvatarProfileHUDLive from "./growth/AvatarProfileHUDLive";
import ProfileMenuSection from "./growth/ProfileMenuSection";
import LevelUpBanner, { LEVEL_UP_BANNER_DURATION_MS } from "./growth/LevelUpBanner";
import GrowthDebugPanel from "./growth/GrowthDebugPanel";
import { useAvatarScale } from "./settings/useAvatarScale";
import AvatarScaleSettings from "./settings/AvatarScaleSettings";
import { useAppUpdater } from "./updater/useAppUpdater";
import UpdateMenuSection from "./updater/UpdateMenuSection";
import UpdateReadyBanner from "./updater/UpdateReadyBanner";
import type { DesktopAvatarLayout } from "./desktopAvatarLayout";
import { calculateGrowth } from "./growth/growthConfig";
import { useAuthSession } from "../../lib/supabase/useAuthSession";
import { profileService } from "../../lib/supabase/profileService";
import { useCoWorkRoom } from "../../lib/supabase/useCoWorkRoom";
import CoWorkMenuSection from "./cowork/CoWorkMenuSection";
import { useDesktopParticipants } from "./cowork/desktopParticipant";
import DesktopParticipantGrid from "./cowork/DesktopParticipantGrid";
import { computeLocalSlotOrigin } from "./cowork/desktopParticipantLayout";
import { useCoworkTimerSync } from "./cowork/useCoworkTimerSync";
import { useCoworkRoomStates } from "./cowork/useCoworkRoomStates";
import { useAvatarAppearancePublish } from "./cowork/useAvatarAppearancePublish";
import { useCoworkRoomAppearances } from "./cowork/useCoworkRoomAppearances";

const isDevBuild = process.env.NODE_ENV !== "production";

// Every prop below routes into the exact same Hair/Face/Tops paint engines
// and ToonStyleController/AvatarAnimationScene the Avatar Editor uses -
// nothing here re-implements painting, morphs, Toon shading, or animation.
// The only thing genuinely different from HairPaintPrototype.tsx is that
// `mode`/`editMode` are pinned to "rotate" (painting pointer handlers in
// MiniWaffleHairScene/FacePaintScene/TopsPaintScene all no-op unless their
// mode/editMode matches "draw"/"hair"/"face"/"tops" - see their own
// pointerdown handlers), so raycast painting is simply never triggered.
const noopFaceHistory = (_layer: string, _status: HistoryStatus) => {};
const noopTopsHistory = (_materialName: string, _status: HistoryStatus) => {};
const noopCosmeticHistory = (_materialName: string, _status: HistoryStatus) => {};
const noopCosmeticLayers = (_materialName: string, _layers: unknown, _activeLayerId: string) => {};

// Section 34/35 of the timer brief: TimerStatus -> avatar animation is
// decided in exactly one place, and the timer's own status is the single
// source of truth both TimerHUD's label and this mapping read from - so
// "running인데 캐릭터 Break" style mismatches are structurally impossible.
function statusToAnimation(status: TimerStatus): AvatarAnimationState {
  switch (status) {
    case "running":
      return "Work";
    case "manualPaused":
    case "autoPaused":
      return "Break";
    case "idle":
    default:
      return "Idle";
  }
}

export default function DesktopAvatarScene() {
  const hairSceneRef = useRef<MiniWaffleHairSceneHandle>(null);
  const faceSceneRef = useRef<FacePaintSceneHandle>(null);
  const topsSceneRef = useRef<TopsPaintSceneHandle>(null);
  const animationSceneRef = useRef<AvatarAnimationSceneHandle>(null);

  const [faceDebugInfo, setFaceDebugInfo] = useState<FaceDebugInfo>(INITIAL_FACE_DEBUG_INFO);
  const [topsMaterialNames, setTopsMaterialNames] = useState<string[]>([]);
  const loadedRef = useRef(false);

  // ---- Cosmetics (액세서리/귀) - display-only reflection of the active
  // CharacterPreset's equipped ear (section 17). Renders the EXACT same
  // reusable CosmeticAttachmentScene/CosmeticPaintScene components the
  // Avatar Editor uses, just with no TransformControls/selection/paint
  // input ever mounted here - `active={false}` on CosmeticPaintScene below
  // means its pointer listeners no-op unconditionally, so painting can
  // never happen on Desktop no matter what. The accessory still follows
  // every Head-bone animation transform automatically (it's a literal
  // child of the Head bone - see cosmeticAttachment.ts), so Idle/Work/
  // Break/Sleep all carry the ear along for free.
  const cosmeticAttachmentRef = useRef<CosmeticAttachmentSceneHandle>(null);
  const cosmeticPaintRef = useRef<CosmeticPaintSceneHandle>(null);
  const [equippedCosmeticId, setEquippedCosmeticId] = useState<string | null>(null);
  const [cosmeticSurfaces, setCosmeticSurfaces] = useState<CosmeticMaterialSurface[]>([]);
  const equippedCosmeticTransformRef = useRef<CosmeticTransform | null>(null);
  const equippedCosmeticCustomizationRef = useRef<CosmeticCustomization | null>(null);
  // Tracks the cosmeticId `loadActiveCharacter` applied LAST time (bug fix -
  // see the reapply branch inside loadActiveCharacter below for why this is
  // needed: `setEquippedCosmeticId` below is a no-op re-render-wise when the
  // id is unchanged from before, so CosmeticAttachmentScene's own attach
  // effect - the ONLY other place that calls setTransform/applyPreset -
  // never re-fires either, silently dropping a same-cosmetic transform/
  // paint-only edit).
  const lastAppliedCosmeticIdRef = useRef<string | null>(null);

  const handleCosmeticAttachmentChange = useCallback(() => {
    const transform = equippedCosmeticTransformRef.current;
    if (transform) cosmeticAttachmentRef.current?.setTransform(transform);
    setCosmeticSurfaces(cosmeticAttachmentRef.current?.getSurfaces() ?? []);
  }, []);

  // Restores the saved ear's Paint Layers once its surfaces exist -
  // identical timing convention to the Editor's own equivalent effect.
  useEffect(() => {
    if (!equippedCosmeticId || cosmeticSurfaces.length === 0) return;
    const stored = equippedCosmeticCustomizationRef.current;
    if (stored) cosmeticPaintRef.current?.applyPreset(stored.materials);
  }, [cosmeticSurfaces, equippedCosmeticId]);

  // ---- Growth (닉네임 + 레벨/EXP) --------------------------------------------
  // Constructed BEFORE useTimerEngine so the stable `growthEngine`
  // reference is available to close over in the onActiveMsCommitted
  // callback passed below - see TimerEngine.ts's doc comment on that
  // option: it fires exactly once per running-segment close (pause/
  // autoPause/end) with exactly that segment's duration, which is the only
  // safe place to grant EXP without any risk of double-counting (section
  // 8/9/11 of the growth brief).
  const { engine: growthEngine, snapshot: growthSnapshot } = useGrowthEngine();

  // ---- Work timer (일반 / 프로그램 연동) -------------------------------------
  // TimerEngine owns all timer state/ticking/persistence itself and keeps
  // running regardless of whether the floating menu is open (section 25) -
  // this component only ever reads `timerSnapshot` (which changes on
  // meaningful transitions only, never once a second) and drives the
  // animation state from it below.
  const { engine: timerEngine, snapshot: timerSnapshot } = useTimerEngine({
    onActiveMsCommitted: (deltaMs) => growthEngine.addWorkMs(deltaMs),
  });
  useForegroundPolling(timerEngine, timerSnapshot.mode, timerSnapshot.status);

  // Level-up celebration (section 17/18 of the growth brief): a transient
  // banner + a one-shot Celebrate animation, both fired from
  // useLiveGrowth's edge-detected level increase (see
  // AvatarProfileHUDLive.tsx). The timer itself is completely unaffected -
  // this never touches timerEngine/growthEngine state, only the animation
  // handle and a small piece of local UI state.
  // ---- Windows auto-update (electron/updater.ts) ---------------------------
  // Production-only in practice (updater.ts's own app.isPackaged guard) -
  // stays at "idle" forever in development/plain-browser preview, so
  // nothing below ever renders (section 19 - "업데이트 없을 때는 아무것도
  // 표시하지 않는다").
  const { state: updateState, checkForUpdates, installUpdate } = useAppUpdater();
  // Dismissing "나중에" only hides the proactive banner for THIS specific
  // downloaded version (section 14/19) - keyed on availableVersion so a
  // later update re-shows even if an earlier one was dismissed, and the
  // "지금 재시작" option still stays available in 설정 > 업데이트 either way.
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null);
  const showUpdateBanner =
    updateState.status === "downloaded" &&
    !!updateState.availableVersion &&
    updateState.availableVersion !== dismissedUpdateVersion;

  const [levelUpBanner, setLevelUpBanner] = useState<{ level: number; key: number } | null>(null);
  const handleLevelUp = useCallback((level: number) => {
    animationSceneRef.current?.playTemporaryAnimation("Celebrate");
    setLevelUpBanner({ level, key: Date.now() });
  }, []);
  useEffect(() => {
    if (!levelUpBanner) return;
    const timer = setTimeout(() => setLevelUpBanner(null), LEVEL_UP_BANNER_DURATION_MS);
    return () => clearTimeout(timer);
  }, [levelUpBanner]);

  // ---- Public profile sync (account/friend-system brief, sections 7/29/30) --
  // Pushes the local Growth system's CURRENT nickname/level/exp up to
  // Supabase as a cache/projection, one-way (local -> Supabase, never the
  // reverse - section 7/9), whenever `growthSnapshot` changes AND a
  // session exists. growthSnapshot only changes at GrowthEngine's own
  // "meaningful transition" checkpoints (nickname save, addWorkMs commits
  // at pause/autoPause/end) - never once a second - so this effect already
  // fires at exactly the checkpoints section 30 asks for (Level Up, Timer
  // pause/end, ...) with no separate throttling needed. Also fires once
  // right after login, since `session` becoming non-null is itself a
  // dependency change (section 30 - "로그인 직후 sync"). Entirely
  // fire-and-forget: a Supabase/network failure here is logged by
  // profileService and never surfaces to the user or blocks anything
  // local (section 11 - offline-first).
  const { session } = useAuthSession();
  useEffect(() => {
    if (!session || !growthSnapshot.loaded) return;
    const growth = calculateGrowth(growthSnapshot.totalWorkMs);
    void profileService.upsertMyProfile(session.user.id, {
      nickname: growthSnapshot.nickname,
      level: growth.level,
      currentExp: growth.currentExp,
      requiredExp: growth.requiredExp,
    });
  }, [session, growthSnapshot]);

  // ---- Co-working Room (room-code brief, sections 42/45/47/53) -------------
  // Purely a floating-menu SUMMARY of whatever active room the account
  // currently has - the full create/join/participant-list UI lives only in
  // the separate CoWork window (section 43). This hook independently
  // fetches/subscribes to the same room the CoWork window would (no IPC
  // relay between windows - same convention as useAuthSession's own cross-
  // window doc comment), and is a no-op (`room: null`) whenever logged out,
  // so it never gates the Desktop Pet itself (section 5/45/46/48/49 - Timer/
  // EXP/CharacterPreset/Scale stay completely independent of room state).
  const coworkRoom = useCoWorkRoom(session?.user.id ?? null);
  const [leavingRoom, setLeavingRoom] = useState(false);

  // ---- Multi-Avatar Desktop grid (Desktop-avatar-rendering brief) ----------
  // Room membership (cowork_room_members via coworkRoom.members - section 2,
  // no separate participant DB) -> the grid's participant list. Always
  // includes exactly one local entry (section 58 - Local Avatar must never
  // disappear because of Room/network state), using the LIVE growthSnapshot
  // nickname/level (not whatever the network row says about self - section
  // 4/35). `localLevel` recomputes from the same calculateGrowth() the
  // profile-sync effect above already calls - cheap pure arithmetic, no
  // extra state needed.
  const localLevel = calculateGrowth(growthSnapshot.totalWorkMs).level;
  const participants = useDesktopParticipants(
    coworkRoom.members,
    session?.user.id ?? null,
    growthSnapshot.nickname,
    localLevel
  );

  // Resizes the transparent window to fit the current participant count
  // (section 19) - a no-op IPC call when count hasn't actually changed
  // (main.ts's applyLayout short-circuits when neither scale nor count
  // changed). Absent in Browser mode via the usual optional chaining.
  useEffect(() => {
    window.desktopAPI?.setParticipantCount(participants.length);
  }, [participants.length]);

  // ---- CoWork Room timer/status sync (cowork-timer-sync brief) -------------
  // Write side: projects the LOCAL TimerEngine's own snapshot (never a new
  // stopwatch - section 0/4) up to Supabase whenever there's an active
  // Room, at exactly the checkpoints section 9 asks for - `timerSnapshot`
  // itself only changes on meaningful transitions, so this needs no extra
  // debouncing. Read side: this account's whole Room's member states,
  // fed to every RemoteAvatarCanvas below for its HUD/animation - `null`
  // roomId (no active Room) correctly no-ops/unsubscribes both sides.
  useCoworkTimerSync(coworkRoom.room?.id ?? null, timerSnapshot);
  const memberStates = useCoworkRoomStates(coworkRoom.room?.id ?? null);

  // ---- Network Appearance Snapshot (avatar-appearance-sync brief) ----------
  // Write side: publishes the LOCAL active CharacterPreset's flattened
  // overlays (never the raw editable layer stack - section 3) whenever it
  // changes, debounced (section 24/25) - `markDirty()` is wired into the
  // EXISTING Editor->Desktop CharacterPreset-saved signal below, no new
  // IPC channel. Read side: current Room's REMOTE participants' published
  // manifests (never Local's own - section 32, Local always renders its
  // own IndexedDB CharacterPreset directly, unaffected by any of this).
  const remoteUserIds = participants.filter((p) => !p.isLocal).map((p) => p.userId);
  const { markDirty: markAppearanceDirty } = useAvatarAppearancePublish(
    coworkRoom.room?.id ?? null,
    session?.user.id ?? null
  );
  const appearances = useCoworkRoomAppearances(coworkRoom.room?.id ?? null, remoteUserIds);

  // Aggregated hover/dragging across every REMOTE avatar slot (section 21 -
  // click-through must consider the whole grid, not just Local's own
  // canvas) - combined into `isInteractive` below alongside Local's own
  // characterHover/dragging signals.
  const [remoteHover, setRemoteHover] = useState(false);
  const [remoteDragging, setRemoteDragging] = useState(false);

  // ---- Avatar Scale (Desktop Pet 표시 크기) -----------------------------------
  // `layout` is a pure function of avatarScale (see desktopAvatarLayout.ts)
  // recomputed every render - cheap arithmetic, no memoization needed. This
  // is what drives the Canvas's own pixel box, the HUD strips above/below
  // it, and the floating menu's anchor - never the BrowserWindow's actual
  // current size (Main owns resizing the window to match; the Renderer
  // never reads window bounds back).
  const { avatarScale, previewAvatarScale, commitAvatarScale } = useAvatarScale();
  const layout = computeDesktopAvatarLayout(avatarScale);

  // ---- Desktop interaction (click-through / drag / menu) -------------------
  const [characterHover, setCharacterHover] = useState(false);
  const [menuHover, setMenuHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [interactionDebug, setInteractionDebug] = useState<DesktopInteractionDebugInfo | null>(
    null
  );

  // Freezes the menu's own anchor layout for as long as the "설정" panel
  // (and its size slider) is open - without this, dragging the slider
  // would continuously reposition the very menu panel the slider lives in
  // (since the menu's anchor tracks the live, shrinking/growing avatar),
  // which could fight a still-in-progress native <input type=range> drag
  // under the user's own cursor. Captured fresh each time settingsOpen
  // transitions to true, so opening settings again later still starts from
  // the avatar's current position/scale.
  const frozenMenuLayoutRef = useRef<DesktopAvatarLayout | null>(null);
  const menuLayout = settingsOpen ? frozenMenuLayoutRef.current ?? layout : layout;

  // Combined "should the OS deliver clicks to us right now" signal - only
  // true while actually over the character, over the floating menu, or
  // mid-drag (section 6/10: menu being merely *open* must not by itself
  // force interactivity everywhere, or the surrounding transparent area
  // would stop being click-through-able while the menu floats).
  const isInteractive = characterHover || menuHover || dragging || remoteHover || remoteDragging;
  const lastSentClickThroughRef = useRef<boolean | null>(null);
  useEffect(() => {
    const ignore = !isInteractive;
    if (lastSentClickThroughRef.current === ignore) return;
    lastSentClickThroughRef.current = ignore;
    window.desktopAPI?.setClickThrough(ignore);
  }, [isInteractive]);

  // Idle animation must never be affected by any of the above - none of
  // this touches AvatarAnimationScene/its mixer in any way (section 22).

  useEffect(() => {
    window.desktopAPI?.getAlwaysOnTop().then((value) => {
      if (typeof value === "boolean") setAlwaysOnTop(value);
    });
  }, []);

  // When the menu closes (via a menu item click, Escape, or an outside
  // click) its DOM node unmounts while the pointer may still be sitting
  // over it - browsers never fire mouseleave on a node that's already been
  // removed, so menuHover would otherwise stay stuck true forever and
  // click-through would never turn back on. Closing the menu always means
  // there's no menu left to hover, so force it false here explicitly.
  useEffect(() => {
    if (!menuOpen) setMenuHover(false);
  }, [menuOpen]);

  // Closing the whole floating menu always leaves the settings panel too -
  // reopening it later starts back at the normal menu view, matching
  // ../timer/TimerFloatingMenuSection's own "reset wizard step on close"
  // convention.
  useEffect(() => {
    if (!menuOpen) setSettingsOpen(false);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  const handleCharacterClick = useCallback(() => {
    setMenuOpen((prev) => !prev);
  }, []);

  const handleOpenEditor = useCallback(() => {
    setMenuOpen(false);
    // Editor opens in its own separate, normal BrowserWindow (section 15) -
    // the Desktop Avatar window/Idle animation are completely untouched.
    window.desktopAPI?.openEditor();
  }, []);

  const handleOpenFriends = useCallback(() => {
    setMenuOpen(false);
    // Same "separate normal BrowserWindow" pattern as the Editor (section
    // 24 of the account/friend-system brief) - the Desktop Avatar window
    // and everything running in it (Timer/Animation/click-through) is
    // completely untouched by opening this.
    window.desktopAPI?.openFriends();
  }, []);

  const handleOpenCowork = useCallback(() => {
    setMenuOpen(false);
    // Same "separate normal BrowserWindow" pattern as Editor/Friends -
    // creating/joining/viewing a room never happens inside this tiny
    // floating menu (section 43).
    window.desktopAPI?.openCowork();
  }, []);

  const handleLeaveRoom = useCallback(async () => {
    setLeavingRoom(true);
    await coworkRoom.leaveRoom();
    setLeavingRoom(false);
  }, [coworkRoom]);

  const handleToggleAlwaysOnTop = useCallback(() => {
    setAlwaysOnTop((prev) => {
      const next = !prev;
      window.desktopAPI?.setAlwaysOnTop(next);
      return next;
    });
  }, []);

  const handleOpenSettings = useCallback(() => {
    frozenMenuLayoutRef.current = layout;
    setSettingsOpen(true);
  }, [layout]);
  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const handleHide = useCallback(() => {
    setMenuOpen(false);
    window.desktopAPI?.hideWindow();
  }, []);

  const handleQuit = useCallback(() => {
    window.desktopAPI?.quit();
  }, []);

  const handleFaceDebugUpdate = useCallback((patch: Partial<FaceDebugInfo>) => {
    setFaceDebugInfo((prev) => ({ ...prev, ...patch }));
  }, []);
  const handleTopsDebugUpdate = useCallback((_patch: Partial<TopsDebugInfo>) => {}, []);
  const handleHairDebugUpdate = useCallback((_patch: Partial<DebugInfo>) => {}, []);
  const handleTopsMaterialsDiscovered = useCallback((names: string[]) => {
    setTopsMaterialNames(names);
  }, []);

  // Identical readiness gate to HairPaintPrototype's `sceneReady` - Face's
  // base/eye materials and every Tops material must already be wired
  // (composite-texture clones in place) before we touch them.
  const sceneReady = faceDebugInfo.bodyFound && topsMaterialNames.length > 0;

  // Drives Idle/Work/Break purely from TimerStatus, through the same
  // imperative handle API the rest of this file already uses (never the
  // AnimationMixer directly - section 9/34). Re-runs once `sceneReady`
  // flips true too, so a timer started before the GLB finished loading
  // (animationSceneRef.current still null the first time) is corrected
  // the moment the ref actually attaches, instead of getting silently
  // stuck on the controller's own default Idle.
  useEffect(() => {
    animationSceneRef.current?.setAnimationState(statusToAnimation(timerSnapshot.status));
  }, [timerSnapshot.status, sceneReady]);

  // Loads whichever CharacterPreset is currently the user's active "내
  // 캐릭터" and applies it through the exact same handle API
  // HairPaintPrototype's applyCharacterAppearance uses - no separate
  // Desktop character store, no re-derivation of appearance data.
  // Extracted as a stable, repeatedly-callable function (rather than
  // inline in the mount effect below) so the Editor-sync effect further
  // down can call the exact same code path on demand, without duplicating
  // any of this logic - CharacterPreset stays the single source of truth
  // for appearance on both Desktop and Editor (section 9 of the Editor
  // sync brief).
  //
  // Applying a CharacterPreset only ever calls each scene's existing
  // applyPresetLayers/applyPreset/setMorphValues handle methods - the same
  // ones HairPaintPrototype's own character-switch flow already calls
  // repeatedly (A -> B -> A -> B) - so it updates textures/morphs in place
  // without unmounting the Canvas, and never touches
  // AnimationMixer/TimerEngine/GrowthEngine/drag state, which live in
  // entirely separate objects (section 19/27 of the Editor sync brief).
  const loadActiveCharacter = useCallback(async () => {
    const activeId = characterPresetStorage.getActiveCharacterId();
    const list = await characterPresetStorage.listCharacters();
    const target = (activeId && list.find((c) => c.id === activeId)) || list[0] || null;
    if (!target) return;
    const record = await characterPresetStorage.getCharacter(target.id);
    if (!record) return;
    const { appearance } = record;
    await Promise.all([
      hairSceneRef.current?.applyPresetLayers(appearance.hair.layers) ?? Promise.resolve(),
      faceSceneRef.current?.applyPreset({
        baseLayers: appearance.face.base.layers,
        eyeLayers: appearance.face.eye.layers,
        baseOverrideTexture: appearance.face.base.overrideTexture ?? null,
        eyeOverrideTexture: appearance.face.eye.overrideTexture ?? null,
      }) ?? Promise.resolve(),
      topsSceneRef.current?.applyPreset({ materials: appearance.clothing.materials }) ??
        Promise.resolve(),
    ]);
    // Never crashes on an older/partial CharacterPreset - same defensive
    // fallback HairPaintPrototype's applyCharacterAppearance uses.
    faceSceneRef.current?.setMorphValues(appearance.morphValues ?? {});

    // Cosmetics (section 15/17): a CharacterPreset written before cosmetics
    // existed has no `cosmetics` field - falls back to "nothing equipped"
    // rather than crashing (same defensive fallback as the Editor's own
    // applyCharacterAppearance).
    const cosmetics = appearance.cosmetics ?? emptyCharacterCosmetics();
    const equippedHead = cosmetics.equipped.head ?? null;
    const nextCosmeticId = equippedHead?.cosmeticId ?? null;
    equippedCosmeticTransformRef.current = equippedHead?.transform ?? null;
    equippedCosmeticCustomizationRef.current = equippedHead
      ? cosmetics.customizations[equippedHead.cosmeticId] ?? null
      : null;

    // Bug fix (live Editor-save refresh): when the SAME cosmetic stays
    // equipped across a reload - only its TRS/paint changed - React bails
    // out of re-rendering on this identical setEquippedCosmeticId call, so
    // CosmeticAttachmentScene's own [equippedId] attach effect (the only
    // other thing that ever calls setTransform/applyPreset) never re-fires
    // either. Re-apply directly against whatever's already attached in that
    // case; the unchanged-id branch below is a no-op the very first time a
    // cosmetic is equipped (lastAppliedCosmeticIdRef still null/different),
    // correctly leaving that fresh attach to the normal reactive path.
    const sameCosmeticStillEquipped =
      nextCosmeticId !== null && lastAppliedCosmeticIdRef.current === nextCosmeticId;
    lastAppliedCosmeticIdRef.current = nextCosmeticId;
    setEquippedCosmeticId(nextCosmeticId);
    if (sameCosmeticStillEquipped && equippedHead) {
      cosmeticAttachmentRef.current?.setTransform(equippedHead.transform);
      void cosmeticPaintRef.current?.applyPreset(
        equippedCosmeticCustomizationRef.current?.materials ?? {}
      );
    }
  }, []);

  // Deferred one macrotask (setTimeout 0) for the same reason
  // ToonStyleController defers its own target-collection pass: React 18
  // StrictMode's dev-only synchronous mount->unmount->mount double-invoke
  // can otherwise let this run against the FIRST (soon-to-be-discarded)
  // instance of Face/Tops's engines, so `loadedRef` blocks it from ever
  // running again against the real, final instance - leaving the avatar
  // stuck on default appearance. Deferring past that synchronous window
  // guarantees this only ever touches the stable, final scene refs.
  // `loadedRef` here means "the very first load has completed" - it stays
  // true forever afterward and additionally gates the Editor-sync effect
  // below, so a preset-updated event that (implausibly) races ahead of
  // this initial load is simply ignored rather than applied against
  // not-yet-final scene refs.
  useEffect(() => {
    if (!sceneReady || loadedRef.current) return;
    const timer = setTimeout(() => {
      if (loadedRef.current) return;
      loadedRef.current = true;
      void loadActiveCharacter();
    }, 0);
    return () => clearTimeout(timer);
  }, [sceneReady, loadActiveCharacter]);

  // Editor sync (section 11/27 of the Editor-connection brief): whenever
  // the Avatar Editor window saves or switches a CharacterPreset, it
  // signals through desktopAPI.notifyPresetSaved() -> this event, and
  // Desktop just re-runs the exact same loadActiveCharacter() the initial
  // mount used - no app/window restart, no Canvas remount, and nothing
  // about Timer/Profile/animation is touched by this effect at all.
  // Absent outside Electron (section 31 - browser mode has no Editor
  // window to sync with in the first place).
  useEffect(() => {
    if (!window.desktopAPI?.onCharacterPresetUpdated) return;
    return window.desktopAPI.onCharacterPresetUpdated(() => {
      if (!loadedRef.current) return;
      void loadActiveCharacter();
      // Network Appearance Snapshot publish trigger (avatar-appearance-
      // sync brief, section 23/25) - reuses this EXISTING "CharacterPreset
      // saved/switched" signal rather than a new one; debounced inside the
      // hook itself, and a complete no-op whenever there's no active Room
      // (markAppearanceDirty still schedules a timer, but doPublish()
      // immediately returns without touching the network - see
      // useAvatarAppearancePublish.ts).
      markAppearanceDirty();
    });
  }, [loadActiveCharacter, markAppearanceDirty]);

  const { ambient, key, fill } = lightIntensitiesFor(DEFAULT_TOON_SETTINGS, 0.8, 1.2, 0.4);

  // Local's own on-screen slot offset within the (possibly multi-avatar)
  // grid (section 12/17) - 0,0 whenever there's no active Room (identical
  // to today), otherwise wherever assignParticipantGrid puts the local
  // cell. Used only to keep the Floating Menu anchored next to Local's
  // ACTUAL avatar - everything else about Local's own rendering is
  // unaffected by this offset (DesktopParticipantGrid positions the cell
  // itself; Local's own content never needs to know its own screen
  // position).
  const localSlotOrigin = computeLocalSlotOrigin(participants, layout);

  // Local's existing content - IDENTICAL to before the cowork-room grid
  // existed (ProfileHUD, LevelUpBanner, the character Canvas with every
  // scene component, TimerHUD - section 1/4). Extracted into a variable
  // only so DesktopParticipantGrid can place it into whichever grid cell
  // assignParticipantGrid assigns Local - nothing inside this JSX itself
  // changed.
  const localSlotContent = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/*
        AvatarProfileHUD - "캐릭터 위" (nickname/level/EXP), always shown
        regardless of TimerStatus (section 1: growth is independent of the
        timer being on). LevelUpBanner is a normal flex sibling too (rather
        than absolutely positioned) so it simply displaces layout briefly
        instead of needing position math against a variable-height
        ProfileHUD - see LevelUpBanner.tsx. Both take `layout.hudScale`
        (NOT avatarScale directly - see desktopAvatarLayout.ts) so HUD text
        stays readable at 50% and doesn't dominate the screen at 150%
        (section 12 of the Avatar Scale brief).
      */}
      <AvatarProfileHUDLive
        growthEngine={growthEngine}
        timerEngine={timerEngine}
        scale={layout.hudScale}
        onLevelUp={handleLevelUp}
      />
      {levelUpBanner && (
        <LevelUpBanner key={levelUpBanner.key} level={levelUpBanner.level} scale={layout.hudScale} />
      )}
      {showUpdateBanner && (
        <UpdateReadyBanner
          scale={layout.hudScale}
          onRestart={installUpdate}
          onDismiss={() => setDismissedUpdateVersion(updateState.availableVersion)}
        />
      )}

      {/*
        AvatarViewport: the character's own render box. Its WIDTH/HEIGHT
        now scale with avatarScale (layout.canvasWidth/canvasHeight) -
        camera position/fov/target (desktopCameraConfig.ts) are completely
        untouched, so a bigger/smaller pixel box under the SAME fixed-FOV
        camera is what actually makes the character look bigger/smaller
        (a real re-render at the new resolution, not a CSS transform/zoom -
        section 3 of the Avatar Scale brief). Width and height always
        scale by the exact same factor, so the aspect ratio - and
        therefore the character's proportions - never distorts. R3F's
        Canvas auto-detects this container's size changes (ResizeObserver)
        and re-renders accordingly; DesktopInteractionLayer's raycast
        already reads the canvas's live getBoundingClientRect() on every
        hit-test, so click/drag hit-detection is automatically correct at
        any scale with zero changes to that file (section 19).
      */}
      <div style={{ width: layout.canvasWidth, height: layout.canvasHeight }}>
      <Canvas
        camera={{ position: DESKTOP_CAMERA_POSITION, fov: DESKTOP_CAMERA_FOV }}
        gl={{ alpha: true }}
        style={{ background: "transparent" }}
        onCreated={(state) => {
          // Section 5: per-pixel alpha, not just CSS - background pixels
          // must actually clear to alpha=0, and Toon's own color-fidelity
          // fix (see ToonStyleController's sibling logic in
          // HairPaintPrototype) is applied unconditionally here since
          // Desktop Mode has no Toon ON/OFF toggle to preserve.
          state.gl.setClearColor(0x000000, 0);
          state.gl.toneMapping = THREE.NoToneMapping;
          state.gl.outputColorSpace = THREE.SRGBColorSpace;
          state.camera.lookAt(...DESKTOP_CAMERA_TARGET);
        }}
      >
        <ambientLight intensity={ambient} />
        <directionalLight position={[3, 5, 4]} intensity={key} />
        <directionalLight position={[-3, 2, -4]} intensity={fill} />

        <Suspense fallback={null}>
          <MiniWaffleHairScene
            ref={hairSceneRef}
            mode="rotate"
            tool="brush"
            color="#000000"
            brushSize={1}
            onDebugUpdate={handleHairDebugUpdate}
          />
          <FacePaintScene
            ref={faceSceneRef}
            editMode="rotate"
            tool="pen"
            color="#000000"
            brushSize={1}
            mirrorEnabled={false}
            onDebugUpdate={handleFaceDebugUpdate}
            onHistoryChange={noopFaceHistory}
          />
          <TopsPaintScene
            ref={topsSceneRef}
            editMode="rotate"
            tool="pen"
            color="#000000"
            brushSize={1}
            onDebugUpdate={handleTopsDebugUpdate}
            onHistoryChange={noopTopsHistory}
            onMaterialsDiscovered={handleTopsMaterialsDiscovered}
          />
          <ToonStyleController ready={sceneReady} settings={DEFAULT_TOON_SETTINGS} />
          {/* No startInEditMode - Desktop Mode plays Idle immediately,
              unlike the Avatar Editor. */}
          <AvatarAnimationScene ref={animationSceneRef} />
          {/* Display-only cosmetic reflection (section 17) - no
              TransformControls/selection/paint input is ever mounted here,
              only the same attach + paint-composite side effects the
              Editor uses to build what the user actually sees. */}
          <CosmeticAttachmentScene
            ref={cosmeticAttachmentRef}
            equippedId={equippedCosmeticId}
            onAttachmentChange={handleCosmeticAttachmentChange}
          />
          <CosmeticPaintScene
            ref={cosmeticPaintRef}
            surfaces={cosmeticSurfaces}
            active={false}
            activeMaterialName=""
            tool="pen"
            color="#000000"
            brushSize={1}
            onHistoryChange={noopCosmeticHistory}
            onLayersChange={noopCosmeticLayers}
          />
          <DesktopInteractionLayer
            ready={sceneReady}
            menuOpen={menuOpen}
            onCharacterHoverChange={setCharacterHover}
            onDraggingChange={setDragging}
            onCharacterClick={handleCharacterClick}
            onDebugUpdate={isDevBuild ? setInteractionDebug : undefined}
          />
        </Suspense>
      </Canvas>
      </div>

      <TimerHUD engine={timerEngine} scale={layout.hudScale} />
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        // Minimal hover feedback only (section 21) - no bounding box/
        // outline is ever drawn around any avatar, local or remote.
        cursor: dragging || remoteDragging ? "grabbing" : characterHover || remoteHover ? "grab" : "default",
      }}
    >
      {/*
        Pinned to the window's top-left, exactly like the old single-avatar
        DesktopAvatarArea wrapper - DesktopParticipantGrid arranges however
        many slots the current Room has (1 when there's no active Room,
        identical to before - section 13) inside here.
      */}
      <div style={{ position: "absolute", top: 0, left: 0 }}>
        <DesktopParticipantGrid
          participants={participants}
          memberStates={memberStates}
          appearances={appearances}
          layout={layout}
          localSlotContent={localSlotContent}
          onRemoteHoverChange={setRemoteHover}
          onRemoteDraggingChange={setRemoteDragging}
        />
      </div>

      <DesktopMenu
        open={menuOpen}
        layout={menuLayout}
        anchorOffset={localSlotOrigin}
        alwaysOnTop={alwaysOnTop}
        onOpenEditor={handleOpenEditor}
        onOpenFriends={handleOpenFriends}
        onOpenCowork={handleOpenCowork}
        hasCoworkRoom={!!coworkRoom.room}
        onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
        onHide={handleHide}
        onQuit={handleQuit}
        onMouseEnter={() => setMenuHover(true)}
        onMouseLeave={() => setMenuHover(false)}
        timerSection={
          <TimerFloatingMenuSection engine={timerEngine} snapshot={timerSnapshot} open={menuOpen} />
        }
        profileSection={
          <ProfileMenuSection growthEngine={growthEngine} timerEngine={timerEngine} open={menuOpen} />
        }
        coworkSection={
          coworkRoom.room ? (
            <CoWorkMenuSection
              roomCode={coworkRoom.room.roomCode}
              memberCount={coworkRoom.members.length}
              onOpenWindow={handleOpenCowork}
              onLeave={handleLeaveRoom}
              leaving={leavingRoom}
            />
          ) : undefined
        }
        settingsOpen={settingsOpen}
        settingsSection={
          <>
            <AvatarScaleSettings
              avatarScale={avatarScale}
              onChange={previewAvatarScale}
              onCommit={commitAvatarScale}
            />
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "6px 2px" }} />
            <UpdateMenuSection state={updateState} onCheck={checkForUpdates} onInstall={installUpdate} />
          </>
        }
        onOpenSettings={handleOpenSettings}
        onCloseSettings={handleCloseSettings}
      />

      {isDevBuild && (
        <>
          <DesktopDebugOverlay info={interactionDebug} clickThrough={!isInteractive} menuOpen={menuOpen} />
          <GrowthDebugPanel engine={growthEngine} />
        </>
      )}

      <DesktopChrome />
    </div>
  );
}

