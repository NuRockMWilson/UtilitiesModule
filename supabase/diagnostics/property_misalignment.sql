-- ============================================================================
-- diagnostic_property_misalignment.sql
-- ============================================================================
--
-- Reference query: surfaces invoices whose utility_account_id points at a
-- UA at a DIFFERENT property than the invoice itself. Excludes
-- is_shared_master UAs (legitimate cross-property linkage by design — see
-- migration 0029).
--
-- Intended use: run periodically (e.g. weekly) to catch any new
-- data-integrity drift. Empty result = clean.
--
-- This is what surfaced the TPC trash incident and the broader Republic
-- Services / Coastal Waste mis-merges in May 2026.
-- ============================================================================

select
  i_p.code              as inv_property,
  ua_p.code             as ua_property,
  g.code                as gl,
  v.name                as ua_vendor,
  ua.account_number     as ua_account,
  count(*)              as inv_count,
  sum(i.total_amount_due)::numeric(14,2) as total_dollars,
  min(i.invoice_date)   as earliest,
  max(i.invoice_date)   as latest
from invoices i
join utility_accounts ua on ua.id = i.utility_account_id
left join properties  i_p  on i_p.id  = i.property_id
left join properties  ua_p on ua_p.id = ua.property_id
left join gl_accounts g    on g.id    = ua.gl_account_id
left join vendors     v    on v.id    = ua.vendor_id
where i.property_id is distinct from ua.property_id
  and not coalesce(ua.is_shared_master, false)
  and i.status not in ('rejected')
group by i_p.code, ua_p.code, g.code, v.name, ua.account_number, ua.id
order by total_dollars desc nulls last;
