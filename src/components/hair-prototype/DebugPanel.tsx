"use client";

import { useState } from "react";
import type {
  DebugInfo,
  EditMode,
  FaceDebugInfo,
  HistoryStatus,
  TopsDebugInfo,
} from "./types";

interface DebugPanelProps {
  debugInfo: DebugInfo;
  faceDebugInfo: FaceDebugInfo;
  topsDebugInfo: TopsDebugInfo;
  editMode: EditMode;
  brushSize: number;
  historyStatus: HistoryStatus;
}

const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  width: 270,
  padding: 12,
  borderRadius: 8,
  background: "rgba(15, 17, 22, 0.85)",
  border: "1px solid #2a2e38",
  color: "#d6d9e0",
  fontFamily: "monospace",
  fontSize: 12,
  lineHeight: 1.7,
  pointerEvents: "none",
  maxHeight: "calc(100vh - 64px)",
  overflowY: "auto",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ color: "#8b93a3" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 8,
        borderTop: "1px solid #2a2e38",
        paddingTop: 6,
        fontWeight: 700,
        color: "#eef0f4",
      }}
    >
      {children}
    </div>
  );
}

function boolText(v: boolean) {
  return v ? "YES" : "NO";
}

export default function DebugPanel({
  debugInfo,
  faceDebugInfo,
  topsDebugInfo,
  editMode,
  brushSize,
  historyStatus,
}: DebugPanelProps) {
  const [visible, setVisible] = useState(true);

  return (
    <div style={{ position: "absolute", top: 16, right: 16 }}>
      <button
        onClick={() => setVisible((v) => !v)}
        style={{
          pointerEvents: "auto",
          marginBottom: 6,
          float: "right",
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 6,
          border: "1px solid #2a2e38",
          background: "rgba(15, 17, 22, 0.85)",
          color: "#8b93a3",
          cursor: "pointer",
        }}
      >
        {visible ? "Debug 숨기기" : "Debug 보기"}
      </button>
      {visible && (
        <div style={{ ...panelStyle, position: "static", width: 270 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "#eef0f4" }}>
            DEBUG
          </div>
          <Row label="Current Mode" value={editMode} />
          <Row label="Brush size" value={`${brushSize}px`} />
          <Row label="Undo count" value={historyStatus.canUndo ? ">0" : 0} />
          <Row label="Redo count" value={historyStatus.canRedo ? ">0" : 0} />

          <SectionTitle>HAIR</SectionTitle>
          <Row
            label="HairCanvas found"
            value={boolText(debugInfo.hairCanvasFound)}
          />
          <Row label="HairCanvas type" value={debugInfo.hairCanvasType ?? "-"} />
          <Row label="Has UV" value={boolText(debugInfo.hasUV)} />
          <Row label="Is SkinnedMesh" value={boolText(debugInfo.isSkinnedMesh)} />
          {editMode === "hair" ? (
            debugInfo.raycastOk && debugInfo.uv ? (
              <>
                <Row label="Raycast" value="OK" />
                <Row label="U" value={debugInfo.uv.u.toFixed(3)} />
                <Row label="V" value={debugInfo.uv.v.toFixed(3)} />
              </>
            ) : (
              <Row label="Raycast" value="MISS" />
            )
          ) : (
            <Row label="Raycast" value="N/A" />
          )}

          <SectionTitle>FACE</SectionTitle>
          <Row label="Body found" value={boolText(faceDebugInfo.bodyFound)} />
          <Row label="Body type" value={faceDebugInfo.bodyNodeType ?? "-"} />
          <Row
            label="Morph Targets"
            value={faceDebugInfo.morphTargetCount ?? "-"}
          />
          <Row
            label="Base texture"
            value={
              faceDebugInfo.basePaintCanvasReady
                ? `READY (${faceDebugInfo.baseTextureSize ?? "?"}px)`
                : "ERROR"
            }
          />
          <Row
            label="Eye texture"
            value={
              faceDebugInfo.eyePaintCanvasReady
                ? `READY (${faceDebugInfo.eyeTextureSize ?? "?"}px)`
                : "ERROR"
            }
          />
          {editMode === "face" ? (
            <>
              <Row
                label="Raycast hit"
                value={boolText(faceDebugInfo.raycastOk)}
              />
              <Row label="Mesh" value={faceDebugInfo.hitMeshName ?? "-"} />
              <Row
                label="Material"
                value={faceDebugInfo.hitMaterialName ?? "-"}
              />
              <Row
                label="Material Index"
                value={faceDebugInfo.hitMaterialIndex ?? "-"}
              />
              <Row label="U" value={faceDebugInfo.uv?.u.toFixed(3) ?? "-"} />
              <Row label="V" value={faceDebugInfo.uv?.v.toFixed(3) ?? "-"} />
              <Row
                label="Current target"
                value={
                  faceDebugInfo.hitLayer
                    ? faceDebugInfo.hitLayer.toUpperCase()
                    : "NONE"
                }
              />
            </>
          ) : (
            <Row label="Raycast" value="N/A" />
          )}

          <SectionTitle>TOPS</SectionTitle>
          <Row label="Tops found" value={boolText(topsDebugInfo.topsFound)} />
          <Row label="Tops type" value={topsDebugInfo.topsMeshType ?? "-"} />
          <Row
            label="Materials"
            value={
              topsDebugInfo.materialNames.length > 0
                ? topsDebugInfo.materialNames.join(", ")
                : "-"
            }
          />
          <Row
            label="Texture"
            value={
              topsDebugInfo.paintCanvasReady
                ? `READY (${topsDebugInfo.textureWidth ?? "?"}px)`
                : "ERROR"
            }
          />
          {editMode === "tops" ? (
            topsDebugInfo.raycastOk && topsDebugInfo.uv ? (
              <>
                <Row label="Raycast" value="OK" />
                <Row
                  label="Material"
                  value={topsDebugInfo.activeMaterial ?? "-"}
                />
                <Row label="U" value={topsDebugInfo.uv.u.toFixed(3)} />
                <Row label="V" value={topsDebugInfo.uv.v.toFixed(3)} />
              </>
            ) : (
              <Row label="Raycast" value="MISS" />
            )
          ) : (
            <Row label="Raycast" value="N/A" />
          )}
        </div>
      )}
    </div>
  );
}
