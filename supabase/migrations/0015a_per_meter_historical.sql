-- ============================================================================
-- 0015a_per_meter_historical_PART_1_OF_4.sql
--
-- This is part 1 of 4 because the full migration is too large for the
-- Supabase SQL Editor (1MB cap). Apply 0015a first, then 0015b, 0015c, 0015d
-- in order. Each part wraps its own transaction.
--
-- Part 1 of 4: Cleanup of migration 0012's bad data + create 160 placeholder
-- vendors. (~30KB)
-- ============================================================================

-- ============================================================================
-- 0015_per_meter_historical.sql
--
-- REPLACES migration 0012_per_account_historical.sql which loaded:
--   - synthetic forecasted May-Dec 2026 amounts that did not exist
--   - $1.1M of non-utility GLs (Orkin, Oakwood, SOCI, etc.)
--   - per-meter rows that did not reconcile to Summary tab roll-ups
--   - missing data for several properties (Tuscany at $0)
--
-- This migration loads per-service detail tab data from each property workbook
-- for Jan 2025 through Apr 2026 (16 months, 19 active properties + 611 inactive).
-- Per-meter granularity is preserved so the variance engine can compare
-- bill-to-bill at the meter level. 11412 invoice rows across
-- 1351 utility accounts and 160 placeholder vendors.
--
-- Reconciliation status against canonical Summary tab roll-ups:
--   18 of 19 active properties at 98%+ reconciliation
--   Total |gap| across portfolio: $46,887 / $5,266,479 = 0.89%
--   Remaining differences are genuine workbook adjustments (e.g. 610 May 2025
--   has a $4,597 negative reversal that the Summary excludes from the roll-up).
--   These are covered by the Summary disclaimer in the tracker UI.
--
-- Vendors are placeholders ([Historical] {property} {GL category}) since the
-- per-meter detail tabs do not consistently identify vendors. Real vendors will
-- be created and reassigned as live bills flow through starting May 2026.
--
-- All historical invoices are inserted with status = posted_to_sage so they
-- appear in variance baselines but are not pulled into approval workflows.
-- They have source = manual and source_reference LIKE 'historical-2025' /
-- 'historical-2026' so they can be deleted or re-loaded cleanly if needed.
-- ============================================================================

begin;

-- Step 1: Drop migration 0012's bad historical data ---------------------

-- Cascade-delete invoice_line_items, approval_log, usage_readings, variance_inquiries
-- via foreign keys. The DELETE on invoices fires whatever cascades are configured.
delete from invoices where source_reference like 'historical%';

-- Drop utility_accounts that were created by migration 0012. Identified by
-- the description field starting with 'historical-' or by the account_number
-- matching the migration 0012 naming pattern. Safe because migration 0015 will
-- re-create the ones we still need.
delete from utility_accounts where description like '[seed]%' or description like 'historical%';

-- Drop any pre-existing placeholder vendors named '[Historical] {prop} {category}'
-- so the INSERT in Step 2 can use ON CONFLICT DO NOTHING cleanly. This only
-- targets vendors with the specific naming pattern we use in Step 2; it does
-- NOT delete the legitimate-named bogus vendors (Orkin, Oakwood, etc.) that
-- migration 0012 also created. Those should be deactivated manually via the
-- /admin/vendors UI after the user has reviewed them.
delete from vendors
where name like '[Historical]%'
  and id not in (select distinct vendor_id from invoices where vendor_id is not null);

-- Step 2: Create placeholder historical vendors ---------------------------
-- One per (property, GL category). Real vendors will be created as live bills
-- flow through. These can be merged later via the /admin/vendors UI.

