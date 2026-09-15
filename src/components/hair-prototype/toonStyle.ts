import * as THREE from "three";

/**
 * Central "Toon Style Manager" - a plain settings object plus the pure
 * helpers that derive gradient maps / light intensities from it. Nothing
 * here touches the scene graph, geometry, skinning, or Painting state; it
 * is purely a rendering-style configuration layer that ToonStyleController
 * consumes. Deliberately NOT persisted into CharacterPreset - this is an
 * app-wide rendering preference, not per-character appearance data.
 */

export interface ToonSettings {
  enabled: boolean;
  /** 0 ("2D"/almost flat) .. 1 ("3D"/more shaded contrast). */
  strength: number;
  shadeSteps: 2 | 3;
  /** 0..1 - how dark the shaded side is allowed to get. */
  shadowStrength: number;
  /** 0..1 - overall ambient/fill light level. */
  ambientStrength: number;
  outlineEnabled: boolean;
  /** Object-space push distance for the inverted-hull outline. */
  outlineWidth: number;
  /** 0..1 - outline opacity/darkness. */
  outlineStrength: number;
}

export const DEFAULT_TOON_SETTINGS: ToonSettings = {
  enabled: true,
  strength: 0.4,
  shadeSteps: 2,
  shadowStrength: 0.32,
  ambientStrength: 0.62,
  outlineEnabled: true,
  outlineWidth: 0.009,
  outlineStrength: 0.45,
};

/**
 * Per-Material-category tuning (section 10 of the brief): every material
 * does not get identical shading. FACE/EYE stay near-flat, HAIR gets very
 * weak toon shading (so the user's own painted highlights/shading read
 * through undisturbed), CLOTHES gets a bit more contrast, BODY PARTS reads
 * like skin.
 */
export type MaterialCategory = "face" | "eye" | "hair" | "clothes" | "bodyParts";

/** How dark the darkest gradient step is allowed to get for this category
 * at shadowStrength = 1 (full requested strength). Lower = can get darker. */
export const CATEGORY_SHADOW_FLOOR: Record<MaterialCategory, number> = {
  eye: 0.93,
  face: 0.84,
  hair: 0.86,
  clothes: 0.6,
  bodyParts: 0.74,
};

/** HairCanvas is structurally never eligible for outlines - see sections
 * 16-19 of the brief. This map exists so the exclusion is a fact about the
 * category, not a conditional sprinkled through the outline code. */
export const CATEGORY_OUTLINE_ALLOWED: Record<MaterialCategory, boolean> = {
  eye: true,
  face: true,
  hair: false,
  clothes: true,
  bodyParts: true,
};

export function effectiveFloor(category: MaterialCategory, shadowStrength: number): number {
  const floor = CATEGORY_SHADOW_FLOOR[category];
  const s = Math.min(1, Math.max(0, shadowStrength));
  return 1 - (1 - floor) * s;
}

const gradientMapCache = new Map<string, THREE.DataTexture>();

/** Builds (and caches) a small NEAREST-filtered gradient map for
 * MeshToonMaterial - `steps` visible shading bands, ramping from `floor`
 * (darkest band) up to 1 (fully lit). NearestFilter keeps the cel-shading
 * bands crisp instead of interpolating into a smooth PBR-style gradient. */
export function getGradientMap(steps: number, floor: number): THREE.DataTexture {
  const key = `${steps}:${floor.toFixed(3)}`;
  const cached = gradientMapCache.get(key);
  if (cached) return cached;
  const size = Math.max(2, steps);
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const t = size === 1 ? 1 : i / (size - 1);
    data[i] = Math.round((floor + (1 - floor) * t) * 255);
  }
  const tex = new THREE.DataTexture(data, size, 1, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradientMapCache.set(key, tex);
  return tex;
}

/** Derives the actual light intensities to render with. When toon is OFF
 * this always returns exactly the base values unchanged, so switching
 * Toon OFF is guaranteed pixel-identical to the pre-toon lighting setup
 * (section 5/39's "OFF must exactly restore the original state"). */
export function lightIntensitiesFor(
  settings: ToonSettings,
  baseAmbient: number,
  baseKey: number,
  baseFill: number
): { ambient: number; key: number; fill: number } {
  if (!settings.enabled) {
    return { ambient: baseAmbient, key: baseKey, fill: baseFill };
  }
  // strength=0 ("2D"): ambient boosted, directional flattened - close to
  // unlit. strength=1 ("3D"): more directional influence/contrast.
  const ambientMul = (1.5 - settings.strength * 0.7) * settings.ambientStrength;
  const dirMul = (0.25 + settings.strength * 0.9) * (0.4 + settings.shadowStrength * 0.8);
  return {
    ambient: baseAmbient * ambientMul,
    key: baseKey * dirMul,
    fill: baseFill * dirMul,
  };
}

export type RenderStylePresetName = "original" | "softToon" | "flat2D" | "strongToon";

export const RENDER_STYLE_PRESETS: Record<RenderStylePresetName, ToonSettings> = {
  original: { ...DEFAULT_TOON_SETTINGS, enabled: false },
  softToon: {
    enabled: true,
    strength: 0.4,
    shadeSteps: 2,
    shadowStrength: 0.3,
    ambientStrength: 0.65,
    outlineEnabled: true,
    outlineWidth: 0.008,
    outlineStrength: 0.45,
  },
  flat2D: {
    enabled: true,
    strength: 0.05,
    shadeSteps: 2,
    shadowStrength: 0.1,
    ambientStrength: 0.9,
    outlineEnabled: true,
    outlineWidth: 0.008,
    outlineStrength: 0.4,
  },
  strongToon: {
    enabled: true,
    strength: 0.8,
    shadeSteps: 3,
    shadowStrength: 0.6,
    ambientStrength: 0.5,
    outlineEnabled: true,
    outlineWidth: 0.014,
    outlineStrength: 0.75,
  },
};

export const RENDER_STYLE_PRESET_LABELS: Record<RenderStylePresetName, string> = {
  original: "원본",
  softToon: "Soft Toon",
  flat2D: "Flat 2D",
  strongToon: "Strong Toon",
};
