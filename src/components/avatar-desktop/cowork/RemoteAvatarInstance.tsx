"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { useFrame } from "@react-three/fiber";
import { collectMaterialTargets } from "../../hair-prototype/textureIO";
import { createToonMaterial } from "../../hair-prototype/toonMaterialFactory";
import { DEFAULT_TOON_SETTINGS } from "../../hair-prototype/toonStyle";
import type { MaterialCategory } from "../../hair-prototype/toonStyle";
import { AvatarAnimationController } from "../../hair-prototype/avatarAnimation";
import { loadRemoteAvatarTemplate, type RemoteAvatarTemplate } from "./remoteAvatarLoader";
import { remoteTimerStatusFor } from "./RemoteTimerHUD";
import {
  applyRemoteAppearance,
  createEmptyCosmeticAppearanceState,
  disposeCosmeticAppearanceState,
  type AppearanceSurfaceTarget,
  type AppearanceTargets,
  type CosmeticAppearanceState,
  type ToonTarget,
} from "./remoteAppearanceApply";
import { clearCachedOverlayBitmaps } from "./remoteAppearanceCache";
import { HEAD_ATTACH_BONE_NAME } from "../../hair-prototype/cosmetics/cosmeticRegistry";
import type { CoworkPublicTimerState, NetworkAppearanceManifest } from "../../../lib/supabase/database.types";
import { devLog } from "../../../lib/devLog";

/** Remote Avatars only ever persist in one of these three (section 8/27) -
 * never Sleep/Wave/Celebrate/Stretch (those stay Local-only one-shot/
 * future states - section 39 of the cowork-timer-sync brief: a Remote
 * Level Up is never broadcast). */
export type RemoteAnimationState = "Idle" | "Work" | "Break";

/** working/break -> Work/Break, idle AND stale both -> Idle (section 27's
 * explicit "stale -> Idle" - a participant whose connection has gone quiet
 * reverts to the same resting pose as someone who simply hasn't started a
 * Timer, never keeps playing a stale "Work" loop). The one place this
 * status->animation mapping happens. */
function animationStateFor(state: CoworkPublicTimerState | null): RemoteAnimationState {
  const status = remoteTimerStatusFor(state);
  if (status === "working") return "Work";
  if (status === "break") return "Break";
  return "Idle";
}

const BODY_NODE_NAME = "Body";
const BODY_BASE_NODE_NAME = "Body-base";
const BODY_PARTS_NODE_NAME = "Body-Parts";
const HEAD_BACK_NODE_NAME = "head-back";
const TOPS_NODE_NAME = "Tops";
const HAIR_CANVAS_NODE_NAME = "HairCanvas";

function categoryFor(nodeLabel: string, materialName: string): MaterialCategory {
  if (nodeLabel === HAIR_CANVAS_NODE_NAME) return "hair";
  if (nodeLabel === TOPS_NODE_NAME) return "clothes";
  if (nodeLabel === BODY_NODE_NAME) return materialName === "eye" ? "eye" : "face";
  return "bodyParts";
}

export interface RemoteAvatarInstanceHandle {
  /** The interactive meshes (Body/Body-base/Body-Parts/head-back/Tops/
   * HairCanvas - section 22/23) belonging to THIS instance's own clone,
   * for the parent RemoteAvatarInteractionLayer to raycast against. Empty
   * until the template has finished loading and the clone/toon setup has
   * run. */
  getInteractiveMeshes: () => THREE.Object3D[];
}

