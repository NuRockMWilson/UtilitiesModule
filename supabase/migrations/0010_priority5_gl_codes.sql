-- ============================================================================
-- Migration 0010 — Priority 5 GL codes for Phone/Cable/FedEx/FIXED
--
-- Most of the GLs we need (5112, 5114, 5116, 5120, 5122, 5125, 5130, 5135,
-- 5140, 5620, 5635) were seeded in 0002. But the FIXED sheet references
-- additional codes that aren't utilities per se but appear on the historical
-- tracker — attorney fees, carpet cleaning, contract painting, etc.
--
-- Add the ones needed to avoid orphaning FIXED-sheet rows during import.
-- These are non-utility categories (maintenance/admin/capital) that don't
-- map to any utility_category enum value, so we tag them 'other'.
-- ============================================================================

insert into gl_accounts (code, description, utility_category) values
    ('5210', 'Carpet Cleaning',          'other'),
    ('5225', 'Contract Painting',        'other'),
    ('5345', 'Fire & Safety',            'other'),
    ('5615', 'Administrative Fees',      'other'),
    ('5655', 'Legal Fees',               'other'),
    ('5660', 'Memberships & Dues',       'other'),
    ('5715', 'Pest Control',             'other'),
    ('6020', 'Flooring',                 'other'),
    ('6085', 'Appliances',               'other')
on conflict (code) do nothing;

-- Phone&Cable sheets reference 5140 (Cable TV) separately from 5635 (Phone).
-- Both are already in 0002 seed; confirm descriptions are present.
update gl_accounts set description = 'Cable TV' where code = '5140' and (description is null or description = '');
update gl_accounts set description = 'Telephone' where code = '5635' and (description is null or description = '');
