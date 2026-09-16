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
 * Click vs drag (free-placement bug/feature request - "다른 사람 캐릭터를
 * 내 화면에서 자유롭게 이동"): a drag detected here reports screen-space
 * pixel deltas via `onDragMove`/`onDragEnd` for the PARENT
 * (DesktopParticipantGrid) to apply to this participant's own layout
 * position - it never touches `window.desktopAPI` at all (a remote
 * avatar's drag must never move the Electron BrowserWindow, which would
 * drag every OTHER avatar along with it too). A plain click (no drag)
 * reports onClick instead, for the parent to show the Participant Popup
 * (section 26) - never the Local Floating Menu (section 27 - that only
 * ever opens from Local's OWN interaction layer).
 */
export default function RemoteAvatarInteractionLayer({
  instanceRef,
  onHoverChange,
  onDraggingChange,
  onDragMove,
  onDragEnd,
  onClick,
}: {
  instanceRef: React.RefObject<RemoteAvatarInstanceHandle>;
  onHoverChange: (hovering: boolean) => void;
  onDraggingChange: (dragging: boolean) => void;
  /** Screen-space pixel delta since the last call (never accumulated
   * server-side, never touches the network - see coworkLocalLayoutStorage.ts). */
  onDragMove: (dx: number, dy: number) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const { camera, gl, raycaster } = useThree();
  const pointerNDC = useMemo(() => new THREE.Vector2(), []);

  const onHoverChangeRef = useRef(onHoverChange);
  const onDraggingChangeRef = useRef(onDraggingChange);
  const onDragMoveRef = useRef(onDragMove);
  const onDragEndRef = useRef(onDragEnd);
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onHoverChangeRef.current = onHoverChange;
    onDraggingChangeRef.current = onDraggingChange;
    onDragMoveRef.current = onDragMove;
    onDragEndRef.current = onDragEnd;
    onClickRef.current = onClick;
  });

  useEffect(() => {
    const dom = gl.domElement;

    let hovering = false;
    let pointerDownOnAvatar = false;
    let dragging = false;
    let dragAccum = { x: 0, y: 0 };
    let frameDelta = { x: 0, y: 0 };
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
        const { x, y } = frameDelta;
        frameDelta = { x: 0, y: 0 };
        if (x !== 0 || y !== 0) onDragMoveRef.current(x, y);
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
        frameDelta.x += e.movementX;
        frameDelta.y += e.movementY;
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
          // The accumulated pre-threshold delta counts as the first move
          // too, so the avatar doesn't visually "jump" once dragging starts.
          onDragMoveRef.current(dragAccum.x, dragAccum.y);
        }
      }
    }

    function handlePointerUp(e: PointerEvent) {
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);

      if (dragging) {
        dragging = false;
        onDraggingChangeRef.current(false);
        onDragEndRef.current();
      } else if (pointerDownOnAvatar) {
        onClickRef.current();
      }
      pointerDownOnAvatar = false;
    }

    function handlePointerCancel() {
      if (dragging) {
        dragging = false;
        onDraggingChangeRef.current(false);
        onDragEndRef.current();
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
