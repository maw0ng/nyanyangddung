"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type {
  EditMode,
  FaceDebugInfo,
  FaceLayerName,
  FaceTool,
  HistoryStatus,
  StoredPaintLayer,
} from "./types";
import {
  canvasToPngBlob,
  collectMaterialTargets,
  generateUVGuideCanvas,
  type MaterialTarget,
} from "./textureIO";
import {
  LayerStackEngine,
  summarizeLayers,
  type LayerSummary,
} from "./layerStackEngine";
import { MODEL_URL } from "./modelConfig";

const BODY_NODE_NAME = "Body";
const FALLBACK_CANVAS_SIZE = 1024;
// A jump larger than this in either UV axis between two consecutive stroke
// points is treated as "landed on a different UV island", not "drag across
// the atlas" - mirrors the seam guard MiniWaffleHairScene uses, generalized
// to both axes since the face atlas isn't a single spherical UV wrap.
const UV_JUMP_THRESHOLD = 0.25;

// Measured directly from the GLB (see the runtime console report too):
//   base primitive UV bbox: U[0.002, 0.998] V[0.003, 0.996]
//   eye  primitive UV bbox: U[0.250, 0.750] V[0.432, 0.869]
// Raycasting only ever hits Body's actual face triangles, so a stroke's UV
// is always already "on the face" - there is no live case today where a
// hit needs to be rejected for landing outside these boxes. This constant
// exists so a future, more permissive Body mesh (e.g. one where "base"
// also covers the neck) can clamp painting to just the face without
// touching the raycasting/painting logic itself.
const FACE_UV_REGION: Record<
  FaceLayerName,
  { uMin: number; uMax: number; vMin: number; vMax: number }
> = {
  base: { uMin: 0, uMax: 1, vMin: 0, vMax: 1 },
  eye: { uMin: 0, uMax: 1, vMin: 0, vMax: 1 },
};

useGLTF.preload(MODEL_URL);

export interface FacePaintSceneHandle {
  undo: (layer: FaceLayerName) => void;
  redo: (layer: FaceLayerName) => void;
  resetToDefault: (layer: FaceLayerName) => void;
  applyPreset: (input: {
    baseLayers: StoredPaintLayer[];
    eyeLayers: StoredPaintLayer[];
    baseOverrideTexture?: Blob | null;
    eyeOverrideTexture?: Blob | null;
  }) => Promise<void>;
  exportForPreset: () => Promise<{
    baseLayers: StoredPaintLayer[];
    eyeLayers: StoredPaintLayer[];
    baseOverrideTexture: Blob | null;
    eyeOverrideTexture: Blob | null;
  }>;
  getUVGuideBlob: (layer: FaceLayerName) => Promise<Blob>;
  getCurrentTextureBlob: (layer: FaceLayerName) => Promise<Blob>;
  getPaintLayerBlob: (layer: FaceLayerName) => Promise<Blob>;
  getActiveLayerBlob: (layer: FaceLayerName) => Promise<Blob>;
  importPaintLayer: (
    layer: FaceLayerName,
    blob: Blob,
    target: "active" | "new"
  ) => Promise<void>;
  importFullTexture: (layer: FaceLayerName, blob: Blob) => Promise<void>;
  getTextureSize: (layer: FaceLayerName) => number | null;
  createLayer: (layer: FaceLayerName) => void;
  deleteLayer: (layer: FaceLayerName, id: string) => void;
  duplicateLayer: (layer: FaceLayerName, id: string) => void;
  renameLayer: (layer: FaceLayerName, id: string, name: string) => void;
  selectLayer: (layer: FaceLayerName, id: string) => void;
  setLayerVisible: (layer: FaceLayerName, id: string, visible: boolean) => void;
  setLayerLocked: (layer: FaceLayerName, id: string, locked: boolean) => void;
  beginOpacityChange: (layer: FaceLayerName, id: string) => void;
  setLayerOpacity: (layer: FaceLayerName, id: string, value: number) => void;
  moveLayerUp: (layer: FaceLayerName, id: string) => void;
  moveLayerDown: (layer: FaceLayerName, id: string) => void;
  reorderLayers: (layer: FaceLayerName, ids: string[]) => void;
  clearHistory: (layer: FaceLayerName) => void;
  /** Body morph targets. Reads/writes the real
   * mesh.morphTargetDictionary/morphTargetInfluences found on Body - never
   * a separate copy of the shape keys themselves. */
  getMorphNames: () => string[];
  getMorphValues: () => Record<string, number>;
  setMorphValue: (name: string, value: number) => void;
  setMorphValues: (values: Record<string, number>) => void;
  /** The values captured immediately after the GLB finished loading, before
   * any user edit - used as "기본 Morph" for a brand-new character. */
  getDefaultMorphValues: () => Record<string, number>;
  resetMorphToDefault: () => void;
  /** The actual runtime name of the mesh whose morphTargetDictionary is
   * being used (e.g. for a diagnostics panel) - never hardcoded. */
  getBodyMeshName: () => string | null;
}

