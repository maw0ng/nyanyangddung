import {
  createIndexedDBPresetStore,
  makeId,
  type PresetRecord,
  type PresetStore,
} from "./genericPresetStore";
import type { FacePresetData, FacePresetDataV2, StoredPaintLayer } from "./types";

/**
 * Face preset persistence. Backed by the generic IndexedDB store, kept on
 * its original database/store name ("miniwaffle-face-presets"/"presets")
 * with `legacyDataFallback` so presets saved before the generic layer
 * existed (payload fields at the top level, not under `data`) still load -
 * `migrate` below then further upgrades that (or the later single-paint-
 * layer v1 shape) into the current multi-layer v2 shape.
 */
const rawStore = createIndexedDBPresetStore<FacePresetData>(
  "miniwaffle-face-presets",
  "presets",
  { legacyDataFallback: true }
);

function toSingleLayer(image: Blob | undefined): StoredPaintLayer[] {
  if (!image) return [];
  return [
    {
      id: makeId(),
      name: "레이어 1",
      image,
      visible: true,
      opacity: 1,
      locked: false,
      order: 0,
    },
  ];
}

function migrate(data: FacePresetData): FacePresetDataV2 {
  if ("schemaVersion" in data && data.schemaVersion === 2) return data;
  const legacy = data as {
    basePaintLayer?: Blob;
    eyePaintLayer?: Blob;
    baseOverrideTexture?: Blob | null;
    eyeOverrideTexture?: Blob | null;
    morphValues?: Record<string, number>;
  };
  return {
    schemaVersion: 2,
    baseLayers: toSingleLayer(legacy.basePaintLayer),
    eyeLayers: toSingleLayer(legacy.eyePaintLayer),
    baseOverrideTexture: legacy.baseOverrideTexture ?? null,
    eyeOverrideTexture: legacy.eyeOverrideTexture ?? null,
    morphValues: legacy.morphValues,
  };
}

export const facePresetStorage: PresetStore<FacePresetDataV2> = {
  listPresets: () => rawStore.listPresets(),
  findByName: (name) => rawStore.findByName(name),
  renamePreset: (id, name) => rawStore.renamePreset(id, name),
  deletePreset: (id) => rawStore.deletePreset(id),
  async loadPreset(id): Promise<PresetRecord<FacePresetDataV2> | null> {
    const record = await rawStore.loadPreset(id);
    if (!record) return null;
    return { ...record, data: migrate(record.data) };
  },
  savePreset: (name, data) => rawStore.savePreset(name, data),
  overwritePreset: (id, data) => rawStore.overwritePreset(id, data),
};
