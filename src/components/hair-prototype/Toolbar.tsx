"use client";

import type { EditMode } from "./types";

interface ToolbarProps {
  editMode: EditMode;
  onSelectRotate: () => void;
  onSelectHair: () => void;
  onSelectFace: () => void;
  onSelectTops: () => void;
  onSelectCosmetic: () => void;
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

function modeButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "10px 8px",
    borderRadius: 8,
    border: active ? "2px solid #3b82f6" : "1px solid #3a3f4b",
    background: active ? "#26314a" : "#20232b",
    color: active ? "#8fb8ff" : "#d6d9e0",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 13,
  };
}

export default function Toolbar({
  editMode,
  onSelectRotate,
  onSelectHair,
  onSelectFace,
  onSelectTops,
  onSelectCosmetic,
}: ToolbarProps) {
  return (
    <>
      <div>
        <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>
          3D Texture Painting Prototype
        </h2>
        <p style={{ fontSize: 12, color: "#8b93a3", margin: 0 }}>
          miniWaffle / Hair + Face + Tops
        </p>
      </div>

      <div>
        <div style={sectionTitleStyle}>모드</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            style={{ ...modeButtonStyle(editMode === "rotate"), flexBasis: "48%" }}
            onClick={onSelectRotate}
          >
            회전
          </button>
          <button
            style={{ ...modeButtonStyle(editMode === "hair"), flexBasis: "48%" }}
            onClick={onSelectHair}
          >
            머리
          </button>
          <button
            style={{ ...modeButtonStyle(editMode === "face"), flexBasis: "48%" }}
            onClick={onSelectFace}
          >
            얼굴
          </button>
          <button
            style={{ ...modeButtonStyle(editMode === "tops"), flexBasis: "48%" }}
            onClick={onSelectTops}
          >
            상의
          </button>
          <button
            style={{ ...modeButtonStyle(editMode === "cosmetic"), flexBasis: "48%" }}
            onClick={onSelectCosmetic}
          >
            액세서리
          </button>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#8b93a3", lineHeight: 1.6 }}>
        <div>1. 회전 모드에서 원하는 각도를 본다.</div>
        <div>2. 머리/얼굴/상의 모드로 바꿔 직접 그린다.</div>
        <div>3. 다시 회전해서 다른 면을 그린다.</div>
        <div>그림은 계속 유지됩니다.</div>
      </div>
    </>
  );
}
