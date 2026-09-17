"use client";

/**
 * Network Appearance Snapshot service layer (section 33/58) - Storage
 * upload/download + DB manifest read/write/subscribe. UI/hooks never call
 * `supabase.storage`/`supabase.from("user_avatar_appearances")` directly.
 */
import { getSupabaseClient } from "./client";
import { getCosmeticDefinition, clampCosmeticScale } from "../../components/hair-prototype/cosmetics/cosmeticRegistry";
import type { ToonSettings } from "../../components/hair-prototype/toonStyle";
import type {
  AvatarAppearanceManifestRow,
  NetworkAppearanceManifest,
  NetworkCosmeticHead,
} from "./database.types";
import { devLog } from "../devLog";

export type AppearanceResult<T> = { ok: true; data: T } | { ok: false; error: string };

const BUCKET = "avatar-appearance";
const NOT_CONFIGURED = "계정 기능을 사용할 수 없습니다.";
const MANIFEST_COLUMNS =
  "user_id,schema_version,revision,hair_overlay_path,face_base_overlay_path,face_eye_overlay_path,tops_overlay_paths,morph_values,cosmetic_head_id,cosmetic_position,cosmetic_rotation,cosmetic_scale,cosmetic_overlay_path,toon_settings,updated_at";

function toUserMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();
  if (msg.includes("not_authenticated")) return "로그인이 필요합니다.";
  if (msg.includes("stale_revision")) return "이미 최신 상태입니다.";
  if (msg.includes("invalid_revision")) return "잘못된 버전 정보입니다.";
  if (msg.includes("fetch") || msg.includes("network")) return "네트워크 연결을 확인해주세요.";
  console.error("[avatarAppearanceService]", raw);
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

/** DB row jsonb columns must never crash the scene just because one
 * malformed manifest exists (section 60) - shallow runtime validation
 * rather than trusting Postgres's jsonb type alone. */
function sanitizeRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
function sanitizeMorphValues(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(0, Math.min(1, v));
  }
  return out;
}

/** A malformed/foreign/partial jsonb value must never reach
 * createToonMaterial/lightIntensitiesFor (section 19/32) - every field is
 * checked individually and the WHOLE object is rejected (-> `null`, meaning
 * "use the safe default Toon") if even one is missing/wrong-typed, rather
 * than silently mixing sanitized fields with runtime `undefined` ones. */
function sanitizeToonSettings(value: unknown): ToonSettings | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (typeof v.enabled !== "boolean") return null;
  if (!isFiniteNumber(v.strength)) return null;
  if (v.shadeSteps !== 2 && v.shadeSteps !== 3) return null;
  if (!isFiniteNumber(v.shadowStrength)) return null;
  if (!isFiniteNumber(v.ambientStrength)) return null;
  if (typeof v.outlineEnabled !== "boolean") return null;
  if (!isFiniteNumber(v.outlineWidth)) return null;
  if (!isFiniteNumber(v.outlineStrength)) return null;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  return {
    enabled: v.enabled,
    strength: clamp01(v.strength),
    shadeSteps: v.shadeSteps,
    shadowStrength: clamp01(v.shadowStrength),
    ambientStrength: clamp01(v.ambientStrength),
    outlineEnabled: v.outlineEnabled,
    outlineWidth: Math.max(0, v.outlineWidth),
    outlineStrength: clamp01(v.outlineStrength),
  };
}

/** Every remote cosmetic transform component must be a finite number - a
 * malformed/foreign jsonb value (or a future schema this client doesn't
 * understand) must never reach THREE.js's `.set()` (section 25/32/44). */
function sanitizeVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return [x, y, z];
}

/** Section 26/32: `cosmeticId` must be one of the app's own known
 * registry entries and every transform component must be a valid finite
 * triple, or the whole cosmetic is dropped (treated as "not equipped")
 * rather than letting a malformed/foreign manifest reach the 3D scene -
 * matches the same "invalid -> ignore, never crash" policy morph value
 * sanitizing already follows above. Scale is additionally clamped through
 * the same COSMETIC_SCALE_MIN/MAX bounds the local Editor's own
 * TransformControls already enforce (cosmeticRegistry.ts), so a corrupted
 * or adversarial 0/negative/huge scale can never reach a remote scene. */
