import type { ToonSettings } from "./toonStyle";

export type { PresetMeta, PresetRecord, PresetStore } from "./genericPresetStore";

export type Mode = "rotate" | "draw";

export type Tool = "brush" | "eraser";

export interface UV {
  u: number;
  v: number;
}

export interface DebugInfo {
  hairCanvasFound: boolean;
  hairCanvasType: string | null;
  isSkinnedMesh: boolean;
  hasUV: boolean;
  raycastOk: boolean;
  uv: UV | null;
}

export const INITIAL_DEBUG_INFO: DebugInfo = {
  hairCanvasFound: false,
  hairCanvasType: null,
  isSkinnedMesh: false,
  hasUV: false,
  raycastOk: false,
  uv: null,
};

// ---------------------------------------------------------------------------
// Face painting (added on top of the existing, untouched hair painting types
// above). Top-level edit mode now has three states; "rotate"/"draw" above
// keep meaning exactly what they meant before for MiniWaffleHairScene, which
// still only ever receives "rotate" | "draw".
// ---------------------------------------------------------------------------

export type EditMode = "rotate" | "hair" | "face" | "tops" | "cosmetic";

export type FaceTool = "pen" | "eraser";

// Generic pen/eraser tool shared by every NEW target-agnostic UI (Face,
// Tops, and Hair's new I/O controls). Hair's existing internal `Tool`
// ("brush" | "eraser") type above is untouched - HairPaintPrototype maps
// between the two at the call site so MiniWaffleHairScene's prop contract
// never changes.
export type PaintTool = "pen" | "eraser";

export interface HistoryStatus {
  canUndo: boolean;
  canRedo: boolean;
}

export const INITIAL_HISTORY_STATUS: HistoryStatus = {
  canUndo: false,
  canRedo: false,
};

/** Which "slot" an uploaded PNG replaces. Only meaningful for targets that
 * have an original GLB texture (Face/Tops) - Hair has no original, so an
 * upload always behaves like "paint-layer". */
export type TextureImportMode = "paint-layer" | "full-texture";

export type FaceLayerName = "base" | "eye";

export interface FaceDebugInfo {
  bodyFound: boolean;
  bodyNodeType: string | null;
  morphTargetCount: number | null;
  baseMeshFound: boolean;
  eyeMeshFound: boolean;
  basePaintCanvasReady: boolean;
  eyePaintCanvasReady: boolean;
  baseTextureSize: number | null;
  eyeTextureSize: number | null;
  raycastOk: boolean;
  hitMeshName: string | null;
  hitMaterialName: string | null;
  hitMaterialIndex: number | null;
  hitLayer: FaceLayerName | null;
  uv: UV | null;
}

export const INITIAL_FACE_DEBUG_INFO: FaceDebugInfo = {
  bodyFound: false,
  bodyNodeType: null,
  morphTargetCount: null,
  baseMeshFound: false,
  eyeMeshFound: false,
  basePaintCanvasReady: false,
  eyePaintCanvasReady: false,
  baseTextureSize: null,
  eyeTextureSize: null,
  raycastOk: false,
  hitMeshName: null,
  hitMaterialName: null,
  hitMaterialIndex: null,
  hitLayer: null,
  uv: null,
};

/** @deprecated use HistoryStatus - kept as an alias, FacePaintScene's
 * existing prop already spells it this way. */
export type FaceHistoryStatus = HistoryStatus;
export const INITIAL_FACE_HISTORY_STATUS: FaceHistoryStatus = INITIAL_HISTORY_STATUS;

// ---------------------------------------------------------------------------
// Preset payloads. Each category's *stored* payload (what lives under a
// PresetRecord<T>.data - see genericPresetStore.ts). Deliberately stores the
// user's *paint layers* (and, for Face, morph values later) rather than a
// baked composite - the original textures already live in the GLB, so
// re-applying only ever needs to replay what the user added on top.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Layer stack (multi-layer painting). One stored layer = one PNG blob plus
// its metadata; StoredPaintLayer is the serialized/preset form of
// layerStackEngine.ts's runtime `PaintLayer` (which holds a live
// HTMLCanvasElement instead of a Blob).
// ---------------------------------------------------------------------------

