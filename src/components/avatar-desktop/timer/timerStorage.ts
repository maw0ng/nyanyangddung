/**
 * IndexedDB persistence for the work timer - deliberately its own database
 * ("miniwaffle-timer"), completely separate from
 * ../../hair-prototype/characterPresetStorage.ts's
 * "miniwaffle-character-presets" database (section 30: "CharacterPreset
 * storage와 Timer storage는 논리적으로 분리"). Two object stores:
 *  - "sessions": every finished TimerSession, keyed by its own id, appended
 *    once on end() and never rewritten.
 *  - "activeState": at most one row (fixed key "current") holding the
 *    in-progress ActiveTimerState, replaced wholesale on every meaningful
 *    transition and deleted once the timer ends (see TimerEngine's
 *    onPersist wiring in useTimerEngine.ts) - never written on a per-second
 *    tick (section 33).
 */

import type { ActiveTimerState, TimerSession } from "./timerTypes";

const DB_NAME = "miniwaffle-timer";
const DB_VERSION = 1;
const SESSIONS_STORE = "sessions";
const ACTIVE_STATE_STORE = "activeState";
const ACTIVE_STATE_KEY = "current";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ACTIVE_STATE_STORE)) {
        db.createObjectStore(ACTIVE_STATE_STORE, { keyPath: "key" });
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

export const timerStorage = {
  async saveSession(session: TimerSession): Promise<void> {
    try {
      const db = await getDb();
      const tx = db.transaction(SESSIONS_STORE, "readwrite");
      tx.objectStore(SESSIONS_STORE).put(session);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Non-fatal - the running session already ended in memory; losing
      // the historical record on a storage failure must never crash the
      // Desktop Avatar.
    }
  },

  /** Newest first - not surfaced in any UI yet (section 46 explicitly
   * defers the stats screens), but kept accurate/queryable for when that's
   * built. */
  async listSessions(): Promise<TimerSession[]> {
    try {
      const db = await getDb();
      const tx = db.transaction(SESSIONS_STORE, "readonly");
      const all = await promisify(tx.objectStore(SESSIONS_STORE).getAll());
      return (all as TimerSession[]).sort((a, b) => b.startedAt - a.startedAt);
    } catch {
      return [];
    }
  },

  async saveActiveState(state: ActiveTimerState | null): Promise<void> {
    try {
      const db = await getDb();
      const tx = db.transaction(ACTIVE_STATE_STORE, "readwrite");
      const store = tx.objectStore(ACTIVE_STATE_STORE);
      if (state) {
        store.put({ key: ACTIVE_STATE_KEY, ...state });
      } else {
        store.delete(ACTIVE_STATE_KEY);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Non-fatal - worst case a restart can't restore the in-progress
      // timer, which TimerEngine already treats as "start from idle".
    }
  },

  async loadActiveState(): Promise<ActiveTimerState | null> {
    try {
      const db = await getDb();
      const tx = db.transaction(ACTIVE_STATE_STORE, "readonly");
      const row = (await promisify(tx.objectStore(ACTIVE_STATE_STORE).get(ACTIVE_STATE_KEY))) as
        | (ActiveTimerState & { key: string })
        | undefined;
      if (!row) return null;
      const { key: _key, ...state } = row;
      return state;
    } catch {
      return null;
    }
  },
};
