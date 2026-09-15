import * as THREE from "three";
import { canvasToPngBlob } from "./textureIO";
import type { HistoryStatus, StoredPaintLayer } from "./types";

/**
 * Shared multi-layer paint-surface engine used by Hair, Face (base/eye),
 * and Tops (per material). This is the thing that changed - the existing
 * Raycast -> UV -> Drawing pipeline in each scene component is completely
 * untouched; it now just draws into `engine.getActiveLayer().canvas`
 * instead of a single shared canvas, and calls `engine.recomposite()`
 * (renamed from each file's old local `recomposite()`) afterwards.
 */

export const MAX_LAYERS = 20;
const MAX_HISTORY = 30;

export interface PaintLayer {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  visible: boolean;
  opacity: number;
  locked: boolean;
  blendMode?: "normal";
  createdAt: number;
  thumbnail: string | null;
}

/** Lightweight, React-state-friendly view of a layer (no canvas ref). */
export interface LayerSummary {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  thumbnail: string | null;
}

export function summarizeLayers(layers: PaintLayer[]): LayerSummary[] {
  return layers.map((l) => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    locked: l.locked,
    thumbnail: l.thumbnail,
  }));
}

interface StackSnapshotLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  dataURL: string;
}

interface StackSnapshot {
  layers: StackSnapshotLayer[]; // bottom -> top
  activeLayerId: string;
  overrideDataURL: string | null;
}

