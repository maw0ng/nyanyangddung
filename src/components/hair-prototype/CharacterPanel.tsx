"use client";

import { useEffect, useState } from "react";
import type { CharacterSummary } from "./characterPresetStorage";
import { smallButtonStyle } from "./PaintToolControls";

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "#14161b",
  border: "1px solid #3a3f4b",
  borderRadius: 6,
  color: "#eef0f4",
  padding: "6px 8px",
  fontSize: 12,
};

function CharacterThumbnail({ blob, name }: { blob: Blob | null; name: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "1 / 1",
        borderRadius: 6,
        background: "#14161b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ fontSize: 11, color: "#4a4f5a" }}>썸네일 없음</span>
      )}
    </div>
  );
}

function NamePrompt({
  initial,
  placeholder,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  confirmLabel: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const trimmed = draft.trim();
            if (trimmed) onConfirm(trimmed);
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        style={inputStyle}
      />
      <button
        style={{ ...smallButtonStyle(false), flex: "none", padding: "6px 10px" }}
        onClick={() => {
          const trimmed = draft.trim();
          if (trimmed) onConfirm(trimmed);
        }}
      >
        {confirmLabel}
      </button>
      <button
        style={{ ...smallButtonStyle(false), flex: "none", padding: "6px 10px" }}
        onClick={onCancel}
      >
        취소
      </button>
    </div>
  );
}

const SAVE_STATUS_LABEL: Record<string, string> = {
  idle: "",
  unsaved: "저장되지 않은 변경사항",
  saving: "저장 중...",
  saved: "저장됨 ✓",
  error: "자동 저장 실패 - 수동으로 저장해주세요",
};

const SAVE_STATUS_COLOR: Record<string, string> = {
  idle: "#8b93a3",
  unsaved: "#f3d08a",
  saving: "#8fb8ff",
  saved: "#7fd490",
  error: "#f3a5a5",
};

export interface CharacterPanelProps {
  characters: CharacterSummary[];
  activeCharacterId: string | null;
  saveStatus: "idle" | "unsaved" | "saving" | "saved" | "error";
  pendingSwitch: { id: string; name: string } | null;
  onSelectCharacter: (id: string) => void;
  onConfirmSaveAndSwitch: () => void;
  onConfirmDiscardAndSwitch: () => void;
  onCancelSwitch: () => void;
  onCreateNew: (name: string) => void;
  onSaveCurrent: () => void;
  onSaveAsNew: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function CharacterPanel({
  characters,
  activeCharacterId,
  saveStatus,
  pendingSwitch,
  onSelectCharacter,
  onConfirmSaveAndSwitch,
  onConfirmDiscardAndSwitch,
  onCancelSwitch,
  onCreateNew,
  onSaveCurrent,
  onSaveAsNew,
  onRename,
  onDuplicate,
  onDelete,
}: CharacterPanelProps) {
  const [creating, setCreating] = useState(false);
  const [savingAsNew, setSavingAsNew] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const activeCharacter = characters.find((c) => c.id === activeCharacterId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={sectionTitleStyle}>내 캐릭터</div>

      {pendingSwitch && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            background: "#2a2414",
            border: "1px solid #6b5a1f",
            borderRadius: 8,
            padding: 8,
            fontSize: 12,
            color: "#f3d08a",
          }}
        >
          <div>저장하지 않은 변경사항이 있습니다.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={smallButtonStyle(false)} onClick={onConfirmSaveAndSwitch}>
              저장하고 전환
            </button>
            <button style={smallButtonStyle(false)} onClick={onConfirmDiscardAndSwitch}>
              저장하지 않고 전환
            </button>
            <button style={smallButtonStyle(false)} onClick={onCancelSwitch}>
              취소
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        {characters.map((c) => {
          const active = c.id === activeCharacterId;
          return (
            <div
              key={c.id}
              onClick={() => onSelectCharacter(c.id)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: 6,
                borderRadius: 8,
                border: active ? "2px solid #3b82f6" : "1px solid #3a3f4b",
                background: active ? "#26314a" : "#20232b",
                cursor: "pointer",
              }}
            >
              <CharacterThumbnail blob={c.thumbnail} name={c.name} />
              {renamingId === c.id ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <NamePrompt
                    initial={c.name}
                    placeholder="캐릭터 이름"
                    confirmLabel="저장"
                    onConfirm={(name) => {
                      onRename(c.id, name);
                      setRenamingId(null);
                    }}
                    onCancel={() => setRenamingId(null)}
                  />
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    color: active ? "#8fb8ff" : "#d6d9e0",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={c.name}
                >
                  {c.name} {active ? "· 선택됨 ✓" : ""}
                </div>
              )}
              <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                <button
                  title="이름 변경"
                  style={{ ...smallButtonStyle(false), flex: 1, padding: "4px 6px", fontSize: 11 }}
                  onClick={() => setRenamingId(c.id)}
                >
                  ✎
                </button>
                <button
                  title="복제"
                  style={{ ...smallButtonStyle(false), flex: 1, padding: "4px 6px", fontSize: 11 }}
                  onClick={() => onDuplicate(c.id)}
                >
                  복제
                </button>
                <button
                  title="삭제"
                  style={{
                    ...smallButtonStyle(false),
                    flex: 1,
                    padding: "4px 6px",
                    fontSize: 11,
                    color: "#f3a5a5",
                    borderColor: "#7f1d1d",
                  }}
                  onClick={() => onDelete(c.id)}
                >
                  삭제
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {creating ? (
        <NamePrompt
          initial={`캐릭터 ${characters.length + 1}`}
          placeholder="새 캐릭터 이름"
          confirmLabel="생성"
          onConfirm={(name) => {
            onCreateNew(name);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button style={smallButtonStyle(false)} onClick={() => setCreating(true)}>
          + 새 캐릭터
        </button>
      )}

      <div style={{ borderTop: "1px solid #2a2e38", paddingTop: 10 }}>
        <div style={{ fontSize: 12, color: "#d6d9e0", marginBottom: 4 }}>
          현재 캐릭터: {activeCharacter?.name ?? "-"}
        </div>
        <div
          style={{
            fontSize: 11,
            color: SAVE_STATUS_COLOR[saveStatus],
            marginBottom: 8,
          }}
        >
          {SAVE_STATUS_LABEL[saveStatus]}
        </div>

        {savingAsNew ? (
          <NamePrompt
            initial={activeCharacter ? `${activeCharacter.name} 2` : "새 이름"}
            placeholder="다른 이름으로 저장"
            confirmLabel="저장"
            onConfirm={(name) => {
              onSaveAsNew(name);
              setSavingAsNew(false);
            }}
            onCancel={() => setSavingAsNew(false)}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={smallButtonStyle(!activeCharacter)} disabled={!activeCharacter} onClick={onSaveCurrent}>
                저장
              </button>
              <button style={smallButtonStyle(false)} onClick={() => setSavingAsNew(true)}>
                다른 이름으로 저장
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
