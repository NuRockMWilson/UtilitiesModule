-- ============================================================================
-- DIAGNOSTIC: 0016 cleanup preview
--
-- Run this in the Supabase SQL Editor BEFORE applying migration 0016 to see
-- exactly which utility_accounts and vendors will be cleaned up.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) How many duplicate (property, account_number, gl) groups exist?
-- ----------------------------------------------------------------------------
select
  count(*) as duplicate_groups,
  sum(n - 1) as total_extra_rows
from (
  select count(*) as n
    from utility_accounts
   group by property_id, account_number, gl_account_id
  having count(*) > 1
) g;

-- ----------------------------------------------------------------------------
-- B) Which utility_accounts will be deleted?
--    Only rows that have no invoices AND have a sibling that does.
-- ----------------------------------------------------------------------------
select
  p.code            as property,
  gl.code           as gl,
  ua.account_number,
  ua.meter_id,
  ua.description,
  v.name            as vendor_name,
  ua.created_at
from utility_accounts ua
join properties  p  on p.id = ua.property_id
join gl_accounts gl on gl.id = ua.gl_account_id
join vendors     v  on v.id = ua.vendor_id
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
order by p.code, gl.code, ua.account_number;

-- ----------------------------------------------------------------------------
-- C) Which vendors will be deactivated?
--    Vendors with no remaining utility_accounts AND no invoices, excluding
--    our HIST-* placeholders from 0015.
-- ----------------------------------------------------------------------------
select
  v.name,
  v.short_name,
  v.category,
  v.created_at,
  v.active
from vendors v
where v.active = true
  and v.short_name not like 'HIST-%'
  and not exists (select 1 from utility_accounts ua where ua.vendor_id = v.id)
  and not exists (select 1 from invoices i where i.vendor_id = v.id)
order by v.created_at, v.name;

-- ----------------------------------------------------------------------------
-- D) Spot-check: pick a property and see all its utility_accounts grouped
--    by (account_number, gl) so you can eyeball duplicates yourself.
--    Replace '508' with whichever property you want to inspect.
-- ----------------------------------------------------------------------------
with totals as (
  select
    ua.id as ua_id,
    coalesce(sum(i.total_amount_due), 0) as invoice_total,
    count(i.id) as invoice_count
  from utility_accounts ua
  left join invoices i on i.utility_account_id = ua.id
  group by ua.id
)
select
  gl.code as gl,
  ua.account_number,
  ua.meter_id,
  ua.description,
  v.name as vendor,
  t.invoice_count,
  t.invoice_total
from utility_accounts ua
join properties p   on p.id = ua.property_id
join gl_accounts gl on gl.id = ua.gl_account_id
join vendors v      on v.id = ua.vendor_id
join totals t       on t.ua_id = ua.id
where p.code = '508'    -- ← change this
order by gl.code, ua.account_number, t.invoice_total desc;
