-- ============================================================================
-- 0021_remap_phone_cable_to_real_vendors.sql
--
-- Replaces [Historical] phone & cable placeholder vendors (created by
-- migration 0015) with the real per-account carrier records (AT&T, Verizon,
-- Comcast, T-Mobile, Spectrum, Level 3, GTT, TBC, Windstream, etc.).
--
-- Unlike electric/water/trash/gas (one vendor per property), phone/cable
-- has multiple carriers per property — one per service line. The mapping
-- key is therefore (property_code, account_number), not (property, GL).
--
-- Sources of the mapping (121 rows total):
--   - 91 rows: explicit Sage Vendor IDs the customer tagged in column B of
--     each property's Phone&Cable spreadsheet tab.
--   - 28 rows: auto-classified by clear name pattern (T-Mobile, AT&T, GTT,
--     Comcast, Verizon, Level 3, etc.) where column B was blank.
--   - 2 rows: edge-case best-guesses (typos and ambiguous abbreviations).
--
-- Out of scope (will stay on placeholders):
--   - ~7 phone/cable UAs whose source rows my regex missed (likely Cable
--     section rows). Review /admin/utility-accounts after running.
--   - All FedEx, electric, water, trash, gas — already handled by 0018/0020.
--   - 606 trash, 611 — vendors not yet set up.
-- ============================================================================

do $migration$
declare
  v_count               int;
  v_missing             text;
  v_inactive            text;
  v_total               int;
  v_updates             int;
  v_merges              int;
  v_invoices_remapped   int;
  v_deactivated         int;
  v_remaining_uas       int;
