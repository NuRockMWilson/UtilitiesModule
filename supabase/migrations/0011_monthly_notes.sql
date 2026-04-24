-- ============================================================================
-- Migration 0011 — Monthly notes
--
-- User-authored notes attached to specific monthly amounts on either a
-- summary-tab cell (property × GL × month) or a detail-tab cell
-- (utility_account × month) or a specific invoice. Used to document
-- variance explanations, known issues, one-time events, etc.
--
-- Schema supports any of three scope levels for a note:
--   * Property-GL-month  — a summary-tab cell
--   * Utility-account-month — a detail-tab cell for one account
--   * Invoice            — a specific bill
--
-- Queries can resolve all notes relevant to a cell by filtering on the
-- appropriate combination of columns. Keeping a single table (rather than
-- splitting note types) makes it easy to render a unified "Recent notes"
-- feed later.
-- ============================================================================

create table monthly_notes (
    id             uuid        primary key default gen_random_uuid(),
    property_id    uuid        not null references properties(id) on delete cascade,
    gl_account_id  uuid        references gl_accounts(id) on delete set null,
    utility_account_id uuid    references utility_accounts(id) on delete set null,
    invoice_id     uuid        references invoices(id) on delete set null,

    year           int         not null check (year between 2000 and 2100),
    month          int         not null check (month between 1 and 12),

    note           text        not null check (char_length(note) between 1 and 4000),

    created_at     timestamptz not null default now(),
    created_by     uuid        references auth.users(id) on delete set null,
    created_by_email text,
    updated_at     timestamptz not null default now()
);

create index idx_monthly_notes_summary_cell
    on monthly_notes (property_id, gl_account_id, year, month);
create index idx_monthly_notes_account_cell
    on monthly_notes (utility_account_id, year, month)
    where utility_account_id is not null;
create index idx_monthly_notes_invoice
    on monthly_notes (invoice_id)
    where invoice_id is not null;

-- Update-timestamp trigger
create or replace function tg_monthly_notes_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger monthly_notes_updated_at
    before update on monthly_notes
    for each row execute function tg_monthly_notes_updated_at();

alter table monthly_notes enable row level security;

-- Any signed-in user can read/write notes. Tighten in Phase 2 with role-based policies.
create policy "authenticated can read monthly notes"
    on monthly_notes for select to authenticated using (true);

create policy "authenticated can insert monthly notes"
    on monthly_notes for insert to authenticated with check (true);

create policy "authenticated can update own monthly notes"
    on monthly_notes for update to authenticated
    using (created_by = auth.uid() or created_by is null)
    with check (created_by = auth.uid() or created_by is null);

create policy "authenticated can delete own monthly notes"
    on monthly_notes for delete to authenticated
    using (created_by = auth.uid() or created_by is null);

comment on table monthly_notes is
    'User-authored notes attached to a specific monthly amount — summary cell, detail-tab cell, or invoice. Used to explain variances and document one-time events.';
