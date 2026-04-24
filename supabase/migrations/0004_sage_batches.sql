-- ============================================================================
-- Sage batch tracking
-- ============================================================================
-- A "Sage batch" is a single AP Import file (for 300 CRE) or a single API
-- push (for Intacct) containing one or more approved invoices. Sharon
-- downloads the file, imports it in the Sage client, then clicks
-- "Confirm Sage import" in the app to flip the invoices to posted_to_sage.
-- The two-step flow matters because:
--   1. File generation is separate from Sage acknowledgment — if the Sage
--      import fails, we can regenerate without double-posting.
--   2. The artifact is retained indefinitely for audit; Sharon can re-pull
--      a batch file weeks later if Sage needs reimporting.
-- ============================================================================

create table sage_batches (
  id uuid primary key default gen_random_uuid(),
  batch_reference text unique not null,       -- 'batch_<ts>_<shortid>'
  sage_system sage_system not null,
  property_id uuid references properties(id),  -- null = cross-property batch
  invoice_count int not null,
  total_amount numeric(14,2) not null,

  -- Artifact (300 CRE only; null for Intacct)
  artifact_path text,                          -- Supabase Storage path
  artifact_filename text,

  -- Lifecycle
  status text not null default 'generated'
    check (status in ('generated','downloaded','confirmed_posted','superseded','void')),
  generated_by uuid references auth.users(id),
  generated_at timestamptz default now(),
  downloaded_at timestamptz,
  downloaded_by uuid references auth.users(id),
  confirmed_posted_at timestamptz,
  confirmed_by uuid references auth.users(id),
  void_reason text,
  notes text
);

create index on sage_batches (status, generated_at desc);
create index on sage_batches (property_id, generated_at desc);

-- Link invoices to the batch they went into. An invoice can only be in
-- one live batch at a time; if a batch is voided, its invoices free up.
alter table invoices add column sage_batch_uuid uuid references sage_batches(id);
create index on invoices (sage_batch_uuid);

-- RLS — permissive for now, to be tightened in the role-based migration
alter table sage_batches enable row level security;
create policy auth_all on sage_batches for all to authenticated using (true) with check (true);
