-- ============================================================================
-- 0024_restore_515_water_sewer.sql
--
-- BACKGROUND
--   Reconciliation after 0023 found 515/5120 (Water) and 515/5125 (Sewer)
--   missing 81 + 16 rows respectively. Per_meter_final has 6 sub-meter
--   accounts (3066883300..3066888300), but utility_accounts has them split
--   across the two GLs in an unusual way:
--
--     GL 5120 (Water):  has only 3066883300
--     GL 5125 (Sewer):  has 3066884300..3066888300 (5 sub-meters)
--
--   The vendor (Dekalb County Finance) has a unique-constraint violation
--   if we try to INSERT a duplicate (vendor_id, account_number) pair —
--   account_number is shared because both water and sewer are billed
--   together on one Sage account.
--
-- WHAT THIS MIGRATION DOES
--   Attach the 97 missing historical invoices to the EXISTING utility_account
--   for each account_number — even when that UA is "under" a different GL.
--   The invoice's gl_account_id stays correct (5120 or 5125); only the
--   utility_account_id link is to the cross-GL UA.
--
--   This matches how Sage actually bills: one account number, water and
--   sewer charges on the same bill, split by GL line. The summary view
--   aggregates by invoice.gl_account_id, so totals will roll up correctly.
--
-- AFTER RUNNING
--   515/5120 should be 97 rows / $24,270.80
--   515/5125 should be 97 rows / $84,652.72
-- ============================================================================

do $migration$
declare
  v_pid              uuid;
  v_gl_5120          uuid;
  v_gl_5125          uuid;
  v_vendor           uuid;
  v_inserted         int;
  v_unresolvable     int;
