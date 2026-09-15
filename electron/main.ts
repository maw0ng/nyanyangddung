/**
 * Electron main process for the miniWaffle Desktop Avatar. Owns exactly
 * two window kinds:
 *  - the transparent, frameless Desktop Avatar window (always exactly one,
 *    opened on app start, loading DESKTOP_ROUTE)
 *  - an on-demand normal (framed) Avatar Editor window, opened/focused via
 *    the "desktop:openEditor" IPC call (section 17 - "Desktop → Editor
 *    이동"), so the Editor never has to share the transparent window or
 *    its input handling.
 *
 * Security (section 3/16): every BrowserWindow uses
 * contextIsolation:true + nodeIntegration:false + a preload script: the
 * renderer never gets raw Node/Electron access, only whatever preload.ts
 * explicitly exposes via contextBridge.
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import path from "node:path";
import type { Server } from "node:http";
import {
  AVATAR_SCALE_DEFAULT,
  clampAvatarScale,
  computeWindowSize,
  computeGridWindowSize,
  DESKTOP_ROUTE,
  DESKTOP_WINDOW_MARGIN,
  DESKTOP_WINDOW_MIN_VISIBLE_MARGIN,
  DEV_SERVER_URL,
  EDITOR_ROUTE,
  FRIENDS_ROUTE,
  COWORK_ROUTE,
  type DesktopWindowSize,
} from "./desktopWindowConfig";
import { startStaticServer } from "./staticServer";
import { loadAvatarScale, loadWindowPosition, saveAvatarScale, saveWindowPosition } from "./windowState";
import { getForegroundApp, getRunningApps } from "./foregroundApp";
import { registerUpdaterIpc, setupAutoUpdater } from "./updater";

const isDev = !app.isPackaged;
const preloadPath = path.join(__dirname, "preload.js");

let desktopWindow: BrowserWindow | null = null;
let editorWindow: BrowserWindow | null = null;
let friendsWindow: BrowserWindow | null = null;
let coworkWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let alwaysOnTopEnabled = true;
let staticServer: Server | null = null;
let staticServerBaseUrl: string | null = null;

/** In-memory mirror of the persisted avatarScale - initialized from disk in
 * computeInitialBounds() (before the window even exists) and kept in sync
 * by every applyLayout() call afterward, so every geometry function
 * below always has a same-tick-accurate "what size is the window
 * currently supposed to be" answer without re-reading disk each time. */
let currentAvatarScale = AVATAR_SCALE_DEFAULT;

/** In-memory mirror of the CURRENT CoWork Room's participant count
 * (Desktop-avatar-rendering brief, section 19) - defaults to 1 (no Room /
 * not logged in / Room member list not loaded yet, all render as the
 * single-avatar case). Updated only via "desktop:setParticipantCount",
 * called by the Renderer's useDesktopParticipants-driven effect whenever
 * the Room's active member count changes. Kept independent of
 * currentAvatarScale so either one changing alone still resizes correctly
 * against the other's current value. */
let currentParticipantCount = 1;

/** Bounds of the window (or a proposed one) at the drag's start - captured
 * once on "desktop:beginWindowDrag", read by every subsequent
 * "desktop:updateWindowDrag" delta so window motion is computed from a
 * single stable origin rather than accumulating float error frame to
 * frame (section 9/10). */
let dragStartBounds: { x: number; y: number } | null = null;

/** Bottom-right of the primary display's WORK area (never the raw screen
 * bounds, so the taskbar is never covered - section 7/12), clamped so the
 * window can't end up fully off-screen on an unusual/multi-monitor setup. */
function computeDefaultBounds(size: DesktopWindowSize) {
  const { workArea } = screen.getPrimaryDisplay();
  let x = workArea.x + workArea.width - size.width - DESKTOP_WINDOW_MARGIN;
  let y = workArea.y + workArea.height - size.height - DESKTOP_WINDOW_MARGIN;
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - size.width));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - size.height));
  return { x, y, width: size.width, height: size.height };
}

/** A saved position is only trusted if it still places at least the
 * minimum grabbable margin within SOME currently-connected display's work
 * area (section 12: "저장된 위치가 현재 monitor 구성에서 유효하지 않으면
 * 기본 위치로 fallback"). */
