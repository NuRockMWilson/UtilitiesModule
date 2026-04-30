-- ============================================================================
-- 0025_restore_602_604_fedex_tpc.sql
--
-- BACKGROUND
--   Reconciliation after 0023+0024 found 602/5620 and 604/5620 (FedEx) still
--   short by 7 rows / $276. Root cause: per_meter_final has rows under
--   account_number "TPC 3377-7497-0" at 602 and 604 — these are FedEx
--   shipments from Town Park Crossing's account that 602 and 604 paid for.
--
--   The Sage account 3377-7497-0 has exactly one UA in DB, owned by 601.
--   Migration 0023's UA-resolution joins on (property_id, account_number),
--   so it couldn't find a UA at 602 or 604 named "TPC 3377-7497-0" and
--   skipped the rows.
--
-- WHAT THIS MIGRATION DOES
--   Insert the missing 7 invoices (2 at 602, 5 at 604) attached to 601's
--   existing TPC UA, but with property_id and gl_coding set to 602/604.
--
--   Why attach to 601's UA: there's only one UA per (vendor_id, account)
--   pair. The actual underlying Sage account is shared, so the right thing
--   is to share the UA. The invoice's property attribution stays at 602/604
--   so v_property_summary aggregates correctly.
--
-- AFTER RUNNING
--   602/5620: 14 rows / $1,357.34 (was 12 / $1,290.38)
--   604/5620: 8 rows / $311.81 (was 3 / $102.75)
-- ============================================================================

do $migration$
declare
  v_p_602      uuid;
  v_p_604      uuid;
  v_gl_5620    uuid;
  v_ua_tpc     uuid;
  v_vendor     uuid;
  v_inserted   int;
begin

  select id into v_p_602   from properties  where code = '602';
  select id into v_p_604   from properties  where code = '604';
  select id into v_gl_5620 from gl_accounts where code = '5620';

  -- 601's UA for TPC FedEx account
  select ua.id, ua.vendor_id into v_ua_tpc, v_vendor
    from utility_accounts ua
    join properties p on p.id = ua.property_id
   where p.code = '601'
     and ua.gl_account_id = v_gl_5620
     and ua.account_number = '3377-7497-0';

  if v_p_602 is null or v_p_604 is null or v_gl_5620 is null
     or v_ua_tpc is null or v_vendor is null then
    raise exception '[0025] Could not resolve property/GL/UA/vendor.';
  end if;

  -- Stage rows
  create temp table _tpc_missing (
    property_code     text,
    year              int,
    month             int,
    amount            numeric,
    source_reference  text
  ) on commit drop;

  insert into _tpc_missing values
  ('602', 2026, 1, 31.12, 'historical-2026-602-5620-TPC 3377-7497-0-01-r1'),
  ('602', 2026, 3, 35.84, 'historical-2026-602-5620-TPC 3377-7497-0-03-r1'),
  ('604', 2026, 1, 38.22, 'historical-2026-604-5620-TPC 3377-7497-0-01-r1'),
  ('604', 2026, 1, 39.48, 'historical-2026-604-5620-TPC 3377-7497-0-01-r2'),
  ('604', 2026, 3, 44.3, 'historical-2026-604-5620-TPC 3377-7497-0-03-r1'),
  ('604', 2026, 3, 45.67, 'historical-2026-604-5620-TPC 3377-7497-0-03-r2'),
  ('604', 2026, 4, 41.39, 'historical-2026-604-5620-TPC 3377-7497-0-04-r1');

  -- Insert
  insert into invoices (
    utility_account_id, property_id, vendor_id, gl_account_id,
    invoice_number, invoice_date, service_period_start, service_period_end,
    current_charges, total_amount_due, gl_coding,
    status, source, source_reference,
    submitted_at, approved_at, sage_posted_at,
    exclude_from_baseline
  )
  select
    v_ua_tpc,
    case t.property_code when '602' then v_p_602 when '604' then v_p_604 end,
    v_vendor,
    v_gl_5620,
    t.source_reference,
    make_date(t.year, t.month, 15),
    make_date(t.year, t.month, 1),
    (make_date(t.year, t.month, 1) + interval '1 month' - interval '1 day')::date,
    t.amount, t.amount,
    '500-' || t.property_code || '-5620.00',
    'posted_to_sage'::invoice_status,
    'manual',
    t.source_reference,
    now(), now(), now(),
    false
  from _tpc_missing t;

  get diagnostics v_inserted = row_count;
  raise notice '[0025] Inserted % missing TPC FedEx invoices.', v_inserted;
  raise notice '[0025] Done. Expected: 602/5620=14/$1,357.34, 604/5620=8/$311.81.';

end $migration$;
