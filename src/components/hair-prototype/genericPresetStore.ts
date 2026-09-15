/**
 * Generic IndexedDB-backed preset repository, shared by Hair/Face/Clothing
 * preset storage. Each category gets its own IndexedDB database + store
 * name (kept separate rather than one shared store) so existing data for
 * one category is never touched by adding another - see facePresetStorage
 * for why this matters (it must stay compatible with rows written before
 * this generic layer existed).
 *
 * Swap `createIndexedDBPresetStore` for a Supabase-backed factory later;
 * nothing above the `PresetStore<T>` interface needs to change.
 */

export interface PresetMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface PresetRecord<T> extends PresetMeta {
  data: T;
}

export interface PresetStore<T> {
  listPresets(): Promise<PresetMeta[]>;
  loadPreset(id: string): Promise<PresetRecord<T> | null>;
  findByName(name: string): Promise<PresetMeta | null>;
  savePreset(name: string, data: T): Promise<PresetMeta>;
  overwritePreset(id: string, data: T): Promise<PresetMeta>;
  renamePreset(id: string, name: string): Promise<void>;
  deletePreset(id: string): Promise<void>;
}

interface RawRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  data?: unknown;
  [key: string]: unknown;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export interface CreatePresetStoreOptions {
  /**
   * Older rows (written before this generic layer existed) store their
   * payload fields at the top level instead of under `data`. When true,
   * such rows are read back with `data` falling back to the raw row
   * itself, so old presets keep loading instead of silently disappearing.
   */
  legacyDataFallback?: boolean;
}

export function createIndexedDBPresetStore<T>(
  dbName: string,
  storeName: string,
  options: CreatePresetStoreOptions = {}
): PresetStore<T> {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB is not available"));
    }
    if (!dbPromise) {
      dbPromise = openDatabase();
    }
    return dbPromise;
  }

  function toMeta(row: RawRow): PresetMeta {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? row.createdAt,
    };
  }

  function toRecord(row: RawRow): PresetRecord<T> | null {
    const data =
      row.data !== undefined
        ? row.data
        : options.legacyDataFallback
          ? row
          : undefined;
    if (data === undefined) return null;
    return { ...toMeta(row), data: data as T };
  }

  async function runReadWrite<R>(
    fn: (store: IDBObjectStore) => R
  ): Promise<R> {
    const db = await getDb();
    const tx = db.transaction(storeName, "readwrite");
    const result = fn(tx.objectStore(storeName));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return result;
  }

  return {
    async listPresets() {
      const db = await getDb();
      const tx = db.transaction(storeName, "readonly");
      const all = await promisifyRequest(tx.objectStore(storeName).getAll());
      return (all as RawRow[]).map(toMeta).sort((a, b) => a.createdAt - b.createdAt);
    },

    async loadPreset(id) {
      const db = await getDb();
      const tx = db.transaction(storeName, "readonly");
      const row = (await promisifyRequest(
        tx.objectStore(storeName).get(id)
      )) as RawRow | undefined;
      return row ? toRecord(row) : null;
    },

    async findByName(name) {
      const db = await getDb();
      const tx = db.transaction(storeName, "readonly");
      const all = ((await promisifyRequest(
        tx.objectStore(storeName).getAll()
      )) as RawRow[]);
      const match = all.find((r) => r.name === name);
      return match ? toMeta(match) : null;
    },

    async savePreset(name, data) {
      const now = Date.now();
      const row: RawRow = { id: makeId(), name, createdAt: now, updatedAt: now, data };
      await runReadWrite((store) => store.put(row));
      return toMeta(row);
    },

    async overwritePreset(id, data) {
      const db = await getDb();
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const existing = (await promisifyRequest(store.get(id))) as
        | RawRow
        | undefined;
      const now = Date.now();
      const row: RawRow = existing
        ? { ...existing, data, updatedAt: now }
        : { id, name: id, createdAt: now, updatedAt: now, data };
      store.put(row);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return toMeta(row);
    },

    async renamePreset(id, name) {
      const db = await getDb();
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const existing = (await promisifyRequest(store.get(id))) as
        | RawRow
        | undefined;
      if (existing) {
        store.put({ ...existing, name, updatedAt: Date.now() });
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },

    async deletePreset(id) {
      await runReadWrite((store) => store.delete(id));
    },
  };
}
