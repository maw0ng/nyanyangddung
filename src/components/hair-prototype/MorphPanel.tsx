"use client";

import { useState } from "react";
import { smallButtonStyle } from "./PaintToolControls";

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#8b93a3",
  marginBottom: 8,
};

interface MorphPanelProps {
  morphNames: string[];
  morphValues: Record<string, number>;
  onChange: (name: string, value: number) => void;
  onReset: () => void;
}

/**
 * Body morph target sliders. Reads/writes whatever names the GLB's own
 * morphTargetDictionary actually has at runtime - never a hardcoded list -
 * so this works unchanged if the model's shape keys are ever renamed.
 */
export default function MorphPanel({
  morphNames,
  morphValues,
  onChange,
  onReset,
}: MorphPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (morphNames.length === 0) return null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div style={sectionTitleStyle}>
          Body Morph ({morphNames.length}) {expanded ? "▾" : "▸"}
        </div>
      </div>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              maxHeight: 240,
              overflowY: "auto",
              paddingRight: 4,
            }}
          >
            {morphNames.map((name) => {
              const value = morphValues[name] ?? 0;
              return (
                <div key={name}>
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
                        maxWidth: 180,
                      }}
                      title={name}
                    >
                      {name}
                    </span>
                    <span>{Math.round(value * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={value}
                    onChange={(e) => onChange(name, Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </div>
              );
            })}
          </div>
          <button style={smallButtonStyle(false)} onClick={onReset}>
            Morph 기본값으로 초기화
          </button>
        </div>
      )}
    </div>
  );
}
