"use client";

/**
 * Public-profile service layer (section 39). `upsertMyProfile` is the ONLY
 * write path from local growth data to Supabase - the direction is always
 * local -> Supabase (section 7/9), never the reverse; nothing in this file
 * (or anywhere else in the app) ever writes a Supabase-read level/exp back
 * into GrowthEngine/profileStorage.
 */
import { getSupabaseClient } from "./client";
import type { ProfilesPublicSelection, PublicProfile } from "./database.types";

export type ProfileResult<T> = { ok: true; data: T } | { ok: false; error: string };

const PUBLIC_COLUMNS = "id,nickname,friend_code,level,current_exp,required_exp";

function toUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  console.error("[profileService]", raw);
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function mapRow(row: ProfilesPublicSelection): PublicProfile {
  return {
    id: row.id,
    nickname: row.nickname,
    friendCode: row.friend_code,
    level: row.level,
    currentExp: row.current_exp,
    requiredExp: row.required_exp,
  };
}

export const profileService = {
  /** My own public profile (nickname/friend_code/level/exp) - used by the
   * Friends window's "내 프로필" card (section 14). Reads directly from
   * Supabase (the row the trigger created at signup), NOT from local
   * storage - local totalWorkMs/nickname stay the presentation source of
   * truth for the Desktop HUD itself (section 43), this is purely "what
   * does my account currently show friends". */
  async getMyProfile(userId: string): Promise<ProfileResult<PublicProfile | null>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: "계정 기능을 사용할 수 없습니다." };
    const { data, error } = await supabase
      .from("profiles")
      .select(PUBLIC_COLUMNS)
      .eq("id", userId)
      .maybeSingle()
      .returns<ProfilesPublicSelection>();
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: data ? mapRow(data) : null };
  },

  /**
   * Pushes the local Growth system's CURRENT nickname/level/exp up as a
   * cache/projection (section 7/30) - called from DesktopAvatarScene only
   * at the same meaningful checkpoints GrowthEngine's own onPersist
   * already fires at (nickname save, pause/autoPause/end commits, plus
   * once right after login) - never on a per-second tick. totalWorkMs
   * itself is never included in the payload (section 8).
   */
  async upsertMyProfile(
    userId: string,
    fields: { nickname: string; level: number; currentExp: number; requiredExp: number }
  ): Promise<ProfileResult<void>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: "계정 기능을 사용할 수 없습니다." };
    const { error } = await supabase
      .from("profiles")
      .update({
        nickname: fields.nickname,
        level: fields.level,
        current_exp: fields.currentExp,
        required_exp: fields.requiredExp,
      })
      .eq("id", userId);
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: undefined };
  },

  /** Friend-code search (section 15/16) - returns only public fields,
   * never email (the profiles table has no email column at all). Distinct
   * "not found" vs "error" so the UI can show "사용자를 찾을 수 없습니다."
   * specifically. */
  async findByFriendCode(code: string): Promise<ProfileResult<PublicProfile | null>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: "계정 기능을 사용할 수 없습니다." };
    const normalized = code.trim().toUpperCase();
    const { data, error } = await supabase
      .from("profiles")
      .select(PUBLIC_COLUMNS)
      .eq("friend_code", normalized)
      .maybeSingle()
      .returns<ProfilesPublicSelection>();
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: data ? mapRow(data) : null };
  },

  /** Batch fetch for the friends list (section 21) - one round trip for N
   * friend ids rather than N requests. */
  async getProfilesByIds(ids: string[]): Promise<ProfileResult<PublicProfile[]>> {
    if (ids.length === 0) return { ok: true, data: [] };
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: "계정 기능을 사용할 수 없습니다." };
    const { data, error } = await supabase
      .from("profiles")
      .select(PUBLIC_COLUMNS)
      .in("id", ids)
      .returns<ProfilesPublicSelection[]>();
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: (data ?? []).map(mapRow) };
  },
};
