"use client";

import { useState } from "react";
import {
  RENDER_STYLE_PRESETS,
  RENDER_STYLE_PRESET_LABELS,
  type RenderStylePresetName,
  type ToonSettings,
} from "./toonStyle";
import { smallButtonStyle } from "./PaintToolControls";

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

const rowLabelStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 11,
  color: "#a8adb8",
};

interface ToonDebugPanelProps {
  settings: ToonSettings;
  onChange: (patch: Partial<ToonSettings>) => void;
}

export default function ToonDebugPanel({ settings, onChange }: ToonDebugPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div style={sectionTitleStyle}>Toon Style {expanded ? "▾" : "▸"}</div>
      </div>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#d6d9e0" }}>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
            />
            Toon
          </label>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(RENDER_STYLE_PRESETS) as RenderStylePresetName[]).map((name) => (
              <button
                key={name}
                style={{ ...smallButtonStyle(false), flex: "none", padding: "4px 8px", fontSize: 11 }}
                onClick={() => onChange(RENDER_STYLE_PRESETS[name])}
              >
                {RENDER_STYLE_PRESET_LABELS[name]}
              </button>
            ))}
          </div>

          <div>
            <div style={rowLabelStyle}>
              <span>Toon Strength (2D ↔ 3D)</span>
              <span>{Math.round(settings.strength * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.strength}
              disabled={!settings.enabled}
              onChange={(e) => onChange({ strength: Number(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <div style={rowLabelStyle}>
              <span>Shade Steps</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[2, 3].map((n) => (
                <button
                  key={n}
                  disabled={!settings.enabled}
                  style={{
                    ...smallButtonStyle(!settings.enabled),
                    flex: 1,
                    border:
                      settings.shadeSteps === n ? "2px solid #3b82f6" : smallButtonStyle(false).border,
                  }}
                  onClick={() => onChange({ shadeSteps: n as 2 | 3 })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={rowLabelStyle}>
              <span>Shadow</span>
              <span>{Math.round(settings.shadowStrength * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.shadowStrength}
              disabled={!settings.enabled}
              onChange={(e) => onChange({ shadowStrength: Number(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <div style={rowLabelStyle}>
              <span>Ambient</span>
              <span>{Math.round(settings.ambientStrength * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1.2}
              step={0.01}
              value={settings.ambientStrength}
              disabled={!settings.enabled}
              onChange={(e) => onChange({ ambientStrength: Number(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#d6d9e0" }}>
            <input
              type="checkbox"
              checked={settings.outlineEnabled}
              disabled={!settings.enabled}
              onChange={(e) => onChange({ outlineEnabled: e.target.checked })}
            />
            외곽선 (Outline)
          </label>
          <div style={{ fontSize: 10, color: "#6b7280" }}>
            HairCanvas(머리)에는 외곽선이 항상 적용되지 않습니다.
          </div>

          <div>
            <div style={rowLabelStyle}>
              <span>Outline Width</span>
              <span>{settings.outlineWidth.toFixed(3)}</span>
            </div>
            <input
              type="range"
              min={0.001}
              max={0.03}
              step={0.001}
              value={settings.outlineWidth}
              disabled={!settings.enabled || !settings.outlineEnabled}
              onChange={(e) => onChange({ outlineWidth: Number(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <div style={rowLabelStyle}>
              <span>Outline Strength</span>
              <span>{Math.round(settings.outlineStrength * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.outlineStrength}
              disabled={!settings.enabled || !settings.outlineEnabled}
              onChange={(e) => onChange({ outlineStrength: Number(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
