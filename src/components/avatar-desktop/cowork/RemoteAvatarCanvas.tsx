"use client";

import { useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import {
  DESKTOP_CAMERA_FOV,
  DESKTOP_CAMERA_POSITION,
  DESKTOP_CAMERA_TARGET,
} from "../desktopCameraConfig";
import { DEFAULT_TOON_SETTINGS, lightIntensitiesFor } from "../../hair-prototype/toonStyle";
import RemoteAvatarInstance, { type RemoteAvatarInstanceHandle } from "./RemoteAvatarInstance";
import RemoteAvatarInteractionLayer from "./RemoteAvatarInteractionLayer";
import AvatarProfileHUD from "../growth/AvatarProfileHUD";
import ParticipantPopup from "./ParticipantPopup";
import RemoteTimerHUD from "./RemoteTimerHUD";
import type { DesktopParticipant } from "./desktopParticipant";
import type { CoworkPublicTimerState, NetworkAppearanceManifest } from "../../../lib/supabase/database.types";

/**
 * ONE Room participant's full slot: its own independent R3F `<Canvas>` +
 * camera + lights (identical framing/lighting to Local's own Canvas in
 * DesktopAvatarScene.tsx, for visual consistency), its own
 * RemoteAvatarInstance + interaction layer, and its own minimal HUD
 * (nickname + Lv only - section 9/51). A separate `<Canvas>` per remote
 * slot (rather than one shared 3D world with multiple avatars positioned
 * side by side under one camera) is what gives each remote participant a
 * genuinely independent render loop/AnimationMixer (section 7) for free,
 * and lets this reuse the EXACT same tightly-tuned close-up camera framing
 * Local already uses, unmodified (section 1) - a single wide shot fitting
 * up to 4 characters would need a whole new camera/lighting design instead.
 *
 * `onHoverChange` is reported up to the parent AvatarGroup so click-through
 * (section 21) considers hover across the WHOLE grid (any avatar, local or
 * remote), not just this one slot.
 */
export default function RemoteAvatarCanvas({
  participant,
  state,
  appearance,
  width,
  canvasHeight,
  profileStripHeight,
  hudScale,
  onHoverChange,
  onDraggingChange,
}: {
  participant: DesktopParticipant;
  /** This participant's current CoWork public timer state (or `null` -
   * treated as idle throughout, e.g. before their first upsert lands)
   * (section 1 of the cowork-timer-sync brief). Passed straight through to
   * RemoteAvatarInstance/RemoteTimerHUD - this component never interprets
   * it itself, so the animation and the HUD always agree (both derive
   * "working/break/idle/stale" the same way, at the cadence each needs
   * it - see RemoteAvatarInstance's own useFrame-driven check and
   * RemoteTimerHUD's own 1s tick). */
  state: CoworkPublicTimerState | null;
  /** This participant's published Network Appearance Snapshot manifest, or
   * `null` if they've never published one - RemoteAvatarInstance treats
   * `null` as "keep the default miniWaffle appearance" (section 0/42). */
  appearance: NetworkAppearanceManifest | null;
  width: number;
  /** The 3D viewport's own pixel height - same as Local's
   * layout.canvasHeight (never layout.windowHeight, which also includes
   * the profile strip + TimerHUD strip - section 50/51). */
  canvasHeight: number;
  /** Same as Local's layout.profileStripHeight - passed in rather than
   * recomputed here so this never drifts from the one source of truth in
   * desktopAvatarLayout.ts (section 19's "매직넘버가 퍼지지 않게"). */
  profileStripHeight: number;
  hudScale: number;
  onHoverChange: (hovering: boolean) => void;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const instanceRef = useRef<RemoteAvatarInstanceHandle>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const { ambient, key, fill } = lightIntensitiesFor(DEFAULT_TOON_SETTINGS, 0.8, 1.2, 0.4);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width }}>
      <div style={{ height: profileStripHeight }}>
        <AvatarProfileHUD nickname={participant.nickname} level={participant.level} minimal scale={hudScale} />
      </div>
      <div style={{ width, height: canvasHeight, position: "relative" }}>
        <Canvas
          camera={{ position: DESKTOP_CAMERA_POSITION, fov: DESKTOP_CAMERA_FOV }}
          gl={{ alpha: true }}
          style={{ background: "transparent" }}
          onCreated={(state) => {
            state.gl.setClearColor(0x000000, 0);
            state.gl.toneMapping = THREE.NoToneMapping;
            state.gl.outputColorSpace = THREE.SRGBColorSpace;
            state.camera.lookAt(...DESKTOP_CAMERA_TARGET);
          }}
        >
          <ambientLight intensity={ambient} />
          <directionalLight position={[3, 5, 4]} intensity={key} />
          <directionalLight position={[-3, 2, -4]} intensity={fill} />
          <RemoteAvatarInstance ref={instanceRef} state={state} appearance={appearance} userId={participant.userId} />
          <RemoteAvatarInteractionLayer
            instanceRef={instanceRef}
            onHoverChange={onHoverChange}
            onDraggingChange={onDraggingChange}
            onClick={() => setPopupOpen((prev) => !prev)}
          />
        </Canvas>
        {popupOpen && (
          <ParticipantPopup
            nickname={participant.nickname}
            level={participant.level}
            onClose={() => setPopupOpen(false)}
          />
        )}
      </div>
      <RemoteTimerHUD state={state} scale={hudScale} />
    </div>
  );
}
