-- ============================================================================
-- 0019_cleanup_migration_artifacts.sql
--
-- The first few attempts at running 0018 used regular (non-temp) tables for
-- the working data because Supabase's SQL Editor wouldn't preserve temp
-- tables across statements in the same transaction. Those attempts failed
-- before completing, leaving orphan `vendor_remap` and `remap_plan` tables
-- in the public schema. The final 0018 wraps everything in a DO block and
-- uses temp tables internally — but if anyone re-runs through the failed
-- versions, this migration cleans up after them.
--
-- Idempotent — safe to run on databases that don't have the orphans.
-- ============================================================================

drop table if exists public.vendor_remap;
drop table if exists public.remap_plan;
