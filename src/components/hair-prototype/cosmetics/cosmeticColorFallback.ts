import * as THREE from "three";

/**
 * Canvas size used ONLY when a cosmetic material has no base color texture
 * at all (section 13) - two of the three v1 ears (cat_ears, bear_ears) are
 * exactly this case, confirmed by inspecting their glTF JSON directly.
 * Smaller than the main character's 1024 (accessories are small, simple
 * surfaces), but still a named constant, never inlined.
 */
export const COSMETIC_FALLBACK_CANVAS_SIZE = 512;

/**
 * Synthesizes a flat-color canvas standing in for "the original texture"
 * (section 13's "원본 material/color를 보존하면서... base canvas 전략") -
 * fed directly into LayerStackEngine's existing `originalImage` parameter
 * (a plain `CanvasImageSource`, which an HTMLCanvasElement satisfies) so
 * the SAME recomposite/export logic Hair/Face/Tops/paintable cosmetics
 * with a real texture already use needs zero changes to support this case.
 * Never mutates the source THREE.Color.
 */
export function createColorFillCanvas(color: THREE.Color, size: number = COSMETIC_FALLBACK_CANVAS_SIZE): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = Math.round(THREE.MathUtils.clamp(color.r, 0, 1) * 255);
  const g = Math.round(THREE.MathUtils.clamp(color.g, 0, 1) * 255);
  const b = Math.round(THREE.MathUtils.clamp(color.b, 0, 1) * 255);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
