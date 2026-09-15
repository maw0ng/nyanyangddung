"use client";

import { useState } from "react";
import { authService } from "../../lib/supabase/authService";
import { isSupabaseConfigured } from "../../lib/supabase/client";
import * as s from "./friendsStyles";

/**
 * Email+password login/signup (section 3/27/28) - the entry point shown
 * whenever the Friends window has no session yet, whether that's because
 * the user has never signed in or just clicked "로그인" from the "로그인이
 * 필요합니다" prompt. Success is picked up automatically by
 * useAuthSession's onAuthStateChange listener in the parent - this
 * component doesn't need to know where to navigate afterward.
 */
export default function AuthView() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedUp, setSignedUp] = useState(false);

  if (!isSupabaseConfigured()) {
    return (
      <div style={s.card}>
        <div style={{ fontSize: 13 }}>계정 기능을 사용할 수 없습니다.</div>
        <div style={s.mutedText}>Supabase 설정이 필요합니다 (.env.local).</div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result =
      mode === "signIn" ? await authService.signIn(email, password) : await authService.signUp(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (mode === "signUp") {
      setSignedUp(true);
    }
  }

  return (
    <div style={s.card}>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button
          type="button"
          style={{ ...s.button(mode === "signIn" ? "primary" : "default"), flex: 1 }}
          onClick={() => {
            setMode("signIn");
            setError(null);
            setSignedUp(false);
          }}
        >
          로그인
        </button>
        <button
          type="button"
          style={{ ...s.button(mode === "signUp" ? "primary" : "default"), flex: 1 }}
          onClick={() => {
            setMode("signUp");
            setError(null);
            setSignedUp(false);
          }}
        >
          회원가입
        </button>
      </div>

      {signedUp ? (
        <div style={{ fontSize: 13 }}>
          가입 확인 이메일을 보냈습니다. 받은 메일함을 확인한 뒤 로그인해주세요.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={s.mutedText}>이메일</div>
          <input
            style={s.input}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div style={s.mutedText}>비밀번호</div>
          <input
            style={s.input}
            type="password"
            required
            minLength={6}
            autoComplete={mode === "signIn" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div style={s.errorText}>{error}</div>}
          <button type="submit" disabled={busy} style={{ ...s.button("primary", busy), width: "100%", marginTop: 8 }}>
            {busy ? (mode === "signIn" ? "로그인 중..." : "가입 중...") : mode === "signIn" ? "로그인" : "회원가입"}
          </button>
        </form>
      )}
    </div>
  );
}
