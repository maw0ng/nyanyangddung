"use client";

import { useRef } from "react";
import * as THREE from "three";
import { TransformControls } from "@react-three/drei";
import { readCosmeticTransform } from "./cosmeticAttachment";
import { clampCosmeticScale, type CosmeticTransform } from "./cosmeticRegistry";

/**
 * Direct 3D manipulation for the selected accessory's AttachmentRoot
 * (section 5 - deliberately NOT a numeric-slider UI). Wraps drei's
 * `TransformControls` as-is (translate/rotate/scale modes, matching W/E/R
 * exactly - section 5), rather than building a custom gizmo.
 *
 * OrbitControls conflict (section 7): `onDragStart`/`onDragEnd` bubble up
 * to the parent (HairPaintPrototype), which disables OrbitControls for the
 * duration of a gizmo drag and re-enables it on release - this component
 * itself never touches OrbitControls directly, keeping the two fully
 * decoupled.
 *
 * XYZ non-uniform scale (section 6): scale mode's per-axis handles are
 * drei's own built-in behavior (never overridden here) - the center
 * uniform-scale handle still works too. Only on drag RELEASE is the
 * resulting scale clamped into the safe range (COSMETIC_SCALE_MIN/MAX) -
 * during the drag itself nothing is clamped, so the live gizmo feel is
 * never fought mid-drag.
 */
export default function CosmeticTransformControls({
  target,
  mode,
  onDragStart,
  onDragEnd,
}: {
  target: THREE.Object3D | null;
  mode: "translate" | "rotate" | "scale";
  onDragStart: () => void;
  onDragEnd: (before: CosmeticTransform, after: CosmeticTransform) => void;
}) {
  const beforeRef = useRef<CosmeticTransform | null>(null);

  if (!target) return null;

  return (
    <TransformControls
      object={target}
      mode={mode}
      onMouseDown={() => {
        beforeRef.current = readCosmeticTransform(target);
        onDragStart();
      }}
      onMouseUp={() => {
        const before = beforeRef.current;
        beforeRef.current = null;
        if (!before) return;
        if (mode === "scale") {
          const clamped = clampCosmeticScale([target.scale.x, target.scale.y, target.scale.z]);
          target.scale.set(clamped[0], clamped[1], clamped[2]);
        }
        const after = readCosmeticTransform(target);
        onDragEnd(before, after);
      }}
    />
  );
}
