/**
 * Tunable constants for the Desktop Timer HUD's placement - kept separate
 * from magic numbers in TimerHUD.tsx itself, matching this project's
 * existing convention (see ../desktopCameraConfig.ts / desktopInteractionConfig.ts).
 *
 * The HUD is no longer positioned via a BrowserWindow-relative pixel
 * offset (that broke the moment the resizable Desktop window was resized
 * larger than its default 450x600, since a `left:0;right:0` fixed-position
 * HUD centers on the whole window while the character stays pinned inside
 * its own fixed-size DesktopAvatarArea box - see DesktopAvatarScene.tsx).
 * The HUD is now simply the next flex child directly below
 * AvatarViewport inside DesktopAvatarArea, so it is glued to the
 * character's actual box regardless of window size - only the small gap
 * between them is a tunable constant now. */
export const TIMER_HUD_GAP = 8;

/** How often TimerHUD re-reads TimerEngine.getElapsedMs() and re-renders
 * itself - entirely local to TimerHUD, never triggers a DesktopAvatarScene
 * or R3F rerender (section 45). */
export const TIMER_HUD_TICK_INTERVAL_MS = 1000;
