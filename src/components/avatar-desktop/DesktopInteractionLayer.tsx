"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { collectMaterialTargets } from "../hair-prototype/textureIO";
import { MODEL_URL } from "../hair-prototype/modelConfig";
import { DRAG_THRESHOLD_PX } from "./desktopInteractionConfig";

// Same runtime-verified node names ToonStyleController already uses for
// its own independent traversal of this GLB - re-declared locally rather
// than imported, matching this codebase's existing convention (every
// scene component owns its own small set of node-name constants; see
// MiniWaffleHairScene/FacePaintScene/TopsPaintScene/ToonStyleController).
const BODY_NODE_NAME = "Body";
const BODY_BASE_NODE_NAME = "Body-base";
const BODY_PARTS_NODE_NAME = "Body-Parts";
const HEAD_BACK_NODE_NAME = "head-back";
const TOPS_NODE_NAME = "Tops";
const HAIR_CANVAS_NODE_NAME = "HairCanvas";
const INTERACTIVE_NODE_NAMES = [
  BODY_NODE_NAME,
  BODY_BASE_NODE_NAME,
  BODY_PARTS_NODE_NAME,
  HEAD_BACK_NODE_NAME,
  TOPS_NODE_NAME,
  HAIR_CANVAS_NODE_NAME,
];

useGLTF.preload(MODEL_URL);

export interface DesktopInteractionDebugInfo {
  hit: boolean;
  dragging: boolean;
  pointerDown: boolean;
}

interface DesktopInteractionLayerProps {
  /** Same readiness gate as ToonStyleController/the character-load effect
   * - only start raycasting once Face/Tops have finished wiring their
   * final meshes (StrictMode-safety, see DesktopAvatarScene's own
   * comment on this exact issue). */
  ready: boolean;
  /** True while the click menu is open - suppresses opening it again on
   * the very same click that's meant to close it (the actual open/close
   * toggle itself is decided by the parent from onCharacterClick). */
  menuOpen: boolean;
  onCharacterHoverChange: (hovering: boolean) => void;
  onDraggingChange: (dragging: boolean) => void;
  onCharacterClick: () => void;
  onDebugUpdate?: (info: DesktopInteractionDebugInfo) => void;
}

/**
 * Purely an input layer - reads the same GLTF-cached scene graph
 * MiniWaffleHairScene/FacePaintScene/TopsPaintScene/ToonStyleController
 * already wire materials onto (never creates a mesh, never touches
 * geometry/material/morph/paint state), and never renders anything
 * itself. Its only job is: figure out whether the pointer is over the
 * actual character (not just anywhere in the transparent Canvas), and
 * turn that + a press-and-move gesture into hover/drag/click signals for
 * the parent to act on (click-through IPC calls, window dragging, the
 * floating menu).
 */
