import { canvasToPngBlob } from "./textureIO";
import { MORPH_CATEGORIES, BODY_SHAPE_MORPH_NAMES } from "./morphConfig";
import type { CharacterSurfaceLayers, StoredPaintLayer } from "./types";

/**
 * Builds the Network Appearance Snapshot's transparent paint-only overlay
 * for one surface (Hair/Face-base/Face-eye/one Tops material) from ALREADY-
 * SAVED CharacterPreset data (section 1/23) - deliberately NOT from a live
 * LayerStackEngine instance, since this must work even when no Editor
 * session is open (publish can fire right after joining a Room with an
 * already-saved active character - section 16/72).
 *
 * Mirrors LayerStackEngine.exportAllLayersCompositeBlob()'s own drawing
 * algorithm byte-for-byte (visible layers only, bottom->top by `order`, at
 * each layer's own opacity, alpha reset before/after - section 45's "별도
 * 방식으로 다시 구현해서 색/alpha가 달라지면 안 된다"), plus the override
 * texture (if any) drawn first/underneath, matching
 * LayerStackEngine.recomposite()'s own `base -> layers` order - so a
 * character that used the "전체 텍스처 업로드" override feature still
 * matches on Remote instead of silently missing it.
 *
 * Canvas size is read from the FIRST available source image's own actual
 * pixel dimensions (never hardcoded - section 9), exactly like
 * TopsPaintScene's own `originalImage.width || FALLBACK_CANVAS_SIZE`
 * sizing (see TopsPaintScene.tsx) - a saved layer Blob already carries
 * whatever dimension it was captured at, so reading it back is
 * automatically correct with zero coupling to any particular scene's own
 * constants.
 *
 * Returns `null` when the result would be fully transparent (section 30/
 * 82 - "빈 Overlay 최적화") - the caller must then publish this surface's
 * manifest path as `null`, never upload an empty PNG.
 */
export async function buildAppearanceOverlay(
  surface: CharacterSurfaceLayers | null | undefined
): Promise<Blob | null> {
  if (!surface) return null;
  const visibleLayers = surface.layers.filter((l) => l.visible);
  if (visibleLayers.length === 0 && !surface.overrideTexture) return null;

  const firstBlob = surface.overrideTexture ?? visibleLayers[0]?.image;
  if (!firstBlob) return null;

  const sizingBitmap = await createImageBitmap(firstBlob);
  const size = sizingBitmap.width || sizingBitmap.height;
  sizingBitmap.close?.();
  if (!size) return null;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  if (surface.overrideTexture) {
    const bitmap = await createImageBitmap(surface.overrideTexture);
    ctx.drawImage(bitmap, 0, 0, size, size);
    bitmap.close?.();
  }

  const ordered = [...visibleLayers].sort((a, b) => a.order - b.order);
  for (const layer of ordered) {
    const bitmap = await createImageBitmap(layer.image);
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(bitmap, 0, 0, size, size);
    bitmap.close?.();
  }
  ctx.globalAlpha = 1;

  if (isCanvasFullyTransparent(ctx, size, size)) return null;
  return canvasToPngBlob(canvas);
}

function isCanvasFullyTransparent(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}

/** Flattens a Hair layer stack the same way (section 5) - Hair has no
 * original/override texture at all (LayerStackEngine is constructed with
 * `null` original for it - see MiniWaffleHairScene.tsx), so this is just
 * the layers-only path of buildAppearanceOverlay above, exposed under its
 * own name for call-site clarity. */
export function buildHairOverlay(layers: StoredPaintLayer[]): Promise<Blob | null> {
  return buildAppearanceOverlay({ layers, overrideTexture: null });
}

/**
 * Network customization morph filter (section 11/12/13) - reuses the SAME
 * category match predicates the Avatar Editor's own Morph panel already
 * uses (morphConfig.ts's MORPH_CATEGORIES: custom-eye-1..4, eye-prefixed,
 * ppl-prefixed, brw-prefixed, mouth-prefixed) PLUS the one genuine body-
 * shape Shape Key (BODY_SHAPE_MORPH_NAMES - "shrink", confirmed to live on
 * a separate mesh, "Body-base" - see FacePaintScene.tsx's
 * BODY_SHAPE_NODE_NAME doc comment), so nothing here re-derives or
 * hardcodes the customization name list. Anything NOT matching one of
 * those (blink, vrc.v_-prefixed, set--prefixed, tear/tear_left/tear_right,
 * sweat-1/2/3, cheek, ear-human, ...) is a transient/internal/expression
 * Shape Key and is silently excluded, never published - bug fix
 * ("Body Morph가 Remote에 동기화되지 않음"): "shrink" used to fall into
 * this excluded bucket too, even though it's the app's only actual body-
 * shape customization, simply because nothing distinguished it from the
 * truly-internal ones. Values are clamped to 0..1 (section 13).
 */
export function filterCustomizationMorphs(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(values)) {
    const allowed = MORPH_CATEGORIES.some((c) => c.match(name)) || BODY_SHAPE_MORPH_NAMES.includes(name);
    if (!allowed) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    out[name] = Math.max(0, Math.min(1, value));
  }
  return out;
}