function sanitizeCosmeticHead(row: AvatarAppearanceManifestRow): NetworkCosmeticHead | null {
  const cosmeticId = row.cosmetic_head_id;
  if (!cosmeticId || !getCosmeticDefinition(cosmeticId)) return null;
  const position = sanitizeVec3(row.cosmetic_position);
  const rotation = sanitizeVec3(row.cosmetic_rotation);
  const scale = sanitizeVec3(row.cosmetic_scale);
  if (!position || !rotation || !scale) return null;
  return { cosmeticId, position, rotation, scale: clampCosmeticScale(scale) };
}

function mapRow(row: AvatarAppearanceManifestRow): NetworkAppearanceManifest {
  const cosmeticHead = sanitizeCosmeticHead(row);
  const morphValues = sanitizeMorphValues(row.morph_values);
  // [MorphTrace:RemoteManifest] (diagnostic - "Remote Avatar Morph 동기화
  // 안 됨") - the RAW DB row's morph_values column vs. what survives
  // sanitizeMorphValues here, for every getManifest/getManifests call (both
  // the publisher's own fresh-revision read and every Remote client's
  // fetch/refetch go through this same mapRow).
  devLog(
    "[MorphTrace:RemoteManifest] userId=", row.user_id,
    "revision=", row.revision,
    "rawMorphCount=", row.morph_values && typeof row.morph_values === "object" ? Object.keys(row.morph_values as object).length : 0,
    "sanitizedCount=", Object.keys(morphValues).length,
    "nonZero=", Object.fromEntries(Object.entries(morphValues).filter(([, v]) => v !== 0))
  );
  return {
    userId: row.user_id,
    schemaVersion: typeof row.schema_version === "number" ? row.schema_version : 1,
    revision: typeof row.revision === "number" ? row.revision : 0,
    hairOverlayPath: row.hair_overlay_path ?? null,
    faceBaseOverlayPath: row.face_base_overlay_path ?? null,
    faceEyeOverlayPath: row.face_eye_overlay_path ?? null,
    topsOverlayPaths: sanitizeRecord(row.tops_overlay_paths),
    morphValues,
    cosmeticHead,
    // No point keeping a paint overlay reference for a cosmetic we just
    // decided not to trust/attach at all.
    cosmeticOverlayPath: cosmeticHead ? row.cosmetic_overlay_path ?? null : null,
    toon: sanitizeToonSettings(row.toon_settings),
    updatedAt: row.updated_at,
  };
}

/** Storage path segments must never contain characters storage.foldername/
 * URL routing would choke on - Tops material names are runtime GLB data,
 * not something this app controls (section 8/17). */
function safeMaterialKey(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned || "material";
}

