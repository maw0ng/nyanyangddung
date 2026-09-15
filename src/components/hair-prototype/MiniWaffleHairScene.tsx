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
import type { DebugInfo, HistoryStatus, Mode, StoredPaintLayer, Tool } from "./types";
import { generateUVGuideCanvas, canvasToPngBlob } from "./textureIO";
import {
  LayerStackEngine,
  MAX_LAYERS,
  summarizeLayers,
  type LayerSummary,
} from "./layerStackEngine";
import { MODEL_URL } from "./modelConfig";

const HAIR_CANVAS_NODE_NAME = "HairCanvas";
const CANVAS_SIZE = 1024;

useGLTF.preload(MODEL_URL);

export interface MiniWaffleHairSceneHandle {
  /** @deprecated use resetToDefault - kept, existing call sites use this name. */
  clearAll: () => void;
  resetToDefault: () => void;
  undo: () => void;
  redo: () => void;
  getCurrentTextureBlob: () => Promise<Blob>;
  getPaintLayerBlob: () => Promise<Blob>;
  getActiveLayerBlob: () => Promise<Blob>;
  getUVGuideBlob: () => Promise<Blob>;
  importPaintLayer: (blob: Blob, target: "active" | "new") => Promise<void>;
  exportForPreset: () => Promise<{ layers: StoredPaintLayer[] }>;
  applyPresetLayers: (layers: StoredPaintLayer[]) => Promise<void>;
  createLayer: () => void;
  deleteLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  selectLayer: (id: string) => void;
  setLayerVisible: (id: string, visible: boolean) => void;
  setLayerLocked: (id: string, locked: boolean) => void;
  beginOpacityChange: (id: string) => void;
  setLayerOpacity: (id: string, value: number) => void;
  moveLayerUp: (id: string) => void;
  moveLayerDown: (id: string) => void;
  reorderLayers: (ids: string[]) => void;
  clearHistory: () => void;
}

interface MiniWaffleHairSceneProps {
  mode: Mode;
  tool: Tool;
  color: string;
  brushSize: number;
  onDebugUpdate: (patch: Partial<DebugInfo>) => void;
  onHistoryChange?: (status: HistoryStatus) => void;
  onLayersChange?: (layers: LayerSummary[], activeLayerId: string) => void;
}

