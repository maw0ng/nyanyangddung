"use client";

import type { PaintTool } from "./types";

interface PaintToolControlsProps {
  tool: PaintTool;
  color: string;
  brushSize: number;
  minBrushSize: number;
  maxBrushSize: number;
  canUndo: boolean;
  canRedo: boolean;
  onSelectPen: () => void;
  onSelectEraser: () => void;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetToDefault: () => void;
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

function toolButtonStyle(active: boolean): React.CSSProperties {
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

export function smallButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "8px 8px",
    borderRadius: 8,
    border: "1px solid #3a3f4b",
    background: disabled ? "#181a20" : "#20232b",
    color: disabled ? "#4a4f5a" : "#d6d9e0",
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    fontSize: 12,
  };
}

export default function PaintToolControls({
  tool,
  color,
  brushSize,
  minBrushSize,
  maxBrushSize,
  canUndo,
  canRedo,
  onSelectPen,
  onSelectEraser,
  onColorChange,
  onBrushSizeChange,
  onUndo,
  onRedo,
  onResetToDefault,
}: PaintToolControlsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={sectionTitleStyle}>도구</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={toolButtonStyle(tool === "pen")} onClick={onSelectPen}>
            펜
          </button>
          <button
            style={toolButtonStyle(tool === "eraser")}
            onClick={onSelectEraser}
          >
            지우개
          </button>
        </div>
      </div>

      <div>
        <div style={sectionTitleStyle}>색상</div>
        <input
          type="color"
          value={color}
          onChange={(e) => onColorChange(e.target.value)}
          disabled={tool !== "pen"}
          style={{
            width: "100%",
            height: 40,
            border: "1px solid #3a3f4b",
            borderRadius: 6,
            background: "#20232b",
            padding: 2,
          }}
        />
      </div>

      <div>
        <div style={sectionTitleStyle}>브러시 크기: {brushSize}px</div>
        <input
          type="range"
          min={minBrushSize}
          max={maxBrushSize}
          value={brushSize}
          onChange={(e) => onBrushSizeChange(Number(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onUndo} disabled={!canUndo} style={smallButtonStyle(!canUndo)}>
          ↶ Undo
        </button>
        <button onClick={onRedo} disabled={!canRedo} style={smallButtonStyle(!canRedo)}>
          ↷ Redo
        </button>
      </div>

      <button
        onClick={onResetToDefault}
        style={{
          width: "100%",
          padding: "10px 8px",
          borderRadius: 8,
          border: "1px solid #7f1d1d",
          background: "#2a1414",
          color: "#f3a5a5",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        기본으로 초기화
      </button>
    </div>
  );
}
