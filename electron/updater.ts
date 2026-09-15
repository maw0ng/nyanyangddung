/**
 * Windows auto-update (electron-updater over GitHub Releases). Owns its own
 * small piece of state and broadcasts it to every open window - exactly the
 * same "main owns the real state, renderer only ever sees a read-only
 * projection over IPC" shape as windowState.ts/foregroundApp.ts, never a
 * second source of truth in the renderer.
 *
 * Production-only (`app.isPackaged`): development never performs a real
 * GitHub update check, matching desktop:dev's own localhost-only load path -
 * see setupAutoUpdater()/every IPC handler below.
 *
 * Never installs anything without an explicit user click on "지금 재시작"
 * (installUpdate() below) - autoDownload happens in the background, but
 * quitAndInstall() is only ever called from that one handler, never
 * automatically on "update-downloaded".
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "upToDate"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  /** Source of truth is always app.getVersion() (section 15) - never
   * hardcoded/duplicated in the renderer. */
  currentVersion: string;
  /** The version found/downloading/downloaded - null in every other state. */
  availableVersion: string | null;
  /** 0-100 while downloading, null otherwise. */
  progressPercent: number | null;
  errorMessage: string | null;
}

let state: UpdateState = {
  status: "idle",
  currentVersion: app.getVersion(),
  availableVersion: null,
  progressPercent: null,
  errorMessage: null,
};

/** Set right before the one and only quitAndInstall() call (section 22) -
 * exported so main.ts's own quit/close handling can check it if any
 * "prevent close, hide to tray instead" logic is ever added later. Today's
 * app.on("window-all-closed")/tray "종료" flow has no such interception to
 * conflict with (verified while building this), so this flag is currently
 * observational/future-proofing rather than gating any existing behavior. */
let isQuittingForUpdate = false;
export function isAppQuittingForUpdate(): boolean {
  return isQuittingForUpdate;
}

function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("update-status", state);
  }
}

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  broadcast();
}

let initialized = false;

/** Wires electron-updater's events into `state` and kicks off one
 * background check shortly after launch (section 13) - call once from
 * app.whenReady(). A no-op in development (section 12). Every event handler
 * only ever writes to local `state`; a GitHub/network failure here can
 * never throw into the rest of main.ts (section 23) - autoUpdater's own
 * "error" event is caught and turned into state.status="error" instead. */
export function setupAutoUpdater(): void {
  if (initialized) return;
  initialized = true;
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  // We decide exactly when to install (installUpdate() below, user-gated -
  // section 14) - never on quit implicitly.
  autoUpdater.autoInstallOnAppQuit = false;
  // Stable channel only (section 30) - a GitHub prerelease must never reach
  // a v1 stable install even if one ever gets published.
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("checking-for-update", () => {
    setState({ status: "checking", errorMessage: null });
  });
  autoUpdater.on("update-available", (info) => {
    setState({ status: "available", availableVersion: info.version, progressPercent: null, errorMessage: null });
  });
  autoUpdater.on("update-not-available", () => {
    setState({ status: "upToDate", availableVersion: null, progressPercent: null, errorMessage: null });
  });
  autoUpdater.on("download-progress", (progress) => {
    setState({ status: "downloading", progressPercent: Math.round(progress.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    setState({ status: "downloaded", availableVersion: info.version, progressPercent: 100 });
  });
  autoUpdater.on("error", (err) => {
    console.error("[updater]", err);
    setState({ status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
  });

  // Background check a few seconds after launch (section 13) - never blocks
  // window creation, never shows anything unless/until a real update is
  // actually found (section 19 - "업데이트 없을 때는 아무것도 표시하지
  // 않는다").
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[updater] initial check failed", err);
    });
  }, 5000);
}

/** IPC surface (section 16/18) - the ONLY way the renderer ever touches the
 * updater; it never gets a Node/electron-updater reference of its own
 * (preload.ts only exposes these four thin passthroughs). Call once from
 * main.ts alongside every other ipcMain.handle registration. */
export function registerUpdaterIpc(): void {
  ipcMain.handle("updater:getState", () => state);

  ipcMain.handle("updater:checkForUpdates", async () => {
    if (!app.isPackaged) return state;
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      console.error("[updater] checkForUpdates failed", err);
      setState({ status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
    }
    return state;
  });

  // Exposed for completeness/manual retry (section 18) - normally a no-op
  // in practice since autoDownload=true already starts the download the
  // moment "update-available" fires.
  ipcMain.handle("updater:downloadUpdate", async () => {
    if (!app.isPackaged) return state;
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      console.error("[updater] downloadUpdate failed", err);
      setState({ status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
    }
    return state;
  });

  ipcMain.handle("updater:installUpdate", () => {
    // Never install anything that isn't a fully, successfully downloaded
    // update (section 14) - a stray call while still "downloading"/
    // "checking" is simply ignored.
    if (state.status !== "downloaded") return;
    isQuittingForUpdate = true;
    autoUpdater.quitAndInstall();
  });
}
