-- ============================================================================
-- Migration 0006 — invoice_line_items
--
-- Splits an invoice's total into per-line-item detail so:
--   • Variance analysis runs on fixed-fee line items separately from
--     consumption-driven line items (storm water doesn't vary; water does).
--   • Sage distribution lines match the source invoice exactly.
--   • Per-property tracker can report "Water $5,242 + Storm $1,186 + Envir
--     $541" instead of lumped "Water $6,968".
--
-- The existing `invoices.total_amount_due` remains authoritative; line items
-- are expected to sum to it (or be flagged via `reconciled_to_total`).
-- ============================================================================

create table invoice_line_items (
    id              uuid primary key default gen_random_uuid(),
    invoice_id      uuid not null references invoices(id) on delete cascade,

    -- GL routing for THIS line (may differ from the invoice's primary GL)
    gl_account_id   uuid not null references gl_accounts(id),
    sub_code        varchar(2) not null default '00',            -- the .XX suffix
    gl_coding       text,                                         -- 500-555-5120.00 denormalized for Sage

    -- Line description from the source (e.g. "Water", "Storm Water", "Envir. Protect. Fee")
    description     text not null,
    category        text,                                         -- 'water' | 'sewer' | 'irrigation' | 'fee' | 'other'

    -- Financial
    amount          numeric(14,2) not null,
    quantity        numeric(14,4),                                -- usage volume if applicable
    unit            text,                                         -- 'gallons' | 'ccf' | 'kwh' | etc
    rate            numeric(14,6),                                -- optional unit price

    -- Whether this line varies with consumption or is a flat fee
    is_consumption_based boolean not null default true,

    -- Source provenance
    source_row_label text,                                        -- what the source sheet called this line
    created_at      timestamptz not null default now()
);

create index idx_line_items_invoice    on invoice_line_items (invoice_id);
create index idx_line_items_gl         on invoice_line_items (gl_account_id);
create index idx_line_items_category   on invoice_line_items (category);

-- A helper column on invoices to flag reconciliation status. `null` means
-- "no line items imported yet"; `true` means items sum to invoice total;
-- `false` means mismatch — inspect manually.
alter table invoices add column if not exists
    line_items_reconciled boolean;

-- View: invoice totals from line items (for reconciliation dashboards)
create or replace view v_invoice_line_totals as
select
    invoice_id,
    count(*)                 as line_count,
    sum(amount)              as line_items_total,
    array_agg(distinct category order by category) as categories
from invoice_line_items
group by invoice_id;

-- RLS — mirror the invoices table policy
alter table invoice_line_items enable row level security;

create policy "authenticated can read line items"
    on invoice_line_items for select to authenticated using (true);

create policy "authenticated can modify line items"
    on invoice_line_items for all to authenticated using (true) with check (true);

comment on table invoice_line_items is
    'Per-line-item breakdown of each invoice. Sum should equal invoices.total_amount_due.';
comment on column invoice_line_items.is_consumption_based is
    'True for water/electric usage-driven charges; false for flat fees like storm water, environmental protection.';