/**
 * Renders ONE Room participant's Avatar using the default miniWaffle
 * appearance (section 0/5) - own independent skeleton (SkeletonUtils.clone
 * - section 6), own independent Materials (fresh MeshToonMaterial objects
 * per mesh via createToonMaterial - section 37/40), own independent
 * morphTargetInfluences (a structural side effect of cloning from a scene
 * graph that has NEVER been touched by Local's pipeline at all - see
 * remoteAvatarLoader.ts's doc comment - section 38), own independent
 * HairCanvas (same reason - section 39), and its own AvatarAnimationController
 * (section 7/29 - genuinely independent mixer/action state per instance;
 * the SAME controller class Local's AvatarAnimationScene.tsx already uses,
 * reused as-is rather than reimplemented - section 28), driven every
 * frame from the `state` prop (this participant's raw CoWork public timer
 * state - section 27/28 of the cowork-timer-sync brief, mapped via
 * animationStateFor() below).
 *
 * Deliberately does NOT reuse MiniWaffleHairScene/FacePaintScene/
 * TopsPaintScene/ToonStyleController/AvatarAnimationScene - those all
 * operate on drei's ONE shared, mutable `useGLTF(MODEL_URL)` scene graph
 * (the same object across every call site in the whole app), which is
 * exactly the object Local's own painting/toon effects mutate in place.
 * Reusing them here would make Remote's "default appearance" depend on a
 * race against Local's mutation timing instead of being a real guarantee
 * (section 1's "재구현하지 않는다" is honored by NOT touching those files
 * at all, not by forcing this fundamentally different multi-instance case
 * through single-instance-shaped code).
 */