function isPositionStillValid(x: number, y: number, size: DesktopWindowSize): boolean {
  const windowRect = { x, y, width: size.width, height: size.height };
  return screen.getAllDisplays().some((display) => {
    const wa = display.workArea;
    const overlapX = Math.min(windowRect.x + windowRect.width, wa.x + wa.width) - Math.max(windowRect.x, wa.x);
    const overlapY =
      Math.min(windowRect.y + windowRect.height, wa.y + wa.height) - Math.max(windowRect.y, wa.y);
    return overlapX >= DESKTOP_WINDOW_MIN_VISIBLE_MARGIN && overlapY >= DESKTOP_WINDOW_MIN_VISIBLE_MARGIN;
  });
}

/** Reads the persisted avatarScale synchronously (before any renderer has
 * loaded - section "Avatar Scale와 Window Size를 구분") and computes the
 * window bounds to match it from the very first frame, so there is never a
 * visible "open at 100%, then snap to my real size" flash on launch. */
function computeInitialBounds() {
  currentAvatarScale = clampAvatarScale(loadAvatarScale() ?? AVATAR_SCALE_DEFAULT);
  const size = computeWindowSize(currentAvatarScale);
  const saved = loadWindowPosition();
  if (saved && isPositionStillValid(saved.x, saved.y, size)) {
    return { x: saved.x, y: saved.y, width: size.width, height: size.height };
  }
  return computeDefaultBounds(size);
}

/** Keeps at least DESKTOP_WINDOW_MIN_VISIBLE_MARGIN px of the window
 * within the work area of whichever display it's now nearest to - allows
 * hanging off an edge (never forces full containment) while guaranteeing
 * the user can always find and re-grab it, including across monitors
 * (section 11). Used for character DRAGS only - `size` is always the
 * window's current actual size (read from getBounds() at the call site),
 * never a stale constant, so this stays correct at any avatarScale. */
function clampToReachableArea(x: number, y: number, size: { width: number; height: number }) {
  const display = screen.getDisplayNearestPoint({
    x: x + size.width / 2,
    y: y + size.height / 2,
  });
  const wa = display.workArea;
  const minX = wa.x - size.width + DESKTOP_WINDOW_MIN_VISIBLE_MARGIN;
  const maxX = wa.x + wa.width - DESKTOP_WINDOW_MIN_VISIBLE_MARGIN;
  const minY = wa.y - size.height + DESKTOP_WINDOW_MIN_VISIBLE_MARGIN;
  const maxY = wa.y + wa.height - DESKTOP_WINDOW_MIN_VISIBLE_MARGIN;
  return {
    x: Math.round(Math.max(minX, Math.min(x, maxX))),
    y: Math.round(Math.max(minY, Math.min(y, maxY))),
  };
}

/** Stricter than clampToReachableArea - FULLY contains the window within
 * the given display's work area (section 14/16 of the Avatar Scale brief:
 * growing the window to fit a bigger avatar must never let part of that
 * avatar end up clipped off-screen, unlike a manual character drag, which
 * is allowed to hang off an edge on purpose). Falls back to anchoring at
 * the work area's own top-left if the window is literally bigger than the
 * whole work area (an extreme edge case - e.g. 150% on a small secondary
 * display), rather than producing an impossible negative-range clamp. */
function clampFullyWithinWorkArea(
  x: number,
  y: number,
  size: { width: number; height: number },
  display: Electron.Display
) {
  const wa = display.workArea;
  const maxX = Math.max(wa.x, wa.x + wa.width - size.width);
  const maxY = Math.max(wa.y, wa.y + wa.height - size.height);
  return {
    x: Math.round(Math.max(wa.x, Math.min(x, maxX))),
    y: Math.round(Math.max(wa.y, Math.min(y, maxY))),
  };
}

