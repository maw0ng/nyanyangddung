"use client";

import { useCallback, useEffect, useState } from "react";
import type { TrackedApp } from "./timerTypes";

function toTrackedApp(app: ForegroundAppInfo): TrackedApp {
  return {
    id: app.executablePath ?? app.processName,
    displayName: app.displayName,
    processName: app.processName,
    executablePath: app.executablePath ?? undefined,
  };
}

interface AppPickerPanelProps {
  selected: TrackedApp[];
  onChange: (apps: TrackedApp[]) => void;
}

/**
 * "측정할 프로그램" checkbox list (section 11/12) - multi-select from the
 * start (AppTrackingConfig.targetApps is always an array), deduped
 * one-per-app by the main process already (electron/foregroundApp.ts).
 * Section 44: outside Electron (window.desktopAPI absent) this shows an
 * explanatory message instead of crashing or silently doing nothing.
 */
export default function AppPickerPanel({ selected, onChange }: AppPickerPanelProps) {
  const [apps, setApps] = useState<ForegroundAppInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const available = typeof window !== "undefined" && !!window.desktopAPI?.getRunningApps;

  const refresh = useCallback(() => {
    if (!available) return;
    setLoading(true);
    window
      .desktopAPI!.getRunningApps()
      .then((list) => setApps(list))
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  }, [available]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!available) {
    return (
      <div style={{ fontSize: 11, color: "#9aa0aa", padding: "8px 4px" }}>
        프로그램 연동은 데스크톱 앱에서 사용할 수 있습니다.
      </div>
    );
  }

  function toggle(app: ForegroundAppInfo) {
    const tracked = toTrackedApp(app);
    const exists = selected.some((s) => s.id === tracked.id);
    onChange(exists ? selected.filter((s) => s.id !== tracked.id) : [...selected, tracked]);
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 4px 6px",
        }}
      >
        <span style={{ fontSize: 11, color: "#9aa0aa" }}>측정할 프로그램</span>
        <button
          type="button"
          onClick={refresh}
          style={{
            background: "transparent",
            border: "none",
            color: "#9ad1ff",
            fontSize: 11,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {loading ? "..." : "새로고침"}
        </button>
      </div>
      <div style={{ maxHeight: 160, overflowY: "auto" }}>
        {apps.length === 0 && !loading && (
          <div style={{ fontSize: 11, color: "#6b7078", padding: "4px" }}>
            실행 중인 프로그램을 찾을 수 없습니다.
          </div>
        )}
        {apps.map((app) => {
          const id = app.executablePath ?? app.processName;
          const checked = selected.some((s) => s.id === id);
          return (
            <label
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 4px",
                fontSize: 12,
                color: "#eef0f4",
                cursor: "pointer",
                borderRadius: 4,
              }}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(app)} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {app.displayName}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
