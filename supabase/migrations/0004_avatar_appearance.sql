-- miniWaffle Desktop Avatar - Network Appearance Snapshot (phase 4)
--
-- Scope: user_avatar_appearances (a manifest of PATHS + morph values, never
-- pixels), the `avatar-appearance` Storage bucket + its RLS, and the
-- publish RPC. Adds to 0001/0002/0003 WITHOUT modifying any of those files.
--
-- Design principles (section 1/4/17/18):
--   - The manifest table never stores image bytes - only Storage object
--     paths (text) + a small morph_values jsonb. The actual overlay PNGs
--     live in Supabase Storage, not in a DB row (section 17/58/59).
--   - A published overlay is a TRANSPARENT PAINT-ONLY PNG (the user's
--     Hair/Face/Tops paint layers flattened) - the original miniWaffle GLB
--     texture itself is never re-uploaded; every client already has it
--     locally (section 4/36).
--   - `revision` is the only thing Realtime ever needs to announce (section
--     15/38) - a client that sees a newer revision than it has cached
--     fetches the manifest + whichever assets actually changed.
--   - Storage access mirrors 0003's own "self or same active Room member"
--     privacy boundary (section 20/67/68) - a third party who isn't
--     currently in a Room with this user can read neither the manifest row
--     nor the Storage objects.

-- ============================================================================
-- user_avatar_appearances
-- ============================================================================

create table if not exists public.user_avatar_appearances (
  user_id uuid primary key references auth.users (id) on delete cascade,
  schema_version integer not null default 1,
  revision integer not null default 0,
  hair_overlay_path text,
  face_base_overlay_path text,
  face_eye_overlay_path text,
  tops_overlay_paths jsonb not null default '{}'::jsonb,
  morph_values jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_avatar_appearances enable row level security;

-- Same "self or current active-Room roommate" predicate as 0003's
-- cowork_member_states policy (section 20/67) - an unrelated third party
-- can never read another user's manifest.
drop policy if exists "user_avatar_appearances_select_self_or_roommate" on public.user_avatar_appearances;
create policy "user_avatar_appearances_select_self_or_roommate"
  on public.user_avatar_appearances for select
  to authenticated
  using (
    user_id = auth.uid()
    or user_id in (
      select theirs.user_id
      from public.cowork_room_members theirs
      join public.cowork_room_members mine on mine.room_id = theirs.room_id
      where mine.user_id = auth.uid() and mine.status = 'active' and theirs.status = 'active'
    )
  );

-- No insert/update/delete policy: every write goes through
-- publish_avatar_appearance() below, which pins user_id to auth.uid()
-- internally (section 19 - a client can never publish for someone else).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_avatar_appearances'
  ) then
    alter publication supabase_realtime add table public.user_avatar_appearances;
  end if;
end $$;

-- ============================================================================
-- publish_avatar_appearance - the ONLY way a manifest row is ever written
-- (section 19/23). Used as the "commit point" (section 28/29): the client
-- uploads every asset to Storage FIRST, and only calls this once all of
-- them have succeeded - if this call never happens (upload failure), the
-- manifest simply stays on its last-good revision, so Remote never briefly
-- sees a revision whose files don't all exist yet.
--
-- `p_revision <= current` is rejected (section 27/29 - "최신 상태 우선",
-- never let a stale/out-of-order publish attempt overwrite a newer one -
-- this is the server-side backstop behind the client's own revision
-- bookkeeping).
-- ============================================================================

create or replace function public.publish_avatar_appearance(
  p_revision integer,
  p_hair_overlay_path text,
  p_face_base_overlay_path text,
  p_face_eye_overlay_path text,
  p_tops_overlay_paths jsonb,
  p_morph_values jsonb
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
    tops_overlay_paths, morph_values, updated_at
  )
  values (
    v_me, 1, p_revision,
    p_hair_overlay_path, p_face_base_overlay_path, p_face_eye_overlay_path,
    coalesce(p_tops_overlay_paths, '{}'::jsonb), coalesce(p_morph_values, '{}'::jsonb), now()
  )
  on conflict (user_id) do update
    set revision = excluded.revision,
        hair_overlay_path = excluded.hair_overlay_path,
        face_base_overlay_path = excluded.face_base_overlay_path,
        face_eye_overlay_path = excluded.face_eye_overlay_path,
        tops_overlay_paths = excluded.tops_overlay_paths,
        morph_values = excluded.morph_values,
        updated_at = now();

  return p_revision;
end;
$$;

revoke all on function public.publish_avatar_appearance(integer, text, text, text, jsonb, jsonb) from public;
grant execute on function public.publish_avatar_appearance(integer, text, text, text, jsonb, jsonb) to authenticated;

-- ============================================================================
-- Storage: avatar-appearance bucket (section 17/18) - PRIVATE (never
-- public), gated by RLS on storage.objects exactly like any other
-- Supabase Storage privacy boundary. Path convention:
--   {userId}/{revision}/hair.png
--   {userId}/{revision}/face-base.png
--   {userId}/{revision}/face-eye.png
--   {userId}/{revision}/tops-<materialKey>.png
-- `{userId}` is always the auth.users UUID - never an email or nickname
-- (section 21).
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('avatar-appearance', 'avatar-appearance', false)
on conflict (id) do nothing;

-- A user may upload/replace/delete ONLY under their own {auth.uid()}/...
-- prefix (section 19) - storage.foldername(name) splits the object path on
-- "/" and returns every segment except the filename itself, so
-- (storage.foldername(name))[1] is always the top-level {userId} folder.
drop policy if exists "avatar_appearance_insert_own" on storage.objects;
create policy "avatar_appearance_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatar-appearance'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatar_appearance_update_own" on storage.objects;
create policy "avatar_appearance_update_own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatar-appearance' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatar-appearance' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatar_appearance_delete_own" on storage.objects;
create policy "avatar_appearance_delete_own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatar-appearance' and (storage.foldername(name))[1] = auth.uid()::text);

-- Read access mirrors the manifest table's own RLS (section 20) - self, or
-- a user currently sharing an active Room with the folder's owner.
drop policy if exists "avatar_appearance_select_self_or_roommate" on storage.objects;
create policy "avatar_appearance_select_self_or_roommate"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatar-appearance'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (storage.foldername(name))[1] in (
        select theirs.user_id::text
        from public.cowork_room_members theirs
        join public.cowork_room_members mine on mine.room_id = theirs.room_id
        where mine.user_id = auth.uid() and mine.status = 'active' and theirs.status = 'active'
      )
    )
  );