export interface StoredPaintLayer {
  id: string;
  name: string;
  image: Blob;
  visible: boolean;
  opacity: number;
  locked: boolean;
  order: number;
  /** Reserved for future multiply/screen/overlay/add support - only
   * "normal" is actually composited today. */
  blendMode?: "normal";
}

// ---- v2 (current) preset payload shapes ------------------------------------

export interface HairPresetDataV2 {
  schemaVersion: 2;
  layers: StoredPaintLayer[];
}

export interface FacePresetDataV2 {
  schemaVersion: 2;
  baseLayers: StoredPaintLayer[];
  eyeLayers: StoredPaintLayer[];
  baseOverrideTexture?: Blob | null;
  eyeOverrideTexture?: Blob | null;
  morphValues?: Record<string, number>;
}

export interface ClothingPresetDataV2 {
  schemaVersion: 2;
  materials: Record<
    string,
    { layers: StoredPaintLayer[]; overrideTexture?: Blob | null }
  >;
}

// ---- v1 (legacy, single paint-layer) shapes - kept only so migration code
// has something to type-check the raw IndexedDB record against. Never
// written anymore; only ever read then upgraded to v2 in the storage
// wrappers (facePresetStorage.ts etc). ---------------------------------------

export interface HairPresetDataV1 {
  paintLayer: Blob;
}

export interface FacePresetDataV1 {
  basePaintLayer: Blob;
  eyePaintLayer: Blob;
  baseOverrideTexture?: Blob | null;
  eyeOverrideTexture?: Blob | null;
  morphValues?: Record<string, number>;
}

export interface ClothingPresetDataV1 {
  target: "Tops";
  paintLayers: Record<string, Blob>;
  overrideTextures?: Record<string, Blob>;
}

export type HairPresetData = HairPresetDataV1 | HairPresetDataV2;
export type FacePresetData = FacePresetDataV1 | FacePresetDataV2;
export type ClothingPresetData = ClothingPresetDataV1 | ClothingPresetDataV2;

export const DEFAULT_PRESET_ID = "__default__";

