-- miniWaffle Desktop Avatar - Account + Friend System (phase 1)
--
-- Scope: profiles, friend_code generation, friend_requests, friendships,
-- and the RLS/functions needed to operate them safely. Deliberately does
-- NOT include anything from the next phase (presence, shared timers,
-- friend avatar display, chat, work stats) - see the accompanying report.
--
-- Design principles this migration follows (see the app's own comments in
-- src/lib/supabase/ for the client-side half of each of these):
--   - `profiles` never stores email or anything from auth.users beyond the
--     id - email must never become a public/friend-visible field.
--   - `profiles.level/current_exp/required_exp` are a CACHE/PROJECTION of
--     the local Growth system's totalWorkMs-derived calculateGrowth() -
--     never a second source of truth. totalWorkMs itself, TimerSession,
--     ActiveInterval, and any foreground-app/window data are never sent
--     here at all.
--   - Every friend_requests/friendships mutation goes through a narrowly-
--     scoped SECURITY DEFINER function that re-validates auth.uid() itself
--     (section 36) - direct client INSERT/UPDATE/DELETE on those two
--     tables is blocked entirely by RLS (no policy grants it), so the
--     functions are the only mutation path, and they enforce the "no self-
--     request", "no duplicate/opposite-direction pending request", and "no
--     re-request between existing friends" rules atomically server-side.

-- ============================================================================
-- profiles
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  friend_code text not null,
  level integer not null default 1,
  current_exp integer not null default 0,
  required_exp integer not null default 60,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_nickname_length check (char_length(nickname) between 1 and 32),
  constraint profiles_friend_code_format check (friend_code ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}$')
);

create unique index if not exists profiles_friend_code_key on public.profiles (friend_code);

alter table public.profiles enable row level security;

-- Any signed-in user can read any profile's public fields (needed for
-- friend-code search and friend-list display - section 33). The table
-- itself never contains email/auth data, so a full-row read is already
-- privacy-safe by construction; not exposed to anon (logged-out) at all.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Users may update ONLY their own row (section 33). Which *columns* may
-- change is further locked down by the trigger below - this policy alone
-- would technically allow a user to rewrite their own friend_code/id too,
-- which the trigger prevents.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert/delete policy: rows are created only by the handle_new_user
-- trigger below (SECURITY DEFINER, fires on auth.users insert) and removed
-- only via the auth.users cascade on account deletion.

-- Defense in depth beyond the UPDATE policy above: even on their own row,
-- a client can never change id/friend_code/created_at (section 33/36 -
-- RLS's `using`/`with check` only constrain which ROW, not which COLUMNS,
-- can change).
create or replace function public.protect_profile_immutable_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id <> old.id then
    raise exception 'id cannot be changed';
  end if;
  if new.friend_code <> old.friend_code then
    raise exception 'friend_code cannot be changed';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_profile_immutable_fields_trigger on public.profiles;
create trigger protect_profile_immutable_fields_trigger
  before update on public.profiles
  for each row execute function public.protect_profile_immutable_fields();

-- ---- friend_code generation --------------------------------------------
-- Human-typeable, collision-checked server-side (section 13) - never left
-- to a bare client-side Math.random(). Alphabet excludes easily-confused
-- characters (O/0, I/1, and also excludes S/5, B/8 for the same reason -
-- section 12).
create or replace function public.generate_friend_code()
returns text
language plpgsql
set search_path = public
as $$
declare
  chars text := 'ACDEFGHJKLMNPQRTUVWXY379'; -- excludes O,0,I,1,S,5,B,8,Z,2 (kept short/simple)
  code text;
  already_used boolean;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
    end loop;
    code := substr(code, 1, 4) || '-' || substr(code, 5, 4);
    select exists(select 1 from public.profiles where friend_code = code) into already_used;
    exit when not already_used;
  end loop;
  return code;
end;
$$;

-- Auto-creates a profile row (with a fresh nickname + friend_code) the
-- moment a new auth.users row appears - the standard Supabase pattern for
-- this, since the new user has no session yet within the same transaction
-- to satisfy a normal RLS-guarded insert (section 6).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nickname, friend_code)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), '게스트'),
    public.generate_friend_code()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- friend_requests
-- ============================================================================

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_no_self check (sender_id <> receiver_id)
);

create index if not exists friend_requests_receiver_idx on public.friend_requests (receiver_id, status);
create index if not exists friend_requests_sender_idx on public.friend_requests (sender_id, status);

-- At most one PENDING request between any two users, regardless of
-- direction (section 18: A->B pending blocks both a second A->B AND a
-- reverse B->A). Accepted/rejected/cancelled rows are exempt so history
-- accumulates normally and a new request can be sent after a rejection.
create unique index if not exists friend_requests_one_pending_per_pair
  on public.friend_requests (least(sender_id, receiver_id), greatest(sender_id, receiver_id))
  where status = 'pending';

alter table public.friend_requests enable row level security;

-- Only the two parties involved may ever see a request row (section 34) -
-- no third party can enumerate anyone else's requests.
drop policy if exists "friend_requests_select_participant" on public.friend_requests;
create policy "friend_requests_select_participant"
  on public.friend_requests for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- No insert/update/delete policy at all: every mutation (send/accept/
-- reject/cancel) goes through the SECURITY DEFINER functions below, which
-- re-validate identity and business rules atomically. A client attempting
-- a raw insert/update is rejected by RLS outright.

