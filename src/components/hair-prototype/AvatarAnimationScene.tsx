"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { MODEL_URL } from "./modelConfig";
import {
  AvatarAnimationController,
  REQUIRED_ANIMATION_CLIPS,
  type AvatarAnimationDebugSnapshot,
  type AvatarAnimationState,
} from "./avatarAnimation";

useGLTF.preload(MODEL_URL);

export interface AvatarAnimationSceneHandle {
  setAnimationState: (state: AvatarAnimationState) => void;
  playTemporaryAnimation: (state: AvatarAnimationState) => void;
  /** Freezes the avatar at a static Edit Pose (a held Idle frame, NOT the
   * raw bind/rest pose) for editing - see
   * AvatarAnimationController.enterEditMode(). */
  enterEditMode: () => void;
  /** Resumes animation from the static Edit Pose into the persistent state. */
  exitEditMode: () => void;
  getDebugSnapshot: () => AvatarAnimationDebugSnapshot;
}

interface AvatarAnimationSceneProps {
  /** True to start the controller already frozen at the static Edit Pose
   * (Avatar Editor's default) instead of auto-playing Idle. Applied once,
   * at the moment the controller is first constructed. */
  startInEditMode?: boolean;
}

/**
 * Owns the avatar's AnimationMixer. Renders nothing itself - Body/Tops/
 * HairCanvas/skinning/materials are all still set up exclusively by
 * MiniWaffleHairScene (`<primitive object={gltf.scene}>`) and FacePaintScene/
 * TopsPaintScene/ToonStyleController, unchanged. `useGLTF(MODEL_URL)` here
 * returns the SAME cached `{ scene, animations }` as those components (drei
 * caches by URL), so the AnimationMixer drives the exact bones those
 * skinned meshes already read from - no new mesh/skeleton is created here.
 */
function AvatarAnimationScene(
  { startInEditMode = false }: AvatarAnimationSceneProps,
  forwardedRef: React.ForwardedRef<AvatarAnimationSceneHandle>
) {
  const gltf = useGLTF(MODEL_URL);
  const engineRef = useRef<AvatarAnimationController | null>(null);
  const loggedRef = useRef(false);

  // Lazy singleton - same StrictMode-safe pattern as LayerStackEngine:
  // created once at render time and kept alive for the component's whole
  // lifetime rather than in an effect that dev-mode double-invoke would
  // otherwise tear down. If starting in edit mode, freeze it to rest pose
  // immediately - before the first useFrame ever calls mixer.update(), so
  // the auto-played Idle never visibly renders even for one frame.
  if (!engineRef.current) {
    engineRef.current = new AvatarAnimationController(gltf.scene, gltf.animations);
    if (startInEditMode) engineRef.current.enterEditMode();
  }

  useEffect(() => {
    if (loggedRef.current) return;
    loggedRef.current = true;

    if (process.env.NODE_ENV !== "production") {
      console.log(
        "[miniWaffle animations]",
        gltf.animations.map((a) => ({
          name: a.name,
          duration: a.duration,
          tracks: a.tracks.length,
        }))
      );
      // Extra safety check (not required by spec, but directly protects
      // section 10's "never overwrite morphTargetInfluences" guarantee):
      // flag any clip that actually animates a morph target, since a
      // morph-target track playing every frame would fight the Face
      // Morph panel / CharacterPreset-restored values.
      const morphTracks = gltf.animations.flatMap((a) =>
        a.tracks.filter((t) => t.name.includes("morphTargetInfluences")).map((t) => `${a.name}: ${t.name}`)
      );
      if (morphTracks.length > 0) {
        console.warn(
          "[AvatarAnimationScene] clip(s) contain morphTargetInfluences tracks - these will fight the Morph panel/CharacterPreset values while playing:",
          morphTracks
        );
      }
    }

    const names = new Set(gltf.animations.map((a) => a.name));
    const missing = REQUIRED_ANIMATION_CLIPS.filter((n) => !names.has(n));
    if (missing.length > 0) {
      console.warn("[AvatarAnimationScene] missing required AnimationClip(s):", missing);
    }
  }, [gltf.animations]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      setAnimationState: (state) => engineRef.current?.setAnimationState(state),
      playTemporaryAnimation: (state) => engineRef.current?.playTemporaryAnimation(state),
      enterEditMode: () => engineRef.current?.enterEditMode(),
      exitEditMode: () => engineRef.current?.exitEditMode(),
      getDebugSnapshot: () =>
        engineRef.current?.getDebugSnapshot() ?? {
          persistent: "Idle",
          playing: "Idle",
          returnTo: "Idle",
          editMode: false,
        },
    }),
    []
  );

  // Driven every frame via delta - never touches React state, so this
  // never causes a component rerender.
  useFrame((_, delta) => {
    engineRef.current?.update(delta);
  });

  return null;
}

export default forwardRef(AvatarAnimationScene);
