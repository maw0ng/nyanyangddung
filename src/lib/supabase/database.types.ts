/**
 * Hand-written types for the tables/RPCs this app actually uses (see
 * supabase/migrations/0001_friend_system.sql for the schema itself). Kept
 * explicit rather than `any` (section 38) - no Supabase CLI codegen was
 * run against a live project as part of this change, so these are typed
 * by hand to exactly match the migration.
 */
import type { ToonSettings } from "../../components/hair-prototype/toonStyle";

export interface ProfilesRow {
  id: string;
  nickname: string;
  friend_code: string;
  level: number;
  current_exp: number;
  required_exp: number;
  created_at: string;
  updated_at: string;
}

export type FriendRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

export interface FriendRequestsRow {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: FriendRequestStatus;
  created_at: string;
  updated_at: string;
}

export interface FriendshipsRow {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
}

/** Narrow row shape actually selected for the "who is this other person"
 * lookups (friend search, incoming/outgoing request display, friends
 * list) - never the full ProfilesRow, so a stray `select("*")` typo can't
 * accidentally start returning more than intended. */
export type ProfilesPublicSelection = Pick<
  ProfilesRow,
  "id" | "nickname" | "friend_code" | "level" | "current_exp" | "required_exp"
>;

/** The public-facing shape of a profile row (section 8/16/31) - deliberately
 * a SUBSET of ProfilesTable["Row"] fields, all of which are already safe to
 * show a friend (the table itself never contains email or any local-only
 * growth data like totalWorkMs). */
export interface PublicProfile {
  id: string;
  nickname: string;
  friendCode: string;
  level: number;
  currentExp: number;
  requiredExp: number;
}

export interface FriendRequestItem {
  requestId: string;
  createdAt: string;
  profile: { id: string; nickname: string; level: number };
}

/**
 * One friend's list entry. Deliberately does not include any online/
 * presence/timer-status field yet (section 49) - that will be added here
 * in the next phase (Realtime Presence) without needing to restructure
 * this shape, just extend it.
 */
export interface FriendListItem {
  userId: string;
  nickname: string;
  level: number;
}

// ============================================================================
// Co-working Rooms (supabase/migrations/0002_cowork_rooms.sql) - a fully
// separate system from Friend Code/friend_requests/friendships above (a
// Room Code lets any logged-in user join regardless of friendship).
// ============================================================================

export type CoworkRoomStatus = "active" | "ended";

export interface CoworkRoomRow {
  id: string;
  room_code: string;
  created_by: string;
  status: CoworkRoomStatus;
  max_members: number;
  created_at: string;
  ended_at: string | null;
}

export type CoworkMemberStatus = "active" | "left";

export interface CoworkRoomMemberRow {
  id: string;
  room_id: string;
  user_id: string;
  status: CoworkMemberStatus;
  joined_at: string;
  left_at: string | null;
}

/** The public-facing shape of a room (camelCase, matches PublicProfile's
 * own row->UI mapping convention above). */
export interface CoworkRoom {
  id: string;
  roomCode: string;
  createdBy: string;
  status: CoworkRoomStatus;
  maxMembers: number;
  createdAt: string;
  endedAt: string | null;
}

/** One room participant as shown in the member list (section 18/31 of the
 * cowork-room brief) - nickname + level only, deliberately no online/
 * working/break/timer field yet. That will be added here once Desktop
 * Avatar rendering connects to Room membership in a later phase - this
 * shape is kept easy to extend (userId/nickname/level) rather than
 * restructured when that happens. */
export interface CoworkRoomMemberView {
  userId: string;
  nickname: string;
  level: number;
  /** This member's own cowork_room_members.joined_at - the stable sort key
   * for the Desktop multi-avatar grid (Desktop-avatar-rendering brief,
   * section 18), so a Realtime update that only changes someone's
   * nickname/level never reshuffles everyone's on-screen position. */
  joinedAt: string;
}

// ============================================================================
// CoWork member timer/status state (supabase/migrations/0003_cowork_member_
// states.sql) - the "display-only" public projection of each Room member's
// LOCAL Timer (never a second source of truth - see
// src/components/avatar-desktop/cowork/coworkTimerProjection.ts). Only ever
// {status, elapsedMs, runningSince, updatedAt} - no foreground app/window
// title/history/targetApps/CharacterPreset/email/totalWorkMs.
// ============================================================================

export type CoworkPublicTimerStatus = "idle" | "working" | "break";

export interface CoworkMemberStateRow {
  room_id: string;
  user_id: string;
  status: CoworkPublicTimerStatus;
  elapsed_ms: number;
  running_since: string | null;
  updated_at: string;
}

/** The public-facing shape (camelCase) - what coworkMemberStateService
 * hands back to the UI/hooks layer. */