interface FacePaintSceneProps {
  editMode: EditMode;
  tool: FaceTool;
  color: string;
  brushSize: number;
  mirrorEnabled: boolean;
  onDebugUpdate: (patch: Partial<FaceDebugInfo>) => void;
  onHistoryChange: (layer: FaceLayerName, status: HistoryStatus) => void;
  onLayersChange?: (
    layer: FaceLayerName,
    layers: LayerSummary[],
    activeLayerId: string
  ) => void;
}

interface Surface {
  name: FaceLayerName;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  engine: LayerStackEngine;
}

function createSurface(
  name: FaceLayerName,
  target: MaterialTarget,
  onStructureChange: () => void,
  onHistoryChange: (status: HistoryStatus) => void
): Surface | null {
  const material = target.material as THREE.MeshStandardMaterial;
  const originalTexture = material.map;
  const originalImage = originalTexture?.image as
    | (CanvasImageSource & { width?: number })
    | undefined;
  if (!originalImage) {
    console.error(
      `[FacePaintScene] "${name}" material has no usable map image`,
      material
    );
    return null;
  }

  const canvasSize = originalImage.width || FALLBACK_CANVAS_SIZE;
  const engine = new LayerStackEngine(
    canvasSize,
    originalImage,
    onStructureChange,
    onHistoryChange
  );

  // Clone the material so painting Body's own face never touches whatever
  // other node (Body-base / Body-Parts / head-back) happens to share the
  // exact same "base" material instance.
  const clonedMaterial = material.clone() as THREE.MeshStandardMaterial;
  clonedMaterial.map = engine.compositeTexture;
  clonedMaterial.needsUpdate = true;

  const materials = Array.isArray(target.mesh.material)
    ? (target.mesh.material as THREE.Material[]).slice()
    : null;
  if (materials) {
    materials[target.materialIndex] = clonedMaterial;
    target.mesh.material = materials;
  } else {
    target.mesh.material = clonedMaterial;
  }

  return { name, mesh: target.mesh, material: clonedMaterial, engine };
}

