-- ============================================================================
-- Migration 0013 — Additional GL codes from FIXED-sheet parser
--
-- The FIXED tab in the legacy property workbooks references several GL codes
-- that don't exist in the 0002 / 0010 seed. These are non-utility recurring
-- expenses (landscaping, pest control, security, software, etc.) that the
-- 0012 per-account seed needs in order to insert FIXED-sheet invoices.
--
-- Without this migration, every FIXED invoice silently fails the
-- `join gl_accounts g on g.code = inv.gl_code` and gets dropped from the
-- INSERT, leaving FIXED data missing in the dashboard.
--
-- All categories are 'other' since the utility_category enum doesn't have
-- distinct values for landscaping / pest / security / etc.
-- ============================================================================

insert into gl_accounts (code, description, utility_category) values
    ('5335', 'Fire Sprinklers / Pool',  'other'),
    ('5340', 'Pest Control',             'other'),
    ('5365', 'Elevator Service',         'other'),
    ('5410', 'Landscaping',              'other'),
    ('5440', 'Rust Removal',             'other'),
    ('5455', 'Attorney Fees',            'other'),
    ('5510', 'Marketing & Advertising',  'other'),
    ('5610', 'Office Supplies',          'other'),
    ('5625', 'Office Equipment',         'other'),
    ('5630', 'Communications & IT',      'other'),
    ('5650', 'Tenant Screening',         'other'),
    ('5670', 'Security',                 'other'),
    ('5672', 'Insurance',                'other'),
    ('6025', 'Window Replacement',       'other'),
    ('6090', 'Capital Solutions',        'other')
on conflict (code) do nothing;
