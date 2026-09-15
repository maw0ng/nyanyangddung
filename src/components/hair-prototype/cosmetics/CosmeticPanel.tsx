"use client";

import { COSMETIC_REGISTRY, type CosmeticSlot } from "./cosmeticRegistry";

export type CosmeticSubMode = "transform" | "paint";
export type CosmeticGizmoMode = "translate" | "rotate" | "scale";

const cardStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  minWidth: 70,
  padding: "10px 6px",
  borderRadius: 8,
  border: active ? "2px solid #3b82f6" : "1px solid #3a3f4b",
  background: active ? "#26314a" : "#20232b",
  color: active ? "#8fb8ff" : "#d6d9e0",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 12,
  textAlign: "center",
});

const subTabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "8px 8px",
  borderRadius: 8,
  border: active ? "2px solid #3b82f6" : "1px solid #3a3f4b",
  background: active ? "#26314a" : "#20232b",
  color: active ? "#8fb8ff" : "#d6d9e0",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 12,
});

const gizmoButtonStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "8px 4px",
  borderRadius: 6,
  border: active ? "2px solid #7aa8ff" : "1px solid #3a3f4b",
  background: active ? "rgba(122,168,255,0.2)" : "#20232b",
  color: "#eef0f4",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 12,
});

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

/**
 * Accessory ("액세서리"/"귀") sidebar panel (section 3/5/7/8) - ear
 * selection cards, Transform/Paint sub-tab, and (in Transform sub-mode)
 * the W/E/R gizmo-mode buttons + "기본 위치로 초기화". Deliberately does
 * NOT include the actual paint controls/layer list here - those are the
 * EXISTING <PaintToolControls>/<LayerPanel> components, rendered directly
 * by HairPaintPrototype.tsx in Paint sub-mode exactly like Hair/Face/Tops
 * already do (section 10/12 - "기존 layer 기능을 그대로 지원", not a
 * second copy of that UI).
 */
export default function CosmeticPanel({
  slot,
  equippedId,
  onEquip,
  subMode,
  onSubModeChange,
  paintDisabledReason,
  gizmoMode,
  onGizmoModeChange,
  onResetTransform,
  headBoneMissing,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  slot: CosmeticSlot;
  equippedId: string | null;
  onEquip: (id: string | null) => void;
  subMode: CosmeticSubMode;
  onSubModeChange: (mode: CosmeticSubMode) => void;
  /** Non-null disables the "페인트" sub-tab with an explanatory reason
   * (section 10 - "장착된 액세서리가 있을 때만 활성화", section 23's "이
   * 액세서리는 페인팅할 수 없습니다"). */
  paintDisabledReason: string | null;
  gizmoMode: CosmeticGizmoMode;
  onGizmoModeChange: (mode: CosmeticGizmoMode) => void;
  onResetTransform: () => void;
  headBoneMissing: boolean;
  /** Transform-level undo/redo (section 9) - a dedicated small stack
   * (equip/transform actions), separate from the Paint sub-mode's own
   * per-material LayerStackEngine undo/redo (that one is exposed through
   * the existing PaintToolControls/LayerPanel at the Paint sub-mode call
   * site, not here). */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const options = COSMETIC_REGISTRY.filter((c) => c.slot === slot);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={sectionTitleStyle}>액세서리 - 귀</div>

      {headBoneMissing && (
        <div style={{ fontSize: 11, color: "#f3a5a5" }}>
          miniWaffle 모델에서 Head 본을 찾을 수 없어 액세서리를 장착할 수 없습니다.
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={cardStyle(!equippedId)} onClick={() => onEquip(null)} disabled={headBoneMissing}>
          없음
        </button>
        {options.map((opt) => (
          <button
            key={opt.id}
            style={cardStyle(equippedId === opt.id)}
            onClick={() => onEquip(opt.id)}
            disabled={headBoneMissing}
          >
            {opt.name}
          </button>
        ))}
      </div>

      {equippedId && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={subTabStyle(subMode === "transform")} onClick={() => onSubModeChange("transform")}>
              배치
            </button>
            <button
              style={{ ...subTabStyle(subMode === "paint"), opacity: paintDisabledReason ? 0.5 : 1 }}
              onClick={() => !paintDisabledReason && onSubModeChange("paint")}
              disabled={!!paintDisabledReason}
              title={paintDisabledReason ?? undefined}
            >
              페인트
            </button>
          </div>

          {subMode === "paint" && paintDisabledReason && (
            <div style={{ fontSize: 11, color: "#f3a5a5" }}>{paintDisabledReason}</div>
          )}

          {subMode === "transform" && (
            <>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={gizmoButtonStyle(gizmoMode === "translate")} onClick={() => onGizmoModeChange("translate")}>
                  이동 (W)
                </button>
                <button style={gizmoButtonStyle(gizmoMode === "rotate")} onClick={() => onGizmoModeChange("rotate")}>
                  회전 (E)
                </button>
                <button style={gizmoButtonStyle(gizmoMode === "scale")} onClick={() => onGizmoModeChange("scale")}>
                  크기 (R)
                </button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: 6,
                    border: "1px solid #3a3f4b",
                    background: "#20232b",
                    color: canUndo ? "#d6d9e0" : "#565b66",
                    cursor: canUndo ? "pointer" : "default",
                    fontSize: 12,
                  }}
                  onClick={onUndo}
                  disabled={!canUndo}
                >
                  실행 취소
                </button>
                <button
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: 6,
                    border: "1px solid #3a3f4b",
                    background: "#20232b",
                    color: canRedo ? "#d6d9e0" : "#565b66",
                    cursor: canRedo ? "pointer" : "default",
                    fontSize: 12,
                  }}
                  onClick={onRedo}
                  disabled={!canRedo}
                >
                  다시 실행
                </button>
              </div>
              <button
                style={{
                  padding: "8px",
                  borderRadius: 6,
                  border: "1px solid #3a3f4b",
                  background: "#20232b",
                  color: "#d6d9e0",
                  cursor: "pointer",
                  fontSize: 12,
                }}
                onClick={onResetTransform}
              >
                기본 위치로 초기화
              </button>
              <div style={{ fontSize: 11, color: "#8b93a3", lineHeight: 1.6 }}>
                3D 화면에서 귀를 클릭해 선택한 뒤 화살표/링/박스 핸들로 직접 이동·회전·크기를 조절하세요.
                빈 공간을 클릭하면 선택이 해제됩니다.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
