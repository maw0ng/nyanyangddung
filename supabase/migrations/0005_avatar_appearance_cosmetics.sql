-- miniWaffle Desktop Avatar - Network Appearance Snapshot: cosmetics (phase 5)
--
-- Scope: extends 0004_avatar_appearance.sql's user_avatar_appearances table
-- and publish_avatar_appearance() RPC with the equipped head cosmetic
-- (cosmeticId + position/rotation/scale) and its own transparent paint
-- overlay - the same "manifest = Storage paths + small jsonb, never pixels"
-- design 0004 already established (section 1/17/58/59 of the CoWork
-- appearance-sync brief). Does not touch 0001/0002/0003/0004's own tables,
-- policies, or the hair/face/tops columns those already added.
--
-- Cosmetic transform storage (section 6/26): position/rotation/scale are
-- each stored as a jsonb 3-element array (`[x,y,z]`) - never flattened into
-- separate x/y/z columns - so a client reads/writes them as the exact same
-- `[number,number,number]` tuple CosmeticTransform already uses everywhere
-- else in this codebase (cosmeticRegistry.ts), with zero reshaping at the
-- DB boundary.
--
-- No equipped head cosmetic -> cosmetic_head_id is NULL (and the other
-- cosmetic_* columns are NULL too) - publish_avatar_appearance always
-- overwrites all of them together, so unequipping on a later revision
-- correctly clears a previous revision's cosmetic (section 39).

-- ============================================================================
-- user_avatar_appearances - add cosmetic columns
-- ============================================================================

alter table public.user_avatar_appearances
  add column if not exists cosmetic_head_id text,
  add column if not exists cosmetic_position jsonb,
  add column if not exists cosmetic_rotation jsonb,
  add column if not exists cosmetic_scale jsonb,
  add column if not exists cosmetic_overlay_path text;

-- ============================================================================
-- publish_avatar_appearance - replaced with the cosmetic-carrying signature.
-- The 0004 6-arg overload is dropped first (rather than left dangling) so
-- there is exactly one publish_avatar_appearance function going forward;
-- this app has no other caller of the old signature to stay compatible with
-- (avatarAppearanceService.ts is updated in the same change).
-- ============================================================================

drop function if exists public.publish_avatar_appearance(integer, text, text, text, jsonb, jsonb);

create or replace function public.publish_avatar_appearance(
  p_revision integer,
  p_hair_overlay_path text,
  p_face_base_overlay_path text,
  p_face_eye_overlay_path text,
  p_tops_overlay_paths jsonb,
  p_morph_values jsonb,
  p_cosmetic_head_id text,
  p_cosmetic_position jsonb,
  p_cosmetic_rotation jsonb,
  p_cosmetic_scale jsonb,
  p_cosmetic_overlay_path text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_current integer;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_revision is null or p_revision < 1 then
    raise exception 'invalid_revision';
  end if;

  select revision into v_current from public.user_avatar_appearances where user_id = v_me;

  if v_current is not null and p_revision <= v_current then
    raise exception 'stale_revision';
  end if;

  insert into public.user_avatar_appearances (
    user_id, schema_version, revision,
    hair_overlay_path, face_base_overlay_path, face_eye_overlay_path,
    tops_overlay_paths, morph_values,
    cosmetic_head_id, cosmetic_position, cosmetic_rotation, cosmetic_scale, cosmetic_overlay_path,
    updated_at
  )
  values (
    v_me, 2, p_revision,
    p_hair_overlay_path, p_face_base_overlay_path, p_face_eye_overlay_path,
    coalesce(p_tops_overlay_paths, '{}'::jsonb), coalesce(p_morph_values, '{}'::jsonb),
    p_cosmetic_head_id, p_cosmetic_position, p_cosmetic_rotation, p_cosmetic_scale, p_cosmetic_overlay_path,
    now()
  )
  on conflict (user_id) do update
    set revision = excluded.revision,
        schema_version = 2,
        hair_overlay_path = excluded.hair_overlay_path,
        face_base_overlay_path = excluded.face_base_overlay_path,
        face_eye_overlay_path = excluded.face_eye_overlay_path,
        tops_overlay_paths = excluded.tops_overlay_paths,
        morph_values = excluded.morph_values,
        cosmetic_head_id = excluded.cosmetic_head_id,
        cosmetic_position = excluded.cosmetic_position,
        cosmetic_rotation = excluded.cosmetic_rotation,
        cosmetic_scale = excluded.cosmetic_scale,
        cosmetic_overlay_path = excluded.cosmetic_overlay_path,
        updated_at = now();

  return p_revision;
end;
$$;

revoke all on function public.publish_avatar_appearance(
  integer, text, text, text, jsonb, jsonb, text, jsonb, jsonb, jsonb, text
) from public;
grant execute on function public.publish_avatar_appearance(
  integer, text, text, text, jsonb, jsonb, text, jsonb, jsonb, jsonb, text
) to authenticated;

-- ============================================================================
-- Storage: avatar-appearance bucket - no NEW bucket/policy needed. The
-- existing 0004 policies already gate every object under this bucket purely
-- by `(storage.foldername(name))[1] = {userId}` (insert/update/delete) or
-- "self or same-active-room roommate" (select), regardless of the filename
-- - so `{userId}/{revision}/cosmetic.png` is already covered by them exactly
-- like hair.png/face-base.png/tops-*.png are. Documented here only so the
-- path convention is written down in one place:
--   avatar-appearance/{userId}/{revision}/cosmetic.png
-- ============================================================================
