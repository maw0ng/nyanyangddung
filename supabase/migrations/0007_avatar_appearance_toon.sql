-- miniWaffle Desktop Avatar - Network Appearance Snapshot: per-user Toon
-- Shading settings (CoWork Remote Morph/Toon sync brief, PART 5/6/30)
--
-- Scope: extends 0004_avatar_appearance.sql's user_avatar_appearances table
-- and publish_avatar_appearance() RPC with the publisher's own Toon Shading
-- settings (src/components/hair-prototype/toonStyle.ts's ToonSettings) -
-- same "manifest = Storage paths + small jsonb, never pixels" design 0004/
-- 0005 already established. Does not touch 0001/0002/0003/0004/0005/0006's
-- own tables, policies, or columns.
--
-- Toon Shading used to be a single app-wide localStorage preference shared
-- by every character on one device - it has just become part of
-- CharacterPreset (per-character, per-user data - see types.ts's
-- CharacterAppearance.toon), so CoWork's Remote Avatar can render each
-- participant with THEIR OWN Toon choice instead of the local viewer's.
-- Stored as one small jsonb object (enabled/strength/shadeSteps/
-- shadowStrength/ambientStrength/outlineEnabled/outlineWidth/
-- outlineStrength - all plain numbers/booleans, nothing sensitive) rather
-- than one column per field, matching morph_values'/tops_overlay_paths' own
-- jsonb convention in this same table.
--
-- No toon_settings published (older client, or a revision published before
-- this column existed) -> NULL, which the client-side mapper already
-- treats as "use the safe default Toon" (avatarAppearanceService.ts) -
-- never a crash, matching morph_values' own "missing -> {}" fallback.

-- ============================================================================
-- user_avatar_appearances - add the toon_settings column
-- ============================================================================

alter table public.user_avatar_appearances
  add column if not exists toon_settings jsonb;

-- ============================================================================
-- publish_avatar_appearance - replaced with the toon-carrying signature. The
-- 0005 11-arg overload is dropped first so there is exactly one
-- publish_avatar_appearance function going forward; this app has no other
-- caller of the old signature to stay compatible with
-- (avatarAppearanceService.ts is updated in the same change).
-- ============================================================================

drop function if exists public.publish_avatar_appearance(
  integer, text, text, text, jsonb, jsonb, text, jsonb, jsonb, jsonb, text
);

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
  p_cosmetic_overlay_path text,
  p_toon_settings jsonb
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
    toon_settings,
    updated_at
  )
  values (
    v_me, 2, p_revision,
    p_hair_overlay_path, p_face_base_overlay_path, p_face_eye_overlay_path,
    coalesce(p_tops_overlay_paths, '{}'::jsonb), coalesce(p_morph_values, '{}'::jsonb),
    p_cosmetic_head_id, p_cosmetic_position, p_cosmetic_rotation, p_cosmetic_scale, p_cosmetic_overlay_path,
    p_toon_settings,
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
        toon_settings = excluded.toon_settings,
        updated_at = now();

  return p_revision;
end;
$$;

revoke all on function public.publish_avatar_appearance(
  integer, text, text, text, jsonb, jsonb, text, jsonb, jsonb, jsonb, text, jsonb
) from public;
grant execute on function public.publish_avatar_appearance(
  integer, text, text, text, jsonb, jsonb, text, jsonb, jsonb, jsonb, text, jsonb
) to authenticated;
