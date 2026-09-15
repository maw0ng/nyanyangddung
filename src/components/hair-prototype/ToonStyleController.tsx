"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { collectMaterialTargets } from "./textureIO";
import {
  createOutlineMaterial,
  createOutlineMesh,
  createToonMaterial,
  updateToonMaterial,
  type OutlineMaterialHandle,
} from "./toonMaterialFactory";
import { type MaterialCategory, type ToonSettings } from "./toonStyle";
import { MODEL_URL } from "./modelConfig";

const BODY_NODE_NAME = "Body";
const BODY_BASE_NODE_NAME = "Body-base";
const BODY_PARTS_NODE_NAME = "Body-Parts";
const HEAD_BACK_NODE_NAME = "head-back";
const TOPS_NODE_NAME = "Tops";
const HAIR_CANVAS_NODE_NAME = "HairCanvas";

const OUTLINE_COLOR = new THREE.Color(0x2c2418);

useGLTF.preload(MODEL_URL);

interface ToonTarget {
  mesh: THREE.Mesh;
  materialIndex: number;
  category: MaterialCategory;
  originalMaterial: THREE.Material;
  toonMaterial: THREE.MeshToonMaterial | null;
  outlineMesh: THREE.Mesh | null;
  /** HairCanvas is structurally excluded here, at target-collection time -
   * never merely skipped later by a conditional (sections 16-19). */
  outlineAllowed: boolean;
}

/** Runtime-verified category assignment (section 10) - never assumes a
 * fixed material index/count, only the already-confirmed node/material
 * *names* this GLB actually uses (the same names the existing Hair/Face/
 * Tops paint scenes already key off of). */
function categoryFor(nodeLabel: string, materialName: string): MaterialCategory {
  if (nodeLabel === HAIR_CANVAS_NODE_NAME) return "hair";
  if (nodeLabel === TOPS_NODE_NAME) return "clothes";
  if (nodeLabel === BODY_NODE_NAME) {
    return materialName === "eye" ? "eye" : "face";
  }
  return "bodyParts"; // Body-base / Body-Parts / head-back
}

function setMeshMaterial(mesh: THREE.Mesh, index: number, material: THREE.Material) {
  if (Array.isArray(mesh.material)) {
    const next = mesh.material.slice();
    next[index] = material;
    mesh.material = next;
  } else {
    mesh.material = material;
  }
}

function collectRoots(scene: THREE.Object3D): [string, THREE.Object3D | undefined][] {
  return [
    [BODY_NODE_NAME, scene.getObjectByName(BODY_NODE_NAME)],
    [BODY_BASE_NODE_NAME, scene.getObjectByName(BODY_BASE_NODE_NAME)],
    [BODY_PARTS_NODE_NAME, scene.getObjectByName(BODY_PARTS_NODE_NAME)],
    [HEAD_BACK_NODE_NAME, scene.getObjectByName(HEAD_BACK_NODE_NAME)],
    [TOPS_NODE_NAME, scene.getObjectByName(TOPS_NODE_NAME)],
    [HAIR_CANVAS_NODE_NAME, scene.getObjectByName(HAIR_CANVAS_NODE_NAME)],
  ];
}

interface ToonStyleControllerProps {
  /** True once Hair/Face/Tops have all finished wiring their own materials
   * - see HairPaintPrototype's `sceneReady`. Building the target list any
   * earlier would capture stale (pre-Painting-clone) material references. */
  ready: boolean;
  settings: ToonSettings;
}

/**
 * Purely a rendering-style layer: reads whatever material each mesh
 * currently has (set up entirely by MiniWaffleHairScene/FacePaintScene/
 * TopsPaintScene) and swaps in a Toon-shaded variant that shares the same
 * map/transparency/alphaTest/side, or swaps back to the exact original
 * material reference when Toon is OFF. Never creates, clones, or mutates
 * geometry, skinning, morph targets, or the Painting engines' own
 * CanvasTexture objects.
 */
