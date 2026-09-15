-- miniWaffle Desktop Avatar - fix: infinite recursion in cowork_room_members RLS
--
-- Bug: 0002_cowork_rooms.sql's "cowork_room_members_select_self_or_roommate"
-- policy is defined ON public.cowork_room_members, but its USING clause
-- contains a subquery that also SELECTs from public.cowork_room_members:
--
--   using (
--     user_id = auth.uid()
--     or room_id in (
--       select room_id from public.cowork_room_members my
--       where my.user_id = auth.uid() and my.status = 'active'
--     )
--   )
--
-- Evaluating that subquery is itself a SELECT on cowork_room_members, so
-- Postgres has to re-apply this SAME policy to evaluate it - which needs
-- the subquery again - forever. This is Postgres's well-known "recursive
-- RLS policy" trap and fails every single SELECT on this table with:
--   ERROR 42P17: infinite recursion detected in policy for relation
--   "cowork_room_members"
-- which is exactly the raw error behind every "요청을 처리하지 못했습니다"
-- the CoWork UI has been showing (coworkRoomService/coworkMemberStateService/
-- avatarAppearanceService all swallow the raw Postgres error into that one
-- generic message - only the browser console/network tab showed the real
-- 42P17 code).
--
-- Blast radius: every OTHER policy that subqueries cowork_room_members
-- (0002's own cowork_rooms_select_member, 0003's
-- cowork_member_states_select_roommate, 0004's
-- user_avatar_appearances_select_self_or_roommate, and 0004's Storage
-- policies) inherits the same failure transitively, even though none of
-- THOSE policies are self-referential on their own - they just can't read
-- cowork_room_members either. Fixing the one root policy below fixes all
-- of them; no other policy needs to change.
--
-- Fix: the standard, Supabase-documented pattern for this exact situation -
-- move the self-referential lookup into a SECURITY DEFINER helper function.
-- A SECURITY DEFINER function's own internal queries run under the
-- function OWNER's privileges (the migration-running role, which bypasses
-- RLS the same way a superuser/table-owner query does), so calling it from
-- inside the policy no longer re-triggers this same policy - breaking the
-- cycle. This is the identical trick 0002/0003/0004's own RPCs already rely
-- on (every create/join/leave/publish function is `security definer` so its
-- internal reads/writes bypass RLS); this migration just applies the same
-- idea to a plain SELECT policy instead of an RPC.

create or replace function public.my_active_cowork_room_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select room_id from public.cowork_room_members
  where user_id = auth.uid() and status = 'active';
$$;

revoke all on function public.my_active_cowork_room_ids() from public;
grant execute on function public.my_active_cowork_room_ids() to authenticated;

drop policy if exists "cowork_room_members_select_self_or_roommate" on public.cowork_room_members;
create policy "cowork_room_members_select_self_or_roommate"
  on public.cowork_room_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or room_id in (select public.my_active_cowork_room_ids())
  );

-- 0002's cowork_rooms_select_member, 0003's
-- cowork_member_states_select_roommate, and 0004's
-- user_avatar_appearances_select_self_or_roommate / Storage policies are
-- left exactly as they are (no CREATE POLICY needed here) - each of them
-- subqueries cowork_room_members filtered by `user_id = auth.uid()`, which
-- the fixed policy above always permits directly, so they start working
-- again automatically once the root recursion is gone.
