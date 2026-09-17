import * as THREE from "three";
import { avatarAppearanceService } from "../../../lib/supabase/avatarAppearanceService";
import { getCachedOverlayBitmaps, setCachedOverlayBitmaps, type CachedOverlayBitmaps } from "./remoteAppearanceCache";
import {
  attachCosmetic,
  detachCosmetic,
  applyCosmeticTransform,
  type CosmeticAttachmentResult,
} from "../../hair-prototype/cosmetics/cosmeticAttachment";
import { getCosmeticDefinition } from "../../hair-prototype/cosmetics/cosmeticRegistry";
import { COSMETIC_FALLBACK_CANVAS_SIZE, createColorFillCanvas } from "../../hair-prototype/cosmetics/cosmeticColorFallback";
import { updateToonMaterial } from "../../hair-prototype/toonMaterialFactory";
import { DEFAULT_TOON_SETTINGS, type MaterialCategory } from "../../hair-prototype/toonStyle";
import type { NetworkAppearanceManifest, NetworkCosmeticHead } from "../../../lib/supabase/database.types";
import { devLog } from "../../../lib/devLog";

/** One mesh/materialIndex slot this appearance surface controls, captured
 * once when RemoteAvatarInstance builds its clone (section 46/47 - the
 * `material` here is already an instance-owned MeshToonMaterial, never
 * shared with any other Avatar). `originalTexture` is the untouched GLB
 * texture for this slot (null for HairCanvas, which never had one -
 * section 4/5) - kept so a manifest with no overlay for this surface can
 * cleanly revert to it (section 30). */
export interface AppearanceSurfaceTarget {
  material: THREE.MeshToonMaterial;
  originalTexture: THREE.Texture | null;
  /** true for Hair (matches MiniWaffleHairScene's own flipY=true override),
   * false for Face/Tops (matches LayerStackEngine's own flipY=false
   * default) - section 10/55, reused exactly, never recomputed. */
  flipY: boolean;
}

/** One cloned material this instance owns, tagged with the SAME
 * MaterialCategory createToonMaterial() originally built it with (bug fix -
 * "친구의 Toon 값이 Remote Avatar에 동기화되지 않음": every remote material
 * used to be permanently built with DEFAULT_TOON_SETTINGS at clone time and
 * never revisited). Covers EVERY cloned material, not just the paintable
 * hair/face/tops surfaces above - Body-base/Body-Parts/head-back (category
 * "bodyParts") have no paint overlay of their own but still need their
 * gradient/shading updated to match the manifest owner's Toon settings. */
export interface ToonTarget {
  material: THREE.MeshToonMaterial;
  category: MaterialCategory;
}

export interface AppearanceTargets {
  hair: AppearanceSurfaceTarget[];
  faceBase: AppearanceSurfaceTarget[];
  faceEye: AppearanceSurfaceTarget[];
  topsByMaterial: Record<string, AppearanceSurfaceTarget[]>;
  /** Every cloned mesh with its own morphTargetDictionary/
   * morphTargetInfluences - "Body" (96 facial Shape Keys) and "Body-base"
   * (the single "shrink" body-shape Shape Key), mirroring the SAME two
   * meshes FacePaintScene's morphMeshesFor() reads/writes for Local
   * (bug fix - "Body Morph가 Remote Avatar에 동기화되지 않음": this used to
   * be a single mesh, which silently dropped "shrink" entirely since it
   * lives on a different mesh than the facial Shape Keys). */
  bodyMorphMeshes: THREE.Mesh[];
  /** This instance's own "Head" bone (found in its own SkeletonUtils clone -
   * section 21/28) - the SAME attachment point cosmeticAttachment.ts's
   * attachCosmetic() already uses for Local/Desktop, reused here as-is
   * (section 26). `null` when this GLB build has no such bone (section 23 -
   * cosmetics are simply never attached for this instance, never a crash). */
  headBone: THREE.Object3D | null;
  /** Every cloned material this instance owns, for the per-user Toon apply
   * below - see ToonTarget's own doc comment. */
  toonTargets: ToonTarget[];
}

