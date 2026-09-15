"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { CosmeticAttachmentSceneHandle } from "./CosmeticAttachmentScene";

const CLICK_MOVE_TOLERANCE_PX = 4;

/**
 * Click-to-select / click-empty-to-deselect for the currently-attached
 * accessory (section 7) - a plain pointerdown/pointerup raycast against the
 * accessory's own meshes (via CosmeticAttachmentSceneHandle.getMeshes()),
 * completely independent of TransformControls' own gizmo raycasting.
 *
 * `active` is driven by the owner (HairPaintPrototype) as
 * `cosmetic Transform sub-mode && equipped && not currently dragging the
 * gizmo` - reading it through a ref (updated post-commit via a plain
 * effect, never synchronously inside the native listener) is what keeps
 * this from misfiring on the SAME pointerup that ends a TransformControls
 * drag: at the moment that native event fires, the ref still reflects the
 * pre-drag-end value for the remainder of that synchronous event, so a
 * gizmo-drag release never gets misread as an empty-space click here
 * (section 7's "TransformControls 드래그와 절대 충돌하면 안 된다").
 */
export default function CosmeticSelectionController({
  active,
  attachmentRef,
  onSelect,
  onDeselect,
}: {
  active: boolean;
  attachmentRef: RefObject<CosmeticAttachmentSceneHandle | null>;
  onSelect: () => void;
  onDeselect: () => void;
}) {
  const { camera, gl, raycaster } = useThree();
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  });

  useEffect(() => {
    const dom = gl.domElement;
    const ndc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    function handlePointerDown(e: PointerEvent) {
      downX = e.clientX;
      downY = e.clientY;
    }

    function handlePointerUp(e: PointerEvent) {
      if (!activeRef.current) return;
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (Math.hypot(dx, dy) > CLICK_MOVE_TOLERANCE_PX) return;

      const meshes = attachmentRef.current?.getMeshes() ?? [];
      if (meshes.length === 0) {
        onDeselect();
        return;
      }
      const rect = dom.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) onSelect();
      else onDeselect();
    }

    dom.addEventListener("pointerdown", handlePointerDown);
    dom.addEventListener("pointerup", handlePointerUp);
    return () => {
      dom.removeEventListener("pointerdown", handlePointerDown);
      dom.removeEventListener("pointerup", handlePointerUp);
    };
  }, [camera, gl, raycaster, attachmentRef, onSelect, onDeselect]);

  return null;
}