/** The single place the window is ever resized for an avatarScale AND/OR
 * participantCount change (section 15/19: "Avatar size/참가자 수의 source
 * of truth는 avatarScale/Room membership, Window size는 그 결과"). Always
 * fully clamps into whichever display the window is currently on (section
 * 17/49), never the primary display by default.
 *
 * Anchoring (section 18/48):
 *   - Whenever BOTH the old and new state are the single-avatar case
 *     (participantCount 1 -> 1), this reproduces the EXACT original
 *     avatarScale-only anchor math byte-for-byte (the avatar's own foot
 *     point + the window's horizontal center) - the overwhelmingly common
 *     "not in a Room" resize path (settings slider) never regresses
 *     (section 75).
 *   - Otherwise (entering/leaving/resizing within a multi-avatar grid),
 *     anchors on the window's own BOTTOM-RIGHT corner instead. Local's own
 *     slot is always the bottom-right cell of the grid (see
 *     src/components/avatar-desktop/cowork/desktopParticipantLayout.ts's
 *     assignParticipantGrid), so holding that corner fixed keeps Local's
 *     own avatar roughly stationary as the grid grows/shrinks around it,
 *     without needing this file to track an arbitrary N-slot grid's
 *     per-cell geometry (which only the Renderer's layout code knows).
 */
function applyLayout(rawScale: number, participantCount?: number) {
  const nextScale = clampAvatarScale(rawScale);
  const nextCount = Math.max(1, Math.min(4, Math.round(participantCount ?? currentParticipantCount) || 1));
  if (!desktopWindow) {
    currentAvatarScale = nextScale;
    currentParticipantCount = nextCount;
    return;
  }
  if (nextScale === currentAvatarScale && nextCount === currentParticipantCount) return;

  const oldGrid = computeGridWindowSize(currentAvatarScale, currentParticipantCount);
  const newGrid = computeGridWindowSize(nextScale, nextCount);
  const bounds = desktopWindow.getBounds();

  let proposedX: number;
  let proposedY: number;
  if (currentParticipantCount === 1 && nextCount === 1) {
    const oldSlot = oldGrid.slot;
    const newSlot = newGrid.slot;
    const oldFootY = bounds.y + oldSlot.profileStripHeight + oldSlot.canvasHeight;
    const oldCenterX = bounds.x + bounds.width / 2;
    proposedX = Math.round(oldCenterX - newSlot.width / 2);
    proposedY = Math.round(oldFootY - newSlot.profileStripHeight - newSlot.canvasHeight);
  } else {
    const oldRight = bounds.x + bounds.width;
    const oldBottom = bounds.y + bounds.height;
    proposedX = Math.round(oldRight - newGrid.width);
    proposedY = Math.round(oldBottom - newGrid.height);
  }

  const display = screen.getDisplayMatching(bounds);
  const clamped = clampFullyWithinWorkArea(proposedX, proposedY, newGrid, display);

  currentAvatarScale = nextScale;
  currentParticipantCount = nextCount;
  desktopWindow.setBounds({ x: clamped.x, y: clamped.y, width: newGrid.width, height: newGrid.height });
}

async function resolveUrl(route: string): Promise<string> {
  if (isDev) return `${DEV_SERVER_URL}${route}`;
  if (!staticServerBaseUrl) {
    const outDir = path.join(process.resourcesPath, "out-electron");
    const { server, baseUrl } = await startStaticServer(outDir);
    staticServer = server;
    staticServerBaseUrl = baseUrl;
  }
  return `${staticServerBaseUrl}${route}`;
}

async function createDesktopWindow() {
  const bounds = computeInitialBounds();

  desktopWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    alwaysOnTop: alwaysOnTopEnabled,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  // Belt-and-suspenders: some Windows/Electron combinations only honor a
  // fully-transparent backgroundColor if it's also set post-construction.
  desktopWindow.setBackgroundColor("#00000000");

  const url = await resolveUrl(DESKTOP_ROUTE);
  await desktopWindow.loadURL(url);

  desktopWindow.on("closed", () => {
    desktopWindow = null;
  });
}

function focusOrCreateEditorWindow() {
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.focus();
    return;
  }
  editorWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "miniWaffle Avatar Editor",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });
  resolveUrl(EDITOR_ROUTE).then((url) => editorWindow?.loadURL(url));
  editorWindow.on("closed", () => {
    editorWindow = null;
  });
}