export default function DesktopInteractionLayer({
  ready,
  menuOpen,
  onCharacterHoverChange,
  onDraggingChange,
  onCharacterClick,
  onDebugUpdate,
}: DesktopInteractionLayerProps) {
  const gltf = useGLTF(MODEL_URL);
  const { camera, gl, raycaster } = useThree();
  const meshesRef = useRef<THREE.Object3D[]>([]);
  const pointerNDC = useMemo(() => new THREE.Vector2(), []);

  // Latest-value refs so the imperative DOM listeners below (set up once)
  // never see stale props - same pattern used throughout hair-prototype.
  const menuOpenRef = useRef(menuOpen);
  const onCharacterHoverChangeRef = useRef(onCharacterHoverChange);
  const onDraggingChangeRef = useRef(onDraggingChange);
  const onCharacterClickRef = useRef(onCharacterClick);
  const onDebugUpdateRef = useRef(onDebugUpdate);
  useEffect(() => {
    menuOpenRef.current = menuOpen;
    onCharacterHoverChangeRef.current = onCharacterHoverChange;
    onDraggingChangeRef.current = onDraggingChange;
    onCharacterClickRef.current = onCharacterClick;
    onDebugUpdateRef.current = onDebugUpdate;
  });

  // Deferred one macrotask past React 18 StrictMode's dev-only double
  // mount/unmount/mount, for the identical reason ToonStyleController and
  // DesktopAvatarScene's character-load effect defer theirs - otherwise
  // this could collect the FIRST (soon-to-be-discarded) pass's mesh
  // instances instead of the real, final ones.
  useEffect(() => {
    if (!ready || meshesRef.current.length > 0) return;
    const timer = setTimeout(() => {
      if (meshesRef.current.length > 0) return;
      const found = new Set<THREE.Object3D>();
      for (const name of INTERACTIVE_NODE_NAMES) {
        const node = gltf.scene.getObjectByName(name);
        if (!node) continue;
        for (const target of collectMaterialTargets(node)) {
          found.add(target.mesh);
        }
      }
      meshesRef.current = Array.from(found);
    }, 0);
    return () => clearTimeout(timer);
  }, [ready, gltf]);

  useEffect(() => {
    const dom = gl.domElement;

    let hovering = false;
    let pointerDownOnCharacter = false;
    let dragging = false;
    let dragAccum = { x: 0, y: 0 };
    let dragUpdateScheduled = false;

    function raycastHitsCharacter(clientX: number, clientY: number): boolean {
      const meshes = meshesRef.current;
      if (meshes.length === 0) return false;
      const rect = dom.getBoundingClientRect();
      pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, camera);
      // Phase 1 (section 5/29): plain geometry raycast. If HairCanvas's
      // fully-transparent shell area turns out to create a noticeably
      // oversized hit region in practice, an alpha-aware filter can be
      // added right here (sample the hit UV against the paint canvas'
      // alpha) without touching anything else in this file.
      return raycaster.intersectObjects(meshes, false).length > 0;
    }

    function reportDebug() {
      onDebugUpdateRef.current?.({ hit: hovering, dragging, pointerDown: pointerDownOnCharacter });
    }

    function setHovering(next: boolean) {
      if (hovering === next) return;
      hovering = next;
      onCharacterHoverChangeRef.current(next);
      reportDebug();
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
      if (!raycastHitsCharacter(e.clientX, e.clientY)) return;
      pointerDownOnCharacter = true;
      dragAccum = { x: 0, y: 0 };
      dom.setPointerCapture(e.pointerId);
      reportDebug();
    }

    function handlePointerMove(e: PointerEvent) {
      if (dragging) {
        dragAccum.x += e.movementX;
        dragAccum.y += e.movementY;
        scheduleDragUpdate();
        return;
      }

      setHovering(raycastHitsCharacter(e.clientX, e.clientY));

      if (pointerDownOnCharacter) {
        dragAccum.x += e.movementX;
        dragAccum.y += e.movementY;
        const distance = Math.hypot(dragAccum.x, dragAccum.y);
        if (distance > DRAG_THRESHOLD_PX) {
          dragging = true;
          onDraggingChangeRef.current(true);
          window.desktopAPI?.beginWindowDrag();
          // Apply the already-accumulated delta immediately so the window
          // doesn't visually "jump" once it starts tracking.
          scheduleDragUpdate();
          reportDebug();
        }
      }
    }

    function handlePointerUp(e: PointerEvent) {
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);

      if (dragging) {
        dragging = false;
        onDraggingChangeRef.current(false);
        window.desktopAPI?.endWindowDrag();
      } else if (pointerDownOnCharacter) {
        onCharacterClickRef.current();
      }
      pointerDownOnCharacter = false;
      reportDebug();
    }

    function handlePointerCancel() {
      if (dragging) {
        dragging = false;
        onDraggingChangeRef.current(false);
        window.desktopAPI?.endWindowDrag();
      }
      pointerDownOnCharacter = false;
      reportDebug();
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
  }, [camera, gl, raycaster, pointerNDC]);

  return null;
}
