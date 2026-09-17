/**
 * Static configuration for the "이목구비" (facial feature) Shape Key
 * customizer. Nothing here invents morph names - every name below was
 * confirmed to exist in the live GLB's Body.morphTargetDictionary by
 * dumping /models/miniwaffle_web_animated3.glb's glTF JSON chunk
 * (mesh.extras.targetNames, 96 entries total) before writing this file.
 * useAvatarMorphs.ts still matches against the *runtime* dictionary at
 * mount time (never assumes these names exist) - this file only supplies
 * category membership + display labels for whichever of them are found.
 */

export type MorphCategoryId = "customEye" | "eye" | "pupil" | "brow" | "mouth";

export interface MorphCategoryConfig {
  id: MorphCategoryId;
  title: string;
  /** Runtime membership test against the real morphTargetDictionary keys -
   * category contents are derived from actual names, never a hardcoded
   * name list (section 4 of the brief). */
  match: (name: string) => boolean;
}

export const MORPH_CATEGORIES: MorphCategoryConfig[] = [
  {
    id: "customEye",
    title: "눈 커스텀",
    match: (name) => /^custom-eye-[1-4]$/.test(name),
  },
  { id: "eye", title: "눈", match: (name) => name.startsWith("eye-") },
  { id: "pupil", title: "눈동자", match: (name) => name.startsWith("ppl-") },
  { id: "brow", title: "눈썹", match: (name) => name.startsWith("brw-") },
  { id: "mouth", title: "입", match: (name) => name.startsWith("mouth-") },
];

/** The four user-authored customization Shape Keys - all four must always
 * be offered regardless of GLB ordering (section 2-A of the brief). */
export const REQUIRED_CUSTOM_EYE_NAMES = [
  "custom-eye-1",
  "custom-eye-2",
  "custom-eye-3",
  "custom-eye-4",
];

/** The GLB's only genuine full-body-shape Shape Key, distinct from the
 * facial categories above - lives on "Body-base", not "Body" (see
 * FacePaintScene.tsx's BODY_SHAPE_NODE_NAME doc comment). Kept as its own
 * explicit list (not folded into MORPH_CATEGORIES, which is specifically
 * the "이목구비"/facial customizer's own categorization) so the Network
 * Appearance export allowlist (appearanceOverlay.ts's
 * filterCustomizationMorphs) can allow it alongside the facial categories
 * without pretending it's a facial feature. */
export const BODY_SHAPE_MORPH_NAMES = ["shrink"];

/**
 * morphName -> display label. Deliberately a single flat map so it's easy
 * to hand-edit later (per the brief's explicit request) without touching
 * any matching/read/write logic. A name not listed here falls back to
 * `fallbackLabel()` below - it is never hidden just for lacking a label.
 */
export const MORPH_LABELS: Record<string, string> = {
  "custom-eye-1": "눈 커스텀 1",
  "custom-eye-2": "눈 커스텀 2",
  "custom-eye-3": "눈 커스텀 3",
  "custom-eye-4": "눈 커스텀 4",

  "eye-smile_left": "웃는 눈 (왼쪽)",
  "eye-smile_right": "웃는 눈 (오른쪽)",
  "eye-close_left": "감은 눈 (왼쪽)",
  "eye-close_right": "감은 눈 (오른쪽)",
  "eye-nagomi_left": "편안한 눈 (왼쪽)",
  "eye-nagomi_right": "편안한 눈 (오른쪽)",
  "eye-nagomi-down_left": "편안한 눈 아래 (왼쪽)",
  "eye-nagomi-down_right": "편안한 눈 아래 (오른쪽)",
  "eye-><_left": "찡그린 눈 (왼쪽)",
  "eye-><_right": "찡그린 눈 (오른쪽)",
  "eye-circle_left": "동그란 눈 (왼쪽)",
  "eye-circle_right": "동그란 눈 (오른쪽)",
  "eye-surprise_left": "놀란 눈 (왼쪽)",
  "eye-surprise_right": "놀란 눈 (오른쪽)",
  "eye-jito_left": "지긋한 눈 (왼쪽)",
  "eye-jito_right": "지긋한 눈 (오른쪽)",

  "ppl-lookL": "동공 왼쪽 보기",
  "ppl-lookR": "동공 오른쪽 보기",
  "ppl-lookU": "동공 위쪽 보기",
  "ppl-lookD": "동공 아래쪽 보기",
  "ppl-dark": "동공 어둡게",
  "ppl-small": "동공 작게",
  "ppl-star": "동공 별 모양",
  "ppl-uru": "촉촉한 눈동자",
  "ppl-hilite-off": "하이라이트 끄기",

  "brw-oko_left": "화난 눈썹 (왼쪽)",
  "brw-oko_right": "화난 눈썹 (오른쪽)",
  "brw-kiri_left": "치켜올린 눈썹 (왼쪽)",
  "brw-kiri_right": "치켜올린 눈썹 (오른쪽)",
  "brw-sad_left": "슬픈 눈썹 (왼쪽)",
  "brw-sad_right": "슬픈 눈썹 (오른쪽)",
  "brw-niko_left": "웃는 눈썹 (왼쪽)",
  "brw-niko_right": "웃는 눈썹 (오른쪽)",
  "brw-up_left": "눈썹 올리기 (왼쪽)",
  "brw-up_right": "눈썹 올리기 (오른쪽)",
  "brw-down_left": "눈썹 내리기 (왼쪽)",
  "brw-down_right": "눈썹 내리기 (오른쪽)",

  "mouth-a": "아 입모양",
  "mouth-e": "에 입모양",
  "mouth-o": "오 입모양",
  "mouth-smile": "미소",
  "mouth-ωopen": "오메가 입 벌림",
  "mouth-ω": "오메가 입",
  "mouth-△": "세모 입",
  "mouth-∧": "역세모 입",
  "mouth-□": "네모 입",
};

/** Readable fallback for any matched-but-unlabeled morph name - strips the
 * category prefix and normalizes separators/casing. Only used when a name
 * isn't in MORPH_LABELS yet (e.g. the GLB gains a new eye-, ppl-, brw-, or
 * mouth- Shape Key later). */
export function fallbackLabel(name: string): string {
  const withoutPrefix = name.replace(/^(custom-eye|eye|ppl|brw|mouth)-/, "");
  const spaced = withoutPrefix.replace(/[_-]+/g, " ").trim();
  if (!spaced) return name;
  return spaced
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function labelFor(name: string): string {
  return MORPH_LABELS[name] ?? fallbackLabel(name);
}
