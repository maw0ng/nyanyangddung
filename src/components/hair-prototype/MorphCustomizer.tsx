"use client";

import { useState } from "react";
import { smallButtonStyle } from "./PaintToolControls";
import type { MorphCategoryUIState, UseAvatarMorphsResult } from "./useAvatarMorphs";
import type { MorphCategoryId } from "./morphConfig";

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

const categoryHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  cursor: "pointer",
  fontSize: 12,
  color: "#d6d9e0",
  fontWeight: 600,
  padding: "6px 0",
};

function CategoryBlock({
  category,
  expanded,
  onToggle,
  onDragStart,
  onChange,
  onReset,
}: {
  category: MorphCategoryUIState;
  expanded: boolean;
  onToggle: () => void;
  onDragStart: (names: string[]) => void;
  onChange: (name: string, value: number) => void;
  onReset: (categoryId: MorphCategoryId) => void;
}) {
  if (category.items.length === 0) return null;

  return (
    <div>
      <div style={categoryHeaderStyle} onClick={onToggle}>
        <span>
          {category.title} ({category.items.length}) {expanded ? "▾" : "▸"}
        </span>
        <button
          style={{ ...smallButtonStyle(false), flex: "none", padding: "3px 8px", fontSize: 11 }}
          onClick={(e) => {
            e.stopPropagation();
            onReset(category.id);
          }}
        >
          초기화
        </button>
      </div>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 6 }}>
          {category.items.map((item) => (
            <div key={item.morphName}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "#a8adb8",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 190,
                  }}
                  title={item.morphName}
                >
                  {item.label}
                </span>
                <span>{item.value.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={item.value}
                onPointerDown={() => onDragStart([item.morphName])}
                onChange={(e) => onChange(item.morphName, Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface MorphCustomizerProps {
  morphs: UseAvatarMorphsResult;
}

/** "이목구비" facial-feature Shape Key customizer. Only reachable through
 * useAvatarMorphs's API (onChange/onDragStart/onCategoryReset/onResetAll/
 * undo/redo) - never touches FacePaintSceneHandle or morphTargetInfluences
 * directly, so it can't drift from the raw "Body Morph" debug panel. */
export default function MorphCustomizer({ morphs }: MorphCustomizerProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<MorphCategoryId>>(
    () => new Set(["customEye"])
  );
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const toggleCategory = (id: MorphCategoryId) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const availableCategories = morphs.categories.filter((c) => c.items.length > 0);
  if (availableCategories.length === 0) return null;

  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div style={sectionTitleStyle}>이목구비 {expanded ? "▾" : "▸"}</div>
      </div>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <button
              style={{ ...smallButtonStyle(!morphs.historyStatus.canUndo), flex: 1 }}
              disabled={!morphs.historyStatus.canUndo}
              onClick={morphs.undo}
            >
              ↶ Undo
            </button>
            <button
              style={{ ...smallButtonStyle(!morphs.historyStatus.canRedo), flex: 1 }}
              disabled={!morphs.historyStatus.canRedo}
              onClick={morphs.redo}
            >
              ↷ Redo
            </button>
          </div>

          <div
            style={{
              maxHeight: 360,
              overflowY: "auto",
              paddingRight: 4,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {availableCategories.map((category) => (
              <CategoryBlock
                key={category.id}
                category={category}
                expanded={expandedCategories.has(category.id)}
                onToggle={() => toggleCategory(category.id)}
                onDragStart={morphs.onDragStart}
                onChange={morphs.onChange}
                onReset={morphs.onCategoryReset}
              />
            ))}
          </div>

          <button style={{ ...smallButtonStyle(false), marginTop: 4 }} onClick={morphs.onResetAll}>
            이목구비 전체 초기화
          </button>

          {process.env.NODE_ENV !== "production" && (
            <div style={{ marginTop: 6 }}>
              <div
                style={{ fontSize: 10, color: "#6b7280", cursor: "pointer" }}
                onClick={() => setShowDiagnostics((v) => !v)}
              >
                [개발용 진단] {showDiagnostics ? "▾" : "▸"}
              </div>
              {showDiagnostics && (
                <div style={{ fontSize: 10, color: "#6b7280", lineHeight: 1.6, marginTop: 4 }}>
                  Body mesh: {morphs.diagnostics.bodyMeshName ?? "-"}
                  <br />
                  Total morph targets: {morphs.diagnostics.totalMorphCount}
                  <br />
                  Custom Eye: {morphs.diagnostics.categoryCounts.customEye}
                  {morphs.diagnostics.missingCustomEyeNames.length > 0 && (
                    <> (missing: {morphs.diagnostics.missingCustomEyeNames.join(", ")})</>
                  )}
                  <br />
                  Eye: {morphs.diagnostics.categoryCounts.eye}
                  <br />
                  Pupil: {morphs.diagnostics.categoryCounts.pupil}
                  <br />
                  Brow: {morphs.diagnostics.categoryCounts.brow}
                  <br />
                  Mouth: {morphs.diagnostics.categoryCounts.mouth}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
