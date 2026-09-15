"use client";

/**
 * Friend-request/friendship service layer (section 39). Every mutation
 * (send/accept/reject/cancel/remove) calls the corresponding RPC from
 * supabase/migrations/0001_friend_system.sql rather than doing raw
 * insert/update/delete - RLS blocks direct table mutation entirely (see
 * that migration's comments), so these RPCs are the only path, matching
 * this file 1:1 with the DB's own enforcement.
 */
import { getSupabaseClient } from "./client";
import type { FriendListItem, FriendRequestItem } from "./database.types";

interface RequestSenderRow {
  id: string;
  created_at: string;
  sender_id: string;
}
interface RequestReceiverRow {
  id: string;
  created_at: string;
  receiver_id: string;
}
interface FriendshipPairRow {
  user_a: string;
  user_b: string;
}
interface NicknameLevelRow {
  id: string;
  nickname: string;
  level: number;
}

export type FriendResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NOT_CONFIGURED = "계정 기능을 사용할 수 없습니다.";

function toUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();
  // RPC functions raise plain exception codes (see the migration) -
  // translate the ones the UI needs to distinguish; everything else falls
  // back to a generic message so no raw Postgres/PostgREST text ever
  // reaches the UI (section 41).
  if (msg.includes("user_not_found")) return "사용자를 찾을 수 없습니다.";
  if (msg.includes("cannot_friend_self")) return "자기 자신에게 친구 요청을 보낼 수 없습니다.";
  if (msg.includes("already_friends")) return "이미 친구입니다.";
  if (msg.includes("request_already_exists")) return "이미 친구 요청이 있습니다.";
  if (msg.includes("not_authorized")) return "권한이 없습니다.";
  if (msg.includes("request_not_pending")) return "이미 처리된 요청입니다.";
  if (msg.includes("request_not_found")) return "요청을 찾을 수 없습니다.";
  if (msg.includes("not_authenticated")) return "로그인이 필요합니다.";
  console.error("[friendService]", raw);
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

export const friendService = {
  async sendFriendRequest(friendCode: string): Promise<FriendResult<void>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { error } = await supabase.rpc("send_friend_request", { target_friend_code: friendCode });
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: undefined };
  },

  async acceptFriendRequest(requestId: string): Promise<FriendResult<void>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { error } = await supabase.rpc("accept_friend_request", { request_id: requestId });
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: undefined };
  },

  async rejectFriendRequest(requestId: string): Promise<FriendResult<void>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { error } = await supabase.rpc("reject_friend_request", { request_id: requestId });
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: undefined };
  },

  async cancelFriendRequest(requestId: string): Promise<FriendResult<void>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { error } = await supabase.rpc("cancel_friend_request", { request_id: requestId });
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: undefined };
  },

  async removeFriend(otherUserId: string): Promise<FriendResult<void>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { error } = await supabase.rpc("remove_friend", { other_user_id: otherUserId });
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: undefined };
  },

  /** Requests where I'm the receiver (section 19), joined with the
   * sender's public profile for display. Two-step query rather than a
   * PostgREST embedded-resource select - friend_requests.sender_id
   * references auth.users(id), not public.profiles(id) directly, so
   * PostgREST has no FK path to auto-embed profiles through (see the
   * migration); fetching the request rows and then batch-loading their
   * profiles via getProfilesByIds is simple and guaranteed correct. */
  async getIncomingRequests(myUserId: string): Promise<FriendResult<FriendRequestItem[]>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data, error } = await supabase
      .from("friend_requests")
      .select("id, created_at, sender_id")
      .eq("receiver_id", myUserId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .returns<RequestSenderRow[]>();
    if (error) return { ok: false, error: toUserMessage(error) };
    return resolveRequestProfiles(data ?? [], (row) => row.sender_id);
  },

  /** Requests I sent that are still pending (section 20). Same two-step
   * pattern as getIncomingRequests. */
  async getOutgoingRequests(myUserId: string): Promise<FriendResult<FriendRequestItem[]>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data, error } = await supabase
      .from("friend_requests")
      .select("id, created_at, receiver_id")
      .eq("sender_id", myUserId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .returns<RequestReceiverRow[]>();
    if (error) return { ok: false, error: toUserMessage(error) };
    return resolveRequestProfiles(data ?? [], (row) => row.receiver_id);
  },

  /** My current friends (section 21) - two-step query (friendships I'm
   * part of, then those users' public profiles) rather than a DB view,
   * since RLS already scopes both queries correctly and this stays simple
   * enough not to need one. */
  async getFriends(myUserId: string): Promise<FriendResult<FriendListItem[]>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data: rows, error } = await supabase
      .from("friendships")
      .select("user_a,user_b")
      .or(`user_a.eq.${myUserId},user_b.eq.${myUserId}`)
      .returns<FriendshipPairRow[]>();
    if (error) return { ok: false, error: toUserMessage(error) };

    const otherIds = (rows ?? []).map((r) => (r.user_a === myUserId ? r.user_b : r.user_a));
    if (otherIds.length === 0) return { ok: true, data: [] };

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id,nickname,level")
      .in("id", otherIds)
      .returns<NicknameLevelRow[]>();
    if (profileError) return { ok: false, error: toUserMessage(profileError) };

    return {
      ok: true,
      data: (profiles ?? []).map((p) => ({ userId: p.id, nickname: p.nickname, level: p.level })),
    };
  },
};

/** Batch-loads the OTHER party's public profile for a list of request
 * rows and zips them together - shared by getIncomingRequests (other
 * party = sender) and getOutgoingRequests (other party = receiver). A
 * request whose other-party profile can't be found (e.g. the account was
 * deleted - the FK's `on delete cascade` would also have removed the
 * request itself, but this stays defensive regardless) is simply omitted
 * rather than crashing the list. */
async function resolveRequestProfiles<Row extends { id: string; created_at: string }>(
  rows: Row[],
  otherUserId: (row: Row) => string
): Promise<FriendResult<FriendRequestItem[]>> {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED };
  if (rows.length === 0) return { ok: true, data: [] };

  const ids = rows.map(otherUserId);
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id,nickname,level")
    .in("id", ids)
    .returns<NicknameLevelRow[]>();
  if (error) return { ok: false, error: toUserMessage(error) };

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const items: FriendRequestItem[] = [];
  for (const row of rows) {
    const profile = byId.get(otherUserId(row));
    if (!profile) continue;
    items.push({
      requestId: row.id,
      createdAt: row.created_at,
      profile: { id: profile.id, nickname: profile.nickname, level: profile.level },
    });
  }
  return { ok: true, data: items };
}
