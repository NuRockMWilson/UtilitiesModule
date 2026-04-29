-- ============================================================================
-- 0018_real_vendors.sql
--
-- Replaces [Historical] placeholder vendors (created by migration 0015) with
-- real vendor records from the customer's vendors table.
--
-- For each (property, GL category) pair where a real vendor has been
-- identified, this migration:
--   1. Looks up the real vendor by Sage Vendor ID.
--   2. Repoints the placeholder utility_account → real vendor (or merges it
--      into an existing real UA when a unique-constraint conflict would arise).
--   3. Cascades vendor_id to all linked historical invoices.
--   4. Deactivates the now-empty [Historical] placeholder vendors.
--
-- The whole migration is wrapped in a single DO block. Reasoning:
-- Postgres parses multi-statement SQL submissions all at once, so a later
-- statement that references a temp table created earlier in the same
-- submission errors at parse time with "relation does not exist". DO blocks
-- defer parsing to execution time, sidestepping this. The block also runs
-- in a single transaction, restoring atomicity (any RAISE EXCEPTION rolls
-- back the whole thing).
--
-- Out of scope (intentionally left on placeholders):
--   - 606 Haverhill trash — no Sage record yet
--   - 611 Beverly Park (everything) — property not yet operating
--   - Phone/cable for all properties — needs account-level mapping pass
--   - FedEx for all properties — needs account-level mapping pass
-- ============================================================================

do $migration$
declare
  v_count                  int;
  v_missing                text;
  v_inactive               text;
  v_total                  int;
  v_updates                int;
  v_merges                 int;
  v_invoices_remapped      int;
  v_deactivated            int;
  v_remaining_placeholders int;
  v_remaining_uas          int;
  v_real_vendors_in_use    int;
