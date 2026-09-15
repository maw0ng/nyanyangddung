"use client";

import { useState } from "react";
import type { PublicProfile } from "../../lib/supabase/database.types";
import * as s from "./friendsStyles";

/** "내 프로필" card (section 14) - nickname/level + friend code with a
 * copy button. Read-only here; nickname itself is still edited only from
 * the Desktop floating menu's existing "닉네임 변경" (section 43 - this
 * window never adds a second nickname-editing UI), and syncs here
 * automatically via profileService.upsertMyProfile. */
export default function MyProfileCard({ profile }: { profile: PublicProfile | null }) {
  const [copied, setCopied] = useState(false);

  if (!profile) {
    return (
      <div style={s.card}>
        <div style={s.sectionTitle}>내 프로필</div>
        <div style={s.mutedText}>불러오는 중...</div>
      </div>
    );
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(profile!.friendCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable/denied - non-fatal, the code is still
      // visible on screen to copy by hand.
    }
  }

  return (
    <div style={s.card}>
      <div style={s.sectionTitle}>내 프로필</div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{profile.nickname}</div>
        <div style={{ fontSize: 13, color: "#8fb8ff" }}>{`Lv.${profile.level}`}</div>
      </div>
      <div style={{ marginTop: 10, ...s.mutedText }}>친구 코드</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 15,
            letterSpacing: 1,
            padding: "6px 10px",
            background: "#14161b",
            border: "1px solid #3a3f4b",
            borderRadius: 6,
            flex: 1,
          }}
        >
          {profile.friendCode}
        </div>
        <button type="button" style={s.button()} onClick={handleCopy}>
          {copied ? "복사됨 ✓" : "복사"}
        </button>
      </div>
    </div>
  );
}
