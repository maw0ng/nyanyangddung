"use client";

import { useState } from "react";
import { profileService } from "../../lib/supabase/profileService";
import { friendService } from "../../lib/supabase/friendService";
import type { PublicProfile } from "../../lib/supabase/database.types";
import * as s from "./friendsStyles";

/**
 * Friend-code search + send request (section 15/16/40). Search results
 * only ever show nickname/level (never email - profileService.
 * findByFriendCode's underlying query never selects it in the first
 * place, so there is nothing to accidentally leak here). Buttons disable
 * while a request is in flight so double-clicking can't fire it twice.
 */
export default function AddFriendPanel({
  myUserId,
  onRequestSent,
}: {
  myUserId: string;
  onRequestSent: () => void;
}) {
  const [code, setCode] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicProfile | null>(null);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searching || !code.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResult(null);
    setSendMessage(null);

    const res = await profileService.findByFriendCode(code);
    setSearching(false);
    if (!res.ok) {
      setSearchError(res.error);
      return;
    }
    if (!res.data) {
      setSearchError("사용자를 찾을 수 없습니다.");
      return;
    }
    if (res.data.id === myUserId) {
      setSearchError("자기 자신에게 친구 요청을 보낼 수 없습니다.");
      return;
    }
    setResult(res.data);
  }

  async function handleSendRequest() {
    if (!result || sending) return;
    setSending(true);
    setSendMessage(null);
    const res = await friendService.sendFriendRequest(result.friendCode);
    setSending(false);
    if (!res.ok) {
      setSendMessage(res.error);
      return;
    }
    setSendMessage("친구 요청을 보냈습니다.");
    setResult(null);
    setCode("");
    onRequestSent();
  }

  return (
    <div style={s.card}>
      <div style={s.sectionTitle}>친구 코드로 추가</div>
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 6 }}>
        <input
          style={{ ...s.input, marginBottom: 0, textTransform: "uppercase" }}
          placeholder="AB7K-4Q2M"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" disabled={searching || !code.trim()} style={s.button("default", searching || !code.trim())}>
          {searching ? "검색 중..." : "검색"}
        </button>
      </form>

      {searchError && <div style={s.errorText}>{searchError}</div>}

      {result && (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px",
            background: "#14161b",
            borderRadius: 6,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{result.nickname}</div>
            <div style={s.mutedText}>{`Lv.${result.level}`}</div>
          </div>
          <button type="button" disabled={sending} style={s.button("primary", sending)} onClick={handleSendRequest}>
            {sending ? "보내는 중..." : "친구 요청"}
          </button>
        </div>
      )}

      {sendMessage && <div style={{ ...s.mutedText, marginTop: 6, color: "#7fd490" }}>{sendMessage}</div>}
    </div>
  );
}
