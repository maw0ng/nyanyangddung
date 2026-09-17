/**
 * Pure geometry for the character menu's collision-avoiding placement (bug
 * fix - "설정창/메뉴가 Electron BrowserWindow 크기 때문에 잘리는 문제").
 * No dependency on Floating UI/Popper (PART 4's "무거운 dependency를
 * 불필요하게 추가하지 않는다") - this is the same flip-then-clamp idea,
 * hand-rolled for this one call site.
 *
 * Two-pass measurement (DesktopAvatarScene.tsx): the menu's actual height
 * varies with its content (profile/timer/cowork sections, settings view),
 * so it's rendered once, measured via a ref, and THEN placed correctly -
 * standard technique for a popover whose size isn't known in advance.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Extra pixels the containing BrowserWindow needs beyond its current
 * compact size, one non-negative number per edge - `left`/`top` also tell
 * the caller how far to shift the window's own x/y (and, to keep the
 * avatar's on-screen position unchanged, how far to shift the rendered
 * content the OPPOSITE way - see DesktopAvatarScene's `menuContentOffset`). */
export interface MenuExpansion {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const ZERO_EXPANSION: MenuExpansion = { left: 0, right: 0, top: 0, bottom: 0 };

function expansionsEqual(a: MenuExpansion, b: MenuExpansion): boolean {
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
}

export interface MenuPlacement {
  /** Position in CSS px, relative to the window's CURRENT (pre-expansion)
   * content origin - i.e. exactly what a `position: fixed` menu's
   * `left`/`top` should be once the caller has also applied
   * `menuContentOffset` (expansion.left/top) to the avatar/grid content
   * wrapper (see this module's own header comment). */
  left: number;
  top: number;
  /** How much the containing BrowserWindow needs to grow, if at all - all
   * zero when the menu already fits the current compact window via flipping
   * alone (the common case - PART 26's test list). */
  expansion: MenuExpansion;
}

/**
 * Where the menu should go, and how much (if any) extra BrowserWindow space
 * it needs (PART 4/5).
 *
 * `avatarRect` and `viewport` are both in the SAME coordinate space (the
 * window's current CSS content origin, i.e. what `getBoundingClientRect()`
 * already returns for anything inside it) - callers never need to
 * pre-offset either one.
 *
 * Horizontal: prefers hugging the avatar's right edge (matches this app's
 * existing menu convention - see desktopAvatarLayout.ts's old
 * menuAnchorFor/MENU_RIGHT_MARGIN); flips to the avatar's left edge if the
 * right side doesn't have room AND the left side has MORE room (never
 * flips into a side that's actually worse). Vertical: prefers aligning the
 * menu's top with the avatar's own top (existing MENU_TOP_WITHIN_CANVAS
 * convention); flips to bottom-aligned-above-the-avatar if there isn't
 * room below AND above has more room.
 *
 * Whatever position survives flipping can still overflow the viewport (the
 * window may simply be smaller than the menu in that dimension even in the
 * better-of-two-sides direction) - the overflow amount becomes `expansion`,
 * and the returned `left`/`top` are shifted so the menu never renders at a
 * negative position once the caller applies that expansion to the window.
 */
export function computeMenuPlacement(
  avatarRect: Rect,
  menuSize: Size,
  viewport: Size,
  margin = 8
): MenuPlacement {
  const rightSpace = viewport.width - (avatarRect.x + avatarRect.width);
  const leftSpace = avatarRect.x;
  const preferRight = rightSpace >= menuSize.width || rightSpace >= leftSpace;
  let left = preferRight ? avatarRect.x + avatarRect.width + margin : avatarRect.x - menuSize.width - margin;

  const belowSpace = viewport.height - avatarRect.y;
  const aboveSpace = avatarRect.y;
  const preferBelow = belowSpace >= menuSize.height || belowSpace >= aboveSpace;
  let top = preferBelow ? avatarRect.y : avatarRect.y + avatarRect.height - menuSize.height;
  // Never place the menu's top so far below that it starts under the
  // avatar's own bottom when aligning-with-top would already fit vertically -
  // clamp top to the avatar's own top whenever there's enough room below.
  if (preferBelow) top = avatarRect.y;

  let expandLeft = 0;
  let expandRight = 0;
  let expandTop = 0;
  let expandBottom = 0;

  if (left < 0) {
    expandLeft = -left;
    left = 0;
  }
  const rightEdge = left + menuSize.width;
  if (rightEdge > viewport.width + expandLeft) {
    expandRight = rightEdge - (viewport.width + expandLeft);
  }

  if (top < 0) {
    expandTop = -top;
    top = 0;
  }
  const bottomEdge = top + menuSize.height;
  if (bottomEdge > viewport.height + expandTop) {
    expandBottom = bottomEdge - (viewport.height + expandTop);
  }

  return {
    left,
    top,
    expansion: { left: expandLeft, right: expandRight, top: expandTop, bottom: expandBottom },
  };
}

export { expansionsEqual };
