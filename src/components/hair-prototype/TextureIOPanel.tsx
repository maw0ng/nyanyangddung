"use client";

import { useRef, useState } from "react";
import type { TextureImportMode } from "./types";
import { validateImageSize } from "./textureIO";
import { smallButtonStyle } from "./PaintToolControls";

type LayerImportTarget = "active" | "new";

interface PendingUpload {
  file: File;
  mode: TextureImportMode;
  target: LayerImportTarget;
  width: number;
  height: number;
}

interface TextureIOPanelProps {
  label: string;
  hasOriginalTexture: boolean;
  recommendedSize: number | null;
  onDownloadUVGuide: () => void;
  onDownloadCurrentTexture: () => void;
  onDownloadPaintLayer: () => void;
  onDownloadActiveLayer: () => void;
  onUploadPNG: (file: File, mode: TextureImportMode, target: LayerImportTarget) => void;
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

export default function TextureIOPanel({
  label,
  hasOriginalTexture,
  recommendedSize,
  onDownloadUVGuide,
  onDownloadCurrentTexture,
  onDownloadPaintLayer,
  onDownloadActiveLayer,
  onUploadPNG,
}: TextureIOPanelProps) {
  const [uploadMode, setUploadMode] = useState<TextureImportMode>("paint-layer");
  // "새 레이어로 불러오기" is the default so an upload never silently
  // overwrites the user's existing work (section 28 of the brief).
  const [uploadTarget, setUploadTarget] = useState<LayerImportTarget>("new");
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFilePicked(file: File) {
    try {
      const bitmap = await createImageBitmap(file);
      const check = validateImageSize(
        { width: bitmap.width, height: bitmap.height },
        recommendedSize ?? bitmap.width,
        recommendedSize ?? bitmap.height
      );
      bitmap.close?.();
      if (!check.matchesExactly) {
        setPendingUpload({
          file,
          mode: uploadMode,
          target: uploadTarget,
          width: check.width,
          height: check.height,
        });
      } else {
        onUploadPNG(file, uploadMode, uploadTarget);
      }
    } catch {
      onUploadPNG(file, uploadMode, uploadTarget);
    }
  }

  return (
    <div>
      <div style={sectionTitleStyle}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button style={smallButtonStyle(false)} onClick={onDownloadUVGuide}>
          UV 가이드 PNG
        </button>
        <button style={smallButtonStyle(false)} onClick={onDownloadCurrentTexture}>
          현재 최종 텍스처 PNG
        </button>
        <button style={smallButtonStyle(false)} onClick={onDownloadPaintLayer}>
          그림 레이어 합성 PNG
        </button>
        <button style={smallButtonStyle(false)} onClick={onDownloadActiveLayer}>
          현재 선택 레이어 PNG
        </button>

        {hasOriginalTexture && (
          <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="radio"
                checked={uploadMode === "paint-layer"}
                onChange={() => setUploadMode("paint-layer")}
              />
              그림 레이어로
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="radio"
                checked={uploadMode === "full-texture"}
                onChange={() => setUploadMode("full-texture")}
              />
              전체 텍스처로
            </label>
          </div>
        )}
        {hasOriginalTexture && uploadMode === "full-texture" && (
          <div style={{ fontSize: 11, color: "#8b93a3" }}>
            전체 텍스처는 레이어 구조 없이 하나의 이미지로 가져옵니다. 가능하면
            그림 레이어 Import를 권장합니다.
          </div>
        )}

        {(!hasOriginalTexture || uploadMode === "paint-layer") && (
          <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="radio"
                checked={uploadTarget === "new"}
                onChange={() => setUploadTarget("new")}
              />
              새 레이어로
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="radio"
                checked={uploadTarget === "active"}
                onChange={() => setUploadTarget("active")}
              />
              현재 레이어에
            </label>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFilePicked(file);
            e.target.value = "";
          }}
        />
        <button
          style={smallButtonStyle(false)}
          onClick={() => fileInputRef.current?.click()}
        >
          PNG 업로드
        </button>

        {pendingUpload && (
          <div
            style={{
              fontSize: 11,
              color: "#f3d08a",
              background: "#2a2414",
              border: "1px solid #6b5a1f",
              borderRadius: 8,
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div>
              업로드: {pendingUpload.width}×{pendingUpload.height}
              {recommendedSize ? ` / 권장: ${recommendedSize}×${recommendedSize}` : ""}
              . 비율이 다르면 이미지가 늘어나 보일 수 있습니다.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                style={smallButtonStyle(false)}
                onClick={() => {
                  onUploadPNG(pendingUpload.file, pendingUpload.mode, pendingUpload.target);
                  setPendingUpload(null);
                }}
              >
                자동 맞춤으로 계속
              </button>
              <button style={smallButtonStyle(false)} onClick={() => setPendingUpload(null)}>
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
