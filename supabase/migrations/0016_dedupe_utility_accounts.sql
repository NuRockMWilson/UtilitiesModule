-- ============================================================================
-- 0016_dedupe_utility_accounts.sql
--
-- Cleans up duplicate utility_accounts left behind by migration 0012.
--
-- Background: migration 0015a did a partial cleanup of 0012's bad data, but
-- only deleted utility_accounts whose `description` matched '[seed]%' or
-- 'historical%'. 0012 also created accounts with other descriptions
-- (account numbers, empty strings, etc.) that survived. Now that 0015b
-- created its own utility_accounts for the same real-world meters, the
-- tracker UI shows duplicates: one row from 0012 with no invoices, and
-- one row from 0015 with the full history.
--
-- This migration deletes the orphaned 0012 rows.
--
-- Safety rules:
--   1. Only delete utility_accounts that have ZERO associated invoices.
--      We never delete a UA that's been used.
--   2. AND only delete if there's ANOTHER utility_account for the same
--      (property_id, account_number, gl_account_id) that DOES have
--      invoices. This protects newly-created accounts that just haven't
--      seen their first bill yet — they don't have a sibling, so they
--      won't be touched.
--
-- Result: every (property, account_number, GL) is collapsed down to the
-- single row that has the actual invoice history.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- DIAGNOSTIC: preview what would be deleted (run this first to check)
-- ----------------------------------------------------------------------------
--
-- Uncomment to preview without deleting:
--
-- select
--   ua.id,
--   p.code as property,
--   gl.code as gl,
--   ua.account_number,
--   ua.meter_id,
--   ua.description,
--   v.name as vendor_name
-- from utility_accounts ua
-- join properties  p  on p.id = ua.property_id
-- join gl_accounts gl on gl.id = ua.gl_account_id
-- join vendors     v  on v.id = ua.vendor_id
-- where not exists (
--   select 1 from invoices i where i.utility_account_id = ua.id
-- )
-- and exists (
--   select 1 from utility_accounts sib
--    where sib.property_id    = ua.property_id
--      and sib.account_number = ua.account_number
--      and sib.gl_account_id  = ua.gl_account_id
--      and sib.id            != ua.id
--      and exists (select 1 from invoices i2 where i2.utility_account_id = sib.id)
-- )
-- order by p.code, gl.code, ua.account_number;

-- ----------------------------------------------------------------------------
-- Step 1: Delete orphaned duplicate utility_accounts
-- ----------------------------------------------------------------------------

with orphan_dupes as (
  select ua.id
    from utility_accounts ua
   where not exists (
           select 1 from invoices i where i.utility_account_id = ua.id
         )
     and exists (
           select 1 from utility_accounts sib
            where sib.property_id    = ua.property_id
              and sib.account_number = ua.account_number
              and sib.gl_account_id  = ua.gl_account_id
              and sib.id            != ua.id
              and exists (select 1 from invoices i2 where i2.utility_account_id = sib.id)
         )
)
delete from utility_accounts
 where id in (select id from orphan_dupes);

-- ----------------------------------------------------------------------------
-- Step 2: Deactivate vendors that no longer have any utility_accounts OR
--         any invoices. These are 0012's leftovers — Orkin, Oakwood, SOCI,
--         account-number-named vendors, etc. We DEACTIVATE rather than
--         delete because:
--           - keeps the audit trail of what was once in the system
--           - avoids any FK surprises (vendor_id is referenced from many tables)
--           - matches the "deactivate-not-delete" pattern used elsewhere
-- ----------------------------------------------------------------------------

update vendors set active = false
 where active = true
   and short_name not like 'HIST-%'           -- leave 0015's placeholders alone
   and id not in (select vendor_id from utility_accounts where vendor_id is not null)
   and id not in (select vendor_id from invoices where vendor_id is not null);

-- ----------------------------------------------------------------------------
-- Step 3: Sanity check
-- ----------------------------------------------------------------------------

do $$
declare
  remaining_dupes int;
  deactivated_vendors int;
begin
  -- Confirm no more duplicates remain at (property, account_number, gl_account)
  select count(*) into remaining_dupes
    from (
      select ua.property_id, ua.account_number, ua.gl_account_id, count(*) as n
        from utility_accounts ua
       group by ua.property_id, ua.account_number, ua.gl_account_id
      having count(*) > 1
    ) dup_groups;

  select count(*) into deactivated_vendors
    from vendors where active = false;

  raise notice 'Migration 0016 complete.';
  raise notice '  Remaining (prop, account, gl) duplicate groups: %', remaining_dupes;
  raise notice '  Total inactive vendors after cleanup: %', deactivated_vendors;

  if remaining_dupes > 0 then
    raise notice 'Some duplicates remain — these have multiple accounts WITH invoices and';
    raise notice 'need manual review. Run the diagnostic query at the top of this file to see them.';
  end if;
end $$;