function FacePaintScene(
  {
    editMode,
    tool,
    color,
    brushSize,
    mirrorEnabled,
    onDebugUpdate,
    onHistoryChange,
    onLayersChange,
  }: FacePaintSceneProps,
  forwardedRef: React.ForwardedRef<FacePaintSceneHandle>
) {
  const gltf = useGLTF(MODEL_URL);
  const { camera, gl, raycaster } = useThree();

  const surfacesRef = useRef<Record<FaceLayerName, Surface | null>>({
    base: null,
    eye: null,
  });

  type MorphMesh = THREE.Mesh & {
    morphTargetDictionary?: Record<string, number>;
    morphTargetInfluences?: number[];
  };
  const morphMeshRef = useRef<MorphMesh | null>(null);
  const defaultMorphValuesRef = useRef<Record<string, number> | null>(null);

  const editModeRef = useRef(editMode);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const brushSizeRef = useRef(brushSize);
  const mirrorRef = useRef(mirrorEnabled);
  const onDebugUpdateRef = useRef(onDebugUpdate);
  const onHistoryChangeRef = useRef(onHistoryChange);
  const onLayersChangeRef = useRef(onLayersChange);
  useEffect(() => {
    editModeRef.current = editMode;
    toolRef.current = tool;
    colorRef.current = color;
    brushSizeRef.current = brushSize;
    mirrorRef.current = mirrorEnabled;
    onDebugUpdateRef.current = onDebugUpdate;
    onHistoryChangeRef.current = onHistoryChange;
    onLayersChangeRef.current = onLayersChange;
  });

  const pointerNDC = useMemo(() => new THREE.Vector2(), []);

  function getSurface(name: FaceLayerName): Surface | null {
    return surfacesRef.current[name];
  }

  useImperativeHandle(
    forwardedRef,
    () => ({
      undo: (layer) => getSurface(layer)?.engine.undo(),
      redo: (layer) => getSurface(layer)?.engine.redo(),
      resetToDefault: (layer) => getSurface(layer)?.engine.resetToDefault(),
      applyPreset: async (input) => {
        const base = getSurface("base");
        const eye = getSurface("eye");
        await Promise.all([
          base?.engine.applyLayerStackFromStored(
            input.baseLayers,
            input.baseOverrideTexture ?? null
          ),
          eye?.engine.applyLayerStackFromStored(
            input.eyeLayers,
            input.eyeOverrideTexture ?? null
          ),
        ]);
      },
      exportForPreset: async () => {
        const base = getSurface("base");
        const eye = getSurface("eye");
        const [baseResult, eyeResult] = await Promise.all([
          base?.engine.exportForPreset() ?? Promise.resolve({ layers: [], overrideTexture: null }),
          eye?.engine.exportForPreset() ?? Promise.resolve({ layers: [], overrideTexture: null }),
        ]);
        return {
          baseLayers: baseResult.layers,
          eyeLayers: eyeResult.layers,
          baseOverrideTexture: baseResult.overrideTexture,
          eyeOverrideTexture: eyeResult.overrideTexture,
        };
      },
      getUVGuideBlob: async (layer) => {
        const surface = getSurface(layer);
        const guide = generateUVGuideCanvas(
          surface?.mesh.geometry ?? new THREE.BufferGeometry(),
          surface?.engine.size ?? FALLBACK_CANVAS_SIZE,
          { flipY: false }
        );
        return canvasToPngBlob(guide);
      },
      getCurrentTextureBlob: (layer) =>
        getSurface(layer)?.engine.exportCompositeBlob() ??
        canvasToPngBlob(document.createElement("canvas")),
      getPaintLayerBlob: (layer) =>
        getSurface(layer)?.engine.exportAllLayersCompositeBlob() ??
        canvasToPngBlob(document.createElement("canvas")),
      getActiveLayerBlob: (layer) =>
        getSurface(layer)?.engine.exportActiveLayerBlob() ??
        canvasToPngBlob(document.createElement("canvas")),
      importPaintLayer: async (layer, blob, target) => {
        const engine = getSurface(layer)?.engine;
        if (!engine) return;
        if (target === "new") await engine.importPNGAsNewLayer(blob);
        else await engine.importPNGToActiveLayer(blob);
      },
      importFullTexture: async (layer, blob) => {
        await getSurface(layer)?.engine.importFullTextureOverride(blob);
      },
      getTextureSize: (layer) => getSurface(layer)?.engine.size ?? null,
      createLayer: (layer) => getSurface(layer)?.engine.createLayer(),
      deleteLayer: (layer, id) => getSurface(layer)?.engine.deleteLayer(id),
      duplicateLayer: (layer, id) => getSurface(layer)?.engine.duplicateLayer(id),
      renameLayer: (layer, id, name) => getSurface(layer)?.engine.renameLayer(id, name),
      selectLayer: (layer, id) => getSurface(layer)?.engine.selectLayer(id),
      setLayerVisible: (layer, id, visible) =>
        getSurface(layer)?.engine.setVisible(id, visible),
      setLayerLocked: (layer, id, locked) =>
        getSurface(layer)?.engine.setLocked(id, locked),
      beginOpacityChange: (layer) => getSurface(layer)?.engine.beginOpacityChange(),
      setLayerOpacity: (layer, id, value) =>
        getSurface(layer)?.engine.setOpacityLive(id, value),
      moveLayerUp: (layer, id) => getSurface(layer)?.engine.moveLayerUp(id),
      moveLayerDown: (layer, id) => getSurface(layer)?.engine.moveLayerDown(id),
      reorderLayers: (layer, ids) => getSurface(layer)?.engine.reorderLayers(ids),
      clearHistory: (layer) => getSurface(layer)?.engine.clearHistory(),
      getMorphNames: () => {
        const dict = morphMeshRef.current?.morphTargetDictionary;
        return dict ? Object.keys(dict) : [];
      },
      getMorphValues: () => {
        const mesh = morphMeshRef.current;
        const result: Record<string, number> = {};
        if (mesh?.morphTargetDictionary && mesh.morphTargetInfluences) {
          for (const [name, idx] of Object.entries(mesh.morphTargetDictionary)) {
            result[name] = mesh.morphTargetInfluences[idx] ?? 0;
          }
        }
        return result;
      },
      setMorphValue: (name, value) => {
        const mesh = morphMeshRef.current;
        if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences) return;
        const idx = mesh.morphTargetDictionary[name];
        if (idx === undefined) return;
        mesh.morphTargetInfluences[idx] = value;
      },
      setMorphValues: (values) => {
        const mesh = morphMeshRef.current;
        if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences) return;
        for (const [name, value] of Object.entries(values)) {
          const idx = mesh.morphTargetDictionary[name];
          // Unknown morph name in stored data (e.g. an older/newer GLB
          // revision) - ignore it rather than crash.
          if (idx === undefined) continue;
          mesh.morphTargetInfluences[idx] = value;
        }
      },
      getDefaultMorphValues: () => ({ ...(defaultMorphValuesRef.current ?? {}) }),
      resetMorphToDefault: () => {
        const mesh = morphMeshRef.current;
        const defaults = defaultMorphValuesRef.current;
        if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences || !defaults) return;
        for (const [name, idx] of Object.entries(mesh.morphTargetDictionary)) {
          mesh.morphTargetInfluences[idx] = defaults[name] ?? 0;
        }
      },
      getBodyMeshName: () => morphMeshRef.current?.name ?? null,
    }),
    []
  );

  // Discover the "Body" node, verify base/eye material targets exist, and
  // wire up a layer-stack engine for each. Never touches HairCanvas or its
  // material, and never rebuilds Body's geometry/skinning.
  useEffect(() => {
    const bodyNode = gltf.scene.getObjectByName(BODY_NODE_NAME);

    if (!bodyNode) {
      console.error(
        `[FacePaintScene] node named "${BODY_NODE_NAME}" was not found in the GLB scene graph.`
      );
      onDebugUpdate({
        bodyFound: false,
        bodyNodeType: null,
        morphTargetCount: null,
        baseMeshFound: false,
        eyeMeshFound: false,
        basePaintCanvasReady: false,
        eyePaintCanvasReady: false,
      });
      return;
    }

    const targets = collectMaterialTargets(bodyNode);
    console.groupCollapsed("[FacePaintScene] Body structure");
    console.log("Body node:", bodyNode.type, bodyNode.name);
    console.log(
      "Descendant mesh/material targets:",
      targets.map((t) => ({
        mesh: t.mesh.name,
        meshType: t.mesh.type,
        isSkinnedMesh: !!(t.mesh as THREE.SkinnedMesh).isSkinnedMesh,
        materialIndex: t.materialIndex,
        materialName: t.material.name,
      }))
    );
    console.groupEnd();

    const baseTarget = targets.find((t) => t.material.name === "base");
    const eyeTarget = targets.find((t) => t.material.name === "eye");

    if (!baseTarget) {
      console.error(
        '[FacePaintScene] no material named "base" found under Body. Found:',
        targets.map((t) => t.material.name)
      );
    }
    if (!eyeTarget) {
      console.error(
        '[FacePaintScene] no material named "eye" found under Body. Found:',
        targets.map((t) => t.material.name)
      );
    }

    const makeCallbacks = (name: FaceLayerName) => ({
      onStructureChange: () => {
        const surface = surfacesRef.current[name];
        if (!surface) return;
        onLayersChangeRef.current?.(
          name,
          summarizeLayers(surface.engine.layers),
          surface.engine.activeLayerId
        );
      },
      onHistoryChange: (status: HistoryStatus) => onHistoryChangeRef.current(name, status),
    });

    const baseCallbacks = makeCallbacks("base");
    const eyeCallbacks = makeCallbacks("eye");

    const baseSurface = baseTarget
      ? createSurface("base", baseTarget, baseCallbacks.onStructureChange, baseCallbacks.onHistoryChange)
      : null;
    const eyeSurface = eyeTarget
      ? createSurface("eye", eyeTarget, eyeCallbacks.onStructureChange, eyeCallbacks.onHistoryChange)
      : null;
    surfacesRef.current = { base: baseSurface, eye: eyeSurface };

    console.log("[FacePaintScene] base texture size:", baseSurface?.engine.size);
    console.log("[FacePaintScene] eye texture size:", eyeSurface?.engine.size);

    let morphTargetCount: number | null = null;
    const meshWithMorphs = targets.find(
      (t) => t.mesh.morphTargetDictionary
    )?.mesh as MorphMesh | undefined;
    if (meshWithMorphs?.morphTargetDictionary) {
      morphTargetCount = Object.keys(meshWithMorphs.morphTargetDictionary)
        .length;
    }
    morphMeshRef.current = meshWithMorphs ?? null;
    // Capture the GLB's own initial morph weights exactly once, so a new
    // Character (or "기본" preset) always resets to what the model actually
    // shipped with - never to whatever the previously active character had
    // last set. Guarded so a StrictMode dev remount can't clobber it with
    // already-user-edited influences.
    if (defaultMorphValuesRef.current === null && meshWithMorphs?.morphTargetDictionary) {
      const defaults: Record<string, number> = {};
      const influences = meshWithMorphs.morphTargetInfluences ?? [];
      for (const [name, idx] of Object.entries(meshWithMorphs.morphTargetDictionary)) {
        defaults[name] = influences[idx] ?? 0;
      }
      defaultMorphValuesRef.current = defaults;
    }

    onDebugUpdate({
      bodyFound: true,
      bodyNodeType: bodyNode.type,
      morphTargetCount,
      baseMeshFound: !!baseSurface,
      eyeMeshFound: !!eyeSurface,
      basePaintCanvasReady: !!baseSurface,
      eyePaintCanvasReady: !!eyeSurface,
      baseTextureSize: baseSurface?.engine.size ?? null,
      eyeTextureSize: eyeSurface?.engine.size ?? null,
    });

    baseCallbacks.onStructureChange();
    eyeCallbacks.onStructureChange();
    baseCallbacks.onHistoryChange({ canUndo: false, canRedo: false });
    eyeCallbacks.onHistoryChange({ canUndo: false, canRedo: false });

    return () => {
      // Intentionally not disposing here - see MiniWaffleHairScene's note
      // on the same pattern (StrictMode dev double-invoke would otherwise
      // tear down the only engines/textures we have).
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, onDebugUpdate]);

  // Pointer-driven painting: raycast against Body's base/eye meshes only,
  // route the stroke to whichever layer was actually hit. Unchanged from
  // the pre-layers version except strokes now draw into the hit surface's
  // *active layer* canvas and recomposite via its engine.
  useEffect(() => {
    const dom = gl.domElement;

    let isDrawing = false;
    let activeSurfaceName: FaceLayerName | null = null;
    const lastUVByLayer: Record<FaceLayerName, THREE.Vector2 | null> = {
      base: null,
      eye: null,
    };

    function getHit(
      clientX: number,
      clientY: number
    ): { uv: THREE.Vector2; layer: FaceLayerName } | null {
      const meshes = [
        surfacesRef.current.base?.mesh,
        surfacesRef.current.eye?.mesh,
      ].filter((m): m is THREE.Mesh => !!m);
      if (meshes.length === 0) return null;

      const rect = dom.getBoundingClientRect();
      pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointerNDC, camera);
      const hits = raycaster.intersectObjects(meshes, false);
      const hit = hits[0];

      if (!hit || !hit.uv) {
        onDebugUpdateRef.current({
          raycastOk: false,
          hitMeshName: null,
          hitMaterialName: null,
          hitMaterialIndex: null,
          hitLayer: null,
        });
        return null;
      }

      const hitUv = hit.uv;
      const hitMesh = hit.object as THREE.Mesh;
      const layerName: FaceLayerName | null =
        hitMesh === surfacesRef.current.base?.mesh
          ? "base"
          : hitMesh === surfacesRef.current.eye?.mesh
            ? "eye"
            : null;
      const material = hitMesh.material as THREE.Material;

      onDebugUpdateRef.current({
        raycastOk: true,
        hitMeshName: hitMesh.name,
        hitMaterialName: material?.name ?? null,
        hitMaterialIndex: hit.face?.materialIndex ?? 0,
        hitLayer: layerName,
        uv: { u: hitUv.x, v: hitUv.y },
      });

      if (!layerName) return null;
      return { uv: hitUv, layer: layerName };
    }

    function clampToFaceRegion(
      layerName: FaceLayerName,
      u: number,
      v: number
    ): [number, number] {
      const region = FACE_UV_REGION[layerName];
      return [
        Math.min(region.uMax, Math.max(region.uMin, u)),
        Math.min(region.vMax, Math.max(region.vMin, v)),
      ];
    }

    function strokeOnSurface(
      surface: Surface,
      uv: THREE.Vector2,
      prevUV: THREE.Vector2 | null,
      mirror: boolean
    ) {
      const layer = surface.engine.getActiveLayer();
      if (!layer) return;
      const ctx = layer.canvas.getContext("2d");
      if (!ctx) return;
      const w = layer.canvas.width;
      const h = layer.canvas.height;
      // Original texture (and therefore our composite) uses flipY=false,
      // i.e. UV v=0 is already the top row - no vertical flip here, unlike
      // HairCanvas's flipY=true canvas.
      const [cu, cv] = clampToFaceRegion(surface.name, uv.x, uv.y);
      const x = cu * w;
      const y = cv * h;

      const isEraser = toolRef.current === "eraser";
      ctx.globalCompositeOperation = isEraser
        ? "destination-out"
        : "source-over";
      ctx.strokeStyle = isEraser ? "rgba(0,0,0,1)" : colorRef.current;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = brushSizeRef.current;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const jumped =
        !!prevUV &&
        (Math.abs(uv.x - prevUV.x) > UV_JUMP_THRESHOLD ||
          Math.abs(uv.y - prevUV.y) > UV_JUMP_THRESHOLD);

      const [pcu, pcv] = prevUV
        ? clampToFaceRegion(surface.name, prevUV.x, prevUV.y)
        : [0, 0];

      const drawPass = (px: number, py: number, cx: number, cy: number) => {
        ctx.beginPath();
        if (prevUV && !jumped) {
          ctx.moveTo(px, py);
          ctx.lineTo(cx, cy);
        } else {
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + 0.01, cy + 0.01);
        }
        ctx.stroke();
      };

      drawPass(pcu * w, pcv * h, x, y);

      if (mirror) {
        const mx = (1 - cu) * w;
        const pmx = (1 - pcu) * w;
        drawPass(pmx, pcv * h, mx, y);
      }

      surface.engine.recomposite();
    }

    function handlePointerDown(e: PointerEvent) {
      if (editModeRef.current !== "face") return;
      if (e.button !== undefined && e.button !== 0) return;

      const hit = getHit(e.clientX, e.clientY);
      if (!hit) return;

      const surface = surfacesRef.current[hit.layer];
      if (!surface) return;
      const pushed = surface.engine.pushStrokeHistory();
      if (!pushed) return; // locked active layer

      dom.setPointerCapture(e.pointerId);
      isDrawing = true;
      activeSurfaceName = hit.layer;
      strokeOnSurface(surface, hit.uv, null, mirrorRef.current);
      lastUVByLayer.base = null;
      lastUVByLayer.eye = null;
      lastUVByLayer[hit.layer] = hit.uv.clone();

      e.preventDefault();
      e.stopPropagation();
    }

    function handlePointerMove(e: PointerEvent) {
      if (editModeRef.current !== "face") return;

      const hit = getHit(e.clientX, e.clientY);
      if (!isDrawing) return;
      if (!hit || hit.layer !== activeSurfaceName) {
        return;
      }

      const surface = surfacesRef.current[hit.layer];
      if (!surface) return;

      strokeOnSurface(surface, hit.uv, lastUVByLayer[hit.layer], mirrorRef.current);
      lastUVByLayer[hit.layer] = hit.uv.clone();

      e.preventDefault();
      e.stopPropagation();
    }

    function handlePointerUp(e: PointerEvent) {
      if (dom.hasPointerCapture(e.pointerId)) {
        dom.releasePointerCapture(e.pointerId);
      }
      if (isDrawing && activeSurfaceName) {
        surfacesRef.current[activeSurfaceName]?.engine.onStrokeEnd();
      }
      isDrawing = false;
      activeSurfaceName = null;
      lastUVByLayer.base = null;
      lastUVByLayer.eye = null;
    }

    dom.addEventListener("pointerdown", handlePointerDown);
    dom.addEventListener("pointermove", handlePointerMove);
    dom.addEventListener("pointerup", handlePointerUp);
    dom.addEventListener("pointercancel", handlePointerUp);
    dom.addEventListener("pointerleave", handlePointerUp);

    return () => {
      dom.removeEventListener("pointerdown", handlePointerDown);
      dom.removeEventListener("pointermove", handlePointerMove);
      dom.removeEventListener("pointerup", handlePointerUp);
      dom.removeEventListener("pointercancel", handlePointerUp);
      dom.removeEventListener("pointerleave", handlePointerUp);
    };
  }, [camera, gl, raycaster, pointerNDC]);

  return null;
}

export default forwardRef(FacePaintScene);
