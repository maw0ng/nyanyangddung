/**
 * Single source of truth for the Desktop Avatar window's size/placement
 * (section 11/12 of the original desktop-interaction brief - "숫자를 여러
 * 파일에 하드코딩하지 말고 한 곳에서 관리한다"). Only electron/main.ts reads
 * this - it's Node-side config, separate from
 * src/components/avatar-desktop/desktopAvatarLayout.ts (the renderer-side
 * mirror of this same math - see that file's own comment on why it can't
 * just import this one across the electron/src boundary).
 *
 * As of the Avatar Scale feature, the window's size is no longer a fixed
 * constant - it's DERIVED from the user's avatarScale setting via
 * computeWindowSize() below. DESKTOP_WINDOW_WIDTH/HEIGHT still exist as the
 * scale=1.0 (100%) reference values, for any call site that only needs a
 * sane default before a real scale is known.
 */

export const AVATAR_SCALE_MIN = 0.5;
export const AVATAR_SCALE_MAX = 1.5;
export const AVATAR_SCALE_DEFAULT = 1.0;

/** The character's own render box at 100% scale - must match
 * src/components/avatar-desktop/desktopCameraConfig.ts's
 * DESKTOP_CHARACTER_CANVAS_WIDTH/HEIGHT exactly (kept as separate constants
 * only because electron/'s tsconfig.json can't import across the
 * electron/src boundary - see foregroundApp.ts's ForegroundAppInfo comment
 * for the same reason). */
const BASE_CANVAS_WIDTH = 450;
const BASE_CANVAS_HEIGHT = 600;
/** Extra height above the character reserved for AvatarProfileHUD at 100%
 * scale (nickname/level/EXP bar). */
const BASE_PROFILE_STRIP_HEIGHT = 46;
/** Extra height below the character reserved for the Timer HUD at 100%
 * scale. */
const BASE_HUD_STRIP_HEIGHT = 90;

/** HUD text/bar size is deliberately NOT allowed to shrink/grow as far as
 * the avatar itself (section 12 of the Avatar Scale brief - "50% Avatar에
 * 서도 닉네임/레벨/타이머를 읽을 수 있어야 한다"). Must match
 * desktopAvatarLayout.ts's own copy exactly. */
const HUD_SCALE_MIN = 0.8;
const HUD_SCALE_MAX = 1.25;

export function clampAvatarScale(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return AVATAR_SCALE_DEFAULT;
  return Math.min(AVATAR_SCALE_MAX, Math.max(AVATAR_SCALE_MIN, value));
}

export interface DesktopWindowSize {
  width: number;
  height: number;
  /** Broken out (not just the total height) so main.ts's resize-anchor
   * math can pin the avatar's own foot position (profileStrip + canvas
   * boundary) rather than an arbitrary window corner - see
   * applyAvatarScale() in main.ts. */
  profileStripHeight: number;
  canvasHeight: number;
  hudStripHeight: number;
}

/** avatarScale -> the window size that exactly fits
 * ProfileHUD + Avatar + TimerHUD + minimal padding at that scale (section
 * 14 of the Avatar Scale brief - never lets the window stay a fixed size
 * while the avatar inside it grows/shrinks). */
export function computeWindowSize(rawScale: number): DesktopWindowSize {
  const scale = clampAvatarScale(rawScale);
  const hudScale = Math.min(HUD_SCALE_MAX, Math.max(HUD_SCALE_MIN, scale));
  const width = Math.round(BASE_CANVAS_WIDTH * scale);
  const canvasHeight = Math.round(BASE_CANVAS_HEIGHT * scale);
  const profileStripHeight = Math.round(BASE_PROFILE_STRIP_HEIGHT * hudScale);
  const hudStripHeight = Math.round(BASE_HUD_STRIP_HEIGHT * hudScale);
  return {
    width,
    height: profileStripHeight + canvasHeight + hudStripHeight,
    profileStripHeight,
    canvasHeight,
    hudStripHeight,
  };
}

/** scale=1.0 reference size - used as the very first window's fallback
 * before any persisted avatarScale is known, and by anything that only
 * ever wants the default. */
const DEFAULT_SIZE = computeWindowSize(AVATAR_SCALE_DEFAULT);
export const DESKTOP_WINDOW_WIDTH = DEFAULT_SIZE.width;
export const DESKTOP_WINDOW_HEIGHT = DEFAULT_SIZE.height;

/** Distance in pixels from the work area's right/bottom edges when first
 * placing the window (section 12). */
export const DESKTOP_WINDOW_MARGIN = 20;

/** While dragging the CHARACTER (not resizing for a scale change), the
 * window is clamped so at least this many pixels of it stay within some
 * display's work area on both axes - enough to still grab/see it, without
 * forcing full containment (the brief explicitly allows the window to hang
 * off an edge during a manual drag). Avatar-scale-driven resizes use a
 * stricter *full* containment clamp instead - see main.ts's
 * clampFullyWithinWorkArea(). */