export const avatarAppearanceService = {
  /** `data: null` (not an error) means the user has never published an
   * appearance yet - callers should treat that as "default appearance"
   * (section 42), not a failure. */
  async getManifest(userId: string): Promise<AppearanceResult<NetworkAppearanceManifest | null>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data, error } = await supabase
      .from("user_avatar_appearances")
      .select(MANIFEST_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle()
      .returns<AvatarAppearanceManifestRow>();
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data: data ? mapRow(data) : null };
  },

  /** Batch form of getManifest (CoWork appearance-sync-v2 brief section 18)
   * - one `IN (...)` query for every remote participant instead of N
   * separate round-trips, used by useCoworkRoomAppearances.ts. A userId
   * with no published row simply has no entry in the returned Map (section
   * 42 - "default appearance", not an error) - `ids` may be empty, in
   * which case this returns an empty Map without querying at all. */
  async getManifests(userIds: string[]): Promise<AppearanceResult<Map<string, NetworkAppearanceManifest>>> {
    if (userIds.length === 0) return { ok: true, data: new Map() };
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data, error } = await supabase
      .from("user_avatar_appearances")
      .select(MANIFEST_COLUMNS)
      .in("user_id", userIds)
      .returns<AvatarAppearanceManifestRow[]>();
    if (error) return { ok: false, error: toUserMessage(error) };
    const out = new Map<string, NetworkAppearanceManifest>();
    for (const row of data ?? []) out.set(row.user_id, mapRow(row));
    return { ok: true, data: out };
  },

  /**
   * Uploads whichever overlay Blobs are non-null under
   * `{userId}/{revision}/...` (section 17), THEN commits the manifest via
   * publish_avatar_appearance (section 28's "DB manifest update를 commit
   * point로 사용") - if any upload throws, the RPC is never reached, so
   * the manifest simply stays on its previous (fully-present) revision
   * (section 29) rather than pointing at a half-uploaded new one.
   */
  async publishOwnAppearance(
    userId: string,
    revision: number,
    assets: {
      hairOverlay: Blob | null;
      faceBaseOverlay: Blob | null;
      faceEyeOverlay: Blob | null;
      topsOverlays: Record<string, Blob>;
      /** `null` = no head cosmetic equipped (section 39) - every
       * cosmetic_* DB column is cleared together in that case, never left
       * pointing at a stale previous revision's cosmetic. */
      cosmeticHead: NetworkCosmeticHead | null;
      /** Only uploaded/used when `cosmeticHead` is non-null; `null` means
       * the equipped cosmetic has no user paint (section 40). */
      cosmeticOverlay: Blob | null;
    },
    morphValues: Record<string, number>,
    toonSettings: ToonSettings
  ): Promise<AppearanceResult<number>> {
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };

    const prefix = `${userId}/${revision}`;
    async function uploadOne(suffix: string, blob: Blob): Promise<string> {
      const path = `${prefix}/${suffix}`;
      const { error } = await supabase!.storage
        .from(BUCKET)
        .upload(path, blob, { upsert: true, contentType: "image/png" });
      if (error) throw error;
      return path;
    }

    try {
      const hairPath = assets.hairOverlay ? await uploadOne("hair.png", assets.hairOverlay) : null;
      const faceBasePath = assets.faceBaseOverlay ? await uploadOne("face-base.png", assets.faceBaseOverlay) : null;
      const faceEyePath = assets.faceEyeOverlay ? await uploadOne("face-eye.png", assets.faceEyeOverlay) : null;
      const topsPaths: Record<string, string> = {};
      for (const [material, blob] of Object.entries(assets.topsOverlays)) {
        topsPaths[material] = await uploadOne(`tops-${safeMaterialKey(material)}.png`, blob);
      }
      const cosmeticOverlayPath =
        assets.cosmeticHead && assets.cosmeticOverlay
          ? await uploadOne("cosmetic.png", assets.cosmeticOverlay)
          : null;

      const { data, error } = await supabase.rpc("publish_avatar_appearance", {
        p_revision: revision,
        p_hair_overlay_path: hairPath,
        p_face_base_overlay_path: faceBasePath,
        p_face_eye_overlay_path: faceEyePath,
        p_tops_overlay_paths: topsPaths,
        p_morph_values: morphValues,
        p_cosmetic_head_id: assets.cosmeticHead?.cosmeticId ?? null,
        p_cosmetic_position: assets.cosmeticHead?.position ?? null,
        p_cosmetic_rotation: assets.cosmeticHead?.rotation ?? null,
        p_cosmetic_scale: assets.cosmeticHead?.scale ?? null,
        p_cosmetic_overlay_path: cosmeticOverlayPath,
        p_toon_settings: toonSettings,
      });
      if (error) return { ok: false, error: toUserMessage(error) };
      return { ok: true, data: data as number };
    } catch (err) {
      return { ok: false, error: toUserMessage(err) };
    }
  },

  /** `path: null` -> `data: null` (section 30 - no overlay published for
   * that surface, Remote uses the original texture alone). Returns a Blob
   * (section 58), never a base64 string. */
  async downloadAsset(path: string | null): Promise<AppearanceResult<Blob | null>> {
    if (!path) return { ok: true, data: null };
    const supabase = getSupabaseClient();
    if (!supabase) return { ok: false, error: NOT_CONFIGURED };
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error) return { ok: false, error: toUserMessage(error) };
    return { ok: true, data };
  },

  /**
   * Realtime subscription for manifest changes (section 38) - relies on
   * Supabase Realtime's own RLS-aware `postgres_changes` delivery (the
   * same mechanism 0002/0003's own subscribe functions already lean on)
   * rather than a per-userId filter string, since `postgres_changes`
   * filters only support a single `column=eq.value` comparison, not "IN a
   * list". A caller only ever RECEIVES events for rows it could already
   * SELECT under 0004's own RLS policy (itself, or a current active Room
   * roommate) - so this naturally satisfies section 39's "현재 Room 참가자
   * 것만" scoping without needing per-room filter plumbing. Callers must
   * only hold this open while actually in a Room (section 31) and
   * unsubscribe otherwise.
   */
  subscribeManifestChanges(onChange: () => void): () => void {
    const supabase = getSupabaseClient();
    if (!supabase) return () => {};
    const channel = supabase
      .channel("avatar_appearance_manifests")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_avatar_appearances" }, onChange)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  },
};
