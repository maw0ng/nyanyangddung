"use client";

import { useRef, useState } from "react";
import type { LayerSummary } from "./layerStackEngine";
import { smallButtonStyle } from "./PaintToolControls";

interface LayerPanelProps {
  layers: LayerSummary[]; // bottom -> top (matches render order on the mesh)
  activeLayerId: string;
  maxLayers: number;
  onSelectLayer: (id: string) => void;
  onCreateLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onDuplicateLayer: (id: string) => void;
  onRenameLayer: (id: string, name: string) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onToggleLocked: (id: string, locked: boolean) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onReorder: (orderedIdsBottomToTop: string[]) => void;
  onOpacityDragStart: (id: string) => void;
  onOpacityChange: (id: string, value: number) => void;
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

export default function LayerPanel({
  layers,
  activeLayerId,
  maxLayers,
  onSelectLayer,
  onCreateLayer,
  onDeleteLayer,
  onDuplicateLayer,
  onRenameLayer,
  onToggleVisible,
  onToggleLocked,
  onMoveUp,
  onMoveDown,
  onReorder,
  onOpacityDragStart,
  onOpacityChange,
}: LayerPanelProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Photoshop-style display: topmost layer (drawn last, on top) first.
  const visual = [...layers].reverse();
  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const atMax = layers.length >= maxLayers;

  function commitDrop(targetVisualIndex: number) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (from === null || from === targetVisualIndex) return;
    const reordered = [...visual];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(targetVisualIndex, 0, moved);
    // visual is top->bottom; engine wants bottom->top.
    onReorder(reordered.slice().reverse().map((l) => l.id));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={sectionTitleStyle}>레이어 ({layers.length}/{maxLayers})</div>

      <button
        onClick={onCreateLayer}
        disabled={atMax}
        style={smallButtonStyle(atMax)}
        title={atMax ? `레이어는 최대 ${maxLayers}개까지 만들 수 있습니다.` : undefined}
      >
        + 새 레이어
      </button>
      {atMax && (
        <div style={{ fontSize: 11, color: "#f3a5a5" }}>
          레이어는 최대 {maxLayers}개까지 만들 수 있습니다.
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxHeight: 260,
          overflowY: "auto",
          border: "1px solid #2a2e38",
          borderRadius: 8,
          padding: 6,
          background: "#14161b",
        }}
      >
        {visual.map((layer, visualIdx) => {
          const active = layer.id === activeLayerId;
          const isRenaming = renamingId === layer.id;
          return (
            <div
              key={layer.id}
              draggable
              onDragStart={() => {
                dragIndexRef.current = visualIdx;
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverIndex(visualIdx);
              }}
              onDrop={(e) => {
                e.preventDefault();
                commitDrop(visualIdx);
              }}
              onDragEnd={() => {
                dragIndexRef.current = null;
                setDragOverIndex(null);
              }}
              onClick={() => onSelectLayer(layer.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 6px",
                borderRadius: 6,
                cursor: "pointer",
                background: active ? "#26314a" : "transparent",
                border:
                  dragOverIndex === visualIdx
                    ? "1px dashed #3b82f6"
                    : "1px solid transparent",
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisible(layer.id, !layer.visible);
                }}
                title={layer.visible ? "숨기기" : "표시"}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  width: 20,
                  opacity: layer.visible ? 1 : 0.35,
                  color: "#d6d9e0",
                }}
              >
                👁
              </button>

              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  flexShrink: 0,
                  background: layer.thumbnail
                    ? `url(${layer.thumbnail}) center / cover, repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 8px 8px`
                    : "repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50% / 8px 8px",
                  border: "1px solid #3a3f4b",
                }}
              />

              {isRenaming ? (
                <input
                  autoFocus
                  value={draft}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    if (draft.trim()) onRenameLayer(layer.id, draft.trim());
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (draft.trim()) onRenameLayer(layer.id, draft.trim());
                      setRenamingId(null);
                    } else if (e.key === "Escape") {
                      setRenamingId(null);
                    }
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "#0e0f13",
                    border: "1px solid #3a3f4b",
                    borderRadius: 4,
                    color: "#eef0f4",
                    padding: "3px 6px",
                    fontSize: 12,
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setDraft(layer.name);
                    setRenamingId(layer.id);
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 13,
                    color: active ? "#8fb8ff" : "#d6d9e0",
                  }}
                  title="더블클릭으로 이름 변경"
                >
                  {layer.name}
                </span>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLocked(layer.id, !layer.locked);
                }}
                title={layer.locked ? "잠금 해제" : "잠그기"}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  width: 18,
                  opacity: layer.locked ? 1 : 0.3,
                  color: "#d6d9e0",
                }}
              >
                🔒
              </button>
            </div>
          );
        })}
      </div>

      {activeLayer && (
        <>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              style={smallButtonStyle(false)}
              onClick={() => onDuplicateLayer(activeLayer.id)}
              disabled={atMax}
            >
              복제
            </button>
            <button
              style={smallButtonStyle(false)}
              onClick={() => onDeleteLayer(activeLayer.id)}
            >
              삭제
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={smallButtonStyle(false)} onClick={() => onMoveUp(activeLayer.id)}>
              위로
            </button>
            <button style={smallButtonStyle(false)} onClick={() => onMoveDown(activeLayer.id)}>
              아래로
            </button>
          </div>

          <div>
            <div style={sectionTitleStyle}>
              투명도: {Math.round(activeLayer.opacity * 100)}%
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(activeLayer.opacity * 100)}
              onPointerDown={() => onOpacityDragStart(activeLayer.id)}
              onChange={(e) => onOpacityChange(activeLayer.id, Number(e.target.value) / 100)}
              style={{ width: "100%" }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={activeLayer.locked}
              onChange={() => onToggleLocked(activeLayer.id, !activeLayer.locked)}
            />
            잠금
          </label>
          {activeLayer.locked && (
            <div style={{ fontSize: 11, color: "#f3a5a5" }}>잠긴 레이어입니다.</div>
          )}
        </>
      )}
    </div>
  );
}
