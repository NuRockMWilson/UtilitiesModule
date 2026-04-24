-- ============================================================================
-- Migration 0007 — Meter-level fields on utility_accounts
--
-- Priority 2 of the historical import: House Meters detail.
-- Each electric meter at a property gets its own utility_accounts row, so
-- variance analysis can surface per-meter anomalies ("Pool pump +23%")
-- instead of only per-property totals.
-- ============================================================================

alter table utility_accounts
    add column if not exists meter_id        text,
    add column if not exists esi_id          text,          -- Texas ESI ID when applicable
    add column if not exists meter_category  text;          -- 'house' | 'clubhouse' | 'pool' | 'trash' | 'lighting' | etc.

-- Index for lookups by meter_id (when bills reference a specific physical meter)
create index if not exists idx_utility_accounts_meter_id on utility_accounts (meter_id)
    where meter_id is not null;

create index if not exists idx_utility_accounts_esi_id on utility_accounts (esi_id)
    where esi_id is not null;

comment on column utility_accounts.meter_id       is 'Physical meter serial / identifier from the utility provider';
comment on column utility_accounts.esi_id         is 'Texas ESI ID (Electric Service Identifier) — applies to TX properties only';
comment on column utility_accounts.meter_category is 'What the meter serves: house | clubhouse | pool | trash | lighting | irrigation | laundry | gate | sign | leasing | other';
