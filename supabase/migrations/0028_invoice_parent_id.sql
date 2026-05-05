-- ============================================================================
-- 0028_invoice_parent_id.sql
-- ============================================================================
--
-- Compiled-PDF support.
--
-- When a single PDF contains multiple distinct bills (e.g. Georgia Power
-- batch download with 7 separate accounts in one file), we split the
-- PDF into N child PDFs and create N invoice rows. Each child references
-- back to a "parent" invoice row that holds the original compiled PDF as
-- an immutable artifact for audit.
--
-- THIS MIGRATION ADDS:
--   1. invoices.parent_invoice_id — self-referencing FK pointing at the
--      compiled-parent row when the invoice is a child of a split.
--      NULL for normal single-bill invoices and for the parent itself.
--   2. invoice_status enum gets 'compiled_parent' value — a holding state
--      for the parent row. compiled_parent invoices are never approved or
--      posted; they exist purely so the original PDF and its split metadata
--      remain queryable.
--
-- Long-detail bills (Austin Energy 109-page case) do NOT use this column.
-- For those, each unit-charge gets its own invoice row sharing the same
-- pdf_path as agreed (Phase 2 decision #1). No parent/child relationship —
-- the rows are siblings linked only by pdf_path.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Extend invoice_status enum with 'compiled_parent'
-- ────────────────────────────────────────────────────────────────────────────

alter type invoice_status add value if not exists 'compiled_parent';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Add parent_invoice_id self-reference
-- ────────────────────────────────────────────────────────────────────────────

alter table invoices
  add column if not exists parent_invoice_id uuid references invoices(id);

-- Index on parent lookups: "give me the children of this compiled parent"
create index if not exists idx_invoices_parent_invoice_id
  on invoices (parent_invoice_id)
  where parent_invoice_id is not null;

comment on column invoices.parent_invoice_id is
  'Self-reference for compiled-PDF children. The parent row holds the original ' ||
  'multi-bill PDF as an audit artifact and has status=compiled_parent. Each ' ||
  'child invoice represents one of the bills extracted from the parent. NULL ' ||
  'for normal single-bill invoices.';