insert into vendors (name, short_name, category, active, notes) values
  ('[Historical] 508 Electric (House)', 'HIST-508-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 508 Electric (Vacant Units)', 'HIST-508-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 508 Electric (Clubhouse)', 'HIST-508-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 508 Water', 'HIST-508-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 508 Sewer / Storm Water', 'HIST-508-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 508 Garbage', 'HIST-508-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 508 FedEx', 'HIST-508-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 508 Telephone', 'HIST-508-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 509 Electric (House)', 'HIST-509-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 509 Electric (Vacant Units)', 'HIST-509-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 509 Electric (Clubhouse)', 'HIST-509-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 509 Water', 'HIST-509-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 509 Sewer / Storm Water', 'HIST-509-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 509 Garbage', 'HIST-509-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 509 Cable Television', 'HIST-509-5140', 'cable'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 509 FedEx', 'HIST-509-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 509 Telephone', 'HIST-509-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 514 Electric (House)', 'HIST-514-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 514 Electric (Vacant Units)', 'HIST-514-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 514 Electric (Clubhouse)', 'HIST-514-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 514 Water', 'HIST-514-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 514 Sewer / Storm Water', 'HIST-514-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 514 Garbage', 'HIST-514-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 514 FedEx', 'HIST-514-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 514 Telephone', 'HIST-514-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 515 Electric (House)', 'HIST-515-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 515 Electric (Vacant Units)', 'HIST-515-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 515 Electric (Clubhouse)', 'HIST-515-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 515 Water', 'HIST-515-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 515 Sewer / Storm Water', 'HIST-515-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 515 Garbage', 'HIST-515-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 515 FedEx', 'HIST-515-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 515 Telephone', 'HIST-515-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 516 Electric (House)', 'HIST-516-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 516 Electric (Vacant Units)', 'HIST-516-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 516 Electric (Clubhouse)', 'HIST-516-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 516 Water', 'HIST-516-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 516 Irrigation', 'HIST-516-5122', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 516 Sewer / Storm Water', 'HIST-516-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 516 Garbage', 'HIST-516-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 516 Cable Television', 'HIST-516-5140', 'cable'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 516 FedEx', 'HIST-516-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 516 Telephone', 'HIST-516-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 555 Electric (House)', 'HIST-555-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 555 Electric (Vacant Units)', 'HIST-555-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 555 Electric (Clubhouse)', 'HIST-555-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 555 Water', 'HIST-555-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 555 Irrigation', 'HIST-555-5122', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 555 Sewer / Storm Water', 'HIST-555-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 555 Garbage', 'HIST-555-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 555 Cable Television', 'HIST-555-5140', 'cable'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 555 FedEx', 'HIST-555-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 555 Telephone', 'HIST-555-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 558 Electric (House)', 'HIST-558-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 558 Electric (Vacant Units)', 'HIST-558-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 558 Electric (Clubhouse)', 'HIST-558-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 558 Water', 'HIST-558-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 558 Irrigation', 'HIST-558-5122', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 558 Sewer / Storm Water', 'HIST-558-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 558 Garbage', 'HIST-558-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 558 Cable Television', 'HIST-558-5140', 'cable'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 558 FedEx', 'HIST-558-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 558 Telephone', 'HIST-558-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 559 Electric (House)', 'HIST-559-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 559 Electric (Vacant Units)', 'HIST-559-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 559 Electric (Clubhouse)', 'HIST-559-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 559 Water', 'HIST-559-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 559 Irrigation', 'HIST-559-5122', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 559 Sewer / Storm Water', 'HIST-559-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 559 Garbage', 'HIST-559-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 559 Cable Television', 'HIST-559-5140', 'cable'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 559 FedEx', 'HIST-559-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 559 Telephone', 'HIST-559-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 560 Electric (House)', 'HIST-560-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 560 Electric (Vacant Units)', 'HIST-560-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 560 Electric (Clubhouse)', 'HIST-560-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 560 Water', 'HIST-560-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 560 Irrigation', 'HIST-560-5122', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 560 Sewer / Storm Water', 'HIST-560-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 560 Garbage', 'HIST-560-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 560 Cable Television', 'HIST-560-5140', 'cable'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 560 FedEx', 'HIST-560-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 560 Telephone', 'HIST-560-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 561 Electric (House)', 'HIST-561-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 561 Electric (Vacant Units)', 'HIST-561-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 561 Electric (Clubhouse)', 'HIST-561-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 561 Water', 'HIST-561-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 561 Sewer / Storm Water', 'HIST-561-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 561 Garbage', 'HIST-561-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 561 Cable Television', 'HIST-561-5140', 'cable'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 561 FedEx', 'HIST-561-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 561 Telephone', 'HIST-561-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 562 Electric (House)', 'HIST-562-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 562 Electric (Vacant Units)', 'HIST-562-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 562 Electric (Clubhouse)', 'HIST-562-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 562 Water', 'HIST-562-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 562 Sewer / Storm Water', 'HIST-562-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 562 Garbage', 'HIST-562-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 562 FedEx', 'HIST-562-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 562 Telephone', 'HIST-562-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 601 Electric (House)', 'HIST-601-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 601 Electric (Vacant Units)', 'HIST-601-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 601 Electric (Clubhouse)', 'HIST-601-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 601 Water', 'HIST-601-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 601 Sewer / Storm Water', 'HIST-601-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 601 Garbage', 'HIST-601-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 601 FedEx', 'HIST-601-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 601 Telephone', 'HIST-601-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 602 Electric (House)', 'HIST-602-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 602 Electric (Vacant Units)', 'HIST-602-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 602 Water', 'HIST-602-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 602 Irrigation', 'HIST-602-5122', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 602 Sewer / Storm Water', 'HIST-602-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 602 Garbage', 'HIST-602-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 602 Cable Television', 'HIST-602-5140', 'cable'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 602 FedEx', 'HIST-602-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 602 Telephone', 'HIST-602-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 603 Electric (House)', 'HIST-603-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 603 Electric (Vacant Units)', 'HIST-603-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 603 Electric (Clubhouse)', 'HIST-603-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 603 Water', 'HIST-603-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 603 Irrigation', 'HIST-603-5122', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 603 Sewer / Storm Water', 'HIST-603-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 603 Garbage', 'HIST-603-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 603 FedEx', 'HIST-603-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 603 Telephone', 'HIST-603-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 604 Electric (House)', 'HIST-604-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 604 Electric (Vacant Units)', 'HIST-604-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 604 Electric (Clubhouse)', 'HIST-604-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 604 Water', 'HIST-604-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 604 Irrigation', 'HIST-604-5122', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 604 Sewer / Storm Water', 'HIST-604-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 604 Garbage', 'HIST-604-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 604 FedEx', 'HIST-604-5620', 'fedex'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 604 Telephone', 'HIST-604-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 606 Electric (House)', 'HIST-606-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 606 Electric (Vacant Units)', 'HIST-606-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 606 Electric (Clubhouse)', 'HIST-606-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 606 Water', 'HIST-606-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 606 Sewer / Storm Water', 'HIST-606-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 606 Telephone', 'HIST-606-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 607 Electric (House)', 'HIST-607-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 607 Electric (Vacant Units)', 'HIST-607-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 607 Water', 'HIST-607-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 607 Sewer / Storm Water', 'HIST-607-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 607 Telephone', 'HIST-607-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 608 Electric (House)', 'HIST-608-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 608 Electric (Vacant Units)', 'HIST-608-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 608 Electric (Clubhouse)', 'HIST-608-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 608 Water', 'HIST-608-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 608 Sewer / Storm Water', 'HIST-608-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 608 Garbage', 'HIST-608-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 608 Telephone', 'HIST-608-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 610 Electric (House)', 'HIST-610-5112', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 610 Electric (Vacant Units)', 'HIST-610-5114', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 610 Electric (Clubhouse)', 'HIST-610-5116', 'electric'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 610 Water', 'HIST-610-5120', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 610 Sewer / Storm Water', 'HIST-610-5125', 'water'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 610 Garbage', 'HIST-610-5135', 'trash'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.'),
  ('[Historical] 610 Telephone', 'HIST-610-5635', 'phone'::utility_category, true, 'Placeholder vendor for historical baseline data (migration 0015). Reassign as real bills flow.')
on conflict do nothing;

-- ON CONFLICT DO NOTHING (no target) silently skips any row that would
-- violate a unique constraint. After Step 1's cleanup deleted unreferenced
-- '[Historical] %' vendors, fresh inserts should succeed; if any of these
-- vendor records were re-introduced manually between migrations, the
-- INSERT skips them safely instead of aborting.

commit;
