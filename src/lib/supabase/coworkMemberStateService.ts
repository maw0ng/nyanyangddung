"use client";

/**
 * CoWork member timer/status state service (section 58 of the cowork-
 * timer-sync brief) - deliberately named distinctly from anything
 * "presence"-shaped (friend online/offline Presence is explicitly NOT
 * built - section 19/52 of earlier briefs) even though the underlying
 * mechanism (a DB row + Realtime) is superficially similar. Every mutation
 * goes through the upsert_cowork_member_state()/leave_cowork_room() RPCs
 * from supabase/migrations/0003_cowork_member_states.sql - RLS blocks
 * direct table mutation entirely, matching this codebase's established
 * friendService.ts/coworkRoomService.ts convention.
 */
import { getSupabaseClient } from "./client";
import type { CoworkMemberStateRow, CoworkPublicTimerState, CoworkPublicTimerStatus } from "./database.types";

export type CoworkStateResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NOT_CONFIGURED = "계정 기능을 사용할 수 없습니다.";

function toUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();
  if (msg.includes("not_authenticated")) return "로그인이 필요합니다.";
  if (msg.includes("not_in_room")) return "참여 중인 작업방이 없습니다.";
  if (msg.includes("invalid_status") || msg.includes("invalid_elapsed")) return "잘못된 상태 값입니다.";
  if (msg.includes("fetch") || msg.includes("network")) return "네트워크 연결을 확인해주세요.";
  console.error("[coworkMemberStateService]", raw);
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function mapRow(row: CoworkMemberStateRow): CoworkPublicTimerState {
  return {
    userId: row.user_id,
    status: row.status,
    elapsedMs: row.elapsed_ms,
    runningSince: row.running_since,
    updatedAt: row.updated_at,
  };
}

export const coworkMemberStateService = {
  /** All current member states for a room (section 12 - a DB snapshot, not
   * just a Realtime feed, so a participant who joins mid-session or
   * reconnects can fetch the current picture directly). */
  async getRoomStates(roomId: string): Promise<CoworkStateResult<CoworkPublicTimerState[]>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data, error } = await supabase
      .from("cowork_member_states")
      .select("room_id,user_id,status,elapsed_ms,running_since,updated_at")
      .eq("room_id", roomId)
      .returns<CoworkMemberStateRow[]>();
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: (data ?? []).map(mapRow) };
  },

  /** Writes the CALLER's own state row for `roomId` via the
   * upsert_cowork_member_state RPC (section 9/16/21) - fire-and-forget by
   * convention at every call site (section 54: a failure here must never
   * block/undo the Local Timer action that triggered it). */
  async upsertOwnState(
    roomId: string,
    projected: { status: CoworkPublicTimerStatus; elapsedMs: number; runningSince: string | null }
  ): Promise<CoworkStateResult<void>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { error } = await supabase.rpc("upsert_cowork_member_state", {
      p_room_id: roomId,
      p_status: projected.status,
      p_elapsed_ms: Math.max(0, Math.round(projected.elapsedMs)),
      p_running_since: projected.runningSince,
    });
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: undefined };
  },

  /** Realtime subscription for state changes within ONE room (section 31) -
   * fires with the full changed row (or null user_id-keyed delete info is
   * not needed since leave_cowork_room's DELETE is already reflected by
   * the participant disappearing from cowork_room_members - section 17's
   * "Room member 자체가 제거되므로 Avatar도 제거"). Callers must unsubscribe
   * on room change/leave/unmount (section 31/32, same discipline as
   * coworkRoomService.subscribeToRoom). */
  subscribeToRoomStates(roomId: string, onChange: () => void): () => void {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};
    const channel = supabase
      .channel(`cowork_member_states:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cowork_member_states", filter: `room_id=eq.${roomId}` },
        onChange
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  },
};
