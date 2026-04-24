-- ============================================================================
-- Reference data: properties and GL accounts
-- Source: Utilities_Procedures.docx
-- ============================================================================

insert into properties (code, full_code, name, short_name, state) values
  -- Georgia
  ('508', '500-508', 'Hearthstone Landing / HL Canton', 'HLC', 'GA'),
  ('509', '500-509', 'Heritage at Walton Reserve / Walton Reserve-Seniors', 'HWR', 'GA'),
  ('514', '500-514', 'Hidden Creste', 'HC', 'GA'),
  ('515', '500-515', 'Tuscany Village', 'TV', 'GA'),
  ('516', '500-516', 'Heritage at McDonough', 'MCD', 'GA'),
  -- Texas
  ('555', '500-555', 'Sunset Pointe', 'SSP', 'TX'),
  ('558', '500-558', 'Onion Creek / River Valley', 'OC', 'TX'),
  ('559', '500-559', 'Eastland / FW Eastland', 'FWE', 'TX'),
  ('560', '500-560', 'Heritage Park Vista', 'HPV', 'TX'),
  ('561', '500-561', 'Stalcup / Buttercup', 'STL', 'TX'),
  ('562', '500-562', 'Earl Campbell / EC Tyler', 'ECT', 'TX'),
  -- Florida
  ('601', '500-601', 'Town Park Crossing', 'TPC', 'FL'),
  ('602', '500-602', 'Vista Grand / NVC Spring Hill', 'VG', 'FL'),
  ('603', '500-603', 'Crystal Lakes', 'CL', 'FL'),
  ('604', '500-604', 'Heritage at Pompano Station', 'HPS', 'FL'),
  ('606', '500-606', 'Haverhill / Cutler Ridge', 'HAV', 'FL'),
  ('607', '500-607', 'Marathon Key', 'MK', 'FL'),
  ('608', '500-608', 'Crystal Cove', 'CC', 'FL'),
  ('610', '500-610', 'Naranja Lakes', 'NL', 'FL');

insert into gl_accounts (code, description, utility_category) values
  ('5112', 'House Electric',        'electric'),
  ('5114', 'Vacant Unit Electric',  'electric'),
  ('5116', 'Clubhouse Electric',    'electric'),
  ('5120', 'Water',                 'water'),
  ('5122', 'Irrigation',            'irrigation'),
  ('5125', 'Sewer',                 'sewer'),
  ('5130', 'Gas',                   'gas'),
  ('5135', 'Trash Removal',         'trash'),
  ('5140', 'Cable Television',      'cable'),
  ('5620', 'FedEx',                 'fedex'),
  ('5635', 'Telephone',             'phone');

-- Note: Storm Water and Environmental Protection roll into GL 5120 (Water)
-- per Sunset Pointe Summary sheet conventions. They are stored as separate
-- line items on the invoice but code to the same GL account.
