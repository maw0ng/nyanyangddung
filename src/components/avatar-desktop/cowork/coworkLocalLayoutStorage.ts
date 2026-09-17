/**
 * Per-user, per-room LOCAL-ONLY layout preference for "다른 사람 캐릭터를 내
 * 화면에서 자유롭게 이동" (free CoWork avatar placement). Deliberately plain
 * localStorage, not CharacterPreset/NetworkAppearanceManifest/Supabase -
 * this is purely "how do I like MY OWN screen arranged", the same category
 * of state as toonStyle.ts's own settings, and must never be synced to
 * other participants (see coworkLayoutDrag.ts's own doc comment for why a
 * drag never touches the network at all).
 *
 * Keyed by roomId -> userId -> {x,y} (pixel offset within the CoWork grid
 * container). Reading/writing is synchronous and cheap (a handful of
 * participants' worth of numbers), so no async/IndexedDB machinery is
 * needed here, unlike CharacterPreset.
 */

const STORAGE_KEY = "coworkLocalLayout.v1";

export interface LayoutPosition {
  x: number;
  y: number;
}

type StoredLayout = Record<string, Record<string, LayoutPosition>>;

function readAll(): StoredLayout {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StoredLayout) : {};
  } catch {
    return {};
  }
}

function writeAll(all: StoredLayout) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Best-effort only (e.g. storage disabled/full) - never blocks the
    // drag itself, which already applied visually regardless.
  }
}

/** This room's saved per-userId positions, or `{}` if this room has never
 * had anything dragged in it (section 19 - "저장된 local layout이 있다면
 * 복원"). */
export function loadRoomLayout(roomId: string): Record<string, LayoutPosition> {
  if (!roomId) return {};
  return readAll()[roomId] ?? {};
}

/** Persists one participant's dragged position for this room, leaving every
 * other room's (and this room's other participants') saved positions
 * untouched. */
export function saveParticipantPosition(roomId: string, userId: string, position: LayoutPosition) {
  if (!roomId) return;
  const all = readAll();
  const room = { ...(all[roomId] ?? {}) };
  room[userId] = position;
  all[roomId] = room;
  writeAll(all);
}

/** Feature - "CoWork 친구 Avatar 위치 초기화": removes ONLY the given
 * userIds' saved overrides for this room, leaving every other room (and
 * any OTHER userId in this same room - notably the local user, and any
 * already-departed participant's leftover entry) completely untouched. A
 * userId with no saved override is silently a no-op, never an error
 * (section 22 - a since-left participant must never throw here). */
export function removeParticipantPositions(roomId: string, userIds: string[]) {
  if (!roomId || userIds.length === 0) return;
  const all = readAll();
  const room = all[roomId];
  if (!room) return;
  const next = { ...room };
  let changed = false;
  for (const userId of userIds) {
    if (userId in next) {
      delete next[userId];
      changed = true;
    }
  }
  if (!changed) return;
  all[roomId] = next;
  writeAll(all);
}
