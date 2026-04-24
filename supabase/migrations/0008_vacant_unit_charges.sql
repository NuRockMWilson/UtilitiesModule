-- ============================================================================
-- Migration 0008 — Vacant unit charges
--
-- Priority 3 of the historical import: Vacant Units detail.
--
-- One row per (property × unit × month) where a vacant-unit electric bill
-- was incurred. These are the costs NuRock absorbs while a unit is between
-- tenants. Typical amount is small ($20–$200) and most units have data only
-- for 1-3 months per year. Storing this separately from invoices because:
--
--   1. They aren't real AP invoices — they're allocations off the master
--      vacant-unit electric account (GL 5114).
--   2. The reporting cut most often wanted is "total vacancy cost by month
--      across all units," not individual-unit detail.
--   3. LIHTC compliance sometimes cares about which units were vacant and
--      when — having the data indexed by (unit, period) makes that
--      straightforward.
-- ============================================================================

create table vacant_unit_charges (
    id              uuid primary key default gen_random_uuid(),
    property_id     uuid not null references properties(id) on delete cascade,

    -- Unit identification
    unit_number     text not null,                                  -- e.g. "1104", "116-Model"
    building_number text,                                            -- e.g. "3820"
    meter_id        text,                                            -- physical meter serial
    esi_id          text,                                            -- Texas ESI ID
    account_number  text,                                            -- utility account the charge came from

    -- Period
    year            int not null,
    month           int not null check (month between 1 and 12),

    -- Cost
    amount          numeric(12, 2) not null,

    -- GL routing — vacant unit electric is typically 5114
    gl_account_id   uuid references gl_accounts(id),
    gl_coding       text,                                            -- '500-555-5114.00' denormalized

    -- Source tracking
    source          text not null default 'historical_import',       -- 'historical_import' | 'bill_allocation' | 'manual'
    notes           text,

    created_at      timestamptz not null default now(),

    unique (property_id, unit_number, year, month)
);

create index idx_vacant_charges_property_period
    on vacant_unit_charges (property_id, year desc, month desc);
create index idx_vacant_charges_unit
    on vacant_unit_charges (property_id, unit_number);

-- Rollup view for property-level vacancy cost reporting
create or replace view v_vacant_cost_by_property_month as
select
    p.id              as property_id,
    p.code            as property_code,
    p.name            as property_name,
    v.year,
    v.month,
    count(*)          as units_charged,
    count(distinct v.unit_number) as distinct_units,
    sum(v.amount)     as total_amount,
    avg(v.amount)     as avg_per_unit
from vacant_unit_charges v
    join properties p on p.id = v.property_id
group by p.id, p.code, p.name, v.year, v.month;

-- Per-unit annual rollup
create or replace view v_vacant_cost_by_unit_year as
select
    property_id,
    unit_number,
    year,
    count(*)                    as months_vacant,
    sum(amount)                 as annual_amount,
    min(month)                  as first_month,
    max(month)                  as last_month
from vacant_unit_charges
group by property_id, unit_number, year;

alter table vacant_unit_charges enable row level security;

create policy "authenticated can read vacant charges"
    on vacant_unit_charges for select to authenticated using (true);

create policy "authenticated can modify vacant charges"
    on vacant_unit_charges for all to authenticated using (true) with check (true);

comment on table vacant_unit_charges is
    'Per-unit electric costs absorbed during vacancy periods. GL 5114.';
comment on column vacant_unit_charges.unit_number is
    'Apartment unit identifier as it appears in property records (e.g. "1104", "116-Model")';
comment on column vacant_unit_charges.source is
    'Provenance — historical_import from legacy sheets, bill_allocation when parsed from an arriving vacant-unit master bill, or manual for admin entry';
