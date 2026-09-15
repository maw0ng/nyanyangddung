/**
 * Storage layer for "My Characters" (CharacterPreset). Kept separate from
 * the generic PresetStore<T> interface used by hair/face/clothing presets
 * because the character list UI needs thumbnails without pulling every
 * character's full layer-stack Blobs into memory at once (see the "memory
 * management" note below) - so this exposes its own small,
 * character-shaped API instead (listCharacters/getCharacter/
 * createCharacter/saveCharacter/renameCharacter/duplicateCharacter/
 * deleteCharacter), per the project's storage-layer convention. Swapping
 * this file for a Supabase-backed implementation later should not require
 * any change above it (HairPaintPrototype only ever calls these methods).
 */

import { createIndexedDBPresetStore } from "./genericPresetStore";
import { emptyCharacterCosmetics } from "./types";
import type { CharacterAppearance, CharacterPresetData, CharacterPresetDataV2 } from "./types";

export interface CharacterSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail: Blob | null;
}

export interface CharacterRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  appearance: CharacterAppearance;
  thumbnail: Blob | null;
}

const rawStore = createIndexedDBPresetStore<CharacterPresetData>(
  "miniwaffle-character-presets",
  "presets"
);

const ACTIVE_CHARACTER_KEY = "miniwaffle:activeCharacterId";

/**
 * schemaVersion migration (section 15) - a v1 record (written before
 * cosmetics existed) is upgraded to v2 by injecting an EMPTY cosmetics
 * state, never by inventing equipped gear. An already-v2 record passes
 * through untouched. Existing hair/face/clothing/morph data is never
 * rewritten by this step - only the shape of `appearance` changes (a new
 * `cosmetics` field appears), so a character loaded after this migration
 * looks/paints/morphs EXACTLY as it did before cosmetics existed (section
 * 15's explicit "귀가 갑자기 생기면 안 된다").
 */
function migrateCharacterPresetData(data: CharacterPresetData): CharacterPresetDataV2 {
  if (data.schemaVersion === 2) return data;
  return {
    schemaVersion: 2,
    appearance: { ...data.appearance, cosmetics: emptyCharacterCosmetics() },
    thumbnail: data.thumbnail,
  };
}

function toRecord(row: {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: CharacterPresetData;
}): CharacterRecord {
  const data = migrateCharacterPresetData(row.data);
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    appearance: data.appearance,
    thumbnail: data.thumbnail ?? null,
  };
}

export const characterPresetStorage = {
  /**
   * Lightweight list for the "My Characters" card grid. Only the active
   * character is ever rehydrated into live LayerStackEngine canvases -
   * this list only needs id/name/timestamps/thumbnail, so nothing here
   * keeps any character's paint-layer Blobs referenced after the call
   * returns (they're read once to pluck out `thumbnail`, then dropped).
   */
  async listCharacters(): Promise<CharacterSummary[]> {
    const metas = await rawStore.listPresets();
    const records = await Promise.all(metas.map((m) => rawStore.loadPreset(m.id)));
    return records
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        thumbnail: r.data.thumbnail ?? null,
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  async getCharacter(id: string): Promise<CharacterRecord | null> {
    const record = await rawStore.loadPreset(id);
    return record ? toRecord(record) : null;
  },

  async createCharacter(
    name: string,
    appearance: CharacterAppearance,
    thumbnail: Blob | null
  ): Promise<CharacterRecord> {
    const meta = await rawStore.savePreset(name, {
      schemaVersion: 2,
      appearance,
      thumbnail,
    });
    return { ...meta, appearance, thumbnail };
  },

  /** Overwrites appearance/thumbnail for an existing character; name and id
   * are untouched (matches "현재 캐릭터 저장", not a rename). */
  async saveCharacter(
    id: string,
    appearance: CharacterAppearance,
    thumbnail: Blob | null
  ): Promise<CharacterRecord> {
    const meta = await rawStore.overwritePreset(id, {
      schemaVersion: 2,
      appearance,
      thumbnail,
    });
    return { ...meta, appearance, thumbnail };
  },

  async renameCharacter(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await rawStore.renamePreset(id, trimmed);
  },

  /** The duplicate is a fully independent row from the very first write -
   * IndexedDB structured-clones the Blobs into a brand new record, and the
   * source record is never mutated afterwards, so editing the copy can
   * never affect the original (or vice versa). */
  async duplicateCharacter(id: string, newName: string): Promise<CharacterRecord | null> {
    const record = await rawStore.loadPreset(id);
    if (!record) return null;
    const migrated = migrateCharacterPresetData(record.data);
    const meta = await rawStore.savePreset(newName, migrated);
    return { ...meta, appearance: migrated.appearance, thumbnail: migrated.thumbnail ?? null };
  },

  async deleteCharacter(id: string): Promise<void> {
    await rawStore.deletePreset(id);
  },

  /** Persisted outside IndexedDB (localStorage) since it's a single scalar
   * "which row was last active" preference, not character data itself. */
  getActiveCharacterId(): string | null {
    try {
      return localStorage.getItem(ACTIVE_CHARACTER_KEY);
    } catch {
      return null;
    }
  },

  setActiveCharacterId(id: string | null) {
    try {
      if (id) localStorage.setItem(ACTIVE_CHARACTER_KEY, id);
      else localStorage.removeItem(ACTIVE_CHARACTER_KEY);
    } catch {
      // Non-fatal - worst case the last-active character isn't restored
      // after a refresh.
    }
  },
};
