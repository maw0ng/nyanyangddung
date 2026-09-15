"use client";

/**
 * Auth service layer (section 39 - UI components never call
 * supabase.auth.* directly). Every method returns a plain
 * `{ok:true,...} | {ok:false, error}` result, matching this codebase's
 * existing convention (GrowthEngine.setNickname's
 * NicknameValidationResult) - `error` is always an already-Korean, user-
 * safe message (section 41), never a raw PostgrestError/AuthError.
 *
 * Session persistence itself is entirely Supabase's own (see client.ts) -
 * this file adds no separate token storage of its own (section 4).
 */
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "./client";

export type AuthResult = { ok: true } | { ok: false; error: string };

const NOT_CONFIGURED_ERROR = "계정 기능을 사용할 수 없습니다. Supabase 설정이 필요합니다.";

function toUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("invalid login credentials")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (lower.includes("user already registered") || lower.includes("already registered"))
    return "이미 가입된 이메일입니다.";
  if (lower.includes("password") && lower.includes("6"))
    return "비밀번호는 6자 이상이어야 합니다.";
  if (lower.includes("email") && lower.includes("invalid")) return "올바른 이메일 형식이 아닙니다.";
  if (lower.includes("email not confirmed")) return "이메일 인증이 필요합니다. 받은 메일함을 확인해주세요.";
  if (lower.includes("rate limit")) return "잠시 후 다시 시도해주세요.";
  if (lower.includes("fetch") || lower.includes("network")) return "네트워크 연결을 확인해주세요.";
  // Never leak the raw driver/DB error text to the UI (section 41) - dev
  // console still gets the original for debugging.
  console.error("[authService]", raw);
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

export const authService = {
  isAvailable(): boolean {
    return getSupabaseClient() !== null;
  },

  async signUp(email: string, password: string, nickname?: string): Promise<AuthResult> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED_ERROR };
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: nickname ? { data: { nickname } } : undefined,
    });
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true };
  },

  async signIn(email: string, password: string): Promise<AuthResult> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED_ERROR };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true };
  },

  /** Ends the network account session only - never touches
   * CharacterPreset/Timer/Profile/Desktop settings (section 10). */
  async signOut(): Promise<AuthResult> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: true }; // nothing to sign out of
    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true };
  },

  async getSession(): Promise<Session | null> {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error("[authService] getSession", error.message);
      return null;
    }
    return data.session;
  },

  /** Fires with the current session (or null) immediately, then again on
   * every auth state change (sign-in/out/token refresh) - including ones
   * that originate from ANOTHER window sharing the same origin/
   * localStorage (e.g. logging in from the Friends window while the
   * Desktop window is open), via supabase-js's own cross-tab storage
   * event listening. Returns an unsubscribe function. No-ops (never
   * calls back) if Supabase isn't configured. */
  onAuthStateChange(callback: (session: Session | null) => void): () => void {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session);
    });
    return () => data.subscription.unsubscribe();
  },
};
