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
  FaceTool,
  HistoryStatus,
  StoredPaintLayer,
  TopsDebugInfo,
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

const TOPS_NODE_NAME = "Tops";
const FALLBACK_CANVAS_SIZE = 1024;
const UV_JUMP_THRESHOLD = 0.25;

useGLTF.preload(MODEL_URL);

export interface TopsPaintSceneHandle {
  undo: (materialName: string) => void;
  redo: (materialName: string) => void;
  resetToDefault: (materialName: string) => void;
  applyPreset: (input: {
    materials: Record<string, { layers: StoredPaintLayer[]; overrideTexture?: Blob | null }>;
  }) => Promise<void>;
  exportForPreset: () => Promise<{
    materials: Record<string, { layers: StoredPaintLayer[]; overrideTexture: Blob | null }>;
  }>;
  getUVGuideBlob: (materialName: string) => Promise<Blob>;
  getCurrentTextureBlob: (materialName: string) => Promise<Blob>;
  getPaintLayerBlob: (materialName: string) => Promise<Blob>;
  getActiveLayerBlob: (materialName: string) => Promise<Blob>;
  importPaintLayer: (
    materialName: string,
    blob: Blob,
    target: "active" | "new"
  ) => Promise<void>;
  importFullTexture: (materialName: string, blob: Blob) => Promise<void>;
  getTextureSize: (materialName: string) => number | null;
  getMaterialNames: () => string[];
  createLayer: (materialName: string) => void;
  deleteLayer: (materialName: string, id: string) => void;
  duplicateLayer: (materialName: string, id: string) => void;
  renameLayer: (materialName: string, id: string, name: string) => void;
  selectLayer: (materialName: string, id: string) => void;
  setLayerVisible: (materialName: string, id: string, visible: boolean) => void;
  setLayerLocked: (materialName: string, id: string, locked: boolean) => void;
  beginOpacityChange: (materialName: string, id: string) => void;
  setLayerOpacity: (materialName: string, id: string, value: number) => void;
  moveLayerUp: (materialName: string, id: string) => void;
  moveLayerDown: (materialName: string, id: string) => void;
  reorderLayers: (materialName: string, ids: string[]) => void;
  clearHistory: (materialName: string) => void;
}

interface TopsPaintSceneProps {
  editMode: EditMode;
  tool: FaceTool;
  color: string;
  brushSize: number;
  onDebugUpdate: (patch: Partial<TopsDebugInfo>) => void;
  onHistoryChange: (materialName: string, status: HistoryStatus) => void;
  onLayersChange?: (
    materialName: string,
    layers: LayerSummary[],
    activeLayerId: string
  ) => void;
  onMaterialsDiscovered?: (materialNames: string[]) => void;
}

interface Surface {
  materialName: string;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  engine: LayerStackEngine;
}

function createSurface(
  target: MaterialTarget,
  onStructureChange: () => void,
  onHistoryChange: (status: HistoryStatus) => void
): Surface | null {
  const material = target.material as THREE.MeshStandardMaterial;
  const materialName = material.name || `material_${target.materialIndex}`;
  const originalImage = material.map?.image as
    | (CanvasImageSource & { width?: number })
    | undefined;
  if (!originalImage) {
    console.error(
      `[TopsPaintScene] material "${materialName}" has no usable map image`,
      material
    );
    return null;
  }

  const canvasSize = originalImage.width || FALLBACK_CANVAS_SIZE;
  const engine = new LayerStackEngine(canvasSize, originalImage, onStructureChange, onHistoryChange);

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

  return { materialName, mesh: target.mesh, material: clonedMaterial, engine };
}

