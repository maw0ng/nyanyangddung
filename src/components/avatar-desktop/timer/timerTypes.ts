/**
 * Shared type/schema definitions for the Desktop Avatar's work timer
 * (일반 타이머 / 프로그램 연동 타이머). Deliberately framework/Electron-free -
 * TimerEngine.ts and timerStorage.ts are the only files that import these
 * beyond the UI layer, so the same types describe both the live in-memory
 * engine state and what gets persisted.
 */

export type TimerMode = "manual" | "appTracking";

/** manualPaused and autoPaused are kept as separate statuses on purpose
 * (never collapsed into one "paused" flag) - autoPaused must never silently
 * resume just because the user is back on a manualPaused timer's target
 * app; only an explicit "계속" click may leave manualPaused. */
export type TimerStatus = "idle" | "running" | "manualPaused" | "autoPaused";

/** Identifies one trackable Windows program. `executablePath` is the
 * preferred stable identifier (falls back to `processName`) - never the
 * window title, which can contain document names/content and has no place
 * being persisted (see the privacy constraints in useForegroundPolling.ts /
 * electron/foregroundApp.ts). */
export interface TrackedApp {
  id: string;
  displayName: string;
  processName?: string;
  executablePath?: string;
}

export interface AppTrackingConfig {
  targetApps: TrackedApp[];
}

/** One contiguous span of genuinely active work time. For a manual timer
 * `app` is always absent (there's only ever one interval per running/pause
 * cycle); for appTracking, a new interval starts every time the foreground
 * target app changes (including target A -> target B, which does NOT
 * change TimerStatus - see TimerEngine.reportForegroundApp). */
export interface ActiveInterval {
  startedAt: number;
  endedAt: number;
  app?: {
    displayName: string;
    processName?: string;
    executablePath?: string;
  };
}

export const TIMER_SESSION_SCHEMA_VERSION = 1;

/** A finished, persisted work session - written once when the user ends
 * the timer (TimerEngine.end()). Never rewritten afterwards. */
export interface TimerSession {
  id: string;
  schemaVersion: number;

  title?: string;
  mode: TimerMode;

  startedAt: number;
  endedAt: number;

  /** Sum of every ActiveInterval's duration - the actual measured work
   * time, distinct from (endedAt - startedAt) which also includes paused
   * spans. */
  activeDurationMs: number;

  targetApps?: TrackedApp[];
  activeIntervals?: ActiveInterval[];

  createdAt: number;
}

export const ACTIVE_TIMER_STATE_SCHEMA_VERSION = 1;

/** The single in-progress timer, persisted at meaningful state changes only
 * (see TimerEngine's notify()) so it can be restored after the app/OS
 * restarts - see TimerEngine.hydrateFromSaved() for exactly how each field
 * is used during recovery. */
export interface ActiveTimerState {
  schemaVersion: number;

  title?: string;
  mode: TimerMode;
  status: TimerStatus;

  accumulatedMs: number;
  /** Present only while status === "running". Kept as the ORIGINAL
   * timestamp (never reset to "now" on restore) so that elapsed time is
   * always accumulatedMs + (Date.now() - runningStartedAt) - for a manual
   * timer this is exactly what makes wall-clock gaps while the app was
   * closed count as work time (section 31). */
  runningStartedAt?: number;

  targetApps?: TrackedApp[];
  startedAt: number;

  activeIntervals?: ActiveInterval[];
  currentInterval?: {
    startedAt: number;
    app?: ActiveInterval["app"];
  };

  /** Wall-clock time this row was last written - the "known-good" instant
   * hydrateFromSaved() closes out a dangling currentInterval against for
   * appTracking mode (where, unlike manual mode, time while the app was
   * closed must NOT be counted as active - section 32). */
  savedAt: number;
}

/** Windows program identity as reported by the Electron main process
 * (electron/foregroundApp.ts) - intentionally excludes window title. */
export interface ForegroundAppInfo {
  pid: number;
  processName: string;
  executablePath: string | null;
  displayName: string;
}
