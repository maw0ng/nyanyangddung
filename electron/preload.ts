/**
 * contextBridge boundary between the Renderer (the Next.js React app) and
 * the Electron main process. Runs with nodeIntegration:false/
 * contextIsolation:true (see main.ts's webPreferences) - the renderer
 * NEVER gets direct Node/Electron access, only this explicit, minimal
 * surface, exposed as `window.desktopAPI` (typed in
 * src/types/desktop.d.ts). Every method here is a thin IPC passthrough;
 * no business logic lives in preload.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { UpdateState } from "./updater";

contextBridge.exposeInMainWorld("desktopAPI", {
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke("desktop:setAlwaysOnTop", enabled),
  getAlwaysOnTop: () => ipcRenderer.invoke("desktop:getAlwaysOnTop"),
  openEditor: () => ipcRenderer.invoke("desktop:openEditor"),
  openFriends: () => ipcRenderer.invoke("desktop:openFriends"),
  openCowork: () => ipcRenderer.invoke("desktop:openCowork"),

  // Desktop interaction layer (2단계) - every method is still a thin IPC
  // passthrough with zero business logic, same as the methods above.
  setClickThrough: (ignore: boolean) => ipcRenderer.invoke("desktop:setClickThrough", ignore),
  beginWindowDrag: () => ipcRenderer.invoke("desktop:beginWindowDrag"),
  updateWindowDrag: (deltaX: number, deltaY: number) =>
    ipcRenderer.invoke("desktop:updateWindowDrag", deltaX, deltaY),
  endWindowDrag: () => ipcRenderer.invoke("desktop:endWindowDrag"),
  hideWindow: () => ipcRenderer.invoke("desktop:hideWindow"),
  quit: () => ipcRenderer.invoke("desktop:quit"),

  // 프로그램 연동 타이머 - Windows foreground/running-app detection, still a
  // thin IPC passthrough (see electron/foregroundApp.ts for the actual
  // implementation).
  getForegroundApp: () => ipcRenderer.invoke("desktop:getForegroundApp"),
  getRunningApps: () => ipcRenderer.invoke("desktop:getRunningApps"),

  // Desktop <-> Editor CharacterPreset sync. Both windows share this same
  // preload script, so both ends of this signal live on the one exposed
  // object rather than inventing a second contextBridge global - the
  // Editor window calls notifyPresetSaved() after a successful save/
  // character-switch, Main relays it to the Desktop window only, and the
  // Desktop window listens via onCharacterPresetUpdated(). No preset data
  // crosses this bridge - it is a plain "please re-read
  // characterPresetStorage yourself" signal (see
  // HairPaintPrototype.tsx/DesktopAvatarScene.tsx), since both windows
  // already read/write the same IndexedDB directly (same origin, no
  // partition set - see main.ts's resolveUrl()).
  notifyPresetSaved: () => ipcRenderer.invoke("desktop:notifyPresetSaved"),
  onCharacterPresetUpdated: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("character-preset-updated", listener);
    return () => ipcRenderer.removeListener("character-preset-updated", listener);
  },

  // Desktop <-> Editor Toon Style sync - identical shape/convention to the
  // CharacterPreset sync pair above, kept as its own separate signal since
  // Toon Style is an app-wide preference (localStorage, toonStyle.ts), not
  // part of CharacterPreset. No settings data crosses this bridge either -
  // both windows already read/write the same localStorage directly.
  notifyToonSettingsSaved: () => ipcRenderer.invoke("desktop:notifyToonSettingsSaved"),
  onToonSettingsUpdated: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("toon-settings-updated", listener);
    return () => ipcRenderer.removeListener("toon-settings-updated", listener);
  },

  // Avatar Scale - still thin IPC passthroughs, all business logic (anchor
  // math, workArea clamping, persistence) lives in main.ts's
  // applyAvatarScale(). resizeAvatarWindow is meant to be called
  // continuously (rAF-throttled by the caller) while the user drags the
  // size slider; setAvatarScale additionally persists and is only called
  // once, on release.
  getAvatarScale: () => ipcRenderer.invoke("desktop:getAvatarScale"),
  setAvatarScale: (scale: number) => ipcRenderer.invoke("desktop:setAvatarScale", scale),
  resizeAvatarWindow: (scale: number) => ipcRenderer.invoke("desktop:resizeAvatarWindow", scale),

  // CoWork Room multi-avatar grid (Desktop-avatar-rendering brief, section
  // 19) - still a thin IPC passthrough, all resize/anchor math lives in
  // main.ts's applyLayout().
  setParticipantCount: (count: number) => ipcRenderer.invoke("desktop:setParticipantCount", count),

  // Windows auto-update (electron/updater.ts owns all real state/logic -
  // every method here is still a thin IPC passthrough, same convention as
  // everything above). A no-op-shaped resolve in development (updater.ts's
  // own app.isPackaged guard), never a real GitHub check outside a packaged
  // build.
  getUpdateState: () => ipcRenderer.invoke("updater:getState"),
  checkForUpdates: () => ipcRenderer.invoke("updater:checkForUpdates"),
  downloadUpdate: () => ipcRenderer.invoke("updater:downloadUpdate"),
  installUpdate: () => ipcRenderer.invoke("updater:installUpdate"),
  onUpdateStatus: (callback: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
});