export function makeDefaultPresetMeta(name: string) {
  return {
    id: DEFAULT_PRESET_ID,
    name,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** @deprecated use makeDefaultPresetMeta("기본") - kept for the existing
 * FacePaintScene/HairPaintPrototype call sites. */
export const DEFAULT_FACE_PRESET_ID = DEFAULT_PRESET_ID;
export const DEFAULT_FACE_PRESET_META = {
  ...makeDefaultPresetMeta("기본"),
  isDefault: true as const,
};

// ---------------------------------------------------------------------------
// Tops (clothing) painting
// ---------------------------------------------------------------------------

export interface TopsDebugInfo {
  topsFound: boolean;
  topsMeshType: string | null;
  materialNames: string[];
  activeMaterial: string | null;
  textureWidth: number | null;
  textureHeight: number | null;
  hasUV: boolean;
  paintCanvasReady: boolean;
  raycastOk: boolean;
  uv: UV | null;
}

export const INITIAL_TOPS_DEBUG_INFO: TopsDebugInfo = {
  topsFound: false,
  topsMeshType: null,
  materialNames: [],
  activeMaterial: null,
  textureWidth: null,
  textureHeight: null,
  hasUV: false,
  paintCanvasReady: false,
  raycastOk: false,
  uv: null,
};

// ---------------------------------------------------------------------------
// "My Characters" (CharacterPreset). A CharacterPreset is a self-contained
// snapshot of a whole character's appearance at save time - not a set of
// links to HairPreset/FacePreset/ClothingPreset ids. It deliberately reuses
// the very same StoredPaintLayer shape those presets already use (fresh
// PNG Blobs produced from the live canvases at save time), so nothing about
// the existing per-category preset storage format changes because this
// exists, and editing/deleting an individual Hair/Face/Clothing preset
// later can never reach back into an already-saved CharacterPreset.
// ---------------------------------------------------------------------------

export interface CharacterSurfaceLayers {
  layers: StoredPaintLayer[];
  overrideTexture?: Blob | null;
}

// ---------------------------------------------------------------------------
// Cosmetics (액세서리/귀 꾸미기 v1) - section 15. `EquippedCosmetic.transform`
// is the AttachmentRoot's own TRS (never the accessory GLB's internal
// Armature - see cosmetics/cosmeticAttachment.ts), always stored as
// independent XYZ tuples (section 6 - never a single uniform-scale number).
// `customizations` is keyed by cosmeticId (not by equip state), so a
// previously-painted accessory's Paint Layers survive being unequipped and
// swapped back in later (section 12/16).
// ---------------------------------------------------------------------------

export interface CosmeticTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface EquippedCosmetic {
  cosmeticId: string;
  transform: CosmeticTransform;
}

/** materialName -> layer stack, mirroring ClothingPresetDataV2's own
 * per-material shape exactly (section 12's "기존 layer 기능을 그대로
 * 지원") - most v1 accessories have exactly one material, but this stays
 * keyed the same way Tops already is. */
export interface CosmeticCustomization {
  materials: Record<string, CharacterSurfaceLayers>;
}

export interface CharacterCosmetics {
  equipped: {
    head?: EquippedCosmetic;
  };
  customizations: Record<string, CosmeticCustomization>;
}

export function emptyCharacterCosmetics(): CharacterCosmetics {
  return { equipped: {}, customizations: {} };
}

export interface CharacterAppearance {
  hair: { layers: StoredPaintLayer[] };
  face: {
    base: CharacterSurfaceLayers;
    eye: CharacterSurfaceLayers;
  };
  clothing: {
    materials: Record<string, CharacterSurfaceLayers>;
  };
  morphValues: Record<string, number>;
  cosmetics: CharacterCosmetics;
  /** Per-character Toon rendering style (bug fix - this used to be a
   * single app-wide localStorage preference shared by every character on
   * the device, via toonStyle.ts's loadToonSettings/saveToonSettings -
   * which made no sense once CoWork needed to show a Remote Avatar with
   * ITS OWNER's actual Toon choice rather than whatever the local viewer's
   * device happened to have set). Optional only so a CharacterPreset saved
   * before this field existed still type-checks and loads - every read
   * site falls back to DEFAULT_TOON_SETTINGS (toonStyle.ts), never crashes
   * on a missing value (section 19's "구버전 호환" principle, applied
   * locally too). */
  toon?: ToonSettings;
}

// ---- v1 (legacy, no cosmetics) - kept ONLY so migration code has
// something to type-check the raw IndexedDB record against (section 15 -
// "schemaVersion migration을 구현한다"), the SAME pattern
// HairPresetDataV1/FacePresetDataV1/ClothingPresetDataV1 above already
// established for their own v1->v2 bumps. Never written anymore; read then
// upgraded to v2 in characterPresetStorage.ts. -------------------------------

export interface CharacterAppearanceV1 {
  hair: { layers: StoredPaintLayer[] };
  face: {
    base: CharacterSurfaceLayers;
    eye: CharacterSurfaceLayers;
  };
  clothing: {
    materials: Record<string, CharacterSurfaceLayers>;
  };
  morphValues: Record<string, number>;
}

export interface CharacterPresetDataV1 {
  schemaVersion: 1;
  appearance: CharacterAppearanceV1;
  thumbnail?: Blob | null;
}

export interface CharacterPresetDataV2 {
  schemaVersion: 2;
  appearance: CharacterAppearance;
  /** Small (<=256px) preview PNG/WebP of the character, captured from the
   * live 3D canvas at save time. Generation failure must never fail the
   * character save itself - see characterPresetStorage.ts. */
  thumbnail?: Blob | null;
}

export type CharacterPresetData = CharacterPresetDataV1 | CharacterPresetDataV2;
