/**
 * Cosmetic Registry (액세서리/귀 꾸미기 v1, section 2) - the single place
 * every cosmetic's asset path/attach bone/paintability/default placement is
 * declared. Nothing else in the app hardcodes a cosmetic id, asset path,
 * or bone name - Editor UI, Desktop Avatar, and (later) Remote rendering
 * all read this registry instead.
 *
 * v1 ships exactly 3 head-slot ears (section 0) - Back/wings are
 * deliberately not added yet, but `CosmeticSlot` is already a union type
 * and every consumer keys off `slot`, so adding "back" later is an
 * additive registry entry, not a structural change (section 21's "다른
 * slot을 추가하기 어렵지 않은 구조").
 */

export type CosmeticSlot = "head";

export interface CosmeticTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export function identityCosmeticTransform(): CosmeticTransform {
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

export interface CosmeticDefinition {
  id: string;
  name: string;
  slot: CosmeticSlot;
  assetPath: string;
  /** Bone name in the miniWaffle scene graph to attach under (section 4) -
   * "Head" for every v1 entry, but kept per-definition so a future non-head
   * slot can name a different bone without any code change beyond adding
   * the registry row. */
  attachBone: string;
  paintable: boolean;
  /** Starting placement (section 2) - each GLB's own Blender-authored
   * export scale/orientation differs, so this is a per-definition,
   * individually-tunable starting point, not a shared constant. Deliberately
   * NOT meant to be perfect out of the box - section 5's whole point is
   * that the user fine-tunes this visually with TransformControls, and
   * "기본 위치로 초기화" (section 8) returns to exactly this value. */
  defaultTransform: CosmeticTransform;
}

/** Safety clamp range for user-adjusted transform values (section 6) -
 * kept as named constants so they're trivial to retune later, never
 * inlined at the call site. Position/rotation are left unclamped (TRS on a
 * bone-relative AttachmentRoot has no meaningful universal bound); only
 * scale is clamped, since 0/negative/extreme scale is what can actually
 * break rendering or make an accessory unrecoverable via the UI alone. */
export const COSMETIC_SCALE_MIN = 0.05;
export const COSMETIC_SCALE_MAX = 8;

export function clampCosmeticScaleComponent(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(COSMETIC_SCALE_MAX, Math.max(COSMETIC_SCALE_MIN, value));
}

export function clampCosmeticScale(scale: [number, number, number]): [number, number, number] {
  return [clampCosmeticScaleComponent(scale[0]), clampCosmeticScaleComponent(scale[1]), clampCosmeticScaleComponent(scale[2])];
}

export const HEAD_ATTACH_BONE_NAME = "Head";

export const COSMETIC_REGISTRY: CosmeticDefinition[] = [
  {
    id: "cat_ears",
    name: "고양이귀",
    slot: "head",
    assetPath: "/models/cosmetics/cat_ears.glb",
    attachBone: HEAD_ATTACH_BONE_NAME,
    paintable: true,
    // Visually tuned against the real GLB (section 2). IMPORTANT: tuned
    // against the Head bone's orientation during actual ANIMATION playback
    // (Idle), not the Editor's frozen "Rest Pose" debug view - this rig's
    // bind/T-pose has the Head bone tilted roughly 90 degrees away from
    // its orientation in every real animation clip, so a transform tuned
    // against Rest Pose looks correct there but badly misplaced/rotated
    // everywhere else (Desktop always plays Idle - section 17 - and so
    // does the Editor outside of the dev-only Rest Pose toggle). The
    // rotation here un-tilts Head's current-animated orientation back
    // toward world-upright; small further per-frame sway on top of this
    // is expected and desired (the accessory riding along with idle
    // sway/breathing - section 19), not something to cancel out.
    defaultTransform: {
      position: [0.01, 0.095, -0.005],
      rotation: [0.3575, 0.0782, -0.129],
      scale: [0.28, 0.28, 0.28],
    },
  },
  {
    id: "rabbit_ears",
    name: "토끼귀",
    slot: "head",
    assetPath: "/models/cosmetics/rabbit_ears.glb",
    attachBone: HEAD_ATTACH_BONE_NAME,
    paintable: true,
    // Tuned against animated (Idle) Head orientation - see cat_ears' own
    // comment above for why.
    defaultTransform: {
      position: [0.01, 0.075, 0.01],
      rotation: [0.3575, 0.0782, -0.129],
      scale: [0.35, 0.35, 0.35],
    },
  },
  {
    id: "bear_ears",
    name: "곰돌이귀",
    slot: "head",
    assetPath: "/models/cosmetics/bear_ears.glb",
    attachBone: HEAD_ATTACH_BONE_NAME,
    paintable: true,
    // bear_ears.glb's own AccessoryRoot.001 -> ears_bone carries a LARGE
    // baked translation (0.361 on ears_bone's local Y, authored against a
    // much taller reference rig than miniWaffle) BEFORE its own -0.05186
    // child scale shrinks the actual ear geometry - unlike cat/rabbit,
    // scale alone can't fix both the mount height and the ear size at once
    // here, so position carries a large explicit counter-offset (solved
    // against Head's actual animated-pose basis, not guessed) to pull the
    // whole accessory back down from that baked offset to Head-bone
    // height. Also tuned against animated (Idle) Head orientation - see
    // cat_ears' own comment above for why.
    defaultTransform: {
      position: [-0.03, -0.123, -0.032],
      rotation: [0.3575, 0.0782, -0.129],
      scale: [0.7, 0.7, 0.7],
    },
  },
];

export function getCosmeticDefinition(id: string): CosmeticDefinition | null {
  return COSMETIC_REGISTRY.find((c) => c.id === id) ?? null;
}

export function cosmeticsForSlot(slot: CosmeticSlot): CosmeticDefinition[] {
  return COSMETIC_REGISTRY.filter((c) => c.slot === slot);
}