/** One remote instance's currently-attached head cosmetic, if any (section
 * 21/26/30) - held in a plain mutable object (not React state) by
 * RemoteAvatarInstance, exactly like `appearanceTargetsRef`/`appliedRevisionRef`
 * already are, since this is imperative Three.js scene-graph state, not UI
 * state. */
export interface CosmeticAppearanceState {
  cosmeticId: string | null;
  attachment: CosmeticAttachmentResult | null;
}

export function createEmptyCosmeticAppearanceState(): CosmeticAppearanceState {
  return { cosmeticId: null, attachment: null };
}

/** Detaches/disposes whatever this instance's cosmetic state currently
 * holds (section 34/35 - Room leave / instance unmount cleanup). Never
 * touches the shared, cached accessory GLB template (cosmeticAssetLoader.ts)
 * or any OTHER instance's own attachment - only this state's own
 * instance-owned clone/materials (mirrors detachCosmetic's own contract). */
export function disposeCosmeticAppearanceState(state: CosmeticAppearanceState): void {
  detachCosmetic(state.attachment);
  state.cosmeticId = null;
  state.attachment = null;
}

function applyTexture(targets: AppearanceSurfaceTarget[], texture: THREE.Texture | null) {
  for (const t of targets) {
    t.material.map = texture;
    t.material.needsUpdate = true;
  }
}

/** original + overlay -> one composite CanvasTexture, or just `original`
 * unchanged when there's no overlay for this surface (section 30 - also
 * correctly REVERTS a previous revision's composite back to the plain
 * original when the user removes their customization). Mirrors
 * LayerStackEngine's own flipY/colorSpace conventions exactly (section 10/
 * 45/55/56) rather than recomputing them. */
