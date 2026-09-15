"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { LayerStackEngine, summarizeLayers, type LayerSummary } from "../layerStackEngine";
import type { HistoryStatus, PaintTool, StoredPaintLayer } from "../types";
import type { CosmeticMaterialSurface } from "./cosmeticAttachment";
import { COSMETIC_FALLBACK_CANVAS_SIZE, createColorFillCanvas } from "./cosmeticColorFallback";

interface EngineEntry {
  engine: LayerStackEngine;
  surface: CosmeticMaterialSurface;
}

export interface CosmeticPaintSceneHandle {
  undo: (materialName: string) => void;
  redo: (materialName: string) => void;
  resetToDefault: (materialName: string) => void;
  exportForPreset: () => Promise<Record<string, { layers: StoredPaintLayer[] }>>;
  applyPreset: (materials: Record<string, { layers: StoredPaintLayer[] }>) => Promise<void>;
  clearHistory: () => void;
  createLayer: (materialName: string) => void;
  deleteLayer: (materialName: string, id: string) => void;
  duplicateLayer: (materialName: string, id: string) => void;
  renameLayer: (materialName: string, id: string, name: string) => void;
  selectLayer: (materialName: string, id: string) => void;
  setLayerVisible: (materialName: string, id: string, visible: boolean) => void;
  setLayerLocked: (materialName: string, id: string, locked: boolean) => void;
  beginOpacityChange: (materialName: string) => void;
  setLayerOpacity: (materialName: string, id: string, value: number) => void;
  moveLayerUp: (materialName: string, id: string) => void;
  moveLayerDown: (materialName: string, id: string) => void;
  reorderLayers: (materialName: string, ids: string[]) => void;
}

interface CosmeticPaintSceneProps {
  /** The currently-attached cosmetic's paintable surfaces (section 12) -
   * `null`/empty when nothing is equipped, in which case this renders
   * nothing and paints nothing (section 10 - "귀는 현재 장착된 액세서리가
   * 있을 때만 활성화"). Re-keyed by materialName; a NEW cosmeticId means
   * entirely new surfaces (section 12's per-cosmetic independent stacks -
   * see the owning component's per-cosmeticId engine map, not this file). */
  surfaces: CosmeticMaterialSurface[];
  active: boolean;
  activeMaterialName: string;
  tool: PaintTool;
  color: string;
  brushSize: number;
  onHistoryChange: (materialName: string, status: HistoryStatus) => void;
  onLayersChange: (materialName: string, layers: LayerSummary[], activeLayerId: string) => void;
}

/**
 * Ear/accessory paint engine (section 10/12/13/14) - reuses
 * LayerStackEngine + textureIO.canvasToPngBlob (via LayerStackEngine
 * itself) verbatim, the SAME engine Hair/Face/Tops already use, and the
 * SAME raycast -> UV -> draw-into-active-layer -> recomposite pointer
 * pipeline MiniWaffleHairScene/FacePaintScene/TopsPaintScene already
 * established - no new painting engine is written here.
 *
 * One LayerStackEngine per (cosmeticId, materialName) pair - section 12's
 * "각 cosmetic별로 독립적인 Paint Layer stack": switching to a different
 * accessory entirely discards this component's engines (its OWN parent
 * mounts a fresh instance keyed by cosmeticId - see CosmeticPanel/
 * HairPaintPrototype), while re-equipping a PREVIOUSLY painted cosmetic
 * restores its own Paint Layer data from CharacterPreset.cosmetics.
 * customizations, never from a live engine that might still be alive from
 * before (section 12's cat/rabbit/bear independence).
 *
 * Original+overlay compositing (section 4/13): each surface's
 * LayerStackEngine is constructed with either the REAL original texture
 * image (surface.originalImage) or, when the material has no texture at
 * all (confirmed true for two of the three v1 ears), a synthesized flat-
 * color canvas standing in for it (cosmeticColorFallback.ts) - either way,
 * LayerStackEngine's OWN existing recomposite()/flipY=false/SRGBColorSpace
 * defaults do the rest, unmodified.
 */
