-- ============================================================================
-- 0027_user_signup_trigger.sql
-- ============================================================================
--
-- Self-signup support for the dashboard.
--
-- Background: with `shouldCreateUser: true` on the OTP login flow, anyone
-- can land in `auth.users` after verifying their email. But our app reads
-- role / property_scope / approval limits from `user_profiles`, which is
-- a separate table. Without this trigger, a fresh signup ends up with an
-- auth row but no profile row, and the app blows up trying to read role.
--
-- This migration adds:
--   1. A new role 'tester' to the user_role enum, used for "can do most
--      things but not destructive operations." See requireTester() in
--      src/lib/admin-auth.ts.
--   2. A function `handle_new_user()` that fires AFTER INSERT on
--      auth.users. It creates a matching user_profiles row with the
--      safest default role: 'viewer'. The 'viewer' role is the "pending
--      approval" state — middleware redirects these users to
--      /pending-approval until an admin elevates their role.
--   3. A backfill for any existing auth.users rows that don't yet have
--      a profile (idempotent — safe to re-run).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Extend user_role enum with 'tester'
-- ────────────────────────────────────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE is idempotent only with IF NOT EXISTS (Postgres 9.6+).

alter type user_role add value if not exists 'tester';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Trigger function: auto-create profile on auth.users insert
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer  -- so it can write to user_profiles even when the
                  -- triggering session has no permissions
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    'viewer',     -- pending state; admins elevate to 'admin' or 'tester'
    true
  )
  on conflict (id) do nothing;  -- idempotent: tolerate re-fires
  return new;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Attach trigger to auth.users
-- ────────────────────────────────────────────────────────────────────────────

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Backfill existing auth.users rows missing a profile
-- ────────────────────────────────────────────────────────────────────────────
--
-- If anyone has been added directly via the Supabase dashboard but
-- doesn't yet have a profile, create one for them now. Idempotent.

insert into public.user_profiles (id, email, role, active)
select au.id, au.email, 'viewer', true
from auth.users au
left join public.user_profiles up on up.id = au.id
where up.id is null
on conflict (id) do nothing;
