/**
 * The API electron/preload.ts exposes via contextBridge - only present
 * when running inside the Electron desktop shell. Every call site must
 * treat this as optional (`window.desktopAPI?.foo()`) so the exact same
 * React app keeps working unmodified in a plain browser (section 18).
 */
export {};

declare global {
  /** Windows program identity as reported by the Electron main process
   * (electron/foregroundApp.ts). Deliberately excludes window title - see
   * that file's privacy note. */
  interface ForegroundAppInfo {
    pid: number;
    processName: string;
    executablePath: string | null;
    displayName: string;
  }

  interface DesktopAPI {
    setAlwaysOnTop: (enabled: boolean) => Promise<void>;
    getAlwaysOnTop: () => Promise<boolean>;
    /** Opens (or focuses, if already open) a normal windowed Avatar
     * Editor - the one way back from Desktop Mode's minimal chrome. */
    openEditor: () => Promise<void>;
    /** Opens (or focuses, if already open) the account/friend management
     * window - a normal framed window, never the Desktop Avatar's
     * transparent/frameless setup. */
    openFriends: () => Promise<void>;
    /** Opens (or focuses, if already open) the Room-Code co-working
     * window - a normal framed window, never the Desktop Avatar's
     * transparent/frameless setup. */
    openCowork: () => Promise<void>;

    /** Toggles OS-level click-through for the Desktop Avatar window.
     * `true` = transparent pixels pass clicks to whatever is behind the
     * window; `false` = the whole window is interactive again. Callers
     * must only invoke this when the value actually changes (see
     * useDesktopInteraction.ts) - it is not free to call every frame. */
    setClickThrough: (ignore: boolean) => Promise<void>;
    /** Captures the window's current position as the drag origin. */
    beginWindowDrag: () => Promise<void>;
    /** Moves the window to (dragOrigin + deltaX, dragOrigin + deltaY),
     * clamped so it can never become fully unreachable. */
    updateWindowDrag: (deltaX: number, deltaY: number) => Promise<void>;
    /** Ends the drag and persists the window's final position to disk. */
    endWindowDrag: () => Promise<void>;
    /** Hides the Desktop Avatar window without quitting the app - only
     * reachable again via the Tray icon's "캐릭터 표시". */
    hideWindow: () => Promise<void>;
    /** Quits the whole app cleanly via the main process - Renderer code
     * must never call process.exit() or similar directly. */
    quit: () => Promise<void>;

    /** The current Windows foreground window's owning app, or null if it
     * can't be determined - callers must treat null as "unknown", never as
     * "not the target app" vs "is the target app" (section 41). */
    getForegroundApp: () => Promise<ForegroundAppInfo | null>;
    /** Every running app with a visible window, deduped one-per-app,
     * excluding this app itself and common Windows shell processes. */
    getRunningApps: () => Promise<ForegroundAppInfo[]>;

    /** Called by the Editor window after a CharacterPreset save/switch
     * succeeds - relayed to the Desktop window as a "character-preset-
     * updated" event. Carries no appearance data itself (see
     * onCharacterPresetUpdated). Safe/no-op-shaped to call from either
     * window; only the Desktop window actually receives the resulting
     * event. */
    notifyPresetSaved: () => Promise<void>;
    /** Desktop-side listener for the above - fires with no arguments
     * (callers re-read characterPresetStorage themselves, exactly like the
     * existing mount-time load already does). Returns an unsubscribe
     * function; call it on unmount like any other event subscription. */
    onCharacterPresetUpdated: (callback: () => void) => () => void;

    /** Editor-only: registers the async flush callback Main invokes right
     * before actually closing the Editor window, so a pending debounced
     * autosave gets a chance to complete (cancel the timer, await the real
     * IndexedDB write) instead of being silently discarded when the window
     * closes mid-debounce. Returns an unsubscribe function. Main bounds the
     * wait with its own timeout - this callback should still resolve
     * promptly rather than assuming it will always be awaited indefinitely. */
    onFlushBeforeClose: (callback: () => Promise<void>) => () => void;

    /** Called by the Editor window after its (debounced) Toon Style save
     * to localStorage settles - relayed to the Desktop window as a
     * "toon-settings-updated" event. Carries no settings data itself (see
     * onToonSettingsUpdated) - same shape/convention as notifyPresetSaved,
     * kept as its own separate signal since Toon Style is an app-wide
     * preference, not part of CharacterPreset (toonStyle.ts). */
    notifyToonSettingsSaved: () => Promise<void>;
    /** Desktop-side listener for the above - fires with no arguments
     * (callers re-read toonStyle.ts's loadToonSettings() themselves, same
     * convention as onCharacterPresetUpdated). Returns an unsubscribe
     * function; call it on unmount like any other event subscription. */
    onToonSettingsUpdated: (callback: () => void) => () => void;

    /** The user's persisted Desktop Pet display size (0.5 - 1.5, 1.0 =
     * 100%) - read once at mount to hydrate initial React state. */
    getAvatarScale: () => Promise<number>;
    /** Persists the given scale to disk AND resizes/repositions the
     * window to match (equivalent to resizeAvatarWindow + a disk write) -
     * call this once, on slider release, never per-tick. */
    setAvatarScale: (scale: number) => Promise<void>;
    /** Resizes/repositions the Desktop window to fit the given scale
     * (workArea-clamped, anchored on the avatar's foot position - see
     * main.ts's applyAvatarScale()) WITHOUT persisting anything - safe to
     * call continuously (rAF-throttled by the caller) while the user is
     * still dragging the size slider. */
    resizeAvatarWindow: (scale: number) => Promise<void>;

    /** Resizes/repositions the Desktop window to fit the current
     * avatarScale AND this many avatar slots (1-4, Desktop-avatar-
     * rendering brief section 19) - call whenever the CoWork Room's active
     * participant count changes (join/leave/Realtime update/app-restart
     * restore). Safe to call with the same count repeatedly (no-ops). */
    setParticipantCount: (count: number) => Promise<void>;

    /** Windows auto-update (electron/updater.ts) - current state snapshot;
     * `currentVersion` is always app.getVersion() (never hardcoded in the
     * renderer). Resolves the same "idle" shape in development (no real
     * GitHub check happens outside a packaged build). */
    getUpdateState: () => Promise<UpdateState>;
    /** Triggers a check now (the "업데이트 확인" menu item - section 20).
     * autoDownload is on, so a found update starts downloading on its own;
     * this call's resolved value is just the state right after the check
     * settles, for callers that want it directly rather than waiting for
     * the next onUpdateStatus event. */
    checkForUpdates: () => Promise<UpdateState>;
    /** Manual/retry download trigger - normally a no-op in practice since
     * an available update already starts downloading automatically. */
    downloadUpdate: () => Promise<UpdateState>;
    /** Quits and installs the already-downloaded update - a no-op unless
     * state.status is exactly "downloaded" (main process re-validates this
     * itself; section 14 - never call this without the user explicitly
     * choosing "지금 재시작"). */
    installUpdate: () => Promise<void>;
    /** Fires with the full current UpdateState every time it changes.
     * Returns an unsubscribe function - call it on unmount like any other
     * listener here. */
    onUpdateStatus: (callback: (state: UpdateState) => void) => () => void;
  }

  /** Mirrors electron/updater.ts's own UpdateState shape (that file is the
   * real source of truth - this is just the renderer-side type, since
   * electron/ and src/ can't import across that boundary - same reason
   * ForegroundAppInfo above is duplicated rather than imported). */
  type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "upToDate" | "error";
  interface UpdateState {
    status: UpdateStatus;
    currentVersion: string;
    availableVersion: string | null;
    progressPercent: number | null;
    errorMessage: string | null;
  }

  interface Window {
    desktopAPI?: DesktopAPI;
  }
}
