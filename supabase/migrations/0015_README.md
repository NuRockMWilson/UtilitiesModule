# Migration 0015 — Per-meter historical baseline

Migration 0015 loads 11,412 historical invoice rows extracted from the legacy
spreadsheet per-meter detail tabs. The single combined file is ~1.6MB which
exceeds the Supabase SQL Editor's 1MB cap, so the migration is split into
four parts.

## Files

| File | Purpose | Size |
|------|---------|------|
| `0015a_per_meter_historical.sql` | Cleanup of migration 0012's bad data + create 160 placeholder vendors | ~34KB |
| `0015b_per_meter_historical.sql` | Insert 1,351 utility_accounts (single CTE-based INSERT) | ~136KB |
| `0015c_per_meter_historical.sql` | Insert first 5,700 historical invoices (single CTE-based INSERT) | ~698KB |
| `0015d_per_meter_historical.sql` | Insert remaining 5,712 historical invoices + sanity check (single CTE-based INSERT) | ~698KB |
| `0015_per_meter_historical.sql.combined-do-not-apply` | Original single-file version, preserved for reference. **Do not apply this directly** — it uses temp tables that don't survive Supabase's pooled connections. | 1.6MB |

## How to apply

### Option A: Supabase SQL Editor (4 separate runs)
Apply each file in order: `0015a`, then `0015b`, then `0015c`, then `0015d`.

Each of `0015b`/`0015c`/`0015d` is structured as a **single CTE-based INSERT
statement** (no temp tables, no multi-statement transactions). This works
under Supabase's pooled-connection SQL Editor where `BEGIN;`/`COMMIT;` markers
don't reliably pin the session and temp tables created in one statement
don't survive to the next.

`0015a` does have multiple statements wrapped in `BEGIN;`/`COMMIT;` but only
performs `DELETE` and a single `INSERT INTO vendors`, none of which depend
on session-level temp objects.

### Option B: Supabase CLI (`supabase db push`)
The CLI applies each `.sql` file in lexicographic order, so `0015a` → `0015b` →
`0015c` → `0015d` happen automatically.

### Option C: psql against the connection string
```bash
psql "$DATABASE_URL" -f supabase/migrations/0015a_per_meter_historical.sql
psql "$DATABASE_URL" -f supabase/migrations/0015b_per_meter_historical.sql
psql "$DATABASE_URL" -f supabase/migrations/0015c_per_meter_historical.sql
psql "$DATABASE_URL" -f supabase/migrations/0015d_per_meter_historical.sql
```

## Why CTE instead of temp tables?

The original combined migration used `CREATE TEMP TABLE` to stage rows before
the final `INSERT ... SELECT FROM <temp> JOIN <real tables>`. This pattern
fails under Supabase's pooled SQL Editor with the error:

> ERROR: relation "_hist_seed" does not exist

because the temp table is created on connection A, and the subsequent INSERT
runs on connection B where the table doesn't exist. `BEGIN;`/`COMMIT;` doesn't
help because the editor processes statements separately.

The fix: turn each part into a single statement using a CTE:

```sql
with seed (...) as (values
  ('508', 'HIST-508-5120', '5120', '...'),
  ...
)
insert into utility_accounts (...)
select ... from seed s
join properties p on p.code = s.property_code
join vendors v on v.short_name = s.vendor_short
join gl_accounts g on g.code = s.gl_code
on conflict (vendor_id, account_number) do nothing;
```

Everything happens in one round-trip. No temp tables, no session state.

## Idempotency

- 0015a is fully idempotent: `DELETE` operations target only historical rows, and
  the vendor `INSERT` uses `ON CONFLICT DO NOTHING`.
- 0015b uses `ON CONFLICT (vendor_id, account_number) DO NOTHING` for utility_accounts.
- 0015c and 0015d insert invoices unconditionally. **If you need to re-apply
  these,** first delete with:
  ```sql
  delete from invoices where source_reference like 'historical-%';
  ```

## Reconciliation status

| Property | Reconciliation % vs Summary tab |
|---|---:|
| 508 | 99.8% |
| 509 | 97.8% |
| 514 | 99.8% |
| 515 | 99.7% |
| 516 | 100.0% |
| 555 | 99.9% |
| 558 | 99.8% |
| 559 | 99.3% |
| 560 | 99.8% |
| 561 | 99.6% |
| 562 | 99.6% |
| 601 | 100.8% |
| 602 | 98.9% |
| 603 | 99.9% |
| 604 | 98.5% |
| 606 | 100.1% |
| 607 | 102.6% |
| 608 | 100.0% |
| 610 | 95.5% |

Total portfolio gap: $46,887 / $5,266,479 = 0.89%. Residual differences are
genuine workbook adjustments (e.g. 610 May 2025 has a $4,597 negative reversal
that the Summary tab excludes from its roll-up). These are surfaced via the
disclaimer banner shown in the tracker UI for any month before May 2026.

## Post-migration manual steps

1. Audit and deactivate migration 0012's legitimate-named bogus vendors (Orkin,
   Oakwood, SOCI, Nelson Office, etc., plus dozens of account-number-style
   names). Use `/admin/vendors` or:
   ```sql
   select v.name, v.short_name, v.category, count(i.id) as invoice_count
     from vendors v
     left join invoices i on i.vendor_id = v.id
    group by v.id
   having count(i.id) = 0
    order by v.created_at;
   ```
2. The placeholder vendors named `[Historical] {prop} {GL}` should be
   consolidated as real bills flow through. Either rename them or reassign
   their invoices to real vendor records.
3. Retire `supabase/seed/0005_historical_data.sql` (superseded by this migration).
