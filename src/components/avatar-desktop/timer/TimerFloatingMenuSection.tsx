"use client";

import { useEffect, useReducer, useState } from "react";
import type { TimerEngine, TimerSnapshot } from "./TimerEngine";
import type { TrackedApp } from "./timerTypes";
import { formatElapsed, statusLabel } from "./timerFormat";
import { TIMER_HUD_TICK_INTERVAL_MS } from "./timerHudConfig";
import AppPickerPanel from "./AppPickerPanel";

type Step = "entry" | "modeSelect" | "manualSetup" | "appTrackingSetup";

const rowButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "7px 0",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "#eef0f4",
  fontSize: 12,
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  ...rowButtonStyle,
  background: "rgba(122,168,255,0.25)",
  border: "1px solid rgba(122,168,255,0.5)",
};

const titleInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "#eef0f4",
  fontSize: 12,
  marginBottom: 8,
};

interface TimerFloatingMenuSectionProps {
  engine: TimerEngine;
  snapshot: TimerSnapshot;
  /** True while the floating menu is open - used only to reset this
   * section's own local wizard step back to a clean default when the menu
   * closes/reopens (section 25: the TIMER itself must never be reset by
   * this - only which sub-screen is shown). */
  open: boolean;
}

/**
 * The timer-owning portion of the floating menu (section 24/26) - kept in
 * its own file/component rather than folded into DesktopMenu.tsx, so timer
 * UI logic never grows into "one giant file" the brief explicitly warns
 * against. Purely a thin view over TimerEngine: every action here calls an
 * engine method (startManual/startAppTracking/pause/resume/end) and never
 * mutates timer state itself - TimerEngine keeps running/ticking/
 * persisting/polling regardless of whether this component (or the whole
 * menu) is even mounted (section 25).
 */
export default function TimerFloatingMenuSection({
  engine,
  snapshot,
  open,
}: TimerFloatingMenuSectionProps) {
  const [step, setStep] = useState<Step>("entry");
  const [title, setTitle] = useState("");
  const [pickedApps, setPickedApps] = useState<TrackedApp[]>([]);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  // Ticks this section's own displayed time while it's visible and the
  // timer is running, the same locally-scoped way TimerHUD does - so a
  // viewer who has both the HUD and this detail view open at once never
  // sees two different numbers for the same running timer (section 35's
  // "single source of truth" extends to every simultaneous display of the
  // same status, not just HUD-vs-animation).
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (snapshot.status !== "running") return;
    const id = setInterval(tick, TIMER_HUD_TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [snapshot.status]);

  useEffect(() => {
    if (!open) {
      setStep("entry");
      setTitle("");
      setPickedApps([]);
      setConfirmingEnd(false);
    }
  }, [open]);

  if (snapshot.status !== "idle") {
    if (confirmingEnd) {
      return (
        <div style={{ padding: "6px 4px" }}>
          <div style={{ fontSize: 12, color: "#eef0f4", marginBottom: 4 }}>작업을 종료할까요?</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 8 }}>
            {formatElapsed(engine.getElapsedMs())}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" style={rowButtonStyle} onClick={() => setConfirmingEnd(false)}>
              계속 작업
            </button>
            <button
              type="button"
              style={{ ...rowButtonStyle, color: "#ff9b9b" }}
              onClick={() => {
                engine.end();
                setConfirmingEnd(false);
              }}
            >
              종료
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ padding: "6px 4px" }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
          {formatElapsed(engine.getElapsedMs())}
        </div>
        <div style={{ fontSize: 11, color: "#9ad1ff", marginBottom: 6 }}>{statusLabel(snapshot.status)}</div>

        {snapshot.title && (
          <div style={{ fontSize: 12, color: "#eef0f4", marginBottom: 2 }}>{snapshot.title}</div>
        )}
        <div style={{ fontSize: 11, color: "#9aa0aa", marginBottom: 8 }}>
          {snapshot.mode === "appTracking" ? "프로그램 연동" : "일반 타이머"}
        </div>

        {snapshot.mode === "appTracking" && (
          <div style={{ fontSize: 11, color: "#9aa0aa", marginBottom: 8 }}>
            {!snapshot.foregroundDetectionOk
              ? "프로그램 상태를 확인할 수 없습니다."
              : snapshot.currentIntervalApp
                ? `측정 중: ${snapshot.currentIntervalApp.displayName}`
                : `대상: ${(snapshot.targetApps ?? []).map((a) => a.displayName).join(", ")}`}
          </div>
        )}

        <div style={{ display: "flex", gap: 6 }}>
          {snapshot.status === "running" ? (
            <button type="button" style={rowButtonStyle} onClick={() => engine.pause()}>
              일시정지
            </button>
          ) : (
            <button type="button" style={primaryButtonStyle} onClick={() => engine.resume()}>
              계속
            </button>
          )}
          <button type="button" style={rowButtonStyle} onClick={() => setConfirmingEnd(true)}>
            종료
          </button>
        </div>
      </div>
    );
  }

  if (step === "entry") {
    return (
      <button
        type="button"
        style={{ ...primaryButtonStyle, width: "100%", padding: "8px 0", marginBottom: 4 }}
        onClick={() => setStep("modeSelect")}
      >
        작업 시작
      </button>
    );
  }

  if (step === "modeSelect") {
    return (
      <div style={{ padding: "4px" }}>
        <div style={{ fontSize: 12, color: "#eef0f4", marginBottom: 6 }}>어떤 방식으로 측정할까요?</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button type="button" style={rowButtonStyle} onClick={() => setStep("manualSetup")}>
            일반 타이머
          </button>
          <button type="button" style={rowButtonStyle} onClick={() => setStep("appTrackingSetup")}>
            프로그램 연동
          </button>
        </div>
      </div>
    );
  }

  if (step === "manualSetup") {
    return (
      <div style={{ padding: "4px" }}>
        <div style={{ fontSize: 11, color: "#9aa0aa", marginBottom: 4 }}>작업 이름</div>
        <input
          style={titleInputStyle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="선택 사항"
        />
        <button
          type="button"
          style={{ ...primaryButtonStyle, width: "100%" }}
          onClick={() => engine.startManual(title)}
        >
          시작
        </button>
      </div>
    );
  }

  // appTrackingSetup
  return (
    <div style={{ padding: "4px" }}>
      <div style={{ fontSize: 11, color: "#9aa0aa", marginBottom: 4 }}>작업 이름</div>
      <input
        style={titleInputStyle}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="선택 사항"
      />
      <AppPickerPanel selected={pickedApps} onChange={setPickedApps} />
      <button
        type="button"
        disabled={pickedApps.length === 0}
        style={{
          ...primaryButtonStyle,
          width: "100%",
          marginTop: 8,
          opacity: pickedApps.length === 0 ? 0.45 : 1,
          cursor: pickedApps.length === 0 ? "default" : "pointer",
        }}
        onClick={() => {
          if (pickedApps.length === 0) return;
          engine.startAppTracking(pickedApps, title);
        }}
      >
        시작
      </button>
    </div>
  );
}