function TopsPaintScene(
  {
    editMode,
    tool,
    color,
    brushSize,
    onDebugUpdate,
    onHistoryChange,
    onLayersChange,
    onMaterialsDiscovered,
  }: TopsPaintSceneProps,
  forwardedRef: React.ForwardedRef<TopsPaintSceneHandle>
) {
  const gltf = useGLTF(MODEL_URL);
  const { camera, gl, raycaster } = useThree();

  const surfacesRef = useRef<Record<string, Surface>>({});

  const editModeRef = useRef(editMode);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const brushSizeRef = useRef(brushSize);
  const onDebugUpdateRef = useRef(onDebugUpdate);
  const onHistoryChangeRef = useRef(onHistoryChange);
  const onLayersChangeRef = useRef(onLayersChange);
  useEffect(() => {
    editModeRef.current = editMode;
    toolRef.current = tool;
    colorRef.current = color;
    brushSizeRef.current = brushSize;
    onDebugUpdateRef.current = onDebugUpdate;
    onHistoryChangeRef.current = onHistoryChange;
    onLayersChangeRef.current = onLayersChange;
  });

  const pointerNDC = useMemo(() => new THREE.Vector2(), []);

  function getSurface(materialName: string): Surface | undefined {
    return surfacesRef.current[materialName];
  }

  useImperativeHandle(
    forwardedRef,
    () => ({
      undo: (name) => getSurface(name)?.engine.undo(),
      redo: (name) => getSurface(name)?.engine.redo(),
      resetToDefault: (name) => getSurface(name)?.engine.resetToDefault(),
      applyPreset: async (input) => {
        await Promise.all(
          Object.entries(surfacesRef.current).map(([name, surface]) => {
            const stored = input.materials[name];
            if (!stored) return Promise.resolve();
            return surface.engine.applyLayerStackFromStored(
              stored.layers,
              stored.overrideTexture ?? null
            );
          })
        );
      },
      exportForPreset: async () => {
        const materials: Record<
          string,
          { layers: StoredPaintLayer[]; overrideTexture: Blob | null }
        > = {};
        for (const [name, surface] of Object.entries(surfacesRef.current)) {
          materials[name] = await surface.engine.exportForPreset();
        }
        return { materials };
      },
      getUVGuideBlob: async (name) => {
        const surface = getSurface(name);
        const guide = generateUVGuideCanvas(
          surface?.mesh.geometry ?? new THREE.BufferGeometry(),
          surface?.engine.size ?? FALLBACK_CANVAS_SIZE,
          { flipY: false }
        );
        return canvasToPngBlob(guide);
      },
      getCurrentTextureBlob: (name) =>
        getSurface(name)?.engine.exportCompositeBlob() ??
        canvasToPngBlob(document.createElement("canvas")),
      getPaintLayerBlob: (name) =>
        getSurface(name)?.engine.exportAllLayersCompositeBlob() ??
        canvasToPngBlob(document.createElement("canvas")),
      getActiveLayerBlob: (name) =>
        getSurface(name)?.engine.exportActiveLayerBlob() ??
        canvasToPngBlob(document.createElement("canvas")),
      importPaintLayer: async (name, blob, target) => {
        const engine = getSurface(name)?.engine;
        if (!engine) return;
        if (target === "new") await engine.importPNGAsNewLayer(blob);
        else await engine.importPNGToActiveLayer(blob);
      },
      importFullTexture: async (name, blob) => {
        await getSurface(name)?.engine.importFullTextureOverride(blob);
      },
      getTextureSize: (name) => getSurface(name)?.engine.size ?? null,
      getMaterialNames: () => Object.keys(surfacesRef.current),
      createLayer: (name) => getSurface(name)?.engine.createLayer(),
      deleteLayer: (name, id) => getSurface(name)?.engine.deleteLayer(id),
      duplicateLayer: (name, id) => getSurface(name)?.engine.duplicateLayer(id),
      renameLayer: (name, id, layerName) =>
        getSurface(name)?.engine.renameLayer(id, layerName),
      selectLayer: (name, id) => getSurface(name)?.engine.selectLayer(id),
      setLayerVisible: (name, id, visible) =>
        getSurface(name)?.engine.setVisible(id, visible),
      setLayerLocked: (name, id, locked) => getSurface(name)?.engine.setLocked(id, locked),
      beginOpacityChange: (name) => getSurface(name)?.engine.beginOpacityChange(),
      setLayerOpacity: (name, id, value) => getSurface(name)?.engine.setOpacityLive(id, value),
      moveLayerUp: (name, id) => getSurface(name)?.engine.moveLayerUp(id),
      moveLayerDown: (name, id) => getSurface(name)?.engine.moveLayerDown(id),
      reorderLayers: (name, ids) => getSurface(name)?.engine.reorderLayers(ids),
      clearHistory: (name) => getSurface(name)?.engine.clearHistory(),
    }),
    []
  );

  // Discover the "Tops" node and every material it actually uses at
  // runtime - never assume the material name, count, or index in advance.
  useEffect(() => {
    const topsNode = gltf.scene.getObjectByName(TOPS_NODE_NAME);

    if (!topsNode) {
      console.error(
        `[TopsPaintScene] node named "${TOPS_NODE_NAME}" was not found in the GLB scene graph.`
      );
      onDebugUpdate({ topsFound: false, topsMeshType: null, materialNames: [] });
      return;
    }

    const targets = collectMaterialTargets(topsNode);
    console.groupCollapsed("[TopsPaintScene] Tops structure");
    console.log("Tops node:", topsNode.type, topsNode.name);
    console.log(
      "Descendant mesh/material targets:",
      targets.map((t) => ({
        mesh: t.mesh.name,
        meshType: t.mesh.type,
        isSkinnedMesh: !!(t.mesh as THREE.SkinnedMesh).isSkinnedMesh,
        materialIndex: t.materialIndex,
        materialName: t.material.name,
        hasUV: !!t.mesh.geometry.getAttribute("uv"),
      }))
    );
    console.groupEnd();

    if (targets.length === 0) {
      console.error("[TopsPaintScene] Tops node has no mesh/material to paint on.");
    }

    const surfaces: Record<string, Surface> = {};
    for (const target of targets) {
      const materialName =
        (target.material as THREE.MeshStandardMaterial).name ||
        `material_${target.materialIndex}`;
      const onStructureChange = () => {
        const surface = surfacesRef.current[materialName];
        if (!surface) return;
        onLayersChangeRef.current?.(
          materialName,
          summarizeLayers(surface.engine.layers),
          surface.engine.activeLayerId
        );
      };
      const onHistChange = (status: HistoryStatus) =>
        onHistoryChangeRef.current(materialName, status);

      const surface = createSurface(target, onStructureChange, onHistChange);
      if (surface) {
        surfaces[surface.materialName] = surface;
        console.log(
          `[TopsPaintScene] "${surface.materialName}" texture size:`,
          surface.engine.size
        );
      }
    }
    surfacesRef.current = surfaces;

    const materialNames = Object.keys(surfaces);
    onMaterialsDiscovered?.(materialNames);

    onDebugUpdate({
      topsFound: true,
      topsMeshType: topsNode.type,
      materialNames,
      activeMaterial: materialNames[0] ?? null,
      textureWidth: materialNames[0] ? surfaces[materialNames[0]].engine.size : null,
      textureHeight: materialNames[0] ? surfaces[materialNames[0]].engine.size : null,
      hasUV: targets.some((t) => !!t.mesh.geometry.getAttribute("uv")),
      paintCanvasReady: materialNames.length > 0,
    });

    for (const name of materialNames) {
      const surface = surfaces[name];
      onLayersChangeRef.current?.(
        name,
        summarizeLayers(surface.engine.layers),
        surface.engine.activeLayerId
      );
      onHistoryChangeRef.current(name, { canUndo: false, canRedo: false });
    }

    return () => {
      // Intentionally not disposing here - see MiniWaffleHairScene's note.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, onDebugUpdate]);

  // Pointer-driven painting: raycast against every Tops mesh/material we
  // discovered, route the stroke to whichever material's active layer was
  // hit. Unchanged from the pre-layers version except strokes now draw
  // into the active layer's canvas and recomposite via its engine.
  useEffect(() => {
    const dom = gl.domElement;

    let isDrawing = false;
    let activeMaterialName: string | null = null;
    let lastUV: THREE.Vector2 | null = null;

    function getHit(
      clientX: number,
      clientY: number
    ): { uv: THREE.Vector2; materialName: string } | null {
      const meshes = Object.values(surfacesRef.current).map((s) => s.mesh);
      if (meshes.length === 0) return null;

      const rect = dom.getBoundingClientRect();
      pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointerNDC, camera);
      const hits = raycaster.intersectObjects(meshes, false);
      const hit = hits[0];

      if (!hit || !hit.uv) {
        onDebugUpdateRef.current({ raycastOk: false, uv: null });
        return null;
      }

      const hitMesh = hit.object as THREE.Mesh;
      const materialName =
        Object.entries(surfacesRef.current).find(
          ([, surface]) => surface.mesh === hitMesh
        )?.[0] ?? null;

      onDebugUpdateRef.current({
        raycastOk: true,
        uv: { u: hit.uv.x, v: hit.uv.y },
        activeMaterial: materialName,
      });

      if (!materialName) return null;
      return { uv: hit.uv, materialName };
    }

    function strokeOnSurface(
      surface: Surface,
      uv: THREE.Vector2,
      prevUV: THREE.Vector2 | null
    ) {
      const layer = surface.engine.getActiveLayer();
      if (!layer) return;
      const ctx = layer.canvas.getContext("2d");
      if (!ctx) return;
      const w = layer.canvas.width;
      const h = layer.canvas.height;
      const x = uv.x * w;
      const y = uv.y * h; // flipY=false convention, same as Face.

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

      ctx.beginPath();
      if (prevUV && !jumped) {
        ctx.moveTo(prevUV.x * w, prevUV.y * h);
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.01, y + 0.01);
      }
      ctx.stroke();

      surface.engine.recomposite();
    }

    function handlePointerDown(e: PointerEvent) {
      if (editModeRef.current !== "tops") return;
      if (e.button !== undefined && e.button !== 0) return;

      const hit = getHit(e.clientX, e.clientY);
      if (!hit) return;

      const surface = surfacesRef.current[hit.materialName];
      if (!surface) return;
      const pushed = surface.engine.pushStrokeHistory();
      if (!pushed) return; // locked active layer

      dom.setPointerCapture(e.pointerId);
      isDrawing = true;
      activeMaterialName = hit.materialName;
      strokeOnSurface(surface, hit.uv, null);
      lastUV = hit.uv.clone();

      e.preventDefault();
      e.stopPropagation();
    }

    function handlePointerMove(e: PointerEvent) {
      if (editModeRef.current !== "tops") return;

      const hit = getHit(e.clientX, e.clientY);
      if (!isDrawing) return;
      if (!hit || hit.materialName !== activeMaterialName) {
        lastUV = null;
        return;
      }

      const surface = surfacesRef.current[hit.materialName];
      if (!surface) return;
      strokeOnSurface(surface, hit.uv, lastUV);
      lastUV = hit.uv.clone();

      e.preventDefault();
      e.stopPropagation();
    }

    function handlePointerUp(e: PointerEvent) {
      if (dom.hasPointerCapture(e.pointerId)) {
        dom.releasePointerCapture(e.pointerId);
      }
      if (isDrawing && activeMaterialName) {
        surfacesRef.current[activeMaterialName]?.engine.onStrokeEnd();
      }
      isDrawing = false;
      activeMaterialName = null;
      lastUV = null;
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

export default forwardRef(TopsPaintScene);