-- ============================================================================
-- friendships
-- ============================================================================

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friendships_ordered check (user_a < user_b)
);

-- Canonical ordering (user_a < user_b, enforced above) means a friendship
-- is stored exactly once regardless of who sent the original request, so
-- "remove friend" naturally removes it for both sides at once (section 22)
-- and this unique index alone prevents duplicate rows.
create unique index if not exists friendships_pair_key on public.friendships (user_a, user_b);

alter table public.friendships enable row level security;

-- Only the two parties in a friendship may read that row (section 35) - no
-- one can query "are A and B friends" from the outside.
drop policy if exists "friendships_select_participant" on public.friendships;
create policy "friendships_select_participant"
  on public.friendships for select
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

-- No insert/update/delete policy: rows are only ever created by
-- accept_friend_request() and removed by remove_friend() below.

-- ============================================================================
-- RPC functions - the only way friend_requests/friendships ever mutate
-- ============================================================================

-- Sends a friend request by friend_code, atomically enforcing every rule
-- from sections 15/17/18 server-side rather than trusting the client to
-- have already checked them:
--   - target code must exist
--   - cannot target yourself
--   - cannot re-request an existing friend
--   - cannot create a duplicate/opposite-direction pending request
--     (the unique index above is the final backstop against a genuine
--     race between two concurrent calls; this explicit check gives a
--     clean error message in the common, non-racing case)
create or replace function public.send_friend_request(target_friend_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_target_id uuid;
  v_a uuid;
  v_b uuid;
  v_existing_id uuid;
  v_new_id uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select id into v_target_id
  from public.profiles
  where friend_code = upper(trim(target_friend_code));

  if v_target_id is null then
    raise exception 'user_not_found';
  end if;

  if v_target_id = v_me then
    raise exception 'cannot_friend_self';
  end if;

  if v_target_id < v_me then v_a := v_target_id; v_b := v_me;
  else v_a := v_me; v_b := v_target_id;
  end if;

  if exists(select 1 from public.friendships where user_a = v_a and user_b = v_b) then
    raise exception 'already_friends';
  end if;

  select id into v_existing_id
  from public.friend_requests
  where status = 'pending'
    and ((sender_id = v_me and receiver_id = v_target_id)
      or (sender_id = v_target_id and receiver_id = v_me));

  if v_existing_id is not null then
    raise exception 'request_already_exists';
  end if;

  insert into public.friend_requests (sender_id, receiver_id, status)
  values (v_me, v_target_id, 'pending')
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- Accepts a pending request addressed to the caller, marks it accepted,
-- and creates the (single, canonically-ordered) friendship row - section
-- 19.
create or replace function public.accept_friend_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_sender uuid;
  v_receiver uuid;
  v_status text;
  v_a uuid;
  v_b uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select sender_id, receiver_id, status into v_sender, v_receiver, v_status
  from public.friend_requests
  where id = request_id
  for update;

  if v_sender is null then
    raise exception 'request_not_found';
  end if;
  if v_receiver <> v_me then
    raise exception 'not_authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  update public.friend_requests
  set status = 'accepted', updated_at = now()
  where id = request_id;

  if v_sender < v_receiver then v_a := v_sender; v_b := v_receiver;
  else v_a := v_receiver; v_b := v_sender;
  end if;

  insert into public.friendships (user_a, user_b)
  values (v_a, v_b)
  on conflict (user_a, user_b) do nothing;
end;
$$;

-- Rejects a pending request addressed to the caller (section 19).
create or replace function public.reject_friend_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_receiver uuid;
  v_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select receiver_id, status into v_receiver, v_status
  from public.friend_requests
  where id = request_id
  for update;

  if v_receiver is null then
    raise exception 'request_not_found';
  end if;
  if v_receiver <> v_me then
    raise exception 'not_authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  update public.friend_requests
  set status = 'rejected', updated_at = now()
  where id = request_id;
end;
$$;

-- Cancels a request the caller themselves sent, while still pending
-- (section 20).
create or replace function public.cancel_friend_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_sender uuid;
  v_status text;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;

  select sender_id, status into v_sender, v_status
  from public.friend_requests
  where id = request_id
  for update;

  if v_sender is null then
    raise exception 'request_not_found';
  end if;
  if v_sender <> v_me then
    raise exception 'not_authorized';
  end if;
  if v_status <> 'pending' then
    raise exception 'request_not_pending';
  end if;

  update public.friend_requests
  set status = 'cancelled', updated_at = now()
  where id = request_id;
end;
$$;

-- Removes a friendship - symmetric by construction (one canonically-
-- ordered row represents both directions), so this deletes it for both
-- sides in one statement (section 22).
create or replace function public.remove_friend(other_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_a uuid;
  v_b uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated';
  end if;
  if other_user_id = v_me then
    raise exception 'invalid_target';
  end if;

  if other_user_id < v_me then v_a := other_user_id; v_b := v_me;
  else v_a := v_me; v_b := other_user_id;
  end if;

  delete from public.friendships where user_a = v_a and user_b = v_b;
end;
$$;

-- Only signed-in users may ever call these - anon/public have no execute
-- grant at all (section 36 - least privilege).
revoke all on function public.send_friend_request(text) from public;
revoke all on function public.accept_friend_request(uuid) from public;
revoke all on function public.reject_friend_request(uuid) from public;
revoke all on function public.cancel_friend_request(uuid) from public;
revoke all on function public.remove_friend(uuid) from public;

grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.reject_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
