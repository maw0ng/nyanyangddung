/**
 * Tunable constants for Desktop Mode's character interaction (click-
 * through, drag-vs-click, menu placement) - kept in one place per this
 * project's established convention (see desktopCameraConfig.ts) rather
 * than scattered as magic numbers through the interaction/menu code.
 */

/** Pointer movement (px, screen-space) before a press-on-character is
 * treated as a drag instead of a click (section 8/13). */
export const DRAG_THRESHOLD_PX = 5;
