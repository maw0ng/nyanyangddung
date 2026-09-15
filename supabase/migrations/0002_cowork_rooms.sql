-- miniWaffle Desktop Avatar - Room-Code Co-working Rooms (phase 2)
--
-- Scope: cowork_rooms, cowork_room_members, the Room Code generator, and
-- the RPCs/RLS/Realtime needed to create/join/leave a multi-person room by
-- sharing a short code. Deliberately does NOT touch 0001_friend_system.sql
-- in any way - friend_code/friend_requests/friendships stay completely
-- separate from room_code/cowork_rooms/cowork_room_members (this app's
-- brief explicitly requires the two systems stay independent: a Room Code
-- lets ANY logged-in user join regardless of friendship).
--
-- Explicitly NOT part of this phase (see the app's own comments in
-- src/lib/supabase/coworkRoomService.ts / src/components/cowork/ for the
-- client-side half): friend invites/accept/reject, friend online presence,
-- cross-room friend presence, strong room-owner privileges (kick/force-
-- start/settings), other members' Timer/Avatar rendering, chat.
--
-- Design principles this migration follows:
--   - Every cowork_room_members/cowork_rooms mutation goes through a
--     narrowly-scoped SECURITY DEFINER function that re-validates
--     auth.uid() itself, exactly like 0001's friend-request functions -
--     direct client INSERT/UPDATE/DELETE on either table is blocked
--     entirely by RLS (no policy grants it).
--   - "One active room per user" and "no duplicate active membership" are
--     both enforced by a single partial unique index, not just application
--     logic - a race between two concurrent RPC calls for the same user
--     still can't produce two active memberships.
--   - "Room full" is checked under a row lock on the room itself
--     (`select ... for update`), so two users racing for the last slot
--     can't both succeed - the second one always sees the first's
--     already-committed membership count.
--   - Members only ever expose nickname/level (via public.profiles, the
--     same table 0001 already locked down) - email/auth metadata/Timer
--     data/CharacterPreset are never touched by any table or function
--     here.

-- ============================================================================
-- cowork_rooms
-- ============================================================================

create table if not exists public.cowork_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  max_members integer not null default 4 check (max_members > 0),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint cowork_rooms_room_code_format check (room_code ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}$')
);

create unique index if not exists cowork_rooms_room_code_key on public.cowork_rooms (room_code);

-- RLS (enable + policy) is deliberately NOT set up here, right after this
-- table - cowork_rooms_select_member's policy below needs to reference
-- cowork_room_members in its USING clause, which does not exist yet at
-- this point in the script. Both tables' RLS is enabled together, and both
-- policies are created together, once BOTH tables exist - see the "RLS"
-- section below (after cowork_room_members). A CREATE POLICY that
-- references a not-yet-created table fails with
-- `relation "public.cowork_room_members" does not exist` (42P01) - this
-- ordering fix is exactly what resolves that error.

-- ============================================================================
-- cowork_room_members
-- ============================================================================

create table if not exists public.cowork_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.cowork_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'left')),
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

create index if not exists cowork_room_members_room_idx on public.cowork_room_members (room_id, status);
create index if not exists cowork_room_members_user_idx on public.cowork_room_members (user_id, status);

-- "A user may have at most ONE active room membership at a time" (section
-- 10/37), enforced at the DB level, not just checked in application code -
-- a partial unique index keyed on user_id ALONE (not room_id+user_id) means
-- a second active row for the same user, in ANY room, is rejected outright
-- by Postgres itself, closing the race window between the RPCs' own
-- explicit checks and the actual insert. As a side effect this also blocks
-- a duplicate active row in the SAME room (section 38 - "동일 Room 재입장"
-- with an already-active membership).
create unique index if not exists cowork_room_members_one_active_per_user
  on public.cowork_room_members (user_id)
  where status = 'active';