function MiniWaffleHairScene(
  {
    mode,
    tool,
    color,
    brushSize,
    onDebugUpdate,
    onHistoryChange,
    onLayersChange,
  }: MiniWaffleHairSceneProps,
  forwardedRef: React.ForwardedRef<MiniWaffleHairSceneHandle>
) {
  const gltf = useGLTF(MODEL_URL);
  const { camera, gl, raycaster } = useThree();

  const hairMeshRef = useRef<THREE.SkinnedMesh | THREE.Mesh | null>(null);
  const engineRef = useRef<LayerStackEngine | null>(null);

  // Latest-value refs so imperative DOM listeners / the engine's stable
  // callback wrappers never see stale props.
  const modeRef = useRef(mode);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const brushSizeRef = useRef(brushSize);
  const onHistoryChangeRef = useRef(onHistoryChange);
  const onLayersChangeRef = useRef(onLayersChange);
  useEffect(() => {
    modeRef.current = mode;
    toolRef.current = tool;
    colorRef.current = color;
    brushSizeRef.current = brushSize;
    onHistoryChangeRef.current = onHistoryChange;
    onLayersChangeRef.current = onLayersChange;
  });

  // Lazily create the persistent layer-stack engine exactly once. This
  // must survive React StrictMode's mount/unmount/mount dev cycle so
  // drawings are never reset by a re-render or a mode switch - same
  // guarantee the old single-canvas ref used to provide.
  if (!engineRef.current) {
    engineRef.current = new LayerStackEngine(
      CANVAS_SIZE,
      null, // HairCanvas has no original GLB texture - transparent background
      () => {
        const engine = engineRef.current!;
        onLayersChangeRef.current?.(summarizeLayers(engine.layers), engine.activeLayerId);
      },
      (status) => onHistoryChangeRef.current?.(status)
    );
  }

  const pointerNDC = useMemo(() => new THREE.Vector2(), []);

  useImperativeHandle(
    forwardedRef,
    () => ({
      clearAll: () => engineRef.current!.resetToDefault(),
      resetToDefault: () => engineRef.current!.resetToDefault(),
      undo: () => engineRef.current!.undo(),
      redo: () => engineRef.current!.redo(),
      getCurrentTextureBlob: () => engineRef.current!.exportCompositeBlob(),
      getPaintLayerBlob: () => engineRef.current!.exportAllLayersCompositeBlob(),
      getActiveLayerBlob: () => engineRef.current!.exportActiveLayerBlob(),
      getUVGuideBlob: async () => {
        const mesh = hairMeshRef.current;
        const guide = generateUVGuideCanvas(
          mesh?.geometry ?? new THREE.BufferGeometry(),
          CANVAS_SIZE,
          { flipY: true }
        );
        return canvasToPngBlob(guide);
      },
      importPaintLayer: async (blob, target) => {
        const engine = engineRef.current!;
        if (target === "new") await engine.importPNGAsNewLayer(blob);
        else await engine.importPNGToActiveLayer(blob);
      },
      exportForPreset: async () => {
        const { layers } = await engineRef.current!.exportForPreset();
        return { layers };
      },
      applyPresetLayers: (layers) => engineRef.current!.applyLayerStackFromStored(layers),
      createLayer: () => engineRef.current!.createLayer(),
      deleteLayer: (id) => engineRef.current!.deleteLayer(id),
      duplicateLayer: (id) => engineRef.current!.duplicateLayer(id),
      renameLayer: (id, name) => engineRef.current!.renameLayer(id, name),
      selectLayer: (id) => engineRef.current!.selectLayer(id),
      setLayerVisible: (id, visible) => engineRef.current!.setVisible(id, visible),
      setLayerLocked: (id, locked) => engineRef.current!.setLocked(id, locked),
      beginOpacityChange: (id) => engineRef.current!.beginOpacityChange(),
      setLayerOpacity: (id, value) => engineRef.current!.setOpacityLive(id, value),
      moveLayerUp: (id) => engineRef.current!.moveLayerUp(id),
      moveLayerDown: (id) => engineRef.current!.moveLayerDown(id),
      reorderLayers: (ids) => engineRef.current!.reorderLayers(ids),
      clearHistory: () => engineRef.current!.clearHistory(),
    }),
    []
  );

  // Wire the HairCanvas mesh material to our persistent layer-stack engine.
  useEffect(() => {
    const hairNode = gltf.scene.getObjectByName(HAIR_CANVAS_NODE_NAME) as
      | THREE.SkinnedMesh
      | THREE.Mesh
      | undefined;

    if (!hairNode || !(hairNode as THREE.Mesh).isMesh) {
      onDebugUpdate({
        hairCanvasFound: false,
        hairCanvasType: null,
        isSkinnedMesh: false,
        hasUV: false,
      });
      hairMeshRef.current = null;
      return;
    }

    const mesh = hairNode as THREE.SkinnedMesh;
    hairMeshRef.current = mesh;

    const geometry = mesh.geometry as THREE.BufferGeometry;
    const hasUV = !!geometry.getAttribute("uv");

    const engine = engineRef.current!;
    const texture = engine.compositeTexture;
    // Hair's composite is always transparent-background + layers, which is
    // the opposite orientation convention from Face/Tops (which mirror the
    // glTF flipY=false original texture). Keep hair's proven flipY=true +
    // (1-v) mapping exactly as before - untouched.
    texture.flipY = true;
    texture.needsUpdate = true;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials as THREE.MeshStandardMaterial[]) {
      material.map = texture;
      material.transparent = true;
      material.alphaTest = 0.02;
      material.depthWrite = false;
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
    }

    onDebugUpdate({
      hairCanvasFound: true,
      hairCanvasType: mesh.type,
      isSkinnedMesh: !!(mesh as THREE.SkinnedMesh).isSkinnedMesh,
      hasUV,
    });

    onLayersChangeRef.current?.(summarizeLayers(engine.layers), engine.activeLayerId);
    onHistoryChangeRef.current?.({ canUndo: false, canRedo: false });

    return () => {
      // Don't dispose the engine here - StrictMode's dev double-invoke
      // would tear down the only texture/layers we have. The engine is
      // intentionally as long-lived as the component instance itself.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, onDebugUpdate]);

  // Pointer-driven painting: raycast against the real HairCanvas mesh and
  // paint using the UV hit, never the raw screen coordinates. Unchanged
  // from the pre-layers version except it now draws into the *active
  // layer's* canvas and recomposites afterwards, instead of a single
  // shared paint canvas.
  useEffect(() => {
    const dom = gl.domElement;

    let isDrawing = false;
    let lastUV: THREE.Vector2 | null = null;

    function getUVAt(clientX: number, clientY: number): THREE.Vector2 | null {
      const mesh = hairMeshRef.current;
      if (!mesh) return null;

      const rect = dom.getBoundingClientRect();
      pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointerNDC, camera);
      const hits = raycaster.intersectObject(mesh, false);

      if (hits.length === 0 || !hits[0].uv) {
        onDebugUpdate({ raycastOk: false });
        return null;
      }

      const uv = hits[0].uv;
      onDebugUpdate({ raycastOk: true, uv: { u: uv.x, v: uv.y } });
      return uv;
    }

    function paintAt(uv: THREE.Vector2, prevUV: THREE.Vector2 | null) {
      const engine = engineRef.current!;
      const layer = engine.getActiveLayer();
      if (!layer) return;
      const ctx = layer.canvas.getContext("2d");
      if (!ctx) return;

      const w = layer.canvas.width;
      const h = layer.canvas.height;
      const x = uv.x * w;
      const y = (1 - uv.y) * h;

      const isEraser = toolRef.current === "eraser";
      ctx.globalCompositeOperation = isEraser
        ? "destination-out"
        : "source-over";
      ctx.strokeStyle = isEraser ? "rgba(0,0,0,1)" : colorRef.current;
      ctx.fillStyle = isEraser ? "rgba(0,0,0,1)" : colorRef.current;
      ctx.lineWidth = brushSizeRef.current;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // UV seam guard: HairCanvas wraps a sphere, so U jumps from ~1 back
      // to ~0 at the seam. A large delta means "moved across the seam",
      // not "dragged across the whole texture" - break the stroke instead
      // of drawing a line straight across the canvas.
      const seamCrossed = !!prevUV && Math.abs(uv.x - prevUV.x) > 0.5;

      ctx.beginPath();
      if (prevUV && !seamCrossed) {
        ctx.moveTo(prevUV.x * w, (1 - prevUV.y) * h);
        ctx.lineTo(x, y);
      } else {
        // Fresh stroke start (or seam break): draw a dot via a near-zero
        // segment so a single click still leaves a visible mark.
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.01, y + 0.01);
      }
      ctx.stroke();

      engine.recomposite();
    }

    function handlePointerDown(e: PointerEvent) {
      if (modeRef.current !== "draw") return;
      if (e.button !== undefined && e.button !== 0) return;

      const uv = getUVAt(e.clientX, e.clientY);
      if (!uv) return;

      const pushed = engineRef.current!.pushStrokeHistory();
      if (!pushed) return; // active layer is locked - do nothing, LayerPanel shows the "locked" hint

      dom.setPointerCapture(e.pointerId);
      isDrawing = true;
      paintAt(uv, null);
      lastUV = uv.clone();
      e.preventDefault();
      e.stopPropagation();
    }

    function handlePointerMove(e: PointerEvent) {
      if (modeRef.current !== "draw") return;

      const uv = getUVAt(e.clientX, e.clientY);
      if (!isDrawing) return;

      if (!uv) {
        // Pointer briefly left the mesh surface mid-drag; don't connect
        // the next hit back to a now-irrelevant point.
        lastUV = null;
        return;
      }

      paintAt(uv, lastUV);
      lastUV = uv.clone();
      e.preventDefault();
      e.stopPropagation();
    }

    function handlePointerUp(e: PointerEvent) {
      if (dom.hasPointerCapture(e.pointerId)) {
        dom.releasePointerCapture(e.pointerId);
      }
      if (isDrawing) engineRef.current!.onStrokeEnd();
      isDrawing = false;
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
  }, [camera, gl, raycaster, pointerNDC, onDebugUpdate]);

  return <primitive object={gltf.scene} />;
}

export default forwardRef(MiniWaffleHairScene);
export { MAX_LAYERS };
export type { LayerSummary };