/** Account/friend management window (section 24/25 of the account/
 * friend-system brief) - same "focus existing instead of duplicating"
 * pattern as focusOrCreateEditorWindow above, reused verbatim rather than
 * rebuilding window-management logic. A normal framed, resizable window -
 * the Desktop Avatar window's transparent/frameless/click-through setup is
 * never applied here (section 24). */
function focusOrCreateFriendsWindow() {
  if (friendsWindow && !friendsWindow.isDestroyed()) {
    friendsWindow.focus();
    return;
  }
  friendsWindow = new BrowserWindow({
    width: 500,
    height: 650,
    resizable: true,
    title: "miniWaffle 친구",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });
  resolveUrl(FRIENDS_ROUTE).then((url) => friendsWindow?.loadURL(url));
  friendsWindow.on("closed", () => {
    friendsWindow = null;
  });
}

/** Room-code co-working window (section 43 of the cowork-room brief) - the
 * exact same "focus existing instead of duplicating" pattern as
 * focusOrCreateEditorWindow/focusOrCreateFriendsWindow above, reused
 * verbatim rather than inventing a third window-management approach. A
 * normal framed, resizable window, never the Desktop Avatar window's
 * transparent/frameless/click-through setup (section 43). */
function focusOrCreateCoworkWindow() {
  if (coworkWindow && !coworkWindow.isDestroyed()) {
    coworkWindow.focus();
    return;
  }
  coworkWindow = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: true,
    title: "miniWaffle 같이 작업하기",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });
  resolveUrl(COWORK_ROUTE).then((url) => coworkWindow?.loadURL(url));
  coworkWindow.on("closed", () => {
    coworkWindow = null;
  });
}

// A tiny embedded 16x16 PNG (no external asset file/new dependency) - just
// enough for a real, non-empty Tray icon. Section 17 explicitly asks for
// "최소한만" here, not icon polish.
const TRAY_ICON_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgoAV49+DEf2yYIs1EGUJIM15DiNWM1RBSNWMYMmoAFQygOBqpkpCINQSvZkKGEKWZVAAATLcu69QlXAQAAAAASUVORK5CYII=";

/** section 17's "복잡한 Tray 메뉴는 만들지 않는다" - exactly two items:
 * bring the Desktop Avatar back after "숨기기", and quit. This is also the
 * only way back once the window is hidden, since this app intentionally
 * has no other "always reachable" surface (no title bar, no dock icon on
 * Windows) - skipping it would risk the "다시 열 수 없는 구조" the brief
 * explicitly forbids. */
function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_BASE64, "base64"));
  tray = new Tray(icon);
  tray.setToolTip("miniWaffle Desktop Avatar");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "캐릭터 표시",
        click: () => {
          if (desktopWindow) {
            desktopWindow.show();
          } else {
            createDesktopWindow();
          }
        },
      },
      { type: "separator" },
      { label: "종료", click: () => app.quit() },
    ])
  );
  tray.on("click", () => {
    if (desktopWindow) desktopWindow.show();
  });
}

ipcMain.handle("desktop:setAlwaysOnTop", (_event, enabled: boolean) => {
  alwaysOnTopEnabled = enabled;
  desktopWindow?.setAlwaysOnTop(enabled);
});

ipcMain.handle("desktop:getAlwaysOnTop", () => alwaysOnTopEnabled);

ipcMain.handle("desktop:openEditor", () => {
  focusOrCreateEditorWindow();
});

ipcMain.handle("desktop:openFriends", () => {
  focusOrCreateFriendsWindow();
});

ipcMain.handle("desktop:openCowork", () => {
  focusOrCreateCoworkWindow();
});

// ---- Avatar Scale (section 3/7/15) -----------------------------------------
// getAvatarScale/resizeAvatarWindow/setAvatarScale all funnel through the
// same in-memory currentAvatarScale + applyLayout() - see their doc
// comments above. resizeAvatarWindow is called continuously (rAF-throttled
// on the Renderer side) while the user drags the slider for live visual
// feedback; setAvatarScale additionally persists to disk and is only
// called once, on release (section 7/9/33 - never write-per-tick).
ipcMain.handle("desktop:getAvatarScale", () => currentAvatarScale);

