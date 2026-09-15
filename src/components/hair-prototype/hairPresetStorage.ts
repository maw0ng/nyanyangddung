import {
  createIndexedDBPresetStore,
  makeId,
  type PresetRecord,
  type PresetStore,
} from "./genericPresetStore";
import type { HairPresetData, HairPresetDataV2 } from "./types";

const rawStore = createIndexedDBPresetStore<HairPresetData>(
  "miniwaffle-hair-presets",
  "presets"
);

/** v1 records had `{paintLayer: Blob}` directly; upgrade to a one-layer v2
 * stack on read so old presets keep loading (section 23: never break
 * existing data). New saves always go through `overwritePreset`/`savePreset`
 * with a v2 payload already, so this only ever fires for old rows. */
function migrate(data: HairPresetData): HairPresetDataV2 {
  if ("schemaVersion" in data && data.schemaVersion === 2) return data;
  const legacy = data as { paintLayer: Blob };
  return {
    schemaVersion: 2,
    layers: [
      {
        id: makeId(),
        name: "레이어 1",
        image: legacy.paintLayer,
        visible: true,
        opacity: 1,
        locked: false,
        order: 0,
      },
    ],
  };
}

export const hairPresetStorage: PresetStore<HairPresetDataV2> = {
  listPresets: () => rawStore.listPresets(),
  findByName: (name) => rawStore.findByName(name),
  renamePreset: (id, name) => rawStore.renamePreset(id, name),
  deletePreset: (id) => rawStore.deletePreset(id),
  async loadPreset(id): Promise<PresetRecord<HairPresetDataV2> | null> {
    const record = await rawStore.loadPreset(id);
    if (!record) return null;
    return { ...record, data: migrate(record.data) };
  },
  savePreset: (name, data) => rawStore.savePreset(name, data),
  overwritePreset: (id, data) => rawStore.overwritePreset(id, data),
};