-- ============================================================================
-- Room Code generation - human-typeable, collision-checked server-side
-- (section 4), never left to a bare client-side Math.random(). Reuses the
-- exact same confusable-character-excluding alphabet as 0001's
-- generate_friend_code() for consistency, but is otherwise a fully
-- separate generator over a fully separate uniqueness domain
-- (cowork_rooms.room_code, never friend_code - section 3). 8 chars over a
-- 24-character alphabet (~1.1 * 10^11 possibilities) - deliberately not
-- shortened, since Room Codes are a shared-secret entry mechanism and short
-- codes are guessable (section 30). Placed here (after both tables exist,
-- before RLS) since it only ever reads public.cowork_rooms.
-- ============================================================================

create or replace function public.generate_room_code()
returns text
language plpgsql
set search_path = public
as $$
declare
  chars text := 'ACDEFGHJKLMNPQRTUVWXY379'; -- excludes O,0,I,1,S,5,B,8,Z,2
  code text;
  already_used boolean;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
    end loop;
    code := substr(code, 1, 4) || '-' || substr(code, 5, 4);
    select exists(select 1 from public.cowork_rooms where room_code = code) into already_used;
    exit when not already_used;
  end loop;
  return code;
end;
$$;

-- ============================================================================
-- RLS - enabled and policies created together for BOTH tables here, only
-- once both cowork_rooms AND cowork_room_members already exist above.
-- cowork_rooms_select_member's USING clause references
-- public.cowork_room_members, so creating it any earlier (e.g. directly
-- after the cowork_rooms table, before cowork_room_members exists) fails
-- with `relation "public.cowork_room_members" does not exist` (42P01).
-- ============================================================================

alter table public.cowork_rooms enable row level security;
alter table public.cowork_room_members enable row level security;

-- Only a current-or-past member of a room may read its row (room_code/
-- status/max_members/...). A stranger who merely GUESSES or is told a room
-- id can't select it directly - joining requires going through
-- join_cowork_room(room_code) below, which validates server-side (never a
-- client-side `select * from cowork_rooms` scan - section 33).
drop policy if exists "cowork_rooms_select_member" on public.cowork_rooms;
create policy "cowork_rooms_select_member"
  on public.cowork_rooms for select
  to authenticated
  using (
    exists (
      select 1 from public.cowork_room_members m
      where m.room_id = cowork_rooms.id and m.user_id = auth.uid()
    )
  );

-- A user always sees their OWN membership rows (active or left - needed
-- for getActiveRoom()/history), plus every member row of any room they are
-- CURRENTLY an active member of (section 18/34). Once they leave a room,
-- they lose visibility into its other members going forward - an unrelated
-- room's members are never visible (section 34).
drop policy if exists "cowork_room_members_select_self_or_roommate" on public.cowork_room_members;
create policy "cowork_room_members_select_self_or_roommate"
  on public.cowork_room_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or room_id in (
      select room_id from public.cowork_room_members my
      where my.user_id = auth.uid() and my.status = 'active'
    )
  );

-- No insert/update/delete policy on either table: rows are only ever
-- created/updated by create_cowork_room()/join_cowork_room()/
-- leave_cowork_room() below, all of which pin user_id to auth.uid()
-- internally (section 35 - a client can never insert a membership row for
-- someone else, or create/end a room row directly).

-- ============================================================================
-- Realtime - member joins/leaves and room-ended, scoped to whichever room a
-- client actually subscribes to (section 19/20/53). Idempotent: re-running
-- this migration on a project that already has these tables in the
-- publication must not error.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cowork_room_members'
  ) then
    alter publication supabase_realtime add table public.cowork_room_members;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cowork_rooms'
  ) then
    alter publication supabase_realtime add table public.cowork_rooms;
  end if;
end $$;

-- ============================================================================
-- RPC functions - the only way cowork_rooms/cowork_room_members ever mutate
-- ============================================================================