ipcMain.handle("desktop:resizeAvatarWindow", (_event, scale: number) => {
  applyLayout(scale);
});

ipcMain.handle("desktop:setAvatarScale", (_event, scale: number) => {
  applyLayout(scale);
  saveAvatarScale(currentAvatarScale);
});

// ---- CoWork Room participant count -> window grid size (section 19) -------
// Called by the Renderer whenever useDesktopParticipants's participant
// count changes (Room join/leave/member Realtime event/app-restart
// restore) - never written to disk (unlike avatarScale), since it's
// derived live from Room membership each time, not a user preference.
ipcMain.handle("desktop:setParticipantCount", (_event, count: number) => {
  applyLayout(currentAvatarScale, count);
});

// ---- Click-through (section 3/6) -----------------------------------------
// `forward: true` keeps mousemove events reaching the Renderer even while
// clicks pass through to whatever is behind the window - required so the
// Renderer's own hover/raycast logic can detect "the cursor is now over
// the character" and call this again with `false` to restore interaction.
// Without `forward`, ignoring mouse events would also stop delivering the
// very mousemove events needed to ever turn it back off.
ipcMain.handle("desktop:setClickThrough", (_event, ignore: boolean) => {
  if (!desktopWindow) return;
  if (ignore) desktopWindow.setIgnoreMouseEvents(true, { forward: true });
  else desktopWindow.setIgnoreMouseEvents(false);
});

// ---- Window drag (section 8/9/10) -----------------------------------------
// The character never moves in 3D world space - dragging it moves the
// BrowserWindow itself. The Renderer accumulates mouse movement (its own
// pointermove `movementX/Y`, robust to the window shifting under a fixed
// OS cursor mid-drag) and reports the running total; Main just re-applies
// it against the bounds captured once at drag start, so float error never
// accumulates frame to frame.
ipcMain.handle("desktop:beginWindowDrag", () => {
  if (!desktopWindow) return;
  const bounds = desktopWindow.getBounds();
  dragStartBounds = { x: bounds.x, y: bounds.y };
});

ipcMain.handle("desktop:updateWindowDrag", (_event, deltaX: number, deltaY: number) => {
  if (!desktopWindow || !dragStartBounds) return;
  const currentSize = desktopWindow.getBounds();
  const next = clampToReachableArea(dragStartBounds.x + deltaX, dragStartBounds.y + deltaY, currentSize);
  desktopWindow.setPosition(next.x, next.y);
});

ipcMain.handle("desktop:endWindowDrag", () => {
  dragStartBounds = null;
  if (!desktopWindow) return;
  const bounds = desktopWindow.getBounds();
  saveWindowPosition({ x: bounds.x, y: bounds.y });
});

// ---- Hide / quit (section 17/18) -------------------------------------------
ipcMain.handle("desktop:hideWindow", () => {
  desktopWindow?.hide();
});

ipcMain.handle("desktop:quit", () => {
  app.quit();
});

// ---- Program-tracking timer: Windows foreground detection ------------------
// Both handlers catch internally in foregroundApp.ts and resolve to
// null/[] rather than throwing - a failed OS lookup must never surface as
// an IPC rejection that could leave the Renderer's timer state stuck.
ipcMain.handle("desktop:getForegroundApp", () => getForegroundApp());
ipcMain.handle("desktop:getRunningApps", () => getRunningApps());

// ---- Desktop <-> Editor CharacterPreset sync -------------------------------
// Fired by the Editor window after it saves/switches a CharacterPreset
// (HairPaintPrototype.tsx) - relayed to the Desktop window only (never
// back to whichever window called this, and never broadcast to windows
// that don't exist), which re-reads characterPresetStorage itself rather
// than receiving any appearance data over this channel.
ipcMain.handle("desktop:notifyPresetSaved", () => {
  desktopWindow?.webContents.send("character-preset-updated");
});

app.whenReady().then(() => {
  createTray();
  createDesktopWindow();
  registerUpdaterIpc();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createDesktopWindow();
  });
});

app.on("window-all-closed", () => {
  staticServer?.close();
  if (process.platform !== "darwin") app.quit();
});
