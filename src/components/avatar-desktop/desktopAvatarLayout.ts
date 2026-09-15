/**
 * Renderer-side single source of truth for every measurement that depends
 * on avatarScale (section 34 of the Avatar Scale brief - "여러 컴포넌트에
 * magic number가 퍼지지 않게 한다"): the Canvas's own pixel box, the HUD
 * strip heights above/below it, the resulting window size, the HUD text/
 * bar scale, and where the floating menu anchors. DesktopAvatarScene.tsx,
 * DesktopMenu.tsx, TimerHUD.tsx and the growth HUD components all read
 * from here rather than computing their own scaled numbers.
 *
 * Mirrored (not imported - electron/'s tsconfig.json can't cross the
 * electron/src boundary, see foregroundApp.ts's ForegroundAppInfo comment
 * for the same reason) by electron/desktopWindowConfig.ts's own
 * computeWindowSize(). The BASE_* constants and HUD_SCALE_MIN/MAX below
 * MUST stay numerically identical to that file's copies, or the window
 * Main creates and the layout the Renderer draws into it will disagree.
 */
import {
  DESKTOP_CHARACTER_CANVAS_HEIGHT,
  DESKTOP_CHARACTER_CANVAS_WIDTH,
} from "./desktopCameraConfig";

export const AVATAR_SCALE_MIN = 0.5;
export const AVATAR_SCALE_MAX = 1.5;
export const AVATAR_SCALE_DEFAULT = 1.0;
/** Quick presets (section 30) - 50/75/100/125/150%. */
export const AVATAR_SCALE_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5] as const;

/** HUD text/bar size is deliberately NOT allowed to shrink/grow as far as
 * the avatar itself (section 12 - "50% Avatar에서도 닉네임/레벨/타이머를
 * 읽을 수 있어야 한다"). Must match electron/desktopWindowConfig.ts's own
 * copy exactly. */
const HUD_SCALE_MIN = 0.8;
const HUD_SCALE_MAX = 1.25;

const BASE_CANVAS_WIDTH = DESKTOP_CHARACTER_CANVAS_WIDTH;
const BASE_CANVAS_HEIGHT = DESKTOP_CHARACTER_CANVAS_HEIGHT;
const BASE_PROFILE_STRIP_HEIGHT = 46;
const BASE_HUD_STRIP_HEIGHT = 90;

/** The floating menu's tuned-at-100% offset from the top of the canvas
 * (70 - 46 = 24, see desktopInteractionConfig.ts's old MENU_ANCHOR
 * history) - scales with avatarScale since it's meant to track a point on
 * the character (roughly chest height), not a page-relative constant. */
const MENU_TOP_WITHIN_CANVAS = 24;
/** Right-edge margin the menu keeps from the window's own right edge,
 * regardless of scale. */
const MENU_RIGHT_MARGIN = 8;
const MENU_MIN_LEFT = 4;

export function clampAvatarScale(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return AVATAR_SCALE_DEFAULT;
  return Math.min(AVATAR_SCALE_MAX, Math.max(AVATAR_SCALE_MIN, value));
}

export interface DesktopAvatarLayout {
  avatarScale: number;
  /** Independent, more conservative scale factor for HUD text/bars/gaps -
   * see hudScaleFor() below. */
  hudScale: number;
  canvasWidth: number;
  canvasHeight: number;
  profileStripHeight: number;
  hudStripHeight: number;
  windowWidth: number;
  windowHeight: number;
}

function hudScaleFor(avatarScale: number): number {
  return Math.min(HUD_SCALE_MAX, Math.max(HUD_SCALE_MIN, avatarScale));
}

/**
 * avatarScale -> every derived measurement Desktop Mode's layout needs.
 * Pure function, cheap enough to call on every render (no memoization
 * needed) - never touches the DOM/IPC/storage itself.
 */
export function computeDesktopAvatarLayout(rawScale: number): DesktopAvatarLayout {
  const avatarScale = clampAvatarScale(rawScale);
  const hudScale = hudScaleFor(avatarScale);
  const canvasWidth = Math.round(BASE_CANVAS_WIDTH * avatarScale);
  const canvasHeight = Math.round(BASE_CANVAS_HEIGHT * avatarScale);
  const profileStripHeight = Math.round(BASE_PROFILE_STRIP_HEIGHT * hudScale);
  const hudStripHeight = Math.round(BASE_HUD_STRIP_HEIGHT * hudScale);
  return {
    avatarScale,
    hudScale,
    canvasWidth,
    canvasHeight,
    profileStripHeight,
    hudStripHeight,
    windowWidth: canvasWidth,
    windowHeight: profileStripHeight + canvasHeight + hudStripHeight,
  };
}

/** Where the floating menu anchors (section 21/26) - tracks the avatar's
 * own position/scale instead of a fixed pixel offset, and keeps its right
 * edge a fixed margin inside the window's current (scale-dependent) width
 * rather than overflowing it at small scales. */
export function menuAnchorFor(layout: DesktopAvatarLayout, menuWidth: number): { top: number; left: number } {
  const idealLeft = layout.windowWidth - menuWidth - MENU_RIGHT_MARGIN;
  const left = Math.max(MENU_MIN_LEFT, idealLeft);
  const top = layout.profileStripHeight + Math.round(MENU_TOP_WITHIN_CANVAS * layout.avatarScale);
  return { top, left };
}