function RemoteAvatarInstance(
  {
    state,
    appearance,
    userId,
  }: { state: CoworkPublicTimerState | null; appearance: NetworkAppearanceManifest | null; userId: string },
  forwardedRef: React.ForwardedRef<RemoteAvatarInstanceHandle>
) {
  const [template, setTemplate] = useState<RemoteAvatarTemplate | null>(null);
  const cloneRef = useRef<THREE.Group | null>(null);
  const controllerRef = useRef<AvatarAnimationController | null>(null);
  const meshesRef = useRef<THREE.Object3D[]>([]);
  const clonedMaterialsRef = useRef<THREE.Material[]>([]);
  const appearanceTargetsRef = useRef<AppearanceTargets | null>(null);
  /** This instance's own head-cosmetic attachment (section 21/26/30) - a
   * plain mutable object (never React state), matching every other piece
   * of this component's own imperative Three.js scene state. */
  const cosmeticStateRef = useRef<CosmeticAppearanceState>(createEmptyCosmeticAppearanceState());
  // Which revision (if any) has actually been applied to THIS instance's
  // meshes yet - guards against re-running the download/composite pipeline
  // when `appearance` re-renders with the same revision (section 36), and
  // against a slower-arriving OLDER apply overwriting a newer one that
  // finished first (checked again right before the atomic swap - section
  // 41's atomicity extends to "never regress to an older revision").
  const appliedRevisionRef = useRef(0);
  /** The most recently REQUESTED (not necessarily yet applied) revision -
   * updated synchronously the instant a new apply is kicked off, so a
   * slower older request can tell it's been superseded even while a newer
   * one is still in flight (section 41 - see remoteAppearanceApply.ts's
   * `isStillLatest` parameter). */
  const requestedRevisionRef = useRef(0);
  // Latest-value ref (section 26/41 - the hot path below reads this every
  // frame, never a stale closure) + a "what did we last actually apply"
  // tracker so setAnimationState is only ever called on a real change, not
  // every frame.
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastAppliedRef = useRef<RemoteAnimationState>("Idle");

  useEffect(() => {
    let cancelled = false;
    loadRemoteAvatarTemplate().then((t) => {
      if (!cancelled) setTemplate(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Build the clone + independent toon materials + own mixer exactly once
  // per component instance, the moment the (module-level, shared, but
  // never-mutated) template is ready - same lazy-singleton-in-render
  // idiom this codebase already uses for LayerStackEngine/
  // AvatarAnimationController.
  if (template && !cloneRef.current) {
    const clone = SkeletonUtils.clone(template.scene) as THREE.Group;
    const meshes: THREE.Object3D[] = [];
    const clonedMaterials: THREE.Material[] = [];
    const hairTargets: AppearanceSurfaceTarget[] = [];
    const faceBaseTargets: AppearanceSurfaceTarget[] = [];
    const faceEyeTargets: AppearanceSurfaceTarget[] = [];
    const topsByMaterial: Record<string, AppearanceSurfaceTarget[]> = {};
    const toonTargets: ToonTarget[] = [];
    // Bug fix ("Body Morph가 Remote Avatar에 동기화되지 않음"): every
    // cloned mesh that actually carries its own morphTargetDictionary -
    // "Body" (96 facial Shape Keys) AND "Body-base" (the single "shrink"
    // body-shape Shape Key, a genuinely separate mesh - see
    // FacePaintScene.tsx's BODY_SHAPE_NODE_NAME doc comment), never just
    // one hardcoded mesh. applyMorphValues (remoteAppearanceApply.ts)
    // applies each published morph name to whichever of these meshes
    // actually has it.
    const bodyMorphMeshes: THREE.Mesh[] = [];

    for (const label of [
      BODY_NODE_NAME,
      BODY_BASE_NODE_NAME,
      BODY_PARTS_NODE_NAME,
      HEAD_BACK_NODE_NAME,
      TOPS_NODE_NAME,
      HAIR_CANVAS_NODE_NAME,
    ]) {
      const node = clone.getObjectByName(label);
      if (!node) continue;
      for (const target of collectMaterialTargets(node)) {
        meshes.push(target.mesh);
        // Captured BEFORE wrapping in Toon (section 4/5/30) - this is the
        // untouched original GLB texture for this slot, which
        // remoteAppearanceApply.ts composites the published overlay onto
        // (or reverts to, if the manifest has no overlay for this
        // surface). null for HairCanvas, which never had one.
        const originalTexture = (target.material as THREE.MeshStandardMaterial).map ?? null;
        const category = categoryFor(label, target.material.name);
        // A fresh MeshToonMaterial per mesh (section 37) - reuses the
        // source's `.map` TEXTURE reference (safe: nothing ever writes new
        // pixels into it for a remote instance, unlike Local's CanvasTexture
        // paint engines), but is otherwise a brand-new Material object, so
        // no two Avatar instances (remote-remote OR remote-local) ever
        // share a live, mutable Material.
        const toon = createToonMaterial(target.material, category, DEFAULT_TOON_SETTINGS);
        clonedMaterials.push(toon);
        toonTargets.push({ material: toon, category });
        if (Array.isArray(target.mesh.material)) {
          const next = target.mesh.material.slice();
          next[target.materialIndex] = toon;
          target.mesh.material = next;
        } else {
          target.mesh.material = toon;
        }

        // Bug fix (Morph sync): collect EVERY mesh that actually carries a
        // morphTargetDictionary (never just one hardcoded/assumed mesh, and
        // never overwritten/lost - a previous version of this code
        // unconditionally overwrote a single `bodyMorphMesh` variable with
        // whichever "face"/"eye" categorized submesh was processed LAST,
        // even when it had no dictionary at all, silently losing the real
        // one). "Body" loads as a Group of sibling Meshes (one per
        // material, per collectMaterialTargets' own doc comment) and only
        // one of its base/eye submeshes actually has the dictionary;
        // "Body-base" is a fully separate mesh with its own single
        // "shrink" entry. Mirrors Local's own FacePaintScene.tsx
        // morphMeshesFor() - every mesh that actually has a dictionary
        // participates, nothing is assumed from node/category name alone.
        if (target.mesh.morphTargetDictionary && !bodyMorphMeshes.includes(target.mesh)) {
          bodyMorphMeshes.push(target.mesh);
        }

        const surfaceTarget: AppearanceSurfaceTarget = { material: toon, originalTexture, flipY: category === "hair" };
        if (category === "hair") hairTargets.push(surfaceTarget);
        else if (category === "face") faceBaseTargets.push(surfaceTarget);
        else if (category === "eye") faceEyeTargets.push(surfaceTarget);
        else if (category === "clothes") {
          const materialName = target.material.name || "material";
          (topsByMaterial[materialName] ??= []).push(surfaceTarget);
        }
      }
    }

    // Section 21/23/26: the same "Head" bone name cosmeticAttachment.ts's
    // findBone()/HEAD_ATTACH_BONE_NAME already use for Local/Desktop -
    // found on THIS instance's own clone (never the shared template), so a
    // cosmetic attached here can never leak into another instance's scene
    // graph. A missing bone (an unexpected GLB build) just means this
    // instance's applyCosmeticHead no-ops forever - never a crash.
    const headBone = clone.getObjectByName(HEAD_ATTACH_BONE_NAME) ?? null;

    appearanceTargetsRef.current = {
      hair: hairTargets,
      faceBase: faceBaseTargets,
      faceEye: faceEyeTargets,
      topsByMaterial,
      bodyMorphMeshes,
      headBone,
      toonTargets,
    };

    // Same AvatarAnimationController class Local uses (section 28) - its
    // own doc comment already anticipates exactly this "one instance per
    // avatar-in-a-room" reuse, so no new animation engine is written here.
    const initial = animationStateFor(stateRef.current);
    controllerRef.current = new AvatarAnimationController(clone, template.animations);
    controllerRef.current.setAnimationState(initial);
    lastAppliedRef.current = initial;

    cloneRef.current = clone;
    meshesRef.current = meshes;
    clonedMaterialsRef.current = clonedMaterials;
    devLog("[Avatar] remote mount user=", userId);
    if (!appearance) devLog("[Appearance] remote fallback (no manifest yet) user=", userId);
  }

  // Cleanup (section 43/44): dispose only THIS instance's own mixer and
  // cloned Material objects - never the shared template's geometries or
  // the template scene itself (other/future remote instances still need
  // it), and never anything belonging to Local's own pipeline. Also clears
  // this user's cached overlay bitmaps (section 35 - Room leave cleanup;
  // this effect's cleanup fires exactly when this participant is no
  // longer rendered, whether because they left the Room or this window's
  // grid otherwise dropped them).
  useEffect(() => {
    return () => {
      controllerRef.current = null;
      for (const material of clonedMaterialsRef.current) material.dispose();
      clonedMaterialsRef.current = [];
      clearCachedOverlayBitmaps(userId);
      disposeCosmeticAppearanceState(cosmeticStateRef.current);
    };
  }, [userId]);

  // Applies the published appearance (section 33/40/41/42/43/44) once the
  // clone/targets exist and whenever the manifest's `revision` actually
  // changes - never on every re-render (a manifest object can be a new
  // reference with the same revision after an unrelated Realtime event on
  // a DIFFERENT participant triggers a shared re-fetch). A `null`
  // appearance (never published, or not loaded yet) simply leaves the
  // default miniWaffle appearance in place (section 0/42) - there is
  // nothing to revert since the clone starts in that state already.
  // Failures are caught and logged only (section 43/44) - never crash the
  // scene, never affect Timer/Animation/ProfileHUD.
  useEffect(() => {
    if (!cloneRef.current || !appearanceTargetsRef.current) return;
    if (!appearance) return;
    if (appearance.revision <= appliedRevisionRef.current) return;
    const targets = appearanceTargetsRef.current;
    const revision = appearance.revision;
    requestedRevisionRef.current = revision;
    applyRemoteAppearance(
      userId,
      appearance,
      targets,
      () => requestedRevisionRef.current === revision,
      cosmeticStateRef.current
    )
      .then(() => {
        if (revision <= appliedRevisionRef.current) return;
        appliedRevisionRef.current = revision;
        devLog("[Appearance] remote revision applied user=", userId, "revision=", revision);
      })
      .catch((err) => {
        console.error("[RemoteAvatarInstance] appearance apply failed", err);
      });
  }, [appearance, userId, template]);

  useImperativeHandle(forwardedRef, () => ({ getInteractiveMeshes: () => meshesRef.current }), []);

  // Re-evaluates working/break/idle/stale -> Work/Break/Idle every frame
  // (section 27) rather than only when `state` itself changes - staleness
  // (section 19/20) is a function of wall-clock time passing, not of the
  // state object changing, so a purely prop-change-driven effect would
  // never notice "this row just became stale" on its own. Cheap (a couple
  // of comparisons + a Date.now() call - no allocation of note) and never
  // touches React state, matching this codebase's established "hot path
  // never drives a rerender" convention (TimerEngine/AvatarAnimationController's
  // own doc comments) - setAnimationState itself is only actually called
  // when the computed state differs from what's already playing.
  useFrame((_, delta) => {
    controllerRef.current?.update(delta);
    const next = animationStateFor(stateRef.current);
    if (next !== lastAppliedRef.current) {
      lastAppliedRef.current = next;
      controllerRef.current?.setAnimationState(next);
    }
  });

  if (!cloneRef.current) return null;
  return <primitive object={cloneRef.current} />;
}

export default forwardRef(RemoteAvatarInstance);
