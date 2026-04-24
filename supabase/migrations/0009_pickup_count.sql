-- ============================================================================
-- Migration 0009 — Pickup count on invoices
--
-- Priority 4: trash / garbage bills carry a pickup count that drives most of
-- the variance. A property that went from 3 pickups/month to 5 pickups/month
-- can expect ~67% higher cost without anything being wrong. Variance analysis
-- should be computed on $/pickup, not total $.
--
-- The new column applies to any utility bill that has a countable unit of
-- service — trash pickups today, maybe delivery counts for FedEx tomorrow.
-- Named generically `units_billed` so it isn't trash-specific.
-- ============================================================================

alter table invoices
    add column if not exists units_billed       numeric(10, 2),
    add column if not exists units_billed_label text;     -- e.g. 'pickups', 'deliveries'

comment on column invoices.units_billed is
    'Countable service units on this bill (pickups, deliveries, etc). Used by the variance engine to normalize cost per unit rather than absolute cost.';
comment on column invoices.units_billed_label is
    'What the units represent in human-readable terms. Typical values: pickups, deliveries, containers, service_hours.';

-- Convenience view: trash-specific pickup tracking across the portfolio
create or replace view v_trash_cost_per_pickup as
select
    p.id                               as property_id,
    p.code                             as property_code,
    p.name                             as property_name,
    i.service_period_start,
    i.service_period_end,
    i.invoice_date,
    i.total_amount_due,
    i.units_billed                     as pickups,
    case when i.units_billed > 0 then i.total_amount_due / i.units_billed end as cost_per_pickup
from invoices i
    join properties  p on p.id = i.property_id
    join gl_accounts g on g.id = i.gl_account_id
where g.code = '5135'
  and i.units_billed_label = 'pickups';
