/**
 * Framework/Electron-agnostic work timer engine. Plain class + imperative
 * methods + a subscribe/notify listener set - same "no React state on the
 * hot path" shape as AvatarAnimationController (see
 * ../../hair-prototype/avatarAnimation.ts). Never touches THREE.js, the
 * DOM, or window.desktopAPI directly; UI/persistence/animation are all
 * wired in from outside via useTimerEngine.ts.
 *
 * Elapsed time is always derived from timestamps
 * (accumulatedMs + (Date.now() - runningStartedAt) while running), never
 * from counting setInterval ticks - see getElapsedMs(). Listeners
 * (subscribe()) only fire on meaningful state transitions (start/pause/
 * resume/auto-pause/auto-resume/interval switch/end), never once a second -
 * a per-second UI refresh is TimerHUD's own concern, decoupled from this
 * engine entirely.
 */

import type {
  ActiveInterval,
  ActiveTimerState,
  ForegroundAppInfo,
  TimerMode,
  TimerSession,
  TimerStatus,
  TrackedApp,
} from "./timerTypes";
import { ACTIVE_TIMER_STATE_SCHEMA_VERSION, TIMER_SESSION_SCHEMA_VERSION } from "./timerTypes";

export interface TimerSnapshot {
  mode: TimerMode;
  status: TimerStatus;
  title?: string;
  targetApps?: TrackedApp[];
  accumulatedMs: number;
  runningStartedAt: number | null;
  startedAt: number | null;
  /** The target app the current ActiveInterval is attributed to (appTracking
   * only) - purely informational, for the floating menu's detail view. */
  currentIntervalApp: TrackedApp | null;
  /** False right after a foreground lookup failed/threw (section 41) - the
   * floating menu uses this to show "프로그램 상태를 확인할 수 없습니다."
   * instead of silently implying autoPaused means "다른 프로그램 사용 중". */
  foregroundDetectionOk: boolean;
}

