"use client";

import { useState } from "react";
import type { PresetMeta } from "./genericPresetStore";
import { smallButtonStyle } from "./PaintToolControls";

const DEFAULT_ID = "__default__";

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

function PresetRow({
  preset,
  active,
  onApply,
  onRename,
  onDelete,
}: {
  preset: PresetMeta;
  active: boolean;
  onApply: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(preset.name);
  const isDefault = preset.id === DEFAULT_ID;

  if (renaming) {
    return (
      <div style={{ display: "flex", gap: 4 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ ...inputStyle, fontSize: 12, padding: "4px 6px" }}
        />
        <button
          onClick={() => {
            const trimmed = draft.trim();
            if (trimmed) onRename(trimmed);
            setRenaming(false);
          }}
          style={{ ...smallButtonStyle(false), flex: "none", padding: "4px 8px" }}
        >
          저장
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <button
        onClick={onApply}
        style={{
          flex: 1,
          textAlign: "left",
          padding: "8px 10px",
          borderRadius: 8,
          border: active ? "2px solid #3b82f6" : "1px solid #3a3f4b",
          background: active ? "#26314a" : "#20232b",
          color: active ? "#8fb8ff" : "#d6d9e0",
          cursor: "pointer",
          fontSize: 13,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={preset.name}
      >
        {preset.name}
      </button>
      {!isDefault && (
        <>
          <button
            onClick={() => {
              setDraft(preset.name);
              setRenaming(true);
            }}
            title="이름 변경"
            style={{ ...smallButtonStyle(false), flex: "none", padding: "6px 8px" }}
          >
            ✎
          </button>
          <button
            onClick={onDelete}
            title="삭제"
            style={{
              ...smallButtonStyle(false),
              flex: "none",
              padding: "6px 8px",
              color: "#f3a5a5",
              borderColor: "#7f1d1d",
            }}
          >
            ✕
          </button>
        </>
      )}
    </div>
  );
}

interface PresetPanelProps {
  presets: PresetMeta[];
  activePresetId: string | null;
  onSaveAsNew: (name: string) => void;
  onOverwriteById: (id: string) => void;
  onOverwriteActive: () => void;
  onApplyPreset: (id: string) => void;
  onRenamePreset: (id: string, name: string) => void;
  onDeletePreset: (id: string) => void;
}

export default function PresetPanel({
  presets,
  activePresetId,
  onSaveAsNew,
  onOverwriteById,
  onOverwriteActive,
  onApplyPreset,
  onRenamePreset,
  onDeletePreset,
}: PresetPanelProps) {
  const [newPresetName, setNewPresetName] = useState("");
  const [nameCollision, setNameCollision] = useState<{
    name: string;
    existingId: string;
    isDefault: boolean;
  } | null>(null);

  const activePreset = presets.find((p) => p.id === activePresetId) ?? null;
  const canOverwriteActive = !!activePreset && activePreset.id !== DEFAULT_ID;

  function handleSaveClick() {
    const trimmed = newPresetName.trim();
    if (!trimmed) return;
    const collision = presets.find((p) => p.name === trimmed);
    if (collision) {
      setNameCollision({
        name: trimmed,
        existingId: collision.id,
        isDefault: collision.id === DEFAULT_ID,
      });
      return;
    }
    onSaveAsNew(trimmed);
    setNewPresetName("");
  }

  return (
    <>
      <div>
        <div style={sectionTitleStyle}>프리셋 저장</div>
        {nameCollision ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              background: "#20232b",
              border: "1px solid #3a3f4b",
              borderRadius: 8,
              padding: 8,
              fontSize: 12,
            }}
          >
            <div>&quot;{nameCollision.name}&quot; 이름의 프리셋이 이미 있습니다.</div>
            <div style={{ display: "flex", gap: 6 }}>
              {!nameCollision.isDefault && (
                <button
                  style={smallButtonStyle(false)}
                  onClick={() => {
                    onOverwriteById(nameCollision.existingId);
                    setNameCollision(null);
                    setNewPresetName("");
                  }}
                >
                  덮어쓰기
                </button>
              )}
              <button
                style={smallButtonStyle(false)}
                onClick={() => setNameCollision(null)}
              >
                새 이름으로
              </button>
              <button
                style={smallButtonStyle(false)}
                onClick={() => {
                  setNameCollision(null);
                  setNewPresetName("");
                }}
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="새 이름으로 저장"
                style={inputStyle}
              />
              <button
                onClick={handleSaveClick}
                style={{ ...smallButtonStyle(false), flex: "none", padding: "6px 10px" }}
              >
                저장
              </button>
            </div>
            <button
              onClick={onOverwriteActive}
              disabled={!canOverwriteActive}
              style={smallButtonStyle(!canOverwriteActive)}
              title={
                canOverwriteActive
                  ? `현재 프리셋(${activePreset?.name})에 덮어쓰기`
                  : "적용된 프리셋이 없어 덮어쓸 수 없습니다"
              }
            >
              현재 프리셋 덮어쓰기
            </button>
          </div>
        )}
      </div>

      <div>
        <div style={sectionTitleStyle}>프리셋 목록</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {presets.map((preset) => (
            <PresetRow
              key={preset.id}
              preset={preset}
              active={preset.id === activePresetId}
              onApply={() => onApplyPreset(preset.id)}
              onRename={(name) => onRenamePreset(preset.id, name)}
              onDelete={() => onDeletePreset(preset.id)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
