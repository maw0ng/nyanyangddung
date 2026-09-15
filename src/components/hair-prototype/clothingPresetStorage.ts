import {
  createIndexedDBPresetStore,
  makeId,
  type PresetRecord,
  type PresetStore,
} from "./genericPresetStore";
import type { ClothingPresetData, ClothingPresetDataV2 } from "./types";

const rawStore = createIndexedDBPresetStore<ClothingPresetData>(
  "miniwaffle-clothing-presets",
  "presets"
);

function migrate(data: ClothingPresetData): ClothingPresetDataV2 {
  if ("schemaVersion" in data && data.schemaVersion === 2) return data;
  const legacy = data as {
    target: "Tops";
    paintLayers: Record<string, Blob>;
    overrideTextures?: Record<string, Blob>;
  };
  const materials: ClothingPresetDataV2["materials"] = {};
  for (const [materialName, image] of Object.entries(legacy.paintLayers ?? {})) {
    materials[materialName] = {
      layers: [
        {
          id: makeId(),
          name: "레이어 1",
          image,
          visible: true,
          opacity: 1,
          locked: false,
          order: 0,
        },
      ],
      overrideTexture: legacy.overrideTextures?.[materialName] ?? null,
    };
  }
  return { schemaVersion: 2, materials };
}

export const clothingPresetStorage: PresetStore<ClothingPresetDataV2> = {
  listPresets: () => rawStore.listPresets(),
  findByName: (name) => rawStore.findByName(name),
  renamePreset: (id, name) => rawStore.renamePreset(id, name),
  deletePreset: (id) => rawStore.deletePreset(id),
  async loadPreset(id): Promise<PresetRecord<ClothingPresetDataV2> | null> {
    const record = await rawStore.loadPreset(id);
    if (!record) return null;
    return { ...record, data: migrate(record.data) };
  },
  savePreset: (name, data) => rawStore.savePreset(name, data),
  overwritePreset: (id, data) => rawStore.overwritePreset(id, data),
};