begin

  -- --------------------------------------------------------------------------
  -- Step 1 — Build the (property, account) → Sage Vendor ID mapping.
  -- --------------------------------------------------------------------------

  create temp table _phonecable_map (
    property_code     text,
    account_number    text,
    sage_vendor_id    text,
    real_vendor_id    uuid
  ) on commit drop;

  insert into _phonecable_map (property_code, account_number, sage_vendor_id) values
  -- ---- 508 ----
  ('508', '8220-21-060-0319901'           , 'Comcast'     ),  -- Comcast-Pool Phone
  ('508', '8220-21-060-0231940'           , 'Comcast'     ),  -- Comcast_New phone service
  ('508', '330249'                        , 'Level3'      ),  -- Level 3 _Corp. Office
  ('508', '1541136455'                    , 'T-Mobile'    ),  -- T-Mobile
  ('508', '73019061'                      , 'windstream'  ),  -- Windstream - replace account 1 360

  -- ---- 509 ----
  ('509', '831-001-2807-963'              , 'AT&T-5019'   ),  -- AT & T-Internet_Master AC
  ('509', '831-001-1165-901'              , 'AT&T-5019'   ),  -- AT&T_Wifi
  ('509', '8220 11 110 7034508'           , 'Comcast'     ),  -- Comcast_CH
  ('509', '337015'                        , 'GTT'         ),  -- GTT\Access Point
  ('509', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('509', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile
  ('509', '1281'                          , 'TBC Comm'    ),  -- TBC\Source_Pool, Fire panels, Elevators
  ('509', '742612118-00004'               , 'Verizon_NJ'  ),  -- Verizon-Pots line

  -- ---- 514 ----
  ('514', '831-001-1165-903'              , 'AT&T-5019'   ),  -- AT&T_Wifi
  ('514', '831-001-5684-693'              , 'AT&T-5019'   ),  -- At & T_Fiber
  ('514', '831-0012807-965'               , 'ATT-5014'    ),  -- At & T_Internet Master AC
  ('514', '337021'                        , 'GTT'         ),  -- GTT\Access Point
  ('514', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('514', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile
  ('514', '1281'                          , 'TBC Comm'    ),  -- TBC\Source Inc._Pots Line
  ('514', '0742612118-00009'              , 'Verizon_NJ'  ),  -- Verizon_Pots Line

  -- ---- 515 ----
  ('515', '831-001-5684-812'              , 'AT&T-5019'   ),  -- AT & T_Fiber
  ('515', '831-001-2807-966'              , 'ATT-5014'    ),  -- AT & T_Internet_Master AC
  ('515', '831-001-1165-904'              , 'AT&T-5019'   ),  -- AT & T_Wifi
  ('515', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('515', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile
  ('515', '1281'                          , 'TBC Comm'    ),  -- TBC\Source Inc.-Pool, fire panels
  ('515', '742412118-0002'                , 'Verizon_NJ'  ),  -- Verizon_Pots line

  -- ---- 516 ----
  ('516', '337020'                        , 'GTT'         ),  -- GTT\Access Point
  ('516', 'T193945'                       , 'GTT'         ),  -- GTT_master acoount
  ('516', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('516', '8312-10-151-0058250 - Master Account for Residents', 'SpectrumIL'  ),  -- Spectrum \ Charter
  ('516', '8312-10-151-0057435_ Elevator Bldg 2_678-814-4881', 'Charter_IL'  ),  -- Spectrum/Charter
  ('516', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile

  -- ---- 555 ----
  ('555', '831-001-5707-441'              , 'AT&T-5019'   ),  -- AT & T - Fiber
  ('555', '831-001-2807-970'              , 'ATT-5014'    ),  -- AT & T_Internet-Master AC
  ('555', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('555', '8317 10 099 1363010'           , 'SpectrumIL'  ),  -- Spectrum  \ Charter-Club House
  ('555', '8317 10 099 0121997'           , 'SpectrumIL'  ),  -- Spectrum \ Charter
  ('555', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile

  -- ---- 558 ----
  ('558', '831-001-1165 909'              , 'AT&T-5019'   ),  -- AT & T - Wifi
  ('558', '831-001-5707-642'              , 'AT&T-5019'   ),  -- AT & T_Fiber
  ('558', '831-001-2807-971'              , 'ATT-5014'    ),  -- AT & T_Internet-Master AC
  ('558', '330249'                        , 'Level3'      ),  -- Level 3
  ('558', '8260 16 158 1089040'           , 'SpectrumCA'  ),  -- Spectrum  \ TIME WARNER
  ('558', '8260 16 1585900069'            , 'Charter_CA'  ),  -- Spectrum - Internet/TV_Corp unit#5307
  ('558', '8260 16 158 1074687'           , 'Charter_CA'  ),  -- Spectrum - Leasing Office Internet/TV
  ('558', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile

  -- ---- 559 ----
  ('559', '831-001-5707-6983'             , 'AT&T-5019'   ),  -- AT & T - Fiber
  ('559', '831-001-2807-972'              , 'ATT-5014'    ),  -- AT & T_Inernet-Master AC
  ('559', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('559', '8317 10 098 1277162'           , 'Charter_IL'  ),  -- Spectrium -Leasing Office Internet
  ('559', '317 10 098 1242513'            , 'SpectrumIL'  ),  -- Spectrum \Charter Business-Club House
  ('559', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile

  -- ---- 560 ----
  ('560', '831-001-5707-687'              , 'AT&T-5019'   ),  -- AT & T_Fiber
  ('560', '831-001-2807-973'              , 'ATT-5014'    ),  -- AT & T_Internet-Master AC
  ('560', '831-001-1165-911'              , 'AT&T-5019'   ),  -- AT & T_Wifi
  ('560', '337025'                        , 'GTT'         ),  -- GTT\Access Point
  ('560', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('560', '8317 10 099 0732645'           , 'SpectrumIL'  ),  -- Spectrum \Charter
  ('560', '8317-10-001-3190268'           , 'SpectrumIL'  ),  -- Spectrum \Charter_Club House
  ('560', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile
  ('560', '1281'                          , 'TBC Comm'    ),  -- TBC\Source Inc
  ('560', '0742612118-0006'               , 'Verizon_NJ'  ),  -- Verizon_Pots line

  -- ---- 561 ----
  ('561', '831-001-2807-974'              , 'ATT-5014'    ),  -- AT & T_Internet-Master AC
  ('561', '831-001-1165-912'              , 'AT&T-5019'   ),  -- AT & T_Wifi
  ('561', '831-001-5707-701'              , 'AT&T-5019'   ),  -- At & T_Fiber
  ('561', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('561', '8317 10 098 1242539'           , 'SpectrumIL'  ),  -- Spectrum \Charter-Club House
  ('561', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile

  -- ---- 562 ----
  ('562', '831-001-5707-764'              , 'AT&T-5019'   ),  -- AT & T - Fiber
  ('562', '831-001-2127-643'              , 'AT&T-5019'   ),  -- AT & T - Wifi
  ('562', '831-001-2807-975'              , 'ATT-5014'    ),  -- AT & T_Internet-Master AC
  ('562', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('562', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile

  -- ---- 601 ----
  ('601', '831-001-5710-914'              , 'AT&T-5019'   ),  -- AT & T_Fiber
  ('601', '831-001-2807-976'              , 'AT&T-5019'   ),  -- AT & T_Internet-Masater AC
  ('601', '831-001-1165-914'              , 'AT&T-5019'   ),  -- AT & T_Wifi
  ('601', '8495 75 262 1217919'           , 'Comcast'     ),  -- Comcast-leasing office phone
  ('601', '337016'                        , 'GTT'         ),  -- GTT\AccessPoint
  ('601', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('601', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile
  ('601', '1281'                          , 'TBC Comm'    ),  -- TBC\Source Inc.
  ('601', '0742612118-00008'              , 'Verizon_NJ'  ),  -- Verizon _ Pots lines

  -- ---- 602 ----
  ('602', '831-001-5710-997'              , 'AT&T-5019'   ),  -- AT & T - Fiber
  ('602', '831-001-2093-184'              , 'AT&T-5019'   ),  -- AT & T - Wifi
  ('602', '831-001-2807-977'              , 'ATT-5014'    ),  -- AT & T_Master Account_Internet
  ('602', '337017'                        , 'GTT'         ),  -- GTT\Access Point
  ('602', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office
  ('602', '1994100'                       , 'Mix Netwk'   ),  -- Mix Networks_Source Inc_Pots Lines
  ('602', '1281'                          , 'TBC Comm'    ),  -- Source Inc_Pots Lines
  ('602', '8337 13 012 1197885'           , 'Charter719'  ),  -- Spectrum-Club House Cable
  ('602', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile
  ('602', '0742612118-00007'              , 'Verizon_NJ'  ),  -- Verizon - Pots Lines

  -- ---- 603 ----
  ('603', '8495-75-386-2566691'           , 'Comcast'     ),  -- Comcast-Internet & TV
  ('603', '337014'                        , 'GTT'         ),  -- GTT\Access Point
  ('603', 'T193945'                       , 'GTT'         ),  -- GTT_Master account
  ('603', '330249'                        , 'Level3'      ),  -- Level 3 _ Corp. Office
  ('603', '151136455'                     , 'T-Mobile'    ),  -- T-Mobile

  -- ---- 604 ----
  ('604', '831-001-3608-842'              , 'AT&T-5019'   ),  -- AT & T_Elevators N&S
  ('604', '302838857'                     , 'ATT-5014'    ),  -- AT&T_Corp.Unit Internet & TV
  ('604', '831-001-3808-994'              , 'AT&T-5019'   ),  -- AT&T_Pool-new acct
  ('604', '337805'                        , 'GTT'         ),  -- GTT
  ('604', 'T193945'                       , 'GTT'         ),  -- GTT_Master account
  ('604', '330249'                        , 'Level3'      ),  -- Level 3 _ Corp. Office

  -- ---- 606 ----
  ('606', '831-001-5711-064'              , 'AT&T-5019'   ),  -- AT & T - Fiber
  ('606', '831-001-1165 919'              , 'AT&T-5019'   ),  -- AT & T - Wifi
  ('606', '289894192'                     , 'ATT-5014'    ),  -- AT & T-Clubhouse Internet & Phones
  ('606', '831-001-2807-978'              , 'ATT-5014'    ),  -- AT & T_Internet-Master AC
  ('606', '337002'                        , 'GTT'         ),  -- GTT\AccessPoint
  ('606', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office

  -- ---- 607 ----
  ('607', '8495 60 083 0478352'           , 'Comcast'     ),  -- Comcast _Bldg #1 Elevator
  ('607', '8495 60 083 0478501'           , 'Comcast'     ),  -- Comcast_Leasing Office -CC
  ('607', '330249'                        , 'Level3'      ),  -- Level 3_Corp. Office

  -- ---- 608 ----
  ('608', '8495 60 083 0481315'           , 'Comcast'     ),  -- Comcast_Elevators/Fire Panels
  ('608', '8495 60 083 0478501'           , 'Comcast'     ),  -- Comcast_Leasing office
  ('608', '330249'                        , 'Level3'      ),  -- Level 3

  -- ---- 610 ----
  ('610', '8495 60 062 7906896'           , 'Comcast'     ),  -- Comcast_Bldg A_Phone/Elevator
  ('610', '8495 60 062 7906854'           , 'Comcast'     ),  -- Comcast_Bldg B _Phone/Elevator
  ('610', '8495 60 062 7816087'           , 'Comcast'     ),  -- Comcast_CH Internet
  ('610', '330249'                        , 'Level3'      );  -- Level 3

  -- --------------------------------------------------------------------------
  -- Step 2 — Resolve real vendor IDs by Sage Vendor ID (case-insensitive).
  -- --------------------------------------------------------------------------

  update _phonecable_map pm
     set real_vendor_id = (
       select v.id from vendors v
        where lower(trim(v.sage_vendor_id)) = lower(trim(pm.sage_vendor_id))
        order by v.active desc, v.created_at asc
        limit 1
     );

  -- --------------------------------------------------------------------------
  -- Step 3 — Validation: abort if any Sage IDs don't resolve or are inactive.
  -- --------------------------------------------------------------------------

  select string_agg(distinct '  - ' || sage_vendor_id, E'\n')
    into v_missing
    from _phonecable_map
   where real_vendor_id is null;

  if v_missing is not null then
    raise exception E'Phone/cable Sage Vendor IDs not found in vendors table:\n%', v_missing;
  end if;

  select string_agg(distinct '  - ' || v.name || ' (sage=' || v.sage_vendor_id || ')', E'\n')
    into v_inactive
    from _phonecable_map pm
    join vendors v on v.id = pm.real_vendor_id
   where not v.active;

  if v_inactive is not null then
    raise exception E'These required vendors exist but are deactivated. Reactivate first:\n%', v_inactive;
  end if;

  select count(*) into v_count from _phonecable_map;
  raise notice '[0021] Step 3 OK: all % phone/cable mappings resolved.', v_count;

  -- --------------------------------------------------------------------------
  -- Step 4 — Build the remap plan with merge handling.
  --
  -- Match candidates by (property_code, account_number). Some account
  -- numbers may be referenced at multiple properties (e.g. shared corporate
  -- internet accounts) — the merge logic from 0018/0020 consolidates them.
  -- --------------------------------------------------------------------------

  create temp table _pc_plan on commit drop as
  with candidates as (
    select
      ua.id              as ua_id,
      ua.vendor_id       as old_vendor_id,
      ua.account_number,
      pm.real_vendor_id  as new_vendor_id,
      pm.property_code,
      pm.sage_vendor_id
    from utility_accounts ua
    join properties p     on p.id = ua.property_id
    join gl_accounts g    on g.id = ua.gl_account_id
    join _phonecable_map pm
      on pm.property_code  = p.code
     and pm.account_number = ua.account_number
    join vendors current_v on current_v.id = ua.vendor_id
    where g.code in ('5635', '5140')
      and current_v.name like '[Historical]%'
  ),
  existing_real as (
    select
      real_ua.vendor_id,
      real_ua.account_number,
      (array_agg(real_ua.id order by real_ua.created_at, real_ua.id))[1] as real_survivor_id
    from candidates c
    join utility_accounts real_ua
      on real_ua.vendor_id      = c.new_vendor_id
     and real_ua.account_number is not distinct from c.account_number
    join vendors v on v.id = real_ua.vendor_id
    where v.name not like '[Historical]%'
    group by real_ua.vendor_id, real_ua.account_number
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
    left join existing_real er
      on er.vendor_id      = c.new_vendor_id
     and er.account_number is not distinct from c.account_number
  )
  select
    ua_id,
    old_vendor_id,
    new_vendor_id,
    account_number,
    property_code,
    sage_vendor_id,
    coalesce(real_survivor_id, placeholder_survivor_id) as survivor_id,
    case
      when real_survivor_id is not null              then 'merge'
      when ua_id = placeholder_survivor_id           then 'update'
      else                                                'merge'
    end as action
  from planned;

  select count(*) into v_total   from _pc_plan;
  select count(*) into v_updates from _pc_plan where action = 'update';
  select count(*) into v_merges  from _pc_plan where action = 'merge';
  raise notice '[0021] Step 4 OK: planned % candidates (% direct updates, % merges).',
    v_total, v_updates, v_merges;

  -- --------------------------------------------------------------------------
  -- Step 5 — Execute the plan (same pattern as 0018/0020).
  -- --------------------------------------------------------------------------

  -- 5a: Move invoices from merged UAs onto their survivor + set vendor.
  update invoices i
     set utility_account_id = p.survivor_id,
         vendor_id          = p.new_vendor_id,
         updated_at         = now()
    from _pc_plan p
   where i.utility_account_id = p.ua_id
     and p.action = 'merge';

  -- 5b: Delete the merged-out UAs.
  delete from utility_accounts ua
   using _pc_plan p
   where ua.id = p.ua_id
     and p.action = 'merge';

  -- 5c: Update surviving placeholder UAs to point at real vendor.
  update utility_accounts ua
     set vendor_id  = p.new_vendor_id,
         updated_at = now()
    from _pc_plan p
   where ua.id = p.ua_id
     and p.action = 'update';

  -- 5d: Cascade vendor_id to historical invoices on the surviving UAs.
  update invoices i
     set vendor_id  = ua.vendor_id,
         updated_at = now()
    from utility_accounts ua
    join _pc_plan p on p.ua_id = ua.id
   where i.utility_account_id = ua.id
     and i.source_reference   like 'historical-%'
     and p.action             = 'update';

  select count(*) into v_invoices_remapped
    from invoices i
    join utility_accounts ua on ua.id = i.utility_account_id
    join vendors v on v.id = ua.vendor_id
    join _pc_plan p on p.ua_id = ua.id or p.survivor_id = ua.id
   where i.source_reference like 'historical-%'
     and v.name not like '[Historical]%';

  raise notice '[0021] Step 5 OK: % phone/cable historical invoices now linked to real vendors.',
    v_invoices_remapped;

  -- --------------------------------------------------------------------------
  -- Step 6 — Deactivate now-empty [Historical] phone/cable placeholders.
  -- --------------------------------------------------------------------------

  update vendors v
     set active     = false,
         updated_at = now()
   where v.name like '[Historical]%'
     and (v.name like '%Phone%' or v.name like '%Cable%')
     and v.active
     and not exists (select 1 from utility_accounts ua where ua.vendor_id = v.id);

  select count(*) into v_deactivated
    from vendors
   where name like '[Historical]%'
     and (name like '%Phone%' or name like '%Cable%')
     and not active;

  raise notice '[0021] Step 6 OK: % phone/cable [Historical] placeholders deactivated.', v_deactivated;

  -- --------------------------------------------------------------------------
  -- Step 7 — Final report.
  -- --------------------------------------------------------------------------

  select count(*) into v_remaining_uas
    from utility_accounts ua
    join vendors v on v.id = ua.vendor_id
    join gl_accounts g on g.id = ua.gl_account_id
   where v.name like '[Historical]%'
     and g.code in ('5635', '5140');

  raise notice '[0021] Final state:';
  raise notice '  - phone/cable UAs still on placeholders: % (review in /admin/utility-accounts)', v_remaining_uas;

end $migration$;