-- Creates a new room and adds the caller as its first (active) member,
-- atomically (section 11/12). If the membership insert fails for any
-- reason (most notably the one-active-room-per-user unique index catching
-- a race), the inner exception block raises a clean 'already_in_room' which
-- propagates out and aborts the WHOLE function's transaction - including
-- the room row just inserted above it - so a race can never leave behind
-- "a room with no member" (section 11's explicit requirement).
create or replace function public.create_cowork_room()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_room_id uuid;
  v_code text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if exists (select 1 from public.cowork_room_members where user_id = v_me and status = 'active') then
    raise exception 'already_in_room';
  end if;

  v_code := public.generate_room_code();

  insert into public.cowork_rooms (room_code, created_by, status, max_members)
  values (v_code, v_me, 'active', 4)
  returning id into v_room_id;

  begin
    insert into public.cowork_room_members (room_id, user_id, status)
    values (v_room_id, v_me, 'active');
  exception when unique_violation then
    raise exception 'already_in_room';
  end;

  return v_room_id;
end;
$$;

-- Joins an existing active room by code (section 13). Normalizes the code
-- itself (upper/trim) rather than trusting the client's own normalization
-- (section 29/33). Capacity is checked under a row lock on the room itself
-- (`for update`) so two users racing for the last slot serialize instead of
-- both getting in (section 16) - the second caller's count(*) is only ever
-- evaluated after the first caller's transaction has committed or rolled
-- back, so it always sees the true, up-to-date active member count.
create or replace function public.join_cowork_room(p_room_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_room_id uuid;
  v_room_status text;
  v_max_members integer;
  v_existing_status text;
  v_active_count integer;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select id, status, max_members into v_room_id, v_room_status, v_max_members
  from public.cowork_rooms
  where room_code = upper(trim(p_room_code));

  if v_room_id is null then
    raise exception 'room_not_found';
  end if;

  if v_room_status <> 'active' then
    raise exception 'room_ended';
  end if;

  select status into v_existing_status
  from public.cowork_room_members
  where room_id = v_room_id and user_id = v_me
  order by joined_at desc
  limit 1;

  if v_existing_status = 'active' then
    raise exception 'already_member';
  end if;

  if exists (select 1 from public.cowork_room_members where user_id = v_me and status = 'active') then
    raise exception 'already_in_room';
  end if;

  -- Serialize concurrent joins to THIS room - see doc comment above.
  perform 1 from public.cowork_rooms where id = v_room_id for update;

  select count(*) into v_active_count
  from public.cowork_room_members
  where room_id = v_room_id and status = 'active';

  if v_active_count >= v_max_members then
    raise exception 'room_full';
  end if;

  begin
    insert into public.cowork_room_members (room_id, user_id, status)
    values (v_room_id, v_me, 'active');
  exception when unique_violation then
    raise exception 'already_in_room';
  end;

  return v_room_id;
end;
$$;

-- Leaves the caller's current active room (section 24). Ending the room
-- when the last active member leaves (section 23) - NEVER when the
-- creator specifically leaves (section 21/22 - createdBy carries no
-- special leave-triggers-end behavior at all, deliberately) - is decided
-- purely from the remaining active member COUNT after this leave, under a
-- row lock on the room to keep it consistent with join_cowork_room's own
-- capacity check (section 16's race-safety applies symmetrically here).
create or replace function public.leave_cowork_room()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_member_id uuid;
  v_room_id uuid;
  v_remaining integer;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select id, room_id into v_member_id, v_room_id
  from public.cowork_room_members
  where user_id = v_me and status = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'not_in_room';
  end if;

  update public.cowork_room_members
  set status = 'left', left_at = now()
  where id = v_member_id;

  perform 1 from public.cowork_rooms where id = v_room_id for update;

  select count(*) into v_remaining
  from public.cowork_room_members
  where room_id = v_room_id and status = 'active';

  if v_remaining = 0 then
    update public.cowork_rooms
    set status = 'ended', ended_at = now()
    where id = v_room_id and status = 'active';
  end if;
end;
$$;

-- Only signed-in users may ever call these - anon/public have no execute
-- grant at all (least privilege, matching 0001's convention).
revoke all on function public.create_cowork_room() from public;
revoke all on function public.join_cowork_room(text) from public;
revoke all on function public.leave_cowork_room() from public;

grant execute on function public.create_cowork_room() to authenticated;
grant execute on function public.join_cowork_room(text) to authenticated;
grant execute on function public.leave_cowork_room() to authenticated;
