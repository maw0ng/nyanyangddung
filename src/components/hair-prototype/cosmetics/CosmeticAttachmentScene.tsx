"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { MODEL_URL } from "../modelConfig";
import {
  applyCosmeticTransform,
  attachCosmetic,
  detachCosmetic,
  findBone,
  readCosmeticTransform,
  type CosmeticAttachmentResult,
  type CosmeticMaterialSurface,
} from "./cosmeticAttachment";
import { getCosmeticDefinition, HEAD_ATTACH_BONE_NAME, type CosmeticTransform } from "./cosmeticRegistry";

useGLTF.preload(MODEL_URL);

export interface CosmeticDebugInfo {
  headBoneFound: boolean;
  equippedId: string | null;
  hasArmature: boolean;
  hasUV: boolean;
  materialNames: string[];
  meshNames: string[];
}

export interface CosmeticAttachmentSceneHandle {
  getAttachmentRoot: () => THREE.Object3D | null;
  getSurfaces: () => CosmeticMaterialSurface[];
  getMeshes: () => THREE.Mesh[];
  getTransform: () => CosmeticTransform | null;
  setTransform: (t: CosmeticTransform) => void;
  getHeadBoneFound: () => boolean;
}

interface CosmeticAttachmentSceneProps {
  /** Currently equipped cosmeticId, or null for "없음" (section 3). Both
   * the Editor (with TransformControls/paint on top) and Desktop
   * (display-only) render this SAME component with just this one prop
   * driven from CharacterPreset - section 17/21. */
  equippedId: string | null;
  onDebugUpdate?: (info: CosmeticDebugInfo) => void;
  /** Fired once attach/detach actually settles (new cosmetic's meshes
   * ready, or cleared) - callers re-read the imperative handle through
   * this signal instead of polling every frame (section 20/41 - no
   * per-frame work here). */
  onAttachmentChange?: () => void;
}

/**
 * Finds miniWaffle's "Head" bone (confirmed to exist by inspecting the
 * GLB's own glTF JSON - section 4) in the SAME shared, drei-cached
 * `useGLTF(MODEL_URL)` scene every other scene component
 * (MiniWaffleHairScene/FacePaintScene/ToonStyleController/
 * AvatarAnimationScene/DesktopInteractionLayer) already reads, and
 * attaches/detaches the currently-equipped cosmetic under it via
 * cosmeticAttachment.ts - `Head -> AttachmentRoot -> accessory's own
 * Armature + SkinnedMesh`, so the accessory follows every Head bone
 * animation automatically while its own internal rig stays completely
 * intact (section 1/19). Renders nothing itself (`return null`) - the
 * attached accessory is added directly to the shared scene graph as a
 * THREE.Object3D side effect, the same "imperative attach, no JSX
 * <primitive>" shape DesktopInteractionLayer already uses for its own
 * side-effect-only scene work.
 */
function CosmeticAttachmentScene(
  { equippedId, onDebugUpdate, onAttachmentChange }: CosmeticAttachmentSceneProps,
  forwardedRef: React.ForwardedRef<CosmeticAttachmentSceneHandle>
) {
  const gltf = useGLTF(MODEL_URL);
  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const attachmentRef = useRef<CosmeticAttachmentResult | null>(null);
  const [, forceRerender] = useState(0);

  useEffect(() => {
    const bone = findBone(gltf.scene, HEAD_ATTACH_BONE_NAME);
    if (!bone) {
      // Section 23 - never crash the app; a missing bone just means
      // cosmetics can't attach this session, loudly logged for diagnosis.
      console.warn(
        `[CosmeticAttachmentScene] "${HEAD_ATTACH_BONE_NAME}" bone not found in miniWaffle scene - accessories cannot attach.`
      );
    }
    headBoneRef.current = bone;
  }, [gltf]);

  // Attach/detach lifecycle whenever the equipped cosmetic changes
  // (section 3) - always detaches whatever was there first (a straight
  // swap, matching "다른 귀를 선택하면 기존 head 액세서리는 교체된다").
  useEffect(() => {
    let cancelled = false;

    if (attachmentRef.current) {
      detachCosmetic(attachmentRef.current);
      attachmentRef.current = null;
    }

    function reportDebug() {
      const r = attachmentRef.current;
      onDebugUpdate?.({
        headBoneFound: !!headBoneRef.current,
        equippedId,
        hasArmature: r?.hasArmature ?? false,
        hasUV: r?.hasAnyUV ?? false,
        materialNames: r?.materialNames ?? [],
        meshNames: r?.meshes.map((m) => m.name) ?? [],
      });
    }

    if (!equippedId) {
      forceRerender((n) => n + 1);
      onAttachmentChange?.();
      reportDebug();
      return;
    }

    const definition = getCosmeticDefinition(equippedId);
    if (!definition) {
      console.error(`[CosmeticAttachmentScene] unknown cosmeticId "${equippedId}" - ignoring.`);
      reportDebug();
      return;
    }
    const headBone = headBoneRef.current;
    if (!headBone) {
      console.error(`[CosmeticAttachmentScene] cannot attach "${equippedId}" - Head bone missing.`);
      reportDebug();
      return;
    }

    attachCosmetic(headBone, definition.assetPath, definition.defaultTransform)
      .then((result) => {
        if (cancelled) {
          // A newer equippedId change already fired before this one
          // finished loading - discard, never attach a superseded result.
          detachCosmetic(result);
          return;
        }
        attachmentRef.current = result;
        forceRerender((n) => n + 1);
        onAttachmentChange?.();
        reportDebug();
      })
      .catch((err) => {
        // Section 23 - a load failure only fails THIS accessory, never
        // the whole Avatar.
        console.error(
          `[CosmeticAttachmentScene] failed to load cosmetic "${equippedId}" (${definition.assetPath})`,
          err
        );
        reportDebug();
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equippedId]);

  // Final cleanup on unmount (section 20/35).
  useEffect(() => {
    return () => {
      detachCosmetic(attachmentRef.current);
      attachmentRef.current = null;
    };
  }, []);

  useImperativeHandle(
    forwardedRef,
    () => ({
      getAttachmentRoot: () => attachmentRef.current?.attachmentRoot ?? null,
      getSurfaces: () => attachmentRef.current?.surfaces ?? [],
      getMeshes: () => attachmentRef.current?.meshes ?? [],
      getTransform: () =>
        attachmentRef.current ? readCosmeticTransform(attachmentRef.current.attachmentRoot) : null,
      setTransform: (t: CosmeticTransform) => {
        if (attachmentRef.current) applyCosmeticTransform(attachmentRef.current.attachmentRoot, t);
      },
      getHeadBoneFound: () => !!headBoneRef.current,
    }),
    []
  );

  return null;
}

export default forwardRef(CosmeticAttachmentScene);
