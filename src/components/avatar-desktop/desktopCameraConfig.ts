/**
 * Desktop Mode's own fixed camera framing - deliberately separate from
 * Avatar Editor's (HairPaintPrototype.tsx uses a drei <Bounds> auto-fit
 * camera, tuned for an editor viewport). Desktop Mode uses a portrait
 * (~450x600) transparent window and plays Idle continuously, so an
 * auto-fit camera would visibly drift as the animation moves bones -
 * a small, fixed, hand-tuned transform is used instead. All three values
 * live here only, so re-tuning framing never means hunting through JSX.
 */

export const DESKTOP_CAMERA_POSITION: [number, number, number] = [0, 0.25, 1.12];
export const DESKTOP_CAMERA_FOV = 30;
/** Where the camera looks - roughly the character's chest/head height,
 * not the world origin (which sits at its feet). */
export const DESKTOP_CAMERA_TARGET: [number, number, number] = [0, 0.25, 0];

/**
 * The Canvas's own fixed pixel box - matches what DESKTOP_WINDOW_WIDTH/
 * HEIGHT were before the Timer HUD strip was added below the character
 * (electron/desktopWindowConfig.ts). Kept as an explicit, separate size
 * (rather than letting the Canvas fill 100% of a taller window) so the
 * character's on-screen framing tuned above stays byte-for-byte identical
 * regardless of how much extra window height the HUD strip needs -
 * growing/shrinking the HUD never resizes, and therefore never rescales or
 * repositions, the character.
 */
export const DESKTOP_CHARACTER_CANVAS_WIDTH = 450;
export const DESKTOP_CHARACTER_CANVAS_HEIGHT = 600;