export interface CoworkPublicTimerState {
  userId: string;
  status: CoworkPublicTimerStatus;
  /** Baseline accumulated ms BEFORE the current running segment (if any) -
   * NOT a live "current elapsed" value. Callers reconstruct the live
   * number themselves: `elapsedMs + (now - runningSince)` while
   * status==="working" and runningSince is set, otherwise elapsedMs as-is
   * (section 6 of the cowork-timer-sync brief). */
  elapsedMs: number;
  /** ISO timestamp of when the current running segment started - null
   * whenever status is "break"/"idle" (section 7/8). */
  runningSince: string | null;
  /** Server-set (never client-supplied - section 61) - the staleness
   * clock: a Remote HUD treats this row as stale once `now - updatedAt`
   * exceeds COWORK_STALE_MS (section 19/20). */
  updatedAt: string;
}

// ============================================================================
// Network Appearance Snapshot (supabase/migrations/0004_avatar_appearance.sql)
// - a manifest of Supabase STORAGE PATHS + filtered morph values, never
// pixels/blobs (section 58/59 of the avatar-appearance-sync brief). The
// actual PNG overlays live in the `avatar-appearance` Storage bucket;
// nothing here ever holds image bytes.
// ============================================================================

export interface AvatarAppearanceManifestRow {
  user_id: string;
  schema_version: number;
  revision: number;
  hair_overlay_path: string | null;
  face_base_overlay_path: string | null;
  face_eye_overlay_path: string | null;
  /** materialName -> Storage path (section 8/16). */
  tops_overlay_paths: Record<string, string>;
  /** Already filtered to customization-only morph names (section 11/12) -
   * see src/components/hair-prototype/appearanceOverlay.ts. */
  morph_values: Record<string, number>;
  /** Equipped head cosmetic (0005_avatar_appearance_cosmetics.sql, CoWork
   * appearance-sync-v2 brief section 6/26) - `null` whenever no head
   * cosmetic is equipped, in which case the other cosmetic_* columns are
   * also null. `cosmetic_head_id` is one of cosmeticRegistry.ts's known ids
   * ("cat_ears"/"rabbit_ears"/"bear_ears") - an unrecognized value (a
   * future/foreign manifest) is treated as "no cosmetic" by the mapping
   * below, never trusted blindly. */
  cosmetic_head_id: string | null;
  /** `[x, y, z]` jsonb tuples - the exact same CosmeticTransform shape used
   * everywhere else in this app (cosmeticRegistry.ts), never split into
   * separate columns. */
  cosmetic_position: [number, number, number] | null;
  cosmetic_rotation: [number, number, number] | null;
  cosmetic_scale: [number, number, number] | null;
  /** The equipped cosmetic's own transparent user paint overlay - `null`
   * means the cosmetic has no user paint (still equips/attaches normally,
   * just shows its original material/color - section 40). */
  cosmetic_overlay_path: string | null;
  /** The publisher's own Toon Shading settings (0007_avatar_appearance_toon.sql) -
   * `null` for a revision published before this column existed, or by an
   * older client - the client-side mapper falls back to the safe default
   * Toon (see database.types.ts's NetworkAppearanceManifest / toonStyle.ts's
   * DEFAULT_TOON_SETTINGS), never a crash. */
  toon_settings: Record<string, unknown> | null;
  updated_at: string;
}

/** One equipped head cosmetic as published to the network (section 6/26) -
 * mirrors EquippedCosmetic (types.ts) exactly, minus paint data (that
 * travels as a separate Storage asset, referenced by
 * NetworkAppearanceManifest.cosmeticOverlayPath, never inline - section 7/9). */
export interface NetworkCosmeticHead {
  cosmeticId: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

/** The public-facing shape (camelCase). A `null` overlay path means "this
 * user hasn't painted anything there" (section 30) - Remote falls back to
 * the original GLB texture alone for that surface, never an empty upload. */
export interface NetworkAppearanceManifest {
  userId: string;
  schemaVersion: number;
  revision: number;
  hairOverlayPath: string | null;
  faceBaseOverlayPath: string | null;
  faceEyeOverlayPath: string | null;
  topsOverlayPaths: Record<string, string>;
  morphValues: Record<string, number>;
  /** `null` = no head cosmetic equipped on this revision (section 39). */
  cosmeticHead: NetworkCosmeticHead | null;
  /** Only meaningful when `cosmeticHead` is non-null; `null` = the equipped
   * cosmetic has no user paint (section 40). */
  cosmeticOverlayPath: string | null;
  /** The publisher's own per-character Toon Shading settings (bug fix -
   * Toon used to be a single app-wide preference, never part of any
   * per-user network data at all). `null` = never published (older
   * revision/client) - callers must fall back to
   * toonStyle.ts's DEFAULT_TOON_SETTINGS, never crash or silently use the
   * LOCAL viewer's own Toon settings for someone else's Avatar. */
  toon: ToonSettings | null;
  updatedAt: string;
}
