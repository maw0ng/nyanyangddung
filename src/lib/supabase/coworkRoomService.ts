"use client";

/**
 * Co-working Room service layer (mirrors friendService.ts's own
 * conventions). Every mutation (create/join/leave) calls the corresponding
 * RPC from supabase/migrations/0002_cowork_rooms.sql rather than doing raw
 * insert/update - RLS blocks direct table mutation entirely (see that
 * migration's comments), so these RPCs are the only path. Reads
 * (getActiveRoom/getRoomById/getRoomMembers) are plain RLS-scoped selects,
 * same read/write split as friendService.
 */
import { getSupabaseClient } from "./client";
import type { CoworkRoom, CoworkRoomMemberView, CoworkRoomRow } from "./database.types";

export type CoworkResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NOT_CONFIGURED = "계정 기능을 사용할 수 없습니다.";

function toUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();
  // The RPC functions raise plain exception codes (see the migration) -
  // translate the ones the UI needs to distinguish; everything else falls
  // back to a generic message so no raw Postgres/PostgREST text ever
  // reaches the UI.
  if (msg.includes("not_authenticated")) return "로그인이 필요합니다.";
  if (msg.includes("already_in_room")) return "이미 다른 작업방에 참여 중입니다.";
  if (msg.includes("room_not_found")) return "해당 작업방을 찾을 수 없습니다.";
  if (msg.includes("room_ended")) return "이미 종료된 작업방입니다.";
  if (msg.includes("already_member")) return "이미 참여 중인 작업방입니다.";
  if (msg.includes("room_full")) return "작업방이 가득 찼습니다.";
  if (msg.includes("not_in_room")) return "참여 중인 작업방이 없습니다.";
  if (msg.includes("fetch") || msg.includes("network")) return "네트워크 연결을 확인해주세요.";
  console.error("[coworkRoomService]", raw);
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function mapRoom(row: CoworkRoomRow): CoworkRoom {
  return {
    id: row.id,
    roomCode: row.room_code,
    createdBy: row.created_by,
    status: row.status,
    maxMembers: row.max_members,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

/** Normalizes a user-typed room code the same way the join RPC itself does
 * server-side (uppercase, trim) - a UX nicety only (section 29); the RPC
 * re-normalizes independently and is the real authority on what counts as
 * a match (section 33 - never trust client-side validation). */
export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

const ROOM_COLUMNS = "id,room_code,created_by,status,max_members,created_at,ended_at";

export const coworkRoomService = {
  /** Creates a new room via the create_cowork_room() RPC (transactional,
   * section 11) and returns the created room. Fails with a translated
   * "이미 다른 작업방에 참여 중입니다." if the caller already has an active
   * membership anywhere (section 10). */
  async createRoom(): Promise<CoworkResult<CoworkRoom>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data: roomId, error } = await supabase.rpc("create_cowork_room");
    if (error) return { ok: false, error: toUserMessage(error) };
    return coworkRoomService.getRoomById(roomId as string);
  },

  /** Joins a room by code via the join_cowork_room() RPC - every business
   * rule (not found/ended/full/already-in-another-room/duplicate-member)
   * is enforced server-side, never assumed client-side (section 13/33). */
  async joinRoom(rawCode: string): Promise<CoworkResult<CoworkRoom>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const code = normalizeRoomCode(rawCode);
    const { data: roomId, error } = await supabase.rpc("join_cowork_room", { p_room_code: code });
    if (error) return { ok: false, error: toUserMessage(error) };
    return coworkRoomService.getRoomById(roomId as string);
  },

  /** Leaves the caller's current active room via leave_cowork_room() -
   * ends the room server-side if this was the last active member (section
   * 23/24), otherwise leaves the room active for the rest (section 22). */
  async leaveRoom(): Promise<CoworkResult<void>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { error } = await supabase.rpc("leave_cowork_room");
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: undefined };
  },

  async getRoomById(roomId: string): Promise<CoworkResult<CoworkRoom>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data, error } = await supabase
      .from("cowork_rooms")
      .select(ROOM_COLUMNS)
      .eq("id", roomId)
      .maybeSingle()
      .returns<CoworkRoomRow>();
    if (error) return { ok: false, error: toUserMessage(error) };
    if (!data) return { ok: false, error: "해당 작업방을 찾을 수 없습니다." };
    return { ok: true, data: mapRoom(data) };
  },

  /** The caller's current active room, if any (section 26 - app-restart
   * recovery). `data: null` (not an error) means "not currently in a
   * room". */
  async getActiveRoom(userId: string): Promise<CoworkResult<CoworkRoom | null>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data: memberRow, error: memberError } = await supabase
      .from("cowork_room_members")
      .select("room_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle()
      .returns<{ room_id: string }>();
    if (memberError) return { ok: false, error: toUserMessage(memberError) };
    if (!memberRow) return { ok: true, data: null };
    return coworkRoomService.getRoomById(memberRow.room_id);
  },

  /** Active participants of a room (section 18/31) - nickname/level only.
   * Two-step query (member rows, then a batch profile lookup) since
   * cowork_room_members.user_id references auth.users directly, not
   * public.profiles - same pattern friendService.ts already uses for the
   * same structural reason. */
  async getRoomMembers(roomId: string): Promise<CoworkResult<CoworkRoomMemberView[]>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data: members, error } = await supabase
      .from("cowork_room_members")
      .select("user_id,joined_at")
      .eq("room_id", roomId)
      .eq("status", "active")
      .returns<{ user_id: string; joined_at: string }[]>();
    if (error) return { ok: false, error: toUserMessage(error) };

    const ids = (members ?? []).map((m) => m.user_id);
    if (ids.length === 0) return { ok: true, data: [] };
    const joinedAtByUserId = new Map((members ?? []).map((m) => [m.user_id, m.joined_at]));

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id,nickname,level")
      .in("id", ids)
      .returns<{ id: string; nickname: string; level: number }[]>();
    // A profile-fetch error (or a specific id simply not resolving - e.g. a
    // stale row) must never crash the whole participant list (section 59) -
    // fall back to a placeholder per missing id rather than propagating the
    // error or silently dropping that member's Avatar/slot.
    const profileById = new Map((profileError ? [] : (profiles ?? [])).map((p) => [p.id, p]));

    return {
      ok: true,
      data: ids.map((id) => {
        const profile = profileById.get(id);
        return {
          userId: id,
          nickname: profile?.nickname ?? "참가자",
          level: profile?.level ?? 0,
          joinedAt: joinedAtByUserId.get(id) ?? new Date(0).toISOString(),
        };
      }),
    };
  },

  /** Realtime subscription for member-join/leave + room-status changes
   * within ONE room (section 19/20/53) - never a friend-presence-style
   * global subscription. Relies on Supabase Realtime's own RLS-aware
   * `postgres_changes` delivery, so a client only ever receives events for
   * rows it could already SELECT (same RLS policies as the plain reads
   * above). Callers MUST call the returned unsubscribe function on room
   * change/leave/unmount/logout (section 54) - never left to accumulate. */
  subscribeToRoom(roomId: string, onChange: () => void): () => void {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};
    const channel = supabase
      .channel(`cowork_room:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cowork_room_members", filter: `room_id=eq.${roomId}` },
        onChange
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "cowork_rooms", filter: `id=eq.${roomId}` },
        onChange
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  },

  /** THIS caller's own `cowork_room_members` rows, independent of any
   * specific room (bug fix - "CoWork 최초 입장 시 친구 캐릭터가 바로 나타나지
   * 않음"). Desktop and CoWork are separate Electron BrowserWindows, each
   * running its own independent `useCoWorkRoom` instance/subscription (see
   * that hook's own doc comment) - there is no shared in-memory state
   * between them. `subscribeToRoom` above only starts listening once a
   * caller already knows a roomId, which is exactly the piece the DESKTOP
   * window never had: when the user creates/joins a room from the CoWork
   * window, only THAT window's own hook instance learns about it locally;
   * Desktop's separate instance had no room yet, so it was never
   * subscribed to anything, and had no way to find out - until the next
   * app restart re-ran its initial `getActiveRoom()` fetch from scratch.
   * Subscribing to "my own membership" the moment `userId` is known (before
   * any room is known) closes that gap with real Realtime delivery, not a
   * poll/timer - the instant this user's own `cowork_room_members` row is
   * inserted/updated/deleted (create, join, leave, kick, room-ended), every
   * window's hook instance calls `onChange` and re-runs its own initial
   * fetch for whatever room now applies. */
  subscribeToOwnMembership(userId: string, onChange: () => void): () => void {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};
    const channel = supabase
      .channel(`cowork_own_membership:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cowork_room_members", filter: `user_id=eq.${userId}` },
        onChange
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  },
};