export default function ToonStyleController({ ready, settings }: ToonStyleControllerProps) {
  const gltf = useGLTF(MODEL_URL);
  const targetsRef = useRef<ToonTarget[]>([]);
  const outlineHandleRef = useRef<OutlineMaterialHandle | null>(null);
  const loggedRef = useRef(false);
  // Flips once the deferred target-collection effect below actually
  // populates `targetsRef` (bug fix - that effect fills the ref inside a
  // setTimeout(0), which runs in a LATER macrotask than the toon-apply and
  // outline effects' own synchronous first run off the same `ready` flip;
  // both of those effects read `targetsRef.current` while it's still `[]`
  // at that point, see `targets.length === 0` and permanently no-op since
  // nothing else was in their dependency array to make them run again -
  // Toon was never actually applied anywhere, in the Editor OR Desktop.
  // Adding this as a real state value they both depend on makes them
  // re-run exactly once more, right after targets become available.
  const [targetsReady, setTargetsReady] = useState(false);

  // Phase 1 (section 3): dump the real runtime mesh/material structure
  // once - nothing below is implemented from a guess about this structure.
  useEffect(() => {
    if (!ready || loggedRef.current) return;
    // Deferred one macrotask so this always runs strictly after React 18
    // StrictMode's dev-only synchronous mount->unmount->remount double
    // pass has fully settled - without this, a first pass can observe
    // (and, worse, permanently capture as "original") materials that a
    // second pass's Face/Tops discovery effect hasn't finished re-wiring
    // yet. See the target-collection effect below for why this matters.
    const timer = setTimeout(() => {
      loggedRef.current = true;
      console.groupCollapsed("[ToonStyleController] runtime material inspection");
      for (const [label, node] of collectRoots(gltf.scene)) {
        if (!node) {
          console.warn(`[ToonStyleController] node "${label}" not found in GLB`);
          continue;
        }
        for (const t of collectMaterialTargets(node)) {
          const mat = t.material as THREE.MeshStandardMaterial;
          console.log(label, {
            meshName: t.mesh.name,
            materialName: mat.name,
            materialType: mat.type,
            hasMap: !!mat.map,
            transparent: mat.transparent,
            opacity: mat.opacity,
            alphaTest: mat.alphaTest,
            side: mat.side,
            isSkinnedMesh: !!(t.mesh as THREE.SkinnedMesh).isSkinnedMesh,
            hasMorphDict: !!t.mesh.morphTargetDictionary,
            hasMorphInfluences: !!t.mesh.morphTargetInfluences,
          });
        }
      }
      console.groupEnd();
    }, 0);
    return () => clearTimeout(timer);
  }, [ready, gltf]);

  // Build the target list exactly once - deferred (see above) so it only
  // ever runs after Face/Tops's own discovery effects have finished their
  // FINAL pass, never in between a StrictMode double-invoke's two passes.
  // As an extra safety net, a material already carrying our own
  // `toonCategory` marker means some earlier pass already wrapped it - in
  // that case this skips instead of adopting a non-original material as
  // "original" (which would make Toon OFF stop matching the true default).
  useEffect(() => {
    if (!ready || targetsRef.current.length > 0) return;
    const timer = setTimeout(() => {
      if (targetsRef.current.length > 0) return;
      const targets: ToonTarget[] = [];
      let sawAlreadyWrapped = false;
      for (const [label, node] of collectRoots(gltf.scene)) {
        if (!node) continue;
        for (const t of collectMaterialTargets(node)) {
          if (t.material.userData?.toonCategory) {
            sawAlreadyWrapped = true;
            continue;
          }
          const category = categoryFor(label, (t.material as THREE.Material).name);
          targets.push({
            mesh: t.mesh,
            materialIndex: t.materialIndex,
            category,
            originalMaterial: t.material,
            toonMaterial: null,
            outlineMesh: null,
            outlineAllowed: label !== HAIR_CANVAS_NODE_NAME,
          });
        }
      }
      if (sawAlreadyWrapped) {
        console.warn(
          "[ToonStyleController] found an already-Toon-wrapped material while collecting targets - skipping this pass."
        );
        return;
      }
      targetsRef.current = targets;
      setTargetsReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [ready, gltf]);

  // Toon material apply/restore + live shadeSteps/shadowStrength updates.
  useEffect(() => {
    if (!ready) return;
    const targets = targetsRef.current;
    if (targets.length === 0) return;

    if (!settings.enabled) {
      for (const t of targets) {
        setMeshMaterial(t.mesh, t.materialIndex, t.originalMaterial);
      }
      return;
    }

    for (const t of targets) {
      if (!t.toonMaterial) {
        t.toonMaterial = createToonMaterial(t.originalMaterial, t.category, settings);
      } else {
        updateToonMaterial(t.toonMaterial, t.category, settings);
      }
      setMeshMaterial(t.mesh, t.materialIndex, t.toonMaterial);
    }
  }, [ready, settings, targetsReady]);

  // Outline lifecycle - kept independent of the toon-material effect so
  // toggling only the outline never rebuilds/reassigns toon materials.
  useEffect(() => {
    if (!ready) return;
    const targets = targetsRef.current;
    if (targets.length === 0) return;

    const showOutline = settings.enabled && settings.outlineEnabled;
    if (!showOutline) {
      for (const t of targets) if (t.outlineMesh) t.outlineMesh.visible = false;
      return;
    }

    if (!outlineHandleRef.current) {
      outlineHandleRef.current = createOutlineMaterial(
        settings.outlineWidth,
        OUTLINE_COLOR,
        settings.outlineStrength
      );
    }
    const handle = outlineHandleRef.current;
    handle.setWidth(settings.outlineWidth);
    handle.setOpacity(Math.min(1, Math.max(0.05, settings.outlineStrength)));

    for (const t of targets) {
      // HairCanvas is never in this loop with outlineAllowed=true - it was
      // excluded from Outline consideration entirely at collection time.
      if (!t.outlineAllowed) continue;
      if (!t.outlineMesh) {
        t.outlineMesh = createOutlineMesh(t.mesh, handle.material);
      }
      t.outlineMesh.visible = true;
    }
  }, [ready, settings.enabled, settings.outlineEnabled, settings.outlineWidth, settings.outlineStrength, targetsReady]);

  return null;
}