function CosmeticPaintScene(
  { surfaces, active, activeMaterialName, tool, color, brushSize, onHistoryChange, onLayersChange }: CosmeticPaintSceneProps,
  forwardedRef: React.ForwardedRef<CosmeticPaintSceneHandle>
) {
  const { camera, gl, raycaster } = useThree();
  const enginesRef = useRef<Map<string, EngineEntry>>(new Map());
  const pointerNDC = useMemo(() => new THREE.Vector2(), []);

  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const brushSizeRef = useRef(brushSize);
  const activeMaterialRef = useRef(activeMaterialName);
  const activeRef = useRef(active);
  useEffect(() => {
    toolRef.current = tool;
    colorRef.current = color;
    brushSizeRef.current = brushSize;
    activeMaterialRef.current = activeMaterialName;
    activeRef.current = active;
  });

  // Builds/refreshes one LayerStackEngine per surface whenever the
  // attached cosmetic's surface list changes (a new accessory equipped,
  // or the same one just finished loading) - wires
  // `material.map = engine.compositeTexture`, exactly mirroring how
  // TopsPaintScene wires its own per-material composite texture.
  useEffect(() => {
    const engines = enginesRef.current;
    const liveNames = new Set(surfaces.map((s) => s.materialName));

    // Drop engines for materials that no longer exist (cosmetic swapped/
    // removed) - dispose their CanvasTexture only, never anything shared.
    for (const [name, entry] of engines) {
      if (!liveNames.has(name)) {
        entry.engine.dispose();
        engines.delete(name);
      }
    }

    for (const surface of surfaces) {
      if (engines.has(surface.materialName)) {
        // Surface object may be a new instance (re-attach) even for the
        // same materialName - re-point the material reference but keep
        // the existing engine/paint data.
        const entry = engines.get(surface.materialName)!;
        entry.surface = surface;
        surface.material.map = entry.engine.compositeTexture;
        surface.material.needsUpdate = true;
        continue;
      }

      const size =
        (surface.originalImage as { width?: number } | null)?.width || COSMETIC_FALLBACK_CANVAS_SIZE;
      const originalImage: CanvasImageSource = surface.originalImage
        ? (surface.originalImage as CanvasImageSource)
        : createColorFillCanvas(surface.originalColor, size);

      const engine = new LayerStackEngine(
        size,
        originalImage,
        () => {
          const e = engines.get(surface.materialName);
          if (e) onLayersChange(surface.materialName, summarizeLayers(e.engine.layers), e.engine.activeLayerId);
        },
        (status) => onHistoryChange(surface.materialName, status)
      );
      surface.material.map = engine.compositeTexture;
      surface.material.needsUpdate = true;
      engines.set(surface.materialName, { engine, surface });
      onLayersChange(surface.materialName, summarizeLayers(engine.layers), engine.activeLayerId);
      onHistoryChange(surface.materialName, { canUndo: false, canRedo: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaces]);

  useEffect(() => {
    return () => {
      for (const entry of enginesRef.current.values()) entry.engine.dispose();
      enginesRef.current.clear();
    };
  }, []);

  // Pointer paint (section 10/11/14) - identical raycast -> UV -> draw
  // pipeline to MiniWaffleHairScene's own, targeted at whichever mesh
  // belongs to the currently-active material tab (mirrors TopsPaintScene's
  // per-material-tab painting convention). No-ops entirely unless BOTH
  // `active` (cosmetic Paint sub-mode, not Transform - section 11) and a
  // cosmetic is actually equipped.
  useEffect(() => {
    const dom = gl.domElement;
    let isDrawing = false;
    let lastUV: THREE.Vector2 | null = null;

    function activeEntry(): EngineEntry | null {
      return enginesRef.current.get(activeMaterialRef.current) ?? null;
    }

    function getUVAt(clientX: number, clientY: number): THREE.Vector2 | null {
      const entry = activeEntry();
      if (!entry) return null;
      const rect = dom.getBoundingClientRect();
      pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, camera);
      const hits = raycaster.intersectObject(entry.surface.mesh, false);
      if (hits.length === 0 || !hits[0].uv) return null;
      return hits[0].uv;
    }

    function paintAt(uv: THREE.Vector2, prevUV: THREE.Vector2 | null) {
      const entry = activeEntry();
      if (!entry) return;
      const layer = entry.engine.getActiveLayer();
      if (!layer) return;
      const ctx = layer.canvas.getContext("2d");
      if (!ctx) return;

      const w = layer.canvas.width;
      const h = layer.canvas.height;
      const x = uv.x * w;
      const y = (1 - uv.y) * h;

      const isEraser = toolRef.current === "eraser";
      ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
      ctx.strokeStyle = isEraser ? "rgba(0,0,0,1)" : colorRef.current;
      ctx.fillStyle = isEraser ? "rgba(0,0,0,1)" : colorRef.current;
      ctx.lineWidth = brushSizeRef.current;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      if (prevUV) {
        ctx.moveTo(prevUV.x * w, (1 - prevUV.y) * h);
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.01, y + 0.01);
      }
      ctx.stroke();

      entry.engine.recomposite();
    }

    function handlePointerDown(e: PointerEvent) {
      if (!activeRef.current) return;
      if (e.button !== undefined && e.button !== 0) return;
      const uv = getUVAt(e.clientX, e.clientY);
      if (!uv) return;
      const entry = activeEntry();
      if (!entry) return;
      const pushed = entry.engine.pushStrokeHistory();
      if (!pushed) return;
      dom.setPointerCapture(e.pointerId);
      isDrawing = true;
      paintAt(uv, null);
      lastUV = uv.clone();
      e.preventDefault();
      e.stopPropagation();
    }

    function handlePointerMove(e: PointerEvent) {
      if (!activeRef.current || !isDrawing) return;
      const uv = getUVAt(e.clientX, e.clientY);
      if (!uv) {
        lastUV = null;
        return;
      }
      paintAt(uv, lastUV);
      lastUV = uv.clone();
      e.preventDefault();
      e.stopPropagation();
    }

    function handlePointerUp(e: PointerEvent) {
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
      if (isDrawing) activeEntry()?.engine.onStrokeEnd();
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
  }, [camera, gl, raycaster, pointerNDC]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      undo: (materialName) => void enginesRef.current.get(materialName)?.engine.undo(),
      redo: (materialName) => void enginesRef.current.get(materialName)?.engine.redo(),
      resetToDefault: (materialName) => enginesRef.current.get(materialName)?.engine.resetToDefault(),
      async exportForPreset() {
        const out: Record<string, { layers: StoredPaintLayer[] }> = {};
        for (const [name, entry] of enginesRef.current) {
          const { layers } = await entry.engine.exportForPreset();
          out[name] = { layers };
        }
        return out;
      },
      async applyPreset(materials) {
        for (const [name, entry] of enginesRef.current) {
          const stored = materials[name];
          await entry.engine.applyLayerStackFromStored(stored?.layers ?? []);
        }
      },
      clearHistory: () => {
        for (const entry of enginesRef.current.values()) entry.engine.clearHistory();
      },
      createLayer: (materialName) => enginesRef.current.get(materialName)?.engine.createLayer(),
      deleteLayer: (materialName, id) => enginesRef.current.get(materialName)?.engine.deleteLayer(id),
      duplicateLayer: (materialName, id) => enginesRef.current.get(materialName)?.engine.duplicateLayer(id),
      renameLayer: (materialName, id, name) => enginesRef.current.get(materialName)?.engine.renameLayer(id, name),
      selectLayer: (materialName, id) => enginesRef.current.get(materialName)?.engine.selectLayer(id),
      setLayerVisible: (materialName, id, visible) =>
        enginesRef.current.get(materialName)?.engine.setVisible(id, visible),
      setLayerLocked: (materialName, id, locked) =>
        enginesRef.current.get(materialName)?.engine.setLocked(id, locked),
      beginOpacityChange: (materialName) => {
        const entry = enginesRef.current.get(materialName);
        if (entry) entry.engine.beginOpacityChange();
      },
      setLayerOpacity: (materialName, id, value) =>
        enginesRef.current.get(materialName)?.engine.setOpacityLive(id, value),
      moveLayerUp: (materialName, id) => enginesRef.current.get(materialName)?.engine.moveLayerUp(id),
      moveLayerDown: (materialName, id) => enginesRef.current.get(materialName)?.engine.moveLayerDown(id),
      reorderLayers: (materialName, ids) => enginesRef.current.get(materialName)?.engine.reorderLayers(ids),
    }),
    []
  );

  return null;
}

export default forwardRef(CosmeticPaintScene);
