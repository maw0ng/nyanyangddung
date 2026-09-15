-- miniWaffle Desktop Avatar - CoWork Room shared work-status/timer (phase 3)
--
-- Scope: cowork_member_states (the "display-only" public projection of
-- each Room member's LOCAL Timer - never a second source of truth for
-- Timer/EXP), its RLS, and the RPCs that write/clean it up. Adds to
-- 0001_friend_system.sql and 0002_cowork_rooms.sql WITHOUT modifying
-- either file - `leave_cowork_room()` is redefined here via
-- `create or replace function` (the standard, safe way a later migration
-- extends an earlier one) purely to additionally clear the caller's own
-- state row on leave; its original membership-ending logic is reproduced
-- unchanged.
--
-- Explicitly NEVER stored here or sent over Realtime (see the app's own
-- comments in src/components/avatar-desktop/cowork/coworkTimerProjection.ts
-- for the client-side half of this guarantee): foreground app/executable
-- path/process name/window title, browser URL/history, local Timer
-- history/ActiveInterval history, targetApps, CharacterPreset, email,
-- totalWorkMs. Only {status, elapsed_ms, running_since, updated_at} per
-- (room, user) - status is one of idle/working/break, never richer than
-- that.
--
-- Design principles (mirrors 0001/0002's own conventions):
--   - Every mutation goes through a SECURITY DEFINER RPC that re-validates
--     auth.uid() AND active room membership - no direct client INSERT/
--     UPDATE/DELETE (no such RLS policy exists on this table at all).
--   - updated_at is always set server-side (`now()`), never taken from the
--     client payload - a client cannot forge a newer-looking row to fight
--     the out-of-order-event guard on the read side.
--   - This table is a snapshot, not just a Realtime broadcast (section 12)
--     - a participant who joins mid-session, or reconnects, can fetch the
--     current state directly instead of waiting for the next transition.

create table if not exists public.cowork_member_states (
  room_id uuid not null references public.cowork_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'idle' check (status in ('idle', 'working', 'break')),
  elapsed_ms bigint not null default 0 check (elapsed_ms >= 0),
  running_since timestamptz,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists cowork_member_states_room_idx on public.cowork_member_states (room_id);

alter table public.cowork_member_states enable row level security;

-- Only a current active member of a room may read that room's states
-- (section 13) - the same "am I an active member of this room_id" predicate
-- 0002's own cowork_room_members_select_self_or_roommate policy already
-- uses. An unrelated room's states are never visible (section 13's "관련
-- 없는 Room state 조회 금지").
drop policy if exists "cowork_member_states_select_roommate" on public.cowork_member_states;
create policy "cowork_member_states_select_roommate"
  on public.cowork_member_states for select
  to authenticated
  using (
    room_id in (
      select room_id from public.cowork_room_members my
      where my.user_id = auth.uid() and my.status = 'active'
    )
  );

-- No insert/update/delete policy: every mutation goes through
-- upsert_cowork_member_state()/leave_cowork_room() below, both of which
-- pin user_id to auth.uid() internally (section 14 - a client can never
-- write a state row for someone else).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cowork_member_states'
  ) then
    alter publication supabase_realtime add table public.cowork_member_states;
  end if;
end $$;

-- ============================================================================
-- upsert_cowork_member_state - the ONLY way a client's own row is ever
-- written (section 9/16/21). Validates active membership in p_room_id
-- (section 15) before writing anything, so a user who isn't actually in
-- that room (or was in it but has since left) can't create/update a state
-- row there. updated_at is always `now()` (section 61), never
-- client-supplied.
-- ============================================================================

create or replace function public.upsert_cowork_member_state(
  p_room_id uuid,
  p_status text,
  p_elapsed_ms bigint,
  p_running_since timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  if p_status not in ('idle', 'working', 'break') then
    raise exception 'invalid_status';
  end if;

  if p_elapsed_ms is null or p_elapsed_ms < 0 then
    raise exception 'invalid_elapsed';
  end if;

  if not exists (
    select 1 from public.cowork_room_members
    where room_id = p_room_id and user_id = v_me and status = 'active'
  ) then
    raise exception 'not_in_room';
  end if;

  insert into public.cowork_member_states (room_id, user_id, status, elapsed_ms, running_since, updated_at)
  values (p_room_id, v_me, p_status, p_elapsed_ms, p_running_since, now())
  on conflict (room_id, user_id) do update
    set status = excluded.status,
        elapsed_ms = excluded.elapsed_ms,
        running_since = excluded.running_since,
        updated_at = now();
end;
$$;

revoke all on function public.upsert_cowork_member_state(uuid, text, bigint, timestamptz) from public;
grant execute on function public.upsert_cowork_member_state(uuid, text, bigint, timestamptz) to authenticated;

-- ============================================================================
-- leave_cowork_room - REDEFINED (create or replace, not a new function) to
-- additionally delete the caller's own cowork_member_states row for the
-- room they're leaving (section 17), in the SAME transaction as the
-- membership update, so the two can never go out of sync (e.g. membership
-- ended but a stale "working" row lingers). Everything else about this
-- function's body is reproduced UNCHANGED from 0002_cowork_rooms.sql - see
-- that file for the original doc comment on the ending-the-room logic.
-- ============================================================================

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

  delete from public.cowork_member_states
  where room_id = v_room_id and user_id = v_me;

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

revoke all on function public.leave_cowork_room() from public;
grant execute on function public.leave_cowork_room() to authenticated;
