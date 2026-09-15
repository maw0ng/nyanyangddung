/**
 * Framework/Electron-agnostic nickname + growth engine - same plain-class +
 * subscribe/notify shape as ../timer/TimerEngine.ts. Owns exactly two
 * persisted fields: `nickname` and `totalWorkMs` (section 2 - level/
 * currentExp/requiredExp are never stored, only ever derived via
 * calculateGrowth()). Never touches TimerEngine, AnimationMixer, or the
 * DOM directly - wiring lives in useGrowthEngine.ts/useLiveGrowth.ts and
 * DesktopAvatarScene.tsx.
 */

import { DEFAULT_NICKNAME, GROWTH_CONFIG, NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from "./growthConfig";
import type { UserProfile } from "./growthTypes";

export interface GrowthSnapshot {
  nickname: string;
  totalWorkMs: number;
  /** False until hydrate() has been called once with the real (or
   * freshly-created default) persisted profile - see useGrowthEngine.ts.
   * Consumers use this to avoid firing a false "level up" the moment a
   * returning user's already-high level first loads in. */
  loaded: boolean;
}

export type NicknameValidationResult = { ok: true } | { ok: false; error: string };

export interface GrowthEngineOptions {
  /** Fired whenever nickname or totalWorkMs actually changes, with the
   * full persistable profile - never on a per-second tick (there is no
   * tick in this engine at all; live/ticking display math lives entirely
   * in useLiveGrowth.ts, outside this class). */
  onPersist?: (profile: UserProfile) => void;
}

function nicknameError(trimmed: string): string | null {
  if (trimmed.length < NICKNAME_MIN_LENGTH) return `닉네임은 ${NICKNAME_MIN_LENGTH}자 이상이어야 합니다.`;
  if (trimmed.length > NICKNAME_MAX_LENGTH) return `닉네임은 ${NICKNAME_MAX_LENGTH}자 이하여야 합니다.`;
  return null;
}

export class GrowthEngine {
  private listeners = new Set<() => void>();
  private readonly onPersist?: (profile: UserProfile) => void;

  private nickname = DEFAULT_NICKNAME;
  private totalWorkMs = 0;
  private createdAt: number | null = null;
  private loaded = false;

  /** Work-time deltas that arrive (via addWorkMs) before hydrate() has
   * completed are queued here rather than dropped or applied against a
   * not-yet-restored totalWorkMs - see addWorkMs()/hydrate(). In practice
   * this only matters for an extremely fast pause/autoPause happening
   * within the same macrotask as mount, but losing real committed work
   * time would violate the "EXP 이중지급/유실 절대 금지" requirement, so
   * it's handled exactly rather than assumed away. */
  private pendingMs = 0;

  private cachedSnapshot: GrowthSnapshot | null = null;

  constructor(options: GrowthEngineOptions = {}) {
    this.onPersist = options.onPersist;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(persist: boolean) {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
    if (persist && this.loaded) {
      this.onPersist?.({
        schemaVersion: 1,
        nickname: this.nickname,
        totalWorkMs: this.totalWorkMs,
        createdAt: this.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      });
    }
  }

  getSnapshot(): GrowthSnapshot {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        nickname: this.nickname,
        totalWorkMs: this.totalWorkMs,
        loaded: this.loaded,
      };
    }
    return this.cachedSnapshot;
  }

  /** Restores a previously-saved profile (or seeds a brand-new one) once,
   * at mount - see useGrowthEngine.ts. Folds in any addWorkMs() deltas
   * that raced ahead of this call. */
  hydrate(profile: UserProfile) {
    this.nickname = profile.nickname;
    this.totalWorkMs = profile.totalWorkMs + this.pendingMs;
    this.pendingMs = 0;
    this.createdAt = profile.createdAt;
    this.loaded = true;
    this.notify(true);
  }

  /**
   * The single write path for growth time - called exactly from
   * TimerEngine's onActiveMsCommitted (see useTimerEngine wiring in
   * DesktopAvatarScene.tsx), which itself fires exactly once per running
   * segment close (pause/autoPause/end) with exactly that segment's
   * duration. Never called with a duration derived any other way, so
   * totalWorkMs can never drift from the sum of TimerSession.activeDurationMs
   * across sessions (section 8/11).
   */
  addWorkMs(deltaMs: number) {
    if (deltaMs <= 0) return;
    if (!this.loaded) {
      this.pendingMs += deltaMs;
      return;
    }
    this.totalWorkMs += deltaMs;
    this.notify(true);
  }

  setNickname(raw: string): NicknameValidationResult {
    const trimmed = raw.trim();
    const error = nicknameError(trimmed);
    if (error) return { ok: false, error };
    if (trimmed === this.nickname) return { ok: true };
    this.nickname = trimmed;
    this.notify(true);
    return { ok: true };
  }

  /** Dev-only debug helper (section 29) - routes through the exact same
   * addWorkMs() path as real committed timer segments, so it can never
   * desync growth from any special-cased "debug" bookkeeping. Callers
   * (DevGrowthDebugPanel) are themselves gated to non-production builds -
   * this method has no gate of its own since it does nothing a real,
   * very-long work session couldn't already do. */
  devAddExp(exp: number) {
    if (exp <= 0) return;
    this.addWorkMs(exp * GROWTH_CONFIG.msPerExp);
  }
}
