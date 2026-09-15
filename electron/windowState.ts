/**
 * Minimal Node-side persistence for Desktop Avatar presentation state - the
 * window's last screen position, and (as of the Avatar Scale feature) the
 * last avatarScale the user picked. Deliberately a tiny hand-rolled JSON
 * file under Electron's own per-user `userData` directory rather than a
 * new dependency (e.g. electron-store) - this is Main-process-only state,
 * unrelated to the Renderer's IndexedDB-based CharacterPreset/Timer/
 * Profile storage, so there is no existing storage abstraction to reuse
 * here. avatarScale lives here (not in the Renderer's IndexedDB) because
 * Main must know it synchronously at window-creation time, before any
 * renderer has loaded far enough to read its own storage - see
 * computeInitialBounds() in main.ts.
 *
 * Both fields are read/written independently (position on drag-end, scale
 * on slider-release) but share one file - writes merge onto whatever is
 * already there rather than clobbering the other field.
 */
import { app } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface DesktopState {
  x?: number;
  y?: number;
  avatarScale?: number;
}

function statePath(): string {
  return path.join(app.getPath("userData"), "desktop-window-state.json");
}

function readState(): DesktopState {
  try {
    const file = statePath();
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    // Corrupt/unreadable state file - fall back to defaults rather than
    // crashing app startup over a cosmetic preference.
    return {};
  }
}

function writeState(patch: DesktopState): void {
  try {
    const merged = { ...readState(), ...patch };
    writeFileSync(statePath(), JSON.stringify(merged), "utf8");
  } catch {
    // Non-fatal - worst case the value just isn't remembered next launch.
  }
}

export function loadWindowPosition(): { x: number; y: number } | null {
  const state = readState();
  if (typeof state.x === "number" && typeof state.y === "number") {
    return { x: state.x, y: state.y };
  }
  return null;
}

export function saveWindowPosition(position: { x: number; y: number }): void {
  writeState(position);
}

export function loadAvatarScale(): number | null {
  const state = readState();
  return typeof state.avatarScale === "number" ? state.avatarScale : null;
}

export function saveAvatarScale(scale: number): void {
  writeState({ avatarScale: scale });
}