begin

  -- --------------------------------------------------------------------------
  -- Step 1 — Build the (property, GL category) → vendor mapping.
  -- --------------------------------------------------------------------------

  create temp table _vendor_remap (
    property_code     text,
    gl_category       text,
    vendor_name       text,
    sage_vendor_id    text,
    real_vendor_id    uuid
  ) on commit drop;

  insert into _vendor_remap (property_code, gl_category, vendor_name, sage_vendor_id) values
    -- ---- 508 Hearthstone Landing ----
    ('508', 'Electric (House)',  'Georgia Power',                          'GP'),
    ('508', 'Electric (Vacant)', 'Georgia Power',                          'GP'),
    ('508', 'Water/Sewer',       'City of Canton Utility Billing',         'cityofcant'),
    ('508', 'Trash',             'Republic Services Inc.',                 'Republic'),
    -- ---- 509 Heritage at Walton Reserve ----
    ('509', 'Electric (House)',  'GreyStone Power Corporation',            'Greystone'),
    ('509', 'Electric (Vacant)', 'GreyStone Power Corporation',            'Greystone'),
    ('509', 'Water/Sewer',       'Cobb County Water System',               'Cobb'),
    ('509', 'Gas',               'Austell Natural Gas Systems',            'Austell'),
    ('509', 'Trash',             'Republic Services Inc.',                 'Republic'),
    -- ---- 514 Hidden Creste ----
    ('514', 'Water/Sewer',       'City of Atlanta',                        'CityAtlant'),
    ('514', 'Trash',             'Republic Services Inc.',                 'Republic'),
    -- ---- 515 Tuscany Village ----
    ('515', 'Electric (House)',  'Georgia Power',                          'GP'),
    ('515', 'Electric (Vacant)', 'Georgia Power',                          'GP'),
    ('515', 'Water/Sewer',       'Dekalb County Finance',                  'Dekalb-R'),
    ('515', 'Trash',             'Republic Services Inc.',                 'Republic'),
    -- ---- 516 Heritage McDonough ----
    ('516', 'Electric (House)',  'Georgia Power',                          'GP'),
    ('516', 'Electric (Vacant)', 'Georgia Power',                          'GP'),
    ('516', 'Trash',             'Republic Services Inc.',                 'Republic'),
    -- ---- 555 Sunset Pointe ----
    ('555', 'Electric (House)',  'Constellation NewEnergy, Inc.',          'Constella'),
    ('555', 'Electric (Vacant)', 'Constellation NewEnergy, Inc.',          'Constella'),
    ('555', 'Water/Sewer',       'Fort Worth Water Department',            'Fort Worth'),
    ('555', 'Trash',             'Republic - Duncan Disposal #794',        'RepublicS'),
    -- ---- 558 Onion Creek ----
    ('558', 'Electric (House)',  'City of Austin',                         'Austin'),
    ('558', 'Electric (Vacant)', 'City of Austin',                         'Austin'),
    ('558', 'Water/Sewer',       'City of Austin',                         'Austin'),
    ('558', 'Trash',             'WM Corporate Services, Inc.',            'Waste TX'),
    -- ---- 559 Eastland ----
    ('559', 'Electric (House)',  'Constellation NewEnergy, Inc.',          'Constella'),
    ('559', 'Electric (Vacant)', 'Constellation NewEnergy, Inc.',          'Constella'),
    ('559', 'Water/Sewer',       'Fort Worth Water Department',            'Fort Worth'),
    ('559', 'Trash',             'Republic - Duncan Disposal #794',        'RepublicS'),
    -- ---- 560 Heritage Park Vista ----
    ('560', 'Electric (House)',  'Tri County Electric Co-Op Inc.',         'TRI-C'),
    ('560', 'Electric (Vacant)', 'Tri County Electric Co-Op Inc.',         'TRI-C'),
    ('560', 'Water/Sewer',       'Fort Worth Water Department',            'Fort Worth'),
    ('560', 'Trash',             'Republic - Duncan Disposal #794',        'RepublicS'),
    -- ---- 561 Stalcup ----
    ('561', 'Electric (House)',  'Constellation NewEnergy, Inc.',          'Constella'),
    ('561', 'Electric (Vacant)', 'Constellation NewEnergy, Inc.',          'Constella'),
    ('561', 'Water/Sewer',       'Fort Worth Water Department',            'Fort Worth'),
    ('561', 'Trash',             'Republic - Duncan Disposal #794',        'RepublicS'),
    -- ---- 562 EC Tyler ----
    ('562', 'Electric (House)',  'TXU Energy',                             'TXU-C'),
    ('562', 'Electric (Vacant)', 'TXU Energy',                             'TXU-C'),
    ('562', 'Water/Sewer',       'City of Tyler',                          'TylerWater'),
    ('562', 'Trash',             'Republic - Duncan Disposal #794',        'RepublicS'),
    -- ---- 601 Town Park Crossing ----
    ('601', 'Electric (House)',  'FL Power Light Company',                 'FL Power'),
    ('601', 'Electric (Vacant)', 'FL Power Light Company',                 'FL Power'),
    ('601', 'Water/Sewer',       'Town of Davie - Utility Payments',       'Town-D'),
    ('601', 'Trash',             'Coastal Waste & Recycling',              'CoastalWR'),
    -- ---- 602 Vista Grand ----
    ('602', 'Electric (House)',  'Withlacoochee River Electric Co-Op Inc.','withlacooc'),
    ('602', 'Electric (Vacant)', 'Withlacoochee River Electric Co-Op Inc.','withlacooc'),
    ('602', 'Water/Sewer',       'Hernando County Utilities',              'Hernando-C'),
    ('602', 'Trash',             'Republic Services, Inc.',                'Republc762'),
    -- ---- 603 Crystal Lakes ----
    ('603', 'Electric (House)',  'FL Power Light Company',                 'FL Power'),
    ('603', 'Electric (Vacant)', 'FL Power Light Company',                 'FL Power'),
    ('603', 'Water/Sewer',       'Broward County WWS',                     'BCWater'),
    ('603', 'Trash',             'Coastal Waste & Recycling',              'CoastalWR'),
    -- ---- 604 Heritage at Pompano ----
    ('604', 'Electric (House)',  'FL Power Light Company',                 'FL Power'),
    ('604', 'Electric (Vacant)', 'FL Power Light Company',                 'FL Power'),
    ('604', 'Water/Sewer',       'City of Pompano',                        'cty of pom'),
    ('604', 'Trash',             'Coastal Waste & Recycling',              'CoastalWR'),
    -- ---- 606 Haverhill ---- (no trash — Sage record TBD)
    ('606', 'Electric (House)',  'FL Power Light Company',                 'FL Power'),
    ('606', 'Electric (Vacant)', 'FL Power Light Company',                 'FL Power'),
    ('606', 'Water/Sewer',       'Palm Beach County',                      'PBCty-WUD'),
    -- ---- 607 Residences at Marathon Key ----
    ('607', 'Electric (House)',  'Florida Keys Electric',                  'FL Keys'),
    ('607', 'Electric (Vacant)', 'Florida Keys Electric',                  'FL Keys'),
    ('607', 'Water/Sewer',       'Florida Keys Aqueduct Authority',        'FKAA'),
    ('607', 'Trash',             'Marathon Garbage Services Inc.',         'MGS'),
    -- ---- 608 Residences at Crystal Cove ----
    ('608', 'Electric (House)',  'Florida Keys Electric',                  'FL Keys'),
    ('608', 'Electric (Vacant)', 'Florida Keys Electric',                  'FL Keys'),
    ('608', 'Water/Sewer',       'Florida Keys Aqueduct Authority',        'FKAA'),
    ('608', 'Trash',             'Marathon Garbage Services Inc.',         'MGS'),
    -- ---- 610 Residences at Naranja Lakes ----
    ('610', 'Electric (House)',  'FL Power Light Company',                 'FL Power'),
    ('610', 'Electric (Vacant)', 'FL Power Light Company',                 'FL Power'),
    ('610', 'Water/Sewer',       'Miami-Dade Water and Sewer Department',  'MiamiWater'),
    ('610', 'Trash',             'WM Corporate Services Inc',              'Waste');
    -- 611 Beverly Park entirely skipped — vendors N/A until property operating

  -- --------------------------------------------------------------------------
  -- Step 2 — Resolve real vendor IDs by Sage Vendor ID (case-insensitive).
  -- Falls back to name match for any row without a Sage ID.
  -- --------------------------------------------------------------------------

  update _vendor_remap vr
     set real_vendor_id = (
       select v.id from vendors v
        where (vr.sage_vendor_id is not null
                and lower(trim(v.sage_vendor_id)) = lower(trim(vr.sage_vendor_id)))
           or (vr.sage_vendor_id is null
                and lower(trim(v.name)) = lower(trim(vr.vendor_name)))
        order by v.active desc, v.created_at asc
        limit 1
     );

  -- --------------------------------------------------------------------------
  -- Step 3 — Validation. Raises and rolls back if anything is missing/inactive.
  -- --------------------------------------------------------------------------

  select string_agg(
           '  - ' || property_code || ' / ' || gl_category || ': sage="'
             || coalesce(sage_vendor_id, '(none)') || '" name="'
             || coalesce(vendor_name, '(none)') || '"',
           E'\n')
    into v_missing
    from _vendor_remap
   where real_vendor_id is null;

  if v_missing is not null then
    raise exception E'Missing vendors — cannot proceed. Add or rename in /admin/vendors:\n%', v_missing;
  end if;

  select string_agg(
           '  - ' || vr.property_code || ' / ' || vr.gl_category || ': "' || v.name || '"',
           E'\n')
    into v_inactive
    from _vendor_remap vr
    join vendors v on v.id = vr.real_vendor_id
   where not v.active;

  if v_inactive is not null then
    raise exception E'These required vendors exist but are deactivated. Reactivate first:\n%', v_inactive;
  end if;

  select count(*) into v_count from _vendor_remap;
  raise notice '[0018] Step 3 OK: all % required vendors resolved.', v_count;

  -- --------------------------------------------------------------------------
  -- Step 4 — Build the remap plan.
  --
  -- For each placeholder UA whose (property, GL) we have a mapping for, decide
  -- the action:
  --   action='update'  this UA survives, just point it at the real vendor
  --   action='merge'   delete this UA, move its invoices to the survivor
  --
  -- Survivor selection per (real_vendor, account_number) group:
  --   If a real (non-placeholder) UA already exists with this combo → use it.
  --   Else → keep the oldest placeholder UA in the group; merge any others.
  -- --------------------------------------------------------------------------

  create temp table _remap_plan on commit drop as
  with candidates as (
    select
      ua.id              as ua_id,
      ua.vendor_id       as old_vendor_id,
      ua.account_number,
      vr.real_vendor_id  as new_vendor_id,
      vr.property_code,
      vr.gl_category
    from utility_accounts ua
    join properties p     on p.id = ua.property_id
    join gl_accounts g    on g.id = ua.gl_account_id
    join _vendor_remap vr on vr.property_code = p.code
    join vendors current_v on current_v.id = ua.vendor_id
    where current_v.name like '[Historical]%'
      and (
           (vr.gl_category = 'Electric (House)'  and g.code = '5112')
        or (vr.gl_category = 'Electric (Vacant)' and g.code in ('5114', '5116'))
        or (vr.gl_category = 'Water/Sewer'       and g.code in ('5120', '5125'))
        or (vr.gl_category = 'Gas'               and g.code = '5130')
        or (vr.gl_category = 'Trash'             and g.code = '5135')
      )
  ),
  existing_real_per_group as (
    select
      c.new_vendor_id,
      c.account_number,
      (array_agg(real_ua.id order by real_ua.created_at, real_ua.id))[1] as real_survivor_id
    from candidates c
    join utility_accounts real_ua
      on real_ua.vendor_id      = c.new_vendor_id
     and real_ua.account_number is not distinct from c.account_number
    join vendors v on v.id = real_ua.vendor_id
    where v.name not like '[Historical]%'
    group by c.new_vendor_id, c.account_number
  ),
  planned as (
    select
      c.*,
      er.real_survivor_id,
      first_value(c.ua_id) over (
        partition by c.new_vendor_id, c.account_number
        order by c.ua_id
        rows between unbounded preceding and unbounded following
      ) as placeholder_survivor_id
    from candidates c
    left join existing_real_per_group er
      on er.new_vendor_id    = c.new_vendor_id
     and er.account_number   is not distinct from c.account_number
  )
  select
    ua_id,
    old_vendor_id,
    new_vendor_id,
    account_number,
    property_code,
    gl_category,
    coalesce(real_survivor_id, placeholder_survivor_id) as survivor_id,
    case
      when real_survivor_id is not null              then 'merge'
      when ua_id = placeholder_survivor_id           then 'update'
      else                                                'merge'
    end as action
  from planned;

  select count(*) into v_total    from _remap_plan;
  select count(*) into v_updates  from _remap_plan where action = 'update';
  select count(*) into v_merges   from _remap_plan where action = 'merge';
  raise notice '[0018] Step 4 OK: planned % candidates (% direct updates, % merges).',
    v_total, v_updates, v_merges;

  -- --------------------------------------------------------------------------
  -- Step 5 — Execute the plan.
  -- 5a: move invoices off merged-out UAs onto their survivors.
  -- 5b: delete the merged-out UAs.
  -- 5c: update surviving placeholder UAs to point at real vendor.
  -- 5d: cascade vendor_id to historical invoices on surviving UAs.
  -- --------------------------------------------------------------------------

  update invoices i
     set utility_account_id = rp.survivor_id,
         vendor_id          = rp.new_vendor_id,
         updated_at         = now()
    from _remap_plan rp
   where i.utility_account_id = rp.ua_id
     and rp.action = 'merge';

  delete from utility_accounts ua
   using _remap_plan rp
   where ua.id = rp.ua_id
     and rp.action = 'merge';

  update utility_accounts ua
     set vendor_id  = rp.new_vendor_id,
         updated_at = now()
    from _remap_plan rp
   where ua.id = rp.ua_id
     and rp.action = 'update';

  update invoices i
     set vendor_id  = ua.vendor_id,
         updated_at = now()
    from utility_accounts ua
    join _remap_plan rp on rp.ua_id = ua.id
   where i.utility_account_id = ua.id
     and i.source_reference   like 'historical-%'
     and rp.action            = 'update';

  select count(*) into v_invoices_remapped
    from invoices i
    join utility_accounts ua on ua.id = i.utility_account_id
    join vendors v on v.id = ua.vendor_id
   where i.source_reference like 'historical-%'
     and v.name not like '[Historical]%';

  raise notice '[0018] Step 5 OK: % historical invoices now linked to real vendors.', v_invoices_remapped;

  -- --------------------------------------------------------------------------
  -- Step 6 — Deactivate now-empty [Historical] placeholders.
  -- --------------------------------------------------------------------------

  update vendors v
     set active = false,
         updated_at = now()
   where v.name like '[Historical]%'
     and not exists (select 1 from utility_accounts ua where ua.vendor_id = v.id);

  select count(*) into v_deactivated
    from vendors where name like '[Historical]%' and not active;
  raise notice '[0018] Step 6 OK: % [Historical] placeholders deactivated.', v_deactivated;

  -- --------------------------------------------------------------------------
  -- Step 7 — Final report.
  -- --------------------------------------------------------------------------

  select count(*) into v_remaining_placeholders
    from vendors where name like '[Historical]%' and active;

  select count(*) into v_remaining_uas
    from utility_accounts ua
    join vendors v on v.id = ua.vendor_id
   where v.name like '[Historical]%';

  select count(distinct vendor_id) into v_real_vendors_in_use
    from utility_accounts
   where vendor_id in (select id from vendors where name not like '[Historical]%');

  raise notice '[0018] Final state:';
  raise notice '  - Active [Historical] placeholders remaining: % (expected: small, for 606 trash, 611, FedEx, phone)', v_remaining_placeholders;
  raise notice '  - utility_accounts still on placeholders:     %', v_remaining_uas;
  raise notice '  - Distinct real vendors with linked UAs:      %', v_real_vendors_in_use;

end $migration$;