begin

  select id into v_pid from properties where code = '515';
  select id into v_gl_5120 from gl_accounts where code = '5120';
  select id into v_gl_5125 from gl_accounts where code = '5125';

  -- Resolve Dekalb County Finance from any existing 515 UA
  select ua.vendor_id into v_vendor
    from utility_accounts ua
   where ua.property_id = v_pid
     and ua.account_number = '3066883300'
   limit 1;

  if v_pid is null or v_gl_5120 is null or v_gl_5125 is null or v_vendor is null then
    raise exception '[0024] Could not resolve property/GL/vendor for 515.';
  end if;

  -- Stage missing invoices --------------------------------------------------

  create temp table _missing_invs (
    gl_account_code   int,
    account_number    text,
    year              int,
    month             int,
    amount            numeric,
    source_reference  text
  ) on commit drop;

  insert into _missing_invs values
  (5120, '3066884300', 2025, 1, 10.07, 'historical-2025-515-5120-3066884300-01-r1'),
  (5120, '3066884300', 2025, 2, 10.07, 'historical-2025-515-5120-3066884300-02-r1'),
  (5120, '3066884300', 2025, 3, 10.07, 'historical-2025-515-5120-3066884300-03-r1'),
  (5120, '3066884300', 2025, 4, 10.07, 'historical-2025-515-5120-3066884300-04-r1'),
  (5120, '3066884300', 2025, 5, 10.07, 'historical-2025-515-5120-3066884300-05-r1'),
  (5120, '3066884300', 2025, 6, 10.07, 'historical-2025-515-5120-3066884300-06-r1'),
  (5120, '3066884300', 2025, 7, 10.07, 'historical-2025-515-5120-3066884300-07-r1'),
  (5120, '3066884300', 2025, 8, 10.07, 'historical-2025-515-5120-3066884300-08-r1'),
  (5120, '3066884300', 2025, 9, 11.08, 'historical-2025-515-5120-3066884300-09-r1'),
  (5120, '3066884300', 2025, 10, 11.08, 'historical-2025-515-5120-3066884300-10-r1'),
  (5120, '3066884300', 2025, 11, 11.08, 'historical-2025-515-5120-3066884300-11-r1'),
  (5120, '3066884300', 2025, 12, 11.08, 'historical-2025-515-5120-3066884300-12-r1'),
  (5120, '3066884300', 2026, 1, 12.19, 'historical-2026-515-5120-3066884300-01-r1'),
  (5120, '3066884300', 2026, 2, 12.19, 'historical-2026-515-5120-3066884300-02-r1'),
  (5120, '3066884300', 2026, 3, 12.19, 'historical-2026-515-5120-3066884300-03-r1'),
  (5120, '3066884300', 2026, 4, 12.19, 'historical-2026-515-5120-3066884300-04-r1'),
  (5120, '3066885300', 2025, 1, 208.59, 'historical-2025-515-5120-3066885300-01-r1'),
  (5120, '3066885300', 2025, 2, 217.27, 'historical-2025-515-5120-3066885300-02-r1'),
  (5120, '3066885300', 2025, 3, 158.42, 'historical-2025-515-5120-3066885300-03-r1'),
  (5120, '3066885300', 2025, 4, 215.13, 'historical-2025-515-5120-3066885300-04-r1'),
  (5120, '3066885300', 2025, 5, 168.02, 'historical-2025-515-5120-3066885300-05-r1'),
  (5120, '3066885300', 2025, 6, 203.03, 'historical-2025-515-5120-3066885300-06-r1'),
  (5120, '3066885300', 2025, 7, 180.15, 'historical-2025-515-5120-3066885300-07-r1'),
  (5120, '3066885300', 2025, 8, 261.32, 'historical-2025-515-5120-3066885300-08-r1'),
  (5120, '3066885300', 2025, 9, 360.71, 'historical-2025-515-5120-3066885300-09-r1'),
  (5120, '3066885300', 2025, 10, 454.19, 'historical-2025-515-5120-3066885300-10-r1'),
  (5120, '3066885300', 2025, 11, 182.69, 'historical-2025-515-5120-3066885300-11-r1'),
  (5120, '3066885300', 2025, 12, 146.44, 'historical-2025-515-5120-3066885300-12-r1'),
  (5120, '3066885300', 2026, 1, 149.79, 'historical-2026-515-5120-3066885300-01-r1'),
  (5120, '3066885300', 2026, 2, 158.92, 'historical-2026-515-5120-3066885300-02-r1'),
  (5120, '3066885300', 2026, 3, 154.86, 'historical-2026-515-5120-3066885300-03-r1'),
  (5120, '3066885300', 2026, 4, 157.25, 'historical-2026-515-5120-3066885300-04-r1'),
  (5120, '3066886300', 2025, 1, 248.59, 'historical-2025-515-5120-3066886300-01-r1'),
  (5120, '3066886300', 2025, 2, 295.19, 'historical-2025-515-5120-3066886300-02-r1'),
  (5120, '3066886300', 2025, 3, 163.88, 'historical-2025-515-5120-3066886300-03-r1'),
  (5120, '3066886300', 2025, 4, 165.56, 'historical-2025-515-5120-3066886300-04-r1'),
  (5120, '3066886300', 2025, 5, 170.72, 'historical-2025-515-5120-3066886300-05-r1'),
  (5120, '3066886300', 2025, 6, 158.58, 'historical-2025-515-5120-3066886300-06-r1'),
  (5120, '3066886300', 2025, 7, 157.62, 'historical-2025-515-5120-3066886300-07-r1'),
  (5120, '3066886300', 2025, 8, 171.1, 'historical-2025-515-5120-3066886300-08-r1'),
  (5120, '3066886300', 2025, 9, 199.69, 'historical-2025-515-5120-3066886300-09-r1'),
  (5120, '3066886300', 2025, 10, 184.47, 'historical-2025-515-5120-3066886300-10-r1'),
  (5120, '3066886300', 2025, 11, 211.75, 'historical-2025-515-5120-3066886300-11-r1'),
  (5120, '3066886300', 2025, 12, 190.39, 'historical-2025-515-5120-3066886300-12-r1'),
  (5120, '3066886300', 2026, 1, 212.87, 'historical-2026-515-5120-3066886300-01-r1'),
  (5120, '3066886300', 2026, 2, 248.81, 'historical-2026-515-5120-3066886300-02-r1'),
  (5120, '3066886300', 2026, 3, 213.88, 'historical-2026-515-5120-3066886300-03-r1'),
  (5120, '3066886300', 2026, 4, 258.98, 'historical-2026-515-5120-3066886300-04-r1'),
  (5120, '3066887301', 2025, 1, 215.28, 'historical-2025-515-5120-3066887301-01-r1'),
  (5120, '3066887301', 2025, 2, 237.04, 'historical-2025-515-5120-3066887301-02-r1'),
  (5120, '3066887301', 2025, 3, 218.22, 'historical-2025-515-5120-3066887301-03-r1'),
  (5120, '3066887301', 2025, 4, 225.83, 'historical-2025-515-5120-3066887301-04-r1'),
  (5120, '3066887301', 2025, 5, 227.16, 'historical-2025-515-5120-3066887301-05-r1'),
  (5120, '3066887301', 2025, 6, -221.52, 'historical-2025-515-5120-3066887301-06-r1'),
  (5120, '3066887301', 2025, 6, 229.19, 'historical-2025-515-5120-3066887301-06-r2'),
  (5120, '3066887301', 2025, 7, 207.01, 'historical-2025-515-5120-3066887301-07-r1'),
  (5120, '3066887301', 2025, 8, 227.09, 'historical-2025-515-5120-3066887301-08-r1'),
  (5120, '3066887301', 2025, 9, 264.41, 'historical-2025-515-5120-3066887301-09-r1'),
  (5120, '3066887301', 2025, 10, 255.35, 'historical-2025-515-5120-3066887301-10-r1'),
  (5120, '3066887301', 2025, 11, 281.02, 'historical-2025-515-5120-3066887301-11-r1'),
  (5120, '3066887301', 2025, 12, 264.75, 'historical-2025-515-5120-3066887301-12-r1'),
  (5120, '3066887301', 2026, 1, 302.02, 'historical-2026-515-5120-3066887301-01-r1'),
  (5120, '3066887301', 2026, 2, 352.52, 'historical-2026-515-5120-3066887301-02-r1'),
  (5120, '3066887301', 2026, 3, 314.33, 'historical-2026-515-5120-3066887301-03-r1'),
  (5120, '3066887301', 2026, 4, 367.44, 'historical-2026-515-5120-3066887301-04-r1'),
  (5120, '3066888300', 2025, 1, 280.87, 'historical-2025-515-5120-3066888300-01-r1'),
  (5120, '3066888300', 2025, 2, 279.57, 'historical-2025-515-5120-3066888300-02-r1'),
  (5120, '3066888300', 2025, 3, 253.21, 'historical-2025-515-5120-3066888300-03-r1'),
  (5120, '3066888300', 2025, 4, 249.9, 'historical-2025-515-5120-3066888300-04-r1'),
  (5120, '3066888300', 2025, 5, 309.51, 'historical-2025-515-5120-3066888300-05-r1'),
  (5120, '3066888300', 2025, 6, 258.99, 'historical-2025-515-5120-3066888300-06-r1'),
  (5120, '3066888300', 2025, 7, 295.38, 'historical-2025-515-5120-3066888300-07-r1'),
  (5120, '3066888300', 2025, 8, 322.11, 'historical-2025-515-5120-3066888300-08-r1'),
  (5120, '3066888300', 2025, 9, 382.84, 'historical-2025-515-5120-3066888300-09-r1'),
  (5120, '3066888300', 2025, 10, 333.5, 'historical-2025-515-5120-3066888300-10-r1'),
  (5120, '3066888300', 2025, 11, 337.46, 'historical-2025-515-5120-3066888300-11-r1'),
  (5120, '3066888300', 2025, 12, 269.13, 'historical-2025-515-5120-3066888300-12-r1'),
  (5120, '3066888300', 2026, 1, 305.29, 'historical-2026-515-5120-3066888300-01-r1'),
  (5120, '3066888300', 2026, 2, 305.47, 'historical-2026-515-5120-3066888300-02-r1'),
  (5120, '3066888300', 2026, 3, 279.97, 'historical-2026-515-5120-3066888300-03-r1'),
  (5120, '3066888300', 2026, 4, 276.48, 'historical-2026-515-5120-3066888300-04-r1'),
  (5125, '3066883300', 2025, 1, 1804.52, 'historical-2025-515-5125-3066883300-01-r1'),
  (5125, '3066883300', 2025, 2, 1982.73, 'historical-2025-515-5125-3066883300-02-r1'),
  (5125, '3066883300', 2025, 3, 1706.84, 'historical-2025-515-5125-3066883300-03-r1'),
  (5125, '3066883300', 2025, 4, 1497.12, 'historical-2025-515-5125-3066883300-04-r1'),
  (5125, '3066883300', 2025, 5, 1429.13, 'historical-2025-515-5125-3066883300-05-r1'),
  (5125, '3066883300', 2025, 6, 1735.93, 'historical-2025-515-5125-3066883300-06-r1'),
  (5125, '3066883300', 2025, 7, 1999.45, 'historical-2025-515-5125-3066883300-07-r1'),
  (5125, '3066883300', 2025, 8, 2262.33, 'historical-2025-515-5125-3066883300-08-r1'),
  (5125, '3066883300', 2025, 9, 1783.8, 'historical-2025-515-5125-3066883300-09-r1'),
  (5125, '3066883300', 2025, 10, 1536.98, 'historical-2025-515-5125-3066883300-10-r1'),
  (5125, '3066883300', 2025, 11, 1843.54, 'historical-2025-515-5125-3066883300-11-r1'),
  (5125, '3066883300', 2025, 12, 1475.6, 'historical-2025-515-5125-3066883300-12-r1'),
  (5125, '3066883300', 2026, 1, 1855.11, 'historical-2026-515-5125-3066883300-01-r1'),
  (5125, '3066883300', 2026, 2, 2361.69, 'historical-2026-515-5125-3066883300-02-r1'),
  (5125, '3066883300', 2026, 3, 1703.66, 'historical-2026-515-5125-3066883300-03-r1'),
  (5125, '3066883300', 2026, 4, 1631.18, 'historical-2026-515-5125-3066883300-04-r1');

  -- Resolve UA by (property, account_number) — IGNORE the GL on the UA.
  -- We attach cross-GL because the unique constraint on UAs is
  -- (vendor_id, account_number), so each Sage account has exactly one UA.
  create temp table _resolved on commit drop as
  select
    mi.*,
    ua.id as utility_account_id,
    case mi.gl_account_code when 5120 then v_gl_5120 when 5125 then v_gl_5125 end as target_gl_id
  from _missing_invs mi
  left join utility_accounts ua
    on ua.property_id = v_pid
   and ua.account_number = mi.account_number
   and ua.vendor_id = v_vendor;

  select count(*) into v_unresolvable from _resolved where utility_account_id is null;
  if v_unresolvable > 0 then
    raise exception '[0024] % rows could not resolve to a UA at 515. Check that all 6 sub-meter UAs exist.', v_unresolvable;
  end if;

  -- Insert ------------------------------------------------------------------

  insert into invoices (
    utility_account_id, property_id, vendor_id, gl_account_id,
    invoice_number, invoice_date, service_period_start, service_period_end,
    current_charges, total_amount_due, gl_coding,
    status, source, source_reference,
    submitted_at, approved_at, sage_posted_at,
    exclude_from_baseline
  )
  select
    r.utility_account_id,
    v_pid,
    v_vendor,
    r.target_gl_id,
    r.source_reference,
    make_date(r.year, r.month, 15),
    make_date(r.year, r.month, 1),
    (make_date(r.year, r.month, 1) + interval '1 month' - interval '1 day')::date,
    r.amount, r.amount,
    '500-515-' || r.gl_account_code::text || '.00',
    'posted_to_sage'::invoice_status,
    'manual',
    r.source_reference,
    now(), now(), now(),
    false
  from _resolved r;

  get diagnostics v_inserted = row_count;
  raise notice '[0024] Inserted % missing historical invoices.', v_inserted;
  raise notice '[0024] Done. Expected: 515/5120=97/$24,270.80, 515/5125=97/$84,652.72.';

end $migration$;
