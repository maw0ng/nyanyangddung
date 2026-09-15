/**
 * Tunable constants for CoWork Room timer/status sync (sections 10/20) -
 * kept separate from magic numbers in the sync/read hooks, matching this
 * project's existing convention (see ../desktopCameraConfig.ts /
 * ../desktopInteractionConfig.ts).
 */

/** How often the write-side hook re-upserts the CURRENT projection while
 * a Room is active and the local Timer isn't idle - purely for stale
 * detection/reconnect reconciliation (section 10), never a Timer tick
 * (state-transition upserts - Start/Pause/Resume/Stop/etc - already fire
 * immediately and independently of this interval - see
 * useCoworkTimerSync.ts). */
export const COWORK_HEARTBEAT_MS = 45_000;

/** A member's state row older than this (now - updatedAt) is treated as
 * stale (section 19/20) - "상태 확인 중", Timer stops advancing, Remote
 * Avatar animation falls back to Idle. Generous margin over
 * COWORK_HEARTBEAT_MS so ordinary network jitter/a single missed heartbeat
 * never flips a still-connected participant to stale. */
export const COWORK_STALE_MS = 150_000;
