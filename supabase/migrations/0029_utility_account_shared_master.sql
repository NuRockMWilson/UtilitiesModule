-- ============================================================================
-- 0029_utility_account_shared_master.sql
-- ============================================================================
--
-- Adds is_shared_master flag to utility_accounts so the audit page and data-
-- integrity diagnostics can distinguish corporate master accounts (Level3,
-- T-Mobile, TBC, FedEx, etc.) — where invoices from multiple properties
-- legitimately link to one UA — from data-integrity bugs where invoices at
-- the wrong property got merged into a UA at a different property.
--
-- BACKGROUND:
--   The unique (vendor_id, account_number) constraint forces a single UA
--   per (vendor + account_number). For shared corporate accounts (one
--   bill, allocated across many properties) this is intentional — the UA
--   lives at one host property and many properties' invoices link to it.
--   Migrations 0018 / 0020 / 0021 explicitly consolidate these.
--
--   The same data shape can also indicate a bug: an orphan-UA merge that
--   pulled invoices from properties A, B, C into a UA at property X
--   without checking property alignment. The recent TPC trash incident
--   (15 invoices at 601 merged into a UA at 603) is one such bug.
--
--   Without a flag, both shapes are indistinguishable. With it, the audit
--   page and Query A diagnostic can ignore the legitimate cases and
--   surface only the bugs.
--
-- BACKFILL POLICY:
--   Conservative and data-driven. is_shared_master = true only for UAs
--   that meet BOTH conditions:
--     (a) live at a GL code that's typically allocated across properties
--         (5635 phone, 5140 cable, 5620 shipping); AND
--     (b) already have at least one invoice linked from a different
--         property than the UA's own.
--   Trash / water / electric / gas — where the known bugs live — are
--   never auto-flagged. If a non-comm shared account ever appears, flag
--   it manually via direct UPDATE.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Add the column
-- ────────────────────────────────────────────────────────────────────────────

alter table utility_accounts
  add column if not exists is_shared_master boolean not null default false;

comment on column utility_accounts.is_shared_master is
  'When true, invoices from any property may legitimately link to this UA (e.g. corporate Level3, T-Mobile, FedEx accounts allocated across the portfolio). When false (default), all invoices linked to this UA must share its property_id; cross-property linkage indicates a data-integrity bug.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Backfill known shared masters from observed data
-- ────────────────────────────────────────────────────────────────────────────

do $migration$
declare
  v_flagged int;
begin
  with to_flag as (
    select distinct ua.id
      from utility_accounts ua
      join gl_accounts g on g.id = ua.gl_account_id
      join invoices    i on i.utility_account_id = ua.id
     where g.code in ('5635', '5140', '5620')
       and i.property_id is distinct from ua.property_id
  )
  update utility_accounts ua
     set is_shared_master = true,
         updated_at       = now()
    from to_flag
   where ua.id = to_flag.id;

  get diagnostics v_flagged = row_count;
  raise notice '[0029] Flagged % UAs as is_shared_master.', v_flagged;
end
$migration$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Partial index for the audit page's filter
-- ────────────────────────────────────────────────────────────────────────────

create index if not exists idx_utility_accounts_shared_master
  on utility_accounts (id) where is_shared_master;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Sanity report — how the backfill landed
-- ────────────────────────────────────────────────────────────────────────────

do $report$
declare
  r record;
begin
  raise notice '[0029] Shared-master UAs after backfill:';
  for r in
    select g.code as gl, v.name as vendor, ua.account_number, p.code as property
      from utility_accounts ua
      join gl_accounts g on g.id = ua.gl_account_id
      join vendors     v on v.id = ua.vendor_id
      join properties  p on p.id = ua.property_id
     where ua.is_shared_master
     order by g.code, v.name, ua.account_number
  loop
    raise notice '  GL % | % | % @ %', r.gl, r.vendor, r.account_number, r.property;
  end loop;
end
$report$;