function buildSurfaceTexture(
  original: THREE.Texture | null,
  overlay: ImageBitmap | null,
  flipY: boolean
): THREE.Texture | null {
  if (!overlay) return original;

  const size = overlay.width || overlay.height;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const originalImage = original?.image as CanvasImageSource | undefined;
  if (originalImage) ctx.drawImage(originalImage, 0, 0, size, size);
  ctx.drawImage(overlay, 0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = flipY;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** original (texture or flat color) + overlay -> one CanvasTexture per
 * cosmetic material surface (section 27/40) - mirrors buildSurfaceTexture's
 * own original+overlay compositing above, and cosmeticColorFallback.ts's
 * "no base texture -> flat color canvas" strategy the LOCAL CosmeticPaintScene
 * already relies on (reused here verbatim, not reimplemented), so a
 * color-only accessory (cat_ears/bear_ears) composites correctly here too.
 * `flipY=false` matches glTF/LayerStackEngine's own convention (section 10),
 * exactly like the cosmetic's original `.map` texture already had. */
function applyCosmeticSurfaceTexture(surface: CosmeticAttachmentResult["surfaces"][number], overlay: ImageBitmap | null): void {
  const size =
    (surface.originalImage as { width?: number } | null)?.width ||
    overlay?.width ||
    COSMETIC_FALLBACK_CANVAS_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  if (surface.originalImage) {
    ctx.drawImage(surface.originalImage as CanvasImageSource, 0, 0, size, size);
  } else {
    ctx.drawImage(createColorFillCanvas(surface.originalColor, size), 0, 0, size, size);
  }
  if (overlay) ctx.drawImage(overlay, 0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  surface.material.map = texture;
  surface.material.needsUpdate = true;
}

/**
 * Prepares (and, once ready, commits) this revision's head cosmetic against
 * `state` (section 21/26/28/29/30/31/32):
 *   - `head` null -> detaches whatever was attached, clears state.
 *   - same cosmeticId already attached -> keeps the existing attachment
 *     (never re-downloads/re-clones the GLB - section 33), just re-applies
 *     the (possibly-changed) transform and paint overlay.
 *   - different/no cosmeticId attached -> detaches the old one (if any) and
 *     attaches the new one via cosmeticAttachment.ts's own attachCosmetic()
 *     (section 26/28 - own Armature/SkinnedMesh fully preserved, exactly
 *     like Local/Desktop), applying the manifest's saved transform as-is
 *     (never re-tuned against Rest Pose - section 29).
 * An unrecognized cosmeticId (already filtered out by
 * avatarAppearanceService's own sanitizeCosmeticHead, but checked again
 * here defensively) or a missing Head bone (section 23) is a silent no-op,
 * never a crash - `state` is simply left however it already was.
 */
async function applyCosmeticHead(
  headBone: THREE.Object3D | null,
  head: NetworkCosmeticHead | null,
  overlay: ImageBitmap | null,
  state: CosmeticAppearanceState,
  /** Same guard applyRemoteAppearance's own texture swap uses (section 41) -
   * checked again right before this function actually mutates `state`,
   * since attaching a cosmetic is itself an async GLB load that can be
   * outlived by an even newer revision's own apply. */
  isStillLatest: () => boolean
): Promise<void> {
  if (!headBone) return;

  if (!head) {
    if (isStillLatest() && state.attachment) disposeCosmeticAppearanceState(state);
    return;
  }

  const definition = getCosmeticDefinition(head.cosmeticId);
  if (!definition) return;

  const transform = { position: head.position, rotation: head.rotation, scale: head.scale };

  if (state.cosmeticId !== head.cosmeticId || !state.attachment) {
    let fresh: CosmeticAttachmentResult;
    try {
      fresh = await attachCosmetic(headBone, definition.assetPath, transform);
    } catch (err) {
      // Section 32 - a failed accessory load never takes down the rest of
      // the remote avatar's appearance; just no ear this revision.
      console.error(`[remoteAppearanceApply] failed to attach cosmetic "${head.cosmeticId}"`, err);
      return;
    }
    if (!isStillLatest()) {
      // A newer revision's own apply won the race while this GLB was
      // loading - discard what was just built rather than leaving a
      // superseded accessory attached (section 31/41).
      detachCosmetic(fresh);
      return;
    }
    if (state.attachment) disposeCosmeticAppearanceState(state);
    state.attachment = fresh;
    state.cosmeticId = head.cosmeticId;
  } else {
    if (!isStillLatest()) return;
    applyCosmeticTransform(state.attachment.attachmentRoot, transform);
  }

  for (const surface of state.attachment.surfaces) {
    applyCosmeticSurfaceTexture(surface, overlay);
  }
}

/** Returns the number of values actually written, for PART 29's
 * `[RemoteMorph] receivedCount=... appliedCount=...` diagnostic - a gap
 * between the two numbers means some published morph name doesn't exist in
 * ANY of this instance's meshes (never a crash, section 13). Value `0` is a
 * completely normal, intentional morph weight (section 9) - never treated
 * as "unset" anywhere in this function. Applies each name to EVERY mesh
 * that actually has it (bug fix - "Body Morph가 Remote Avatar에 동기화되지
 * 않음": "shrink" lives on a different mesh than the facial Shape Keys, so
 * a single-mesh apply silently dropped it; PART 2-12 also requires this
 * generally, for any name that happens to exist on more than one mesh). */
/** [MorphTrace] diagnostic test keys ("Remote Avatar Morph 동기화 안 됨") -
 * one representative name per category (morphConfig.ts), all confirmed to
 * exist in the live GLB's dictionary. Traced through Dictionary Match /
 * Influence Apply / several-frames-later below. */
const MORPH_TRACE_TEST_KEYS = ["shrink", "eye-smile_left", "ppl-lookL", "brw-oko_left", "mouth-smile"];

function applyMorphValues(meshes: THREE.Mesh[], morphValues: Record<string, number>): number {
  let applied = 0;
  for (const [name, value] of Object.entries(morphValues)) {
    const isTraceKey = MORPH_TRACE_TEST_KEYS.includes(name);
    for (const mesh of meshes) {
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      const index = mesh.morphTargetDictionary[name];
      // Unknown morph name on this mesh (a manifest from a newer/different
      // schema, a GLB mismatch, or simply "belongs to a different mesh") -
      // skip just this one, never throw (section 13).
      if (index === undefined) continue;
      const before = mesh.morphTargetInfluences[index];
      const next = Math.max(0, Math.min(1, value));
      mesh.morphTargetInfluences[index] = next;
      applied++;
      if (isTraceKey) {
        devLog(
          "[MorphTrace:DictionaryMatch] key=", name, "mesh=", mesh.name, "index=", index
        );
        devLog(
          "[MorphTrace:InfluenceApply] key=", name, "mesh=", mesh.name, "index=", index,
          "manifestValue=", value, "before=", before, "after=", mesh.morphTargetInfluences[index]
        );
        // Several-frames-later check (STEP 10) - read-only, no functional
        // change: confirms whether something (e.g. an AnimationMixer track)
        // silently overwrites this influence after this synchronous apply
        // returns. Purely diagnostic - never used as a fix.
        let framesLeft = 5;
        const mesh_ = mesh;
        const index_ = index;
        const expected = next;
        const checkFrame = () => {
          const current = mesh_.morphTargetInfluences?.[index_];
          devLog(
            "[MorphTrace:AfterFrames] key=", name, "framesLeft=", framesLeft,
            "expected=", expected, "current=", current
          );
          framesLeft--;
          if (framesLeft > 0) requestAnimationFrame(checkFrame);
        };
        requestAnimationFrame(checkFrame);
      }
    }
  }
  return applied;
}

/**
 * Applies one participant's published appearance to their already-cloned,
 * already-toon-wrapped Avatar targets (section 33/41/45/49). Downloads +
 * decodes only what isn't already cached for this exact revision (section
 * 36), builds every composite texture FIRST, then assigns them all in one
 * synchronous pass at the end (section 41 - never a frame where hair is
 * new but face is old) and finally writes morph values (section 48 -
 * independent per instance, since `targets` always belongs to exactly one
 * Avatar clone).
 *
 * Never touches AnimationMixer/skeleton/current action (section 49) -
 * purely material.map + morphTargetInfluences writes on meshes that
 * already exist; Work/Break/Idle keeps playing uninterrupted.
 */
export async function applyRemoteAppearance(
  userId: string,
  manifest: NetworkAppearanceManifest,
  targets: AppearanceTargets,
  /** Checked right before the atomic swap (section 41) - if a NEWER
   * revision's own apply has since started (and possibly already
   * finished) while this one was still downloading/compositing, this
   * call's textures are simply discarded instead of overwriting the
   * newer, already-correct ones. Defaults to always-true for any future
   * caller that doesn't need the guard. */
  isStillLatest: () => boolean = () => true,
  /** This instance's own head-cosmetic attachment state (section 21/26) -
   * omitted entirely means "this caller doesn't support cosmetics" (no
   * such caller exists yet, but keeps this function's older 3-arg call
   * shape valid). */
  cosmeticState?: CosmeticAppearanceState
): Promise<void> {
  let cached = getCachedOverlayBitmaps(userId, manifest.revision);
  if (!cached) {
    const topsEntries = Object.entries(manifest.topsOverlayPaths);
    const [hairRes, faceBaseRes, faceEyeRes, cosmeticRes, ...topsResults] = await Promise.all([
      avatarAppearanceService.downloadAsset(manifest.hairOverlayPath),
      avatarAppearanceService.downloadAsset(manifest.faceBaseOverlayPath),
      avatarAppearanceService.downloadAsset(manifest.faceEyeOverlayPath),
      avatarAppearanceService.downloadAsset(manifest.cosmeticOverlayPath),
      ...topsEntries.map(([, path]) => avatarAppearanceService.downloadAsset(path)),
    ]);

    async function decode(res: { ok: boolean; data?: Blob | null }): Promise<ImageBitmap | null> {
      if (!res.ok || !res.data) return null;
      try {
        return await createImageBitmap(res.data);
      } catch {
        // Section 44 - one bad asset must never take down the whole apply;
        // that surface just falls back to its original texture.
        return null;
      }
    }

    const [hair, faceBase, faceEye, cosmetic] = await Promise.all([
      decode(hairRes),
      decode(faceBaseRes),
      decode(faceEyeRes),
      decode(cosmeticRes),
    ]);
    const tops: Record<string, ImageBitmap> = {};
    for (let i = 0; i < topsEntries.length; i++) {
      const bmp = await decode(topsResults[i]);
      if (bmp) tops[topsEntries[i][0]] = bmp;
    }

    cached = { revision: manifest.revision, hair, faceBase, faceEye, tops, cosmetic };
    setCachedOverlayBitmaps(userId, cached);
  }

  const nonNullCache: CachedOverlayBitmaps = cached;
  const hairTexture = buildSurfaceTexture(
    targets.hair[0]?.originalTexture ?? null,
    nonNullCache.hair,
    targets.hair[0]?.flipY ?? true
  );
  const faceBaseTexture = buildSurfaceTexture(
    targets.faceBase[0]?.originalTexture ?? null,
    nonNullCache.faceBase,
    targets.faceBase[0]?.flipY ?? false
  );
  const faceEyeTexture = buildSurfaceTexture(
    targets.faceEye[0]?.originalTexture ?? null,
    nonNullCache.faceEye,
    targets.faceEye[0]?.flipY ?? false
  );
  const topsTextures: Record<string, THREE.Texture | null> = {};
  for (const [material, surfaceTargets] of Object.entries(targets.topsByMaterial)) {
    topsTextures[material] = buildSurfaceTexture(
      surfaceTargets[0]?.originalTexture ?? null,
      nonNullCache.tops[material] ?? null,
      surfaceTargets[0]?.flipY ?? false
    );
  }

  // Section 41: discard this call's (fully-prepared, but now superseded)
  // textures rather than swapping them in over a newer revision that
  // finished first - never dispose them here either, since a newer
  // apply's own targets don't overlap with these local variables and GC
  // reclaims them normally.
  if (!isStillLatest()) return;

  // Atomic swap (section 41) - everything prepared above, assigned now.
  applyTexture(targets.hair, hairTexture);
  applyTexture(targets.faceBase, faceBaseTexture);
  applyTexture(targets.faceEye, faceEyeTexture);
  for (const [material, surfaceTargets] of Object.entries(targets.topsByMaterial)) {
    applyTexture(surfaceTargets, topsTextures[material] ?? null);
  }

  const appliedMorphCount = applyMorphValues(targets.bodyMorphMeshes, manifest.morphValues);
  devLog(
    "[RemoteMorph] userId=", userId,
    "receivedCount=", Object.keys(manifest.morphValues).length,
    "appliedCount=", appliedMorphCount
  );

  // Toon (bug fix - "친구의 Toon 값이 Remote Avatar에 동기화되지 않음"): the
  // SAME updateToonMaterial() Local's own ToonStyleController already uses
  // for live shadeSteps/shadowStrength slider updates, called once per
  // owned material with THIS manifest owner's own settings - never the
  // current (local) user's. `manifest.toon` is `null` for an older
  // revision/client (section 19) - falls back to the safe default Toon,
  // same fallback DEFAULT_TOON_SETTINGS already is everywhere else.
  // Atomic with the texture/morph swap above (same isStillLatest() guard,
  // same revision), so a Toon-only change rides the identical
  // fetch-once/apply-once pipeline as a UV/Morph change instead of a
  // separate, potentially-racing update path.
  const toonSettings = manifest.toon ?? DEFAULT_TOON_SETTINGS;
  for (const t of targets.toonTargets) {
    updateToonMaterial(t.material, t.category, toonSettings);
  }
  devLog("[RemoteToon] userId=", userId, "applied=", !!manifest.toon);

  // Cosmetics (section 21/26/28/30/31) - its own async attach/detach is
  // guarded by the same isStillLatest() check, re-checked internally right
  // before it mutates `cosmeticState` (see applyCosmeticHead's own doc
  // comment for why this can't simply happen before the guard above like
  // the plain texture swaps do).
  if (cosmeticState) {
    await applyCosmeticHead(targets.headBone, manifest.cosmeticHead, nonNullCache.cosmetic, cosmeticState, isStillLatest);
  }
}
