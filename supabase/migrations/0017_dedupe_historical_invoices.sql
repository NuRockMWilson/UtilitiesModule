-- ============================================================================
-- 0017_dedupe_historical_invoices.sql
--
-- Repairs a known issue where migration 0015c was applied twice — once with
-- the original (failing) temp-table approach and once with the CTE rewrite,
-- or via two clicks on the SQL Editor's Run button. Each historical invoice
-- has a unique `source_reference` of the form
-- `historical-{year}-{prop}-{gl}-{account}-{month:02d}`. Two rows sharing
-- that reference are duplicates of the same legacy spreadsheet cell.
--
-- Symptom: tracker grid shows every meter at exactly 2× the expected
-- amount. Clicking a cell takes you to ONE of the two invoices and shows
-- the correct single-cell amount.
--
-- This migration:
--   1. Deletes duplicate historical invoices, keeping the oldest copy of
--      each (which is whatever 0015c originally inserted).
--   2. Adds a partial unique index on `source_reference` for historical
--      rows so re-running 0015c is rejected by the database instead of
--      silently doubling the data.
--
-- Safe to run when there are no duplicates — the DELETE is a no-op and
-- the index creation is idempotent (`CREATE UNIQUE INDEX IF NOT EXISTS`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- DIAGNOSTIC: how many duplicates exist? (Run before applying.)
-- ----------------------------------------------------------------------------
--
-- select
--   count(*) filter (where dup_count > 1) as duplicate_groups,
--   sum(dup_count - 1) filter (where dup_count > 1) as extra_rows_to_delete,
--   sum(dup_count) as total_historical_invoices
-- from (
--   select source_reference, count(*) as dup_count
--     from invoices
--    where source_reference like 'historical-%'
--    group by source_reference
-- ) g;

-- ----------------------------------------------------------------------------
-- Step 1: Delete duplicate historical invoices
-- ----------------------------------------------------------------------------

with ranked as (
  select
    id,
    row_number() over (
      partition by source_reference
      order by created_at, id
    ) as rn
  from invoices
  where source_reference like 'historical-%'
)
delete from invoices
 where id in (select id from ranked where rn > 1);

-- ----------------------------------------------------------------------------
-- Step 2: Prevent recurrence — partial unique index on source_reference
--         scoped to historical rows so future bills that share a
--         source_reference (unlikely, but possible) aren't impacted.
-- ----------------------------------------------------------------------------

create unique index if not exists invoices_historical_source_ref_unique
  on invoices (source_reference)
  where source_reference like 'historical-%';

-- ----------------------------------------------------------------------------
-- Step 3: Sanity check
-- ----------------------------------------------------------------------------

do $$
declare
  v_total          int;
  v_dup_groups     int;
begin
  select count(*) into v_total
    from invoices where source_reference like 'historical-%';

  select count(*) into v_dup_groups
    from (
      select source_reference
        from invoices
       where source_reference like 'historical-%'
       group by source_reference
      having count(*) > 1
    ) g;

  raise notice 'Migration 0017: % historical invoices remain (expected ~11,412).', v_total;
  raise notice 'Migration 0017: % duplicate groups remain (expected 0).', v_dup_groups;

  if v_dup_groups > 0 then
    raise exception 'Duplicates still present after dedupe — investigate manually.';
  end if;
end $$;
