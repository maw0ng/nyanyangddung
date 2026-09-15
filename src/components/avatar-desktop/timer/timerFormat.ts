import type { TimerStatus } from "./timerTypes";

/** HH:MM:SS, HH never wraps at 24 (section 3 - "31:42:18"처럼 계속 표시). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export function statusLabel(status: TimerStatus): string {
  switch (status) {
    case "running":
      return "작업 중";
    case "manualPaused":
      return "일시정지";
    case "autoPaused":
      return "자동 일시정지";
    case "idle":
    default:
      return "";
  }
}
