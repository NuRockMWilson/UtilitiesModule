-- ============================================================================
-- 0020_remap_fedex_to_real_vendor.sql
--
-- Replaces the [Historical] FedEx placeholder vendors created by migration
-- 0015 with the single real FedEx vendor record (sage_vendor_id="FedEx").
--
-- Conceptually identical to 0018 but simpler: every FedEx placeholder UA
-- maps to ONE target vendor regardless of property, so there's no
-- (property, GL) mapping table.
--
-- Merge handling: FedEx account numbers can appear at multiple properties
-- in the legacy spreadsheets via "Pay for other A/C" entries. After remap,
-- such UAs would conflict on the unique (vendor_id, account_number)
-- constraint. The plan groups by account_number, picks one survivor per
-- group (preferring an existing real UA, else the oldest placeholder), and
-- merges all others into it. Invoice.property_id is preserved on the
-- invoice records themselves, so per-property tracker totals stay correct.
-- ============================================================================

do $migration$
declare
  v_fedex_vendor_id    uuid;
  v_fedex_vendor_name  text;
  v_candidates         int;
  v_total              int;
  v_updates            int;
  v_merges             int;
  v_invoices_remapped  int;
  v_deactivated        int;
  v_total_active_placeholders int;
begin

  -- --------------------------------------------------------------------------
  -- Step 1 — Find the real FedEx vendor.
  -- --------------------------------------------------------------------------

  select id, name
    into v_fedex_vendor_id, v_fedex_vendor_name
    from vendors
   where lower(trim(sage_vendor_id)) = 'fedex'
     and active
   order by created_at asc
   limit 1;

  if v_fedex_vendor_id is null then
    raise exception 'FedEx vendor not found (expected sage_vendor_id="FedEx" with active=true). Add or activate it via /admin/vendors and re-run.';
  end if;

  raise notice '[0020] Step 1 OK: target vendor = "%" (id=%)',
    v_fedex_vendor_name, v_fedex_vendor_id;

  -- --------------------------------------------------------------------------
  -- Step 2 — Count placeholder FedEx UAs (gl_account.code='5620').
  -- --------------------------------------------------------------------------

  select count(*)
    into v_candidates
    from utility_accounts ua
    join gl_accounts g on g.id = ua.gl_account_id
    join vendors v     on v.id = ua.vendor_id
   where g.code = '5620'
     and v.name like '[Historical]%';

  raise notice '[0020] Step 2: found % FedEx [Historical] placeholder utility_accounts', v_candidates;

  if v_candidates = 0 then
    raise notice '[0020] Nothing to do — no FedEx placeholders found. Migration is a no-op.';
    return;
  end if;

  -- --------------------------------------------------------------------------
  -- Step 3 — Build the remap plan.
  --
  -- Survivor selection per account_number:
  --   * If an existing real FedEx UA already has this account_number, use it.
  --   * Otherwise, keep the oldest placeholder UA for this account_number
  --     and merge any other placeholders with the same account_number into it.
  -- --------------------------------------------------------------------------

  create temp table _fedex_plan on commit drop as
  with candidates as (
    select
      ua.id            as ua_id,
      ua.vendor_id     as old_vendor_id,
      ua.account_number
    from utility_accounts ua
    join gl_accounts g on g.id = ua.gl_account_id
    join vendors v     on v.id = ua.vendor_id
    where g.code = '5620'
      and v.name like '[Historical]%'
  ),
  existing_real as (
    -- Real FedEx UAs (not placeholders) already in the system whose
    -- account_number matches one of our candidates.
    select
      real_ua.account_number,
      (array_agg(real_ua.id order by real_ua.created_at, real_ua.id))[1] as real_survivor_id
    from utility_accounts real_ua
    where real_ua.vendor_id = v_fedex_vendor_id
      and real_ua.account_number in (select account_number from candidates)
    group by real_ua.account_number
  ),
  planned as (
    select
      c.*,
      er.real_survivor_id,
      first_value(c.ua_id) over (
        partition by c.account_number
        order by c.ua_id
        rows between unbounded preceding and unbounded following
      ) as placeholder_survivor_id
    from candidates c
    left join existing_real er
      on er.account_number is not distinct from c.account_number
  )
  select
    ua_id,
    old_vendor_id,
    account_number,
    coalesce(real_survivor_id, placeholder_survivor_id) as survivor_id,
    case
      when real_survivor_id is not null         then 'merge'
      when ua_id = placeholder_survivor_id      then 'update'
      else                                           'merge'
    end as action
  from planned;

  select count(*) into v_total   from _fedex_plan;
  select count(*) into v_updates from _fedex_plan where action = 'update';
  select count(*) into v_merges  from _fedex_plan where action = 'merge';
  raise notice '[0020] Step 3 OK: planned % candidates (% direct updates, % merges).',
    v_total, v_updates, v_merges;

  -- --------------------------------------------------------------------------
  -- Step 4 — Execute the plan.
  -- --------------------------------------------------------------------------

  -- 4a: Move invoices from merged UAs onto their survivor + set vendor.
  update invoices i
     set utility_account_id = p.survivor_id,
         vendor_id          = v_fedex_vendor_id,
         updated_at         = now()
    from _fedex_plan p
   where i.utility_account_id = p.ua_id
     and p.action = 'merge';

  -- 4b: Delete the merged-out UAs (now have no invoices linked).
  delete from utility_accounts ua
   using _fedex_plan p
   where ua.id = p.ua_id
     and p.action = 'merge';

  -- 4c: Update surviving placeholder UAs to point at FedEx.
  update utility_accounts ua
     set vendor_id  = v_fedex_vendor_id,
         updated_at = now()
    from _fedex_plan p
   where ua.id = p.ua_id
     and p.action = 'update';

  -- 4d: Cascade vendor_id to historical invoices on the surviving UAs.
  update invoices i
     set vendor_id  = v_fedex_vendor_id,
         updated_at = now()
    from utility_accounts ua
    join _fedex_plan p on p.ua_id = ua.id
   where i.utility_account_id = ua.id
     and i.source_reference   like 'historical-%'
     and p.action             = 'update';

  select count(*) into v_invoices_remapped
    from invoices i
    join utility_accounts ua on ua.id = i.utility_account_id
   where i.source_reference like 'historical-%'
     and ua.vendor_id = v_fedex_vendor_id;

  raise notice '[0020] Step 4 OK: % FedEx historical invoices now linked to real vendor.',
    v_invoices_remapped;

  -- --------------------------------------------------------------------------
  -- Step 5 — Deactivate the [Historical] FedEx placeholders that are now empty.
  -- We scope this to placeholders whose name contains "FedEx" so we don't
  -- accidentally touch other migrations' placeholders. (In practice 0018
  -- already deactivated everything else's, but explicit scope is safer.)
  -- --------------------------------------------------------------------------

  update vendors v
     set active     = false,
         updated_at = now()
   where v.name like '[Historical]%FedEx%'
     and v.active
     and not exists (select 1 from utility_accounts ua where ua.vendor_id = v.id);

  select count(*) into v_deactivated
    from vendors
   where name like '[Historical]%FedEx%'
     and not active;

  raise notice '[0020] Step 5 OK: % FedEx [Historical] placeholders deactivated.',
    v_deactivated;

  -- --------------------------------------------------------------------------
  -- Step 6 — Report remaining placeholders so we know what's left.
  -- --------------------------------------------------------------------------

  select count(*) into v_total_active_placeholders
    from vendors where name like '[Historical]%' and active;

  raise notice '[0020] Final state:';
  raise notice '  - Active [Historical] placeholders remaining: %', v_total_active_placeholders;
  raise notice '    (expected: phone/cable for all properties, plus 606 trash, 611)';

end $migration$;