type HistoryEntry =
  | { kind: "pixels"; layerId: string; dataURL: string }
  | { kind: "stack"; snapshot: StackSnapshot };

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `layer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function imageFromDataURL(dataURL: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to decode dataURL"));
    img.src = dataURL;
  });
}

const THUMBNAIL_SIZE = 48;

export class LayerStackEngine {
  readonly size: number;
  layers: PaintLayer[] = []; // bottom -> top
  activeLayerId = "";

  /** Full-texture upload override (Face/Tops only) - sits below all layers,
   * above the original texture. Kept from the previous turn's design. */
  overrideImage: CanvasImageSource | null = null;

  readonly compositeCanvas: HTMLCanvasElement;
  private readonly compositeCtx: CanvasRenderingContext2D;
  readonly compositeTexture: THREE.CanvasTexture;

  private layerCounter = 0;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(
    size: number,
    private readonly originalImage: CanvasImageSource | null,
    private readonly onStructureChange: () => void,
    private readonly onHistoryChange: (status: HistoryStatus) => void
  ) {
    this.size = size;
    this.compositeCanvas = document.createElement("canvas");
    this.compositeCanvas.width = size;
    this.compositeCanvas.height = size;
    this.compositeCtx = this.compositeCanvas.getContext("2d")!;
    this.compositeTexture = new THREE.CanvasTexture(this.compositeCanvas);
    this.compositeTexture.flipY = false;
    this.compositeTexture.colorSpace = THREE.SRGBColorSpace;

    this.createLayer(undefined, { silent: true });
    this.recomposite();
  }

  // ---- construction helpers ------------------------------------------
  private makeCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.size;
    c.height = this.size;
    return c;
  }

  private nextLayerName(): string {
    this.layerCounter += 1;
    return `레이어 ${this.layerCounter}`;
  }

  // ---- composite -------------------------------------------------------
  recomposite() {
    const ctx = this.compositeCtx;
    const w = this.compositeCanvas.width;
    const h = this.compositeCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const base = this.overrideImage ?? this.originalImage;
    if (base) {
      ctx.drawImage(base, 0, 0, w, h);
    }

    for (const layer of this.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;

    this.compositeTexture.needsUpdate = true;
  }

  private updateThumbnail(layer: PaintLayer) {
    const t = document.createElement("canvas");
    t.width = THUMBNAIL_SIZE;
    t.height = THUMBNAIL_SIZE;
    const tctx = t.getContext("2d");
    if (!tctx) return;
    tctx.clearRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    tctx.drawImage(layer.canvas, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    layer.thumbnail = t.toDataURL("image/png");
  }

  // ---- history -----------------------------------------------------------
  private notifyHistory() {
    this.onHistoryChange({
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  /** Synchronous - drawImage+toDataURL of an already-decoded image source
   * never needs to await anything, so every stack snapshot can cheaply and
   * unconditionally include the override state without special-casing
   * which callers "care about" override (that was a source of bugs). */
  private captureOverrideDataURL(): string {
    if (!this.overrideImage) return "";
    const c = this.makeCanvas();
    c.getContext("2d")!.drawImage(this.overrideImage, 0, 0, this.size, this.size);
    return c.toDataURL("image/png");
  }

  private snapshotStack(): StackSnapshot {
    return {
      layers: this.layers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        locked: l.locked,
        dataURL: l.canvas.toDataURL("image/png"),
      })),
      activeLayerId: this.activeLayerId,
      overrideDataURL: this.captureOverrideDataURL(),
    };
  }

  /** Push a full-stack snapshot as the "before" state of a structural
   * change (create/delete/duplicate/rename/reorder/visibility/lock/
   * opacity-commit/reset/import/preset-apply). */
  private pushStackHistory() {
    this.undoStack.push({ kind: "stack", snapshot: this.snapshotStack() });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.notifyHistory();
  }

  /** Push a single-layer pixel snapshot as the "before" state of a stroke.
   * Cheap: only the active layer's canvas is serialized, not the whole
   * stack - this is the high-frequency path (one push per completed
   * stroke), so it deliberately avoids the full-stack cost. */
  pushStrokeHistory(): boolean {
    const layer = this.getActiveLayer();
    if (!layer) return false;
    if (layer.locked) return false;
    this.undoStack.push({
      kind: "pixels",
      layerId: layer.id,
      dataURL: layer.canvas.toDataURL("image/png"),
    });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.notifyHistory();
    return true;
  }

  private async restoreStack(snap: StackSnapshot) {
    const newLayers: PaintLayer[] = [];
    for (const sl of snap.layers) {
      const canvas = this.makeCanvas();
      if (sl.dataURL) {
        try {
          const img = await imageFromDataURL(sl.dataURL);
          canvas.getContext("2d")!.drawImage(img, 0, 0);
        } catch {
          // leave blank on decode failure
        }
      }
      const layer: PaintLayer = {
        id: sl.id,
        name: sl.name,
        canvas,
        visible: sl.visible,
        opacity: sl.opacity,
        locked: sl.locked,
        createdAt: Date.now(),
        thumbnail: null,
      };
      this.updateThumbnail(layer);
      newLayers.push(layer);
    }
    this.layers = newLayers;
    this.activeLayerId =
      snap.activeLayerId && newLayers.some((l) => l.id === snap.activeLayerId)
        ? snap.activeLayerId
        : (newLayers[newLayers.length - 1]?.id ?? "");
    this.overrideImage = snap.overrideDataURL
      ? await imageFromDataURL(snap.overrideDataURL)
      : null;
    this.ensureAtLeastOneLayer();
    this.recomposite();
    this.onStructureChange();
  }

  private restorePixels(layerId: string, dataURL: string) {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const ctx = layer.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    if (!dataURL) {
      this.updateThumbnail(layer);
      this.recomposite();
      return;
    }
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      this.updateThumbnail(layer);
      this.recomposite();
    };
    img.src = dataURL;
  }

  async undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (entry.kind === "pixels") {
      const layer = this.layers.find((l) => l.id === entry.layerId);
      this.redoStack.push({
        kind: "pixels",
        layerId: entry.layerId,
        dataURL: layer ? layer.canvas.toDataURL("image/png") : "",
      });
      if (this.redoStack.length > MAX_HISTORY) this.redoStack.shift();
      this.restorePixels(entry.layerId, entry.dataURL);
    } else {
      this.redoStack.push({ kind: "stack", snapshot: this.snapshotStack() });
      if (this.redoStack.length > MAX_HISTORY) this.redoStack.shift();
      await this.restoreStack(entry.snapshot);
    }
    this.notifyHistory();
  }

  async redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    if (entry.kind === "pixels") {
      const layer = this.layers.find((l) => l.id === entry.layerId);
      this.undoStack.push({
        kind: "pixels",
        layerId: entry.layerId,
        dataURL: layer ? layer.canvas.toDataURL("image/png") : "",
      });
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.restorePixels(entry.layerId, entry.dataURL);
    } else {
      this.undoStack.push({ kind: "stack", snapshot: this.snapshotStack() });
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      await this.restoreStack(entry.snapshot);
    }
    this.notifyHistory();
  }

  /** Wipe undo/redo history without touching current layer content. Used
   * when switching the active Character - the new character's canvases
   * must never be reachable via an Undo that reaches back into whatever
   * the previous character had on screen. */
  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.notifyHistory();
  }

  // ---- layer management --------------------------------------------------
  getActiveLayer(): PaintLayer | undefined {
    return this.layers.find((l) => l.id === this.activeLayerId);
  }

  private ensureAtLeastOneLayer() {
    if (this.layers.length === 0) {
      const layer: PaintLayer = {
        id: makeId(),
        name: this.nextLayerName(),
        canvas: this.makeCanvas(),
        visible: true,
        opacity: 1,
        locked: false,
        createdAt: Date.now(),
        thumbnail: null,
      };
      this.updateThumbnail(layer);
      this.layers.push(layer);
      this.activeLayerId = layer.id;
    }
  }

  createLayer(name?: string, opts: { silent?: boolean } = {}): PaintLayer | null {
    if (this.layers.length >= MAX_LAYERS) return null;
    if (!opts.silent) this.pushStackHistory();
    const layer: PaintLayer = {
      id: makeId(),
      name: name ?? this.nextLayerName(),
      canvas: this.makeCanvas(),
      visible: true,
      opacity: 1,
      locked: false,
      createdAt: Date.now(),
      thumbnail: null,
    };
    this.updateThumbnail(layer);
    this.layers.push(layer);
    this.activeLayerId = layer.id;
    if (!opts.silent) {
      this.recomposite();
      this.onStructureChange();
    }
    return layer;
  }

  deleteLayer(id: string) {
    if (!this.layers.some((l) => l.id === id)) return;
    this.pushStackHistory();
    const idx = this.layers.findIndex((l) => l.id === id);
    this.layers.splice(idx, 1);
    if (this.activeLayerId === id) {
      const fallback = this.layers[idx] ?? this.layers[idx - 1] ?? this.layers[this.layers.length - 1];
      this.activeLayerId = fallback?.id ?? "";
    }
    this.ensureAtLeastOneLayer();
    this.recomposite();
    this.onStructureChange();
  }

  duplicateLayer(id: string) {
    const source = this.layers.find((l) => l.id === id);
    if (!source) return;
    if (this.layers.length >= MAX_LAYERS) return;
    this.pushStackHistory();
    const canvas = this.makeCanvas();
    canvas.getContext("2d")!.drawImage(source.canvas, 0, 0);
    const layer: PaintLayer = {
      id: makeId(),
      name: `${source.name} 복사`,
      canvas,
      visible: source.visible,
      opacity: source.opacity,
      locked: false,
      createdAt: Date.now(),
      thumbnail: null,
    };
    this.updateThumbnail(layer);
    const sourceIdx = this.layers.findIndex((l) => l.id === id);
    this.layers.splice(sourceIdx + 1, 0, layer);
    this.activeLayerId = layer.id;
    this.recomposite();
    this.onStructureChange();
  }

  renameLayer(id: string, name: string) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer || !name.trim()) return;
    this.pushStackHistory();
    layer.name = name.trim();
    this.onStructureChange();
  }

  setVisible(id: string, visible: boolean) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer || layer.visible === visible) return;
    this.pushStackHistory();
    layer.visible = visible;
    this.recomposite();
    this.onStructureChange();
  }

  setLocked(id: string, locked: boolean) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer || layer.locked === locked) return;
    this.pushStackHistory();
    layer.locked = locked;
    this.onStructureChange();
  }

  /** Call once at the start of an opacity-slider drag (e.g. onPointerDown
   * on the <input type="range">) - pushes exactly one history entry for
   * the whole drag. Follow with any number of `setOpacityLive` calls. */
  beginOpacityChange() {
    this.pushStackHistory();
  }

  setOpacityLive(id: string, opacity: number) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    layer.opacity = Math.min(1, Math.max(0, opacity));
    this.recomposite();
    this.onStructureChange();
  }

  moveLayerUp(id: string) {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx < 0 || idx >= this.layers.length - 1) return;
    this.pushStackHistory();
    const [layer] = this.layers.splice(idx, 1);
    this.layers.splice(idx + 1, 0, layer);
    this.recomposite();
    this.onStructureChange();
  }

  moveLayerDown(id: string) {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx <= 0) return;
    this.pushStackHistory();
    const [layer] = this.layers.splice(idx, 1);
    this.layers.splice(idx - 1, 0, layer);
    this.recomposite();
    this.onStructureChange();
  }

  /** Drag & drop reorder: pass the full new bottom->top id order. */
  reorderLayers(orderedIds: string[]) {
    const byId = new Map(this.layers.map((l) => [l.id, l]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter((l): l is PaintLayer => !!l);
    if (reordered.length !== this.layers.length) return;
    this.pushStackHistory();
    this.layers = reordered;
    this.recomposite();
    this.onStructureChange();
  }

  selectLayer(id: string) {
    if (!this.layers.some((l) => l.id === id)) return;
    this.activeLayerId = id;
    this.onStructureChange();
  }

  onStrokeEnd() {
    const layer = this.getActiveLayer();
    if (layer) this.updateThumbnail(layer);
    this.onStructureChange();
  }

  // ---- reset / import / preset -------------------------------------------
  resetToDefault() {
    this.pushStackHistory();
    this.layers = [];
    this.overrideImage = null;
    this.layerCounter = 0;
    this.ensureAtLeastOneLayer();
    this.recomposite();
    this.onStructureChange();
  }

  async importPNGToActiveLayer(blob: Blob) {
    const layer = this.getActiveLayer();
    if (!layer) return;
    if (layer.locked) return;
    this.pushStackHistory();
    const bitmap = await createImageBitmap(blob);
    const ctx = layer.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.drawImage(bitmap, 0, 0, layer.canvas.width, layer.canvas.height);
    bitmap.close?.();
    this.updateThumbnail(layer);
    this.recomposite();
    this.onStructureChange();
  }

  async importPNGAsNewLayer(blob: Blob, name?: string) {
    if (this.layers.length >= MAX_LAYERS) return null;
    this.pushStackHistory();
    const bitmap = await createImageBitmap(blob);
    const canvas = this.makeCanvas();
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const layer: PaintLayer = {
      id: makeId(),
      name: name ?? this.nextLayerName(),
      canvas,
      visible: true,
      opacity: 1,
      locked: false,
      createdAt: Date.now(),
      thumbnail: null,
    };
    this.updateThumbnail(layer);
    this.layers.push(layer);
    this.activeLayerId = layer.id;
    this.recomposite();
    this.onStructureChange();
    return layer;
  }

  async importFullTextureOverride(blob: Blob) {
    this.pushStackHistory();
    const bitmap = await createImageBitmap(blob);
    const canvas = this.makeCanvas();
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    this.overrideImage = canvas;
    this.recomposite();
    this.onStructureChange();
  }

  /** Replace the whole layer stack from preset data (async image decode
   * for each stored layer). Used by FacePreset/HairPreset/ClothingPreset
   * apply. */
  async applyLayerStackFromStored(stored: StoredPaintLayer[], overrideBlob?: Blob | null) {
    this.pushStackHistory();
    const newLayers: PaintLayer[] = [];
    const ordered = [...stored].sort((a, b) => a.order - b.order);
    for (const sl of ordered) {
      const canvas = this.makeCanvas();
      try {
        const bitmap = await createImageBitmap(sl.image);
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
      } catch {
        // leave blank
      }
      const layer: PaintLayer = {
        id: sl.id || makeId(),
        name: sl.name,
        canvas,
        visible: sl.visible,
        opacity: sl.opacity,
        locked: sl.locked,
        createdAt: Date.now(),
        thumbnail: null,
      };
      this.updateThumbnail(layer);
      newLayers.push(layer);
    }
    this.layers = newLayers;
    this.layerCounter = newLayers.length;
    this.ensureAtLeastOneLayer();
    this.activeLayerId = this.layers[this.layers.length - 1].id;

    if (overrideBlob) {
      const bitmap = await createImageBitmap(overrideBlob);
      const c = this.makeCanvas();
      c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close?.();
      this.overrideImage = c;
    } else {
      this.overrideImage = null;
    }

    this.recomposite();
    this.onStructureChange();
  }

  // ---- export --------------------------------------------------------------
  async exportCompositeBlob(): Promise<Blob> {
    return canvasToPngBlob(this.compositeCanvas);
  }

  async exportActiveLayerBlob(): Promise<Blob> {
    const layer = this.getActiveLayer();
    return canvasToPngBlob(layer?.canvas ?? this.makeCanvas());
  }

  /** All visible user layers merged, original/override excluded. */
  async exportAllLayersCompositeBlob(): Promise<Blob> {
    const canvas = this.makeCanvas();
    const ctx = canvas.getContext("2d")!;
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    return canvasToPngBlob(canvas);
  }

  async exportForPreset(): Promise<{
    layers: StoredPaintLayer[];
    overrideTexture: Blob | null;
  }> {
    const layers: StoredPaintLayer[] = [];
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      layers.push({
        id: layer.id,
        name: layer.name,
        image: await canvasToPngBlob(layer.canvas),
        visible: layer.visible,
        opacity: layer.opacity,
        locked: layer.locked,
        order: i,
      });
    }
    const overrideTexture = this.overrideImage
      ? await (async () => {
          const c = this.makeCanvas();
          c.getContext("2d")!.drawImage(this.overrideImage!, 0, 0, c.width, c.height);
          return canvasToPngBlob(c);
        })()
      : null;
    return { layers, overrideTexture };
  }

  dispose() {
    this.compositeTexture.dispose();
  }
}