export const DESKTOP_WINDOW_MIN_VISIBLE_MARGIN = 80;

export const DEV_SERVER_URL = "http://localhost:3000";
/** Route the Desktop window opens by default. */
export const DESKTOP_ROUTE = "/desktop";
/** Route a normal, framed window opens for "다시 Avatar Editor 열기". */
export const EDITOR_ROUTE = "/hair-test";
/** Route a normal, framed window opens for the account/friend management
 * UI (section 24 of the account/friend-system brief) - never transparent/
 * frameless like the Desktop Avatar window. */
export const FRIENDS_ROUTE = "/friends";
/** Route a normal, framed window opens for the Room-Code co-working UI
 * (section 43 of the cowork-room brief) - same "never transparent/
 * frameless" rule as FRIENDS_ROUTE above. */
export const COWORK_ROUTE = "/cowork";

// ============================================================================
// Multi-Avatar Desktop grid (Desktop-avatar-rendering brief) - mirrored
// (not imported, same electron/src boundary reason as everything else in
// this file) by src/components/avatar-desktop/desktopParticipantLayout.ts.
// MUST stay numerically identical to that file's own copy of GRID_GAP, or
// the window Main sizes and the grid the Renderer actually draws into it
// will disagree (visible clipping/empty gap).
// ============================================================================

/** Gap in px between avatar slots in the grid - independent of avatarScale
 * (a fixed visual gutter, not a proportional one - matches
 * DESKTOP_WINDOW_MARGIN's own "always exactly N px" convention). */
export const GRID_GAP = 16;

// ============================================================================
// Character menu bounds expansion (bug fix - "설정창/메뉴가 BrowserWindow
// 크기 때문에 잘리는 문제") - mirrored (not imported, same electron/src
// boundary reason as everything else here) by
// src/components/avatar-desktop/menuPlacement.ts's own MenuExpansion type.
// ============================================================================

/** Extra px the transparent BrowserWindow needs beyond its current compact
 * grid size, one non-negative number per edge, ONLY while the character
 * menu is open and doesn't fit the compact window even after flipping to
 * its best side (PART 4/5/6 - collision detection first, window expansion
 * only as the fallback it's designed to rarely need). `left`/`top` also
 * describe how far the window's own x/y must shift (see applyMenuExpansion
 * in main.ts) - the Renderer shifts its own content the OPPOSITE way by the
 * same amount so the avatar's on-screen position never jumps (PART 7). */
export interface MenuExpansion {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const ZERO_MENU_EXPANSION: MenuExpansion = { left: 0, right: 0, top: 0, bottom: 0 };

/** Per-avatar-slot geometry for a given participantCount, derived from the
 * same computeWindowSize() single-avatar math (section 19 - "정확한 px은
 * 현재 desktop camera/avatarScale/HUD 크기를 조사해서 결정" - this reuses
 * that existing math rather than inventing new numbers). Remote slots now
 * include the same hudStripHeight as Local (RemoteTimerHUD - cowork-
 * timer-sync brief section 43) - so remoteSlotHeight and localSlotHeight
 * are numerically equal, kept as separate named fields only for call-site
 * clarity/documentation. */
export interface GridWindowSize {
  width: number;
  height: number;
  slot: DesktopWindowSize;
  remoteSlotHeight: number;
  localSlotHeight: number;
}

/**
 * participantCount -> overall transparent window size (section 19/20).
 * Layout (matches desktopParticipantLayout.ts's grid exactly - see that
 * file for the on-screen slot arrangement):
 *   1: 1 slot (identical to the pre-cowork single-avatar window - zero
 *      regression for the by-far-most-common "not in a room" case).
 *   2: 2 slots side by side, one row (remote left, local right).
 *   3/4: 2 columns x 2 rows - row 1 up to 2 remotes, row 2 holds the local
 *      slot (+ one remote when count=4). All rows are now the same height
 *      (see remoteSlotHeight's own doc comment above).
 */
export function computeGridWindowSize(avatarScale: number, participantCount: number): GridWindowSize {
  const slot = computeWindowSize(avatarScale);
  const remoteSlotHeight = slot.height;
  const localSlotHeight = slot.height;
  const count = Math.max(1, Math.min(4, Math.round(participantCount) || 1));

  if (count === 1) {
    return { width: slot.width, height: localSlotHeight, slot, remoteSlotHeight, localSlotHeight };
  }
  if (count === 2) {
    return { width: slot.width * 2 + GRID_GAP, height: localSlotHeight, slot, remoteSlotHeight, localSlotHeight };
  }
  // 3 and 4 both use a 2-column top row (even when count===3 only fills
  // one of those two top slots - desktopParticipantLayout.ts centers it)
  // so the window never has to resize again just because the 3rd member's
  // slot fills in to become the 4th.
  return {
    width: slot.width * 2 + GRID_GAP,
    height: remoteSlotHeight + GRID_GAP + localSlotHeight,
    slot,
    remoteSlotHeight,
    localSlotHeight,
  };
}
