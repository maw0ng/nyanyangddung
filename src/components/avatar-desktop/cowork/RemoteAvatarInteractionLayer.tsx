"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { DRAG_THRESHOLD_PX } from "../desktopInteractionConfig";
import type { RemoteAvatarInstanceHandle } from "./RemoteAvatarInstance";

/**
 * Remote-avatar counterpart of ../DesktopInteractionLayer.tsx - same
 * raycast-hit-test + press-and-move-threshold gesture logic (sections 22/
 * 23/25), deliberately duplicated in a small, adapted form rather than
 * generalizing DesktopInteractionLayer itself to accept an external mesh
 * list. Local's file stays completely untouched (section 1/75 - zero
 * regression risk to the working Local interaction path); this file only
 * ever raycasts against ONE remote instance's OWN cloned meshes, read live
 * via `instanceRef.current.getInteractiveMeshes()` (empty/no-op until that
 * instance's async template has finished loading and cloning).
 *
 * Click vs drag (section 24/25): any avatar - local OR remote - drags the
 * WHOLE BrowserWindow (never an individual Avatar's own position), so a
 * drag detected here calls the exact same
 * desktopAPI.beginWindowDrag/updateWindowDrag/endWindowDrag IPC calls
 * DesktopInteractionLayer already uses. A plain click (no drag) reports
 * onClick instead, for the parent to show the Participant Popup (section
 * 26) - never the Local Floating Menu (section 27 - that only ever opens
 * from Local's OWN interaction layer).
 */
export default function RemoteAvatarInteractionLayer({
  instanceRef,
  onHoverChange,
  onDraggingChange,
  onClick,
}: {
  instanceRef: React.RefObject<RemoteAvatarInstanceHandle>;
  onHoverChange: (hovering: boolean) => void;
  onDraggingChange: (dragging: boolean) => void;
  onClick: () => void;
}) {
  const { camera, gl, raycaster } = useThree();
  const pointerNDC = useMemo(() => new THREE.Vector2(), []);

  const onHoverChangeRef = useRef(onHoverChange);
  const onDraggingChangeRef = useRef(onDraggingChange);
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onHoverChangeRef.current = onHoverChange;
    onDraggingChangeRef.current = onDraggingChange;
    onClickRef.current = onClick;
  });

  useEffect(() => {
    const dom = gl.domElement;

    let hovering = false;
    let pointerDownOnAvatar = false;
    let dragging = false;
    let dragAccum = { x: 0, y: 0 };
    let dragUpdateScheduled = false;

    function raycastHitsAvatar(clientX: number, clientY: number): boolean {
      const meshes = instanceRef.current?.getInteractiveMeshes() ?? [];
      if (meshes.length === 0) return false;
      const rect = dom.getBoundingClientRect();
      pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, camera);
      return raycaster.intersectObjects(meshes, false).length > 0;
    }

    function setHovering(next: boolean) {
      if (hovering === next) return;
      hovering = next;
      onHoverChangeRef.current(next);
    }

    function scheduleDragUpdate() {
      if (dragUpdateScheduled) return;
      dragUpdateScheduled = true;
      requestAnimationFrame(() => {
        dragUpdateScheduled = false;
        window.desktopAPI?.updateWindowDrag(dragAccum.x, dragAccum.y);
      });
    }

    function handlePointerDown(e: PointerEvent) {
      if (e.button !== undefined && e.button !== 0) return;
      if (!raycastHitsAvatar(e.clientX, e.clientY)) return;
      pointerDownOnAvatar = true;
      dragAccum = { x: 0, y: 0 };
      dom.setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e: PointerEvent) {
      if (dragging) {
        dragAccum.x += e.movementX;
        dragAccum.y += e.movementY;
        scheduleDragUpdate();
        return;
      }

      setHovering(raycastHitsAvatar(e.clientX, e.clientY));

      if (pointerDownOnAvatar) {
        dragAccum.x += e.movementX;
        dragAccum.y += e.movementY;
        const distance = Math.hypot(dragAccum.x, dragAccum.y);
        if (distance > DRAG_THRESHOLD_PX) {
          dragging = true;
          onDraggingChangeRef.current(true);
          window.desktopAPI?.beginWindowDrag();
          scheduleDragUpdate();
        }
      }
    }

    function handlePointerUp(e: PointerEvent) {
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);

      if (dragging) {
        dragging = false;
        onDraggingChangeRef.current(false);
        window.desktopAPI?.endWindowDrag();
      } else if (pointerDownOnAvatar) {
        onClickRef.current();
      }
      pointerDownOnAvatar = false;
    }

    function handlePointerCancel() {
      if (dragging) {
        dragging = false;
        onDraggingChangeRef.current(false);
        window.desktopAPI?.endWindowDrag();
      }
      pointerDownOnAvatar = false;
    }

    dom.addEventListener("pointerdown", handlePointerDown);
    dom.addEventListener("pointermove", handlePointerMove);
    dom.addEventListener("pointerup", handlePointerUp);
    dom.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      dom.removeEventListener("pointerdown", handlePointerDown);
      dom.removeEventListener("pointermove", handlePointerMove);
      dom.removeEventListener("pointerup", handlePointerUp);
      dom.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [camera, gl, raycaster, pointerNDC, instanceRef]);

  return null;
}
