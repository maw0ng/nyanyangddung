/**
 * IndexedDB persistence for the local UserProfile - its own database
 * ("miniwaffle-profile"), separate from both
 * ../../hair-prototype/characterPresetStorage.ts's
 * "miniwaffle-character-presets" (CharacterPreset is appearance, this is
 * growth - section 22) and ../timer/timerStorage.ts's "miniwaffle-timer"
 * (section 20). A single fixed-key row, same shape as timerStorage.ts's
 * activeState store.
 */

import type { UserProfile } from "./growthTypes";

const DB_NAME = "miniwaffle-profile";
const DB_VERSION = 1;
const PROFILE_STORE = "profile";
const PROFILE_KEY = "current";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE, { keyPath: "key" });
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
  if (!dbPromise) dbPromise = openDatabase();
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const profileStorage = {
  async loadProfile(): Promise<UserProfile | null> {
    try {
      const db = await getDb();
      const tx = db.transaction(PROFILE_STORE, "readonly");
      const row = (await promisify(tx.objectStore(PROFILE_STORE).get(PROFILE_KEY))) as
        | (UserProfile & { key: string })
        | undefined;
      if (!row) return null;
      const { key: _key, ...profile } = row;
      return profile;
    } catch {
      return null;
    }
  },

  async saveProfile(profile: UserProfile): Promise<void> {
    try {
      const db = await getDb();
      const tx = db.transaction(PROFILE_STORE, "readwrite");
      tx.objectStore(PROFILE_STORE).put({ key: PROFILE_KEY, ...profile });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Non-fatal - worst case the nickname/growth just isn't persisted
      // this time; GrowthEngine keeps the in-memory value regardless.
    }
  },
};
