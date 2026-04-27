-- ============================================================================
-- 0014_vendor_uniqueness.sql
--
-- Loosen vendor uniqueness rules.
--
-- Background: 0012_per_account_historical.sql created `vendors_name_key`, a
-- UNIQUE index on vendors(name), purely so an `ON CONFLICT (name) DO NOTHING`
-- could keep the seed idempotent. That was wrong as a permanent rule —
-- NuRock legitimately has multiple records for the same parent company
-- billing different properties from different remit offices (Republic
-- Services Atlanta vs Republic Services Florida, Charter Communications -CA
-- vs Charter Communications - Texas, etc.). The fuzzy-match dialog in
-- /admin/vendors/new is the right warning surface for that case.
--
-- What blocks legitimate duplicates: the same NAME under the SAME Sage
-- vendor id, because that would collide in Sage. We enforce that with a
-- partial unique index that only fires when sage_vendor_id is set.
-- Vendors without a Sage id yet (newly created, awaiting Sharon to assign)
-- are excluded from the constraint.
-- ============================================================================

drop index if exists vendors_name_key;

create unique index if not exists vendors_name_sage_id_key
  on vendors (name, sage_vendor_id)
  where sage_vendor_id is not null;
