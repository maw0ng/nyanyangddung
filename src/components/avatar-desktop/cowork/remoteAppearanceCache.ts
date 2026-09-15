/**
 * Module-level cache for DECODED overlay bitmaps, keyed by userId+revision
 * (section 36/37 - "signed URL 자체를 identity로 쓰지 않는다", identity is
 * always userId+revision+asset type). Deliberately caches only the decoded
 * `ImageBitmap`s (the expensive-to-reproduce part: network download + PNG
 * decode), never a live `THREE.Texture`/Material - each
 * RemoteAvatarInstance still builds its OWN CanvasTexture from these on
 * every apply, so two Avatar instances (or the same user leaving and
 * rejoining) never share a mutable GPU-side texture object (section 46/
 * 47/48's independence guarantee holds even with this cache in place).
 *
 * A cache hit on the SAME revision skips the network download + PNG decode
 * entirely; a miss (new revision, or first time seeing this user) replaces
 * the old entry and disposes its bitmaps (section 57 - ImageBitmap.close()
 * releases the decoded pixel buffer immediately rather than waiting on GC).
 */
export interface CachedOverlayBitmaps {
  revision: number;
  hair: ImageBitmap | null;
  faceBase: ImageBitmap | null;
  faceEye: ImageBitmap | null;
  tops: Record<string, ImageBitmap>;
  /** The equipped cosmetic's own paint overlay (CoWork appearance-sync-v2
   * brief section 26/27/33) - `null` when no cosmetic is equipped on this
   * revision, or the equipped one has no user paint. Cached/disposed
   * alongside the others, same userId+revision identity. */
  cosmetic: ImageBitmap | null;
}

const cache = new Map<string, CachedOverlayBitmaps>();

export function getCachedOverlayBitmaps(userId: string, revision: number): CachedOverlayBitmaps | null {
  const entry = cache.get(userId);
  return entry && entry.revision === revision ? entry : null;
}

function closeAll(entry: CachedOverlayBitmaps): void {
  entry.hair?.close?.();
  entry.faceBase?.close?.();
  entry.faceEye?.close?.();
  entry.cosmetic?.close?.();
  for (const bmp of Object.values(entry.tops)) bmp.close?.();
}

export function setCachedOverlayBitmaps(userId: string, entry: CachedOverlayBitmaps): void {
  const old = cache.get(userId);
  if (old && old !== entry) closeAll(old);
  cache.set(userId, entry);
}

/** Called when a participant leaves the Room (section 35) - releases their
 * cached bitmaps immediately rather than waiting for a revision bump that
 * may never come (they're gone). Never touches any OTHER user's cache
 * entry or the shared GLTF template (remoteAvatarLoader.ts). */
export function clearCachedOverlayBitmaps(userId: string): void {
  const old = cache.get(userId);
  if (!old) return;
  closeAll(old);
  cache.delete(userId);
}