export interface TimerEngineOptions {
  /** Fired on every meaningful transition with the current persistable
   * state (or null once the timer ends/is idle) - see timerStorage.ts.
   * Never fired on a per-second tick. */
  onPersist?: (state: ActiveTimerState | null) => void;
  /** Fired exactly once, synchronously, when end() finalizes a session. */
  onSessionComplete?: (session: TimerSession) => void;
  /** Fired exactly once per running-segment close (pause / auto-pause /
   * end), with exactly the delta milliseconds just folded into
   * `accumulatedMs` - see commitElapsedRunningMs(). This is the ONLY place
   * "real, permanently-recorded" active time is ever produced, so it is
   * the single safe hook for the growth system (GrowthEngine.addWorkMs) to
   * consume without any risk of double-counting: every millisecond
   * accumulatedMs ever gains flows through here exactly once, and nothing
   * else in this class increments accumulatedMs. */
  onActiveMsCommitted?: (deltaMs: number) => void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `timer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function matchesTarget(app: ForegroundAppInfo, targets: TrackedApp[]): TrackedApp | null {
  for (const target of targets) {
    if (target.executablePath && app.executablePath && target.executablePath === app.executablePath) {
      return target;
    }
    if (target.processName && app.processName && target.processName === app.processName) {
      return target;
    }
  }
  return null;
}

function toIntervalApp(app: TrackedApp | null | undefined): ActiveInterval["app"] {
  if (!app) return undefined;
  return {
    displayName: app.displayName,
    processName: app.processName,
    executablePath: app.executablePath,
  };
}

export class TimerEngine {
  private listeners = new Set<() => void>();
  private readonly onPersist?: (state: ActiveTimerState | null) => void;
  private readonly onSessionComplete?: (session: TimerSession) => void;
  private readonly onActiveMsCommitted?: (deltaMs: number) => void;

  private mode: TimerMode = "manual";
  private status: TimerStatus = "idle";
  private title: string | undefined;
  private targetApps: TrackedApp[] | undefined;

  private accumulatedMs = 0;
  private runningStartedAt: number | null = null;
  private startedAt: number | null = null;

  private activeIntervals: ActiveInterval[] = [];
  private currentInterval: { startedAt: number; app?: ActiveInterval["app"] } | null = null;
  private currentIntervalApp: TrackedApp | null = null;

  /** Last foreground match seen while mode === "appTracking", updated even
   * while manualPaused (which otherwise ignores foreground changes) so
   * resume() can decide running vs autoPaused instantly instead of waiting
   * for the next poll tick (section 20). */
  private lastForegroundMatch: TrackedApp | null = null;
  private foregroundDetectionOk = true;

  /** useSyncExternalStore (see useTimerEngine.ts) requires getSnapshot() to
   * return the exact same reference across calls until something actually
   * changed - returning a fresh object literal every call makes React
   * conclude the store changed on every single render and re-subscribe
   * forever ("Maximum update depth exceeded"). Cached here and invalidated
   * only inside notify(), i.e. only on a real, meaningful transition. */
  private cachedSnapshot: TimerSnapshot | null = null;

  constructor(options: TimerEngineOptions = {}) {
    this.onPersist = options.onPersist;
    this.onSessionComplete = options.onSessionComplete;
    this.onActiveMsCommitted = options.onActiveMsCommitted;
  }

  /** The single place accumulatedMs is ever incremented - folds the
   * elapsed running segment (now - runningStartedAt) into accumulatedMs
   * and reports exactly that delta via onActiveMsCommitted. Callers are
   * still responsible for clearing `runningStartedAt` afterward (this
   * helper only touches accumulatedMs, matching each call site's own
   * surrounding status-transition logic). */
  private commitElapsedRunningMs(now: number) {
    if (this.runningStartedAt === null) return;
    const delta = Math.max(0, now - this.runningStartedAt);
    if (delta === 0) return;
    this.accumulatedMs += delta;
    this.onActiveMsCommitted?.(delta);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
    this.onPersist?.(this.status === "idle" ? null : this.buildActiveTimerState());
  }

  getSnapshot(): TimerSnapshot {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        mode: this.mode,
        status: this.status,
        title: this.title,
        targetApps: this.targetApps,
        accumulatedMs: this.accumulatedMs,
        runningStartedAt: this.runningStartedAt,
        startedAt: this.startedAt,
        currentIntervalApp: this.currentIntervalApp,
        foregroundDetectionOk: this.foregroundDetectionOk,
      };
    }
    return this.cachedSnapshot;
  }

  /** Timestamp-based elapsed time - safe to call every render/tick, never
   * drifts under CPU throttling since it never depends on how many ticks
   * actually fired (section 21). */
  getElapsedMs(): number {
    if (this.status === "running" && this.runningStartedAt !== null) {
      return this.accumulatedMs + Math.max(0, Date.now() - this.runningStartedAt);
    }
    return this.accumulatedMs;
  }

  // ---- Starting -------------------------------------------------------

  startManual(title?: string) {
    const now = Date.now();
    this.mode = "manual";
    this.status = "running";
    this.title = title?.trim() || undefined;
    this.targetApps = undefined;
    this.accumulatedMs = 0;
    this.runningStartedAt = now;
    this.startedAt = now;
    this.activeIntervals = [];
    this.currentInterval = { startedAt: now };
    this.currentIntervalApp = null;
    this.lastForegroundMatch = null;
    this.foregroundDetectionOk = true;
    this.notify();
  }

  startAppTracking(targetApps: TrackedApp[], title?: string) {
    if (targetApps.length === 0) return;
    const now = Date.now();
    this.mode = "appTracking";
    this.status = "autoPaused"; // corrected to "running" by the first poll if already on a target app
    this.title = title?.trim() || undefined;
    this.targetApps = targetApps;
    this.accumulatedMs = 0;
    this.runningStartedAt = null;
    this.startedAt = now;
    this.activeIntervals = [];
    this.currentInterval = null;
    this.currentIntervalApp = null;
    this.lastForegroundMatch = null;
    this.foregroundDetectionOk = true;
    this.notify();
  }

  // ---- Manual pause / resume -------------------------------------------

  /** The user explicitly pausing - always produces manualPaused, regardless
   * of timer mode (section 20/24's "일시정지" button). */
  pause() {
    if (this.status !== "running") return;
    const now = Date.now();
    this.commitElapsedRunningMs(now);
    this.runningStartedAt = null;
    this.status = "manualPaused";
    this.closeCurrentInterval(now);
    this.notify();
  }

  /** The user explicitly clicking "계속" from manualPaused OR autoPaused.
   * For appTracking mode this decides running vs autoPaused from the last
   * known foreground match rather than blindly resuming (section 20). */
  resume() {
    if (this.status !== "manualPaused" && this.status !== "autoPaused") return;
    const now = Date.now();
    if (this.mode === "manual") {
      this.runningStartedAt = now;
      this.status = "running";
      this.currentInterval = { startedAt: now };
      this.currentIntervalApp = null;
    } else {
      if (this.lastForegroundMatch) {
        this.runningStartedAt = now;
        this.status = "running";
        this.currentInterval = { startedAt: now, app: toIntervalApp(this.lastForegroundMatch) };
        this.currentIntervalApp = this.lastForegroundMatch;
      } else {
        this.runningStartedAt = null;
        this.status = "autoPaused";
        this.currentInterval = null;
        this.currentIntervalApp = null;
      }
    }
    this.notify();
  }

  // ---- Foreground tracking (appTracking mode only) ----------------------

  /** Called by useForegroundPolling.ts with the latest foreground window's
   * app identity (or null on a failed lookup). No-ops entirely outside
   * appTracking mode or while manualPaused (section 20: manualPaused must
   * never auto-resume just because the target app came back). */
  reportForegroundApp(app: ForegroundAppInfo | null, opts: { detectionFailed?: boolean } = {}) {
    if (this.mode !== "appTracking") return;

    this.foregroundDetectionOk = !opts.detectionFailed;
    const match = app && !opts.detectionFailed ? matchesTarget(app, this.targetApps ?? []) : null;
    this.lastForegroundMatch = match;

    if (this.status === "manualPaused") return; // tracked for resume(), but never auto-transitions

    const now = Date.now();

    if (match) {
      if (this.status !== "running") {
        this.status = "running";
        this.runningStartedAt = now;
      }
      if (this.currentIntervalApp?.id !== match.id) {
        // Either no interval yet, or the foreground target changed
        // (target A -> target B) - status stays "running" either way,
        // only the interval attribution changes (section 29).
        this.closeCurrentInterval(now);
        this.currentInterval = { startedAt: now, app: toIntervalApp(match) };
        this.currentIntervalApp = match;
      }
      this.notify();
      return;
    }

    // No target app in the foreground (or detection failed) - never guess
    // "still running" (section 41).
    if (this.status === "running") {
      this.commitElapsedRunningMs(now);
      this.runningStartedAt = null;
      this.status = "autoPaused";
      this.closeCurrentInterval(now);
      this.notify();
    }
    // Already autoPaused/idle with no match: nothing changed, skip the
    // notify()/persist churn.
  }

  // ---- Ending -----------------------------------------------------------

  /** Finalizes the current timer into a TimerSession (returned, and passed
   * to onSessionComplete), then resets to idle. */
  end(): TimerSession | null {
    if (this.status === "idle" || this.startedAt === null) return null;
    const now = Date.now();
    if (this.status === "running") {
      this.commitElapsedRunningMs(now);
    }
    this.closeCurrentInterval(now);

    const session: TimerSession = {
      id: makeId(),
      schemaVersion: TIMER_SESSION_SCHEMA_VERSION,
      title: this.title,
      mode: this.mode,
      startedAt: this.startedAt,
      endedAt: now,
      activeDurationMs: this.accumulatedMs,
      targetApps: this.targetApps,
      activeIntervals: this.activeIntervals.length > 0 ? this.activeIntervals : undefined,
      createdAt: now,
    };

    this.mode = "manual";
    this.status = "idle";
    this.title = undefined;
    this.targetApps = undefined;
    this.accumulatedMs = 0;
    this.runningStartedAt = null;
    this.startedAt = null;
    this.activeIntervals = [];
    this.currentInterval = null;
    this.currentIntervalApp = null;
    this.lastForegroundMatch = null;
    this.foregroundDetectionOk = true;

    this.onSessionComplete?.(session);
    this.notify();
    return session;
  }

  /** Low-frequency (section 33) persistence checkpoint - re-notifies
   * persistence listeners only, without implying any state actually
   * changed. Safe to call from a slow interval (see useTimerCheckpoint). */
  checkpoint() {
    if (this.status === "idle") return;
    this.onPersist?.(this.buildActiveTimerState());
  }

  private closeCurrentInterval(endedAt: number) {
    if (!this.currentInterval) return;
    this.activeIntervals.push({
      startedAt: this.currentInterval.startedAt,
      endedAt,
      app: this.currentInterval.app,
    });
    this.currentInterval = null;
  }

  private buildActiveTimerState(): ActiveTimerState {
    return {
      schemaVersion: ACTIVE_TIMER_STATE_SCHEMA_VERSION,
      title: this.title,
      mode: this.mode,
      status: this.status,
      accumulatedMs: this.accumulatedMs,
      runningStartedAt: this.runningStartedAt ?? undefined,
      targetApps: this.targetApps,
      startedAt: this.startedAt ?? Date.now(),
      activeIntervals: this.activeIntervals.length > 0 ? this.activeIntervals : undefined,
      currentInterval: this.currentInterval ?? undefined,
      savedAt: Date.now(),
    };
  }

  /** Restores a persisted ActiveTimerState after an app/OS restart. Manual
   * mode keeps `runningStartedAt` as its ORIGINAL timestamp so the elapsed
   * calculation naturally folds in the time the app was closed (section
   * 31). appTracking mode never extends across the closed-app gap (section
   * 32): any dangling currentInterval is closed at `saved.savedAt` (the
   * last known-good instant), accumulation stops there, and status is
   * provisionally set to autoPaused until the next foreground poll
   * confirms whether a target app is actually in front. */
  hydrateFromSaved(saved: ActiveTimerState) {
    const now = Date.now();
    this.mode = saved.mode;
    this.title = saved.title;
    this.targetApps = saved.targetApps;
    this.startedAt = saved.startedAt;
    this.activeIntervals = saved.activeIntervals ? [...saved.activeIntervals] : [];
    this.lastForegroundMatch = null;
    this.foregroundDetectionOk = true;

    if (saved.mode === "manual") {
      this.accumulatedMs = saved.accumulatedMs;
      if (saved.status === "running" && saved.runningStartedAt !== undefined) {
        // Defensive against a corrupted/rolled-back system clock: never let
        // a bogus future timestamp produce a negative elapsed contribution.
        this.runningStartedAt = saved.runningStartedAt <= now ? saved.runningStartedAt : now;
        this.status = "running";
        this.currentInterval = saved.currentInterval
          ? { ...saved.currentInterval }
          : { startedAt: this.runningStartedAt };
        this.currentIntervalApp = null;
      } else {
        this.accumulatedMs = saved.accumulatedMs;
        this.runningStartedAt = null;
        this.status = saved.status === "idle" ? "idle" : "manualPaused";
        this.currentInterval = null;
        this.currentIntervalApp = null;
      }
    } else {
      // appTracking: close any dangling interval at the last checkpoint,
      // never at "now" - the app being closed means we have no idea
      // whether the target app was still focused a second before the
      // crash/close, let alone for the whole gap since.
      this.accumulatedMs = saved.accumulatedMs;
      this.runningStartedAt = null;
      this.currentIntervalApp = null;
      if (saved.currentInterval) {
        this.activeIntervals.push({
          startedAt: saved.currentInterval.startedAt,
          endedAt: saved.savedAt,
          app: saved.currentInterval.app,
        });
      }
      this.currentInterval = null;
      this.status = saved.status === "idle" ? "idle" : "autoPaused";
    }

    this.notify();
  }
}
