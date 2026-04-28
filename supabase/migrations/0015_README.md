# Migration 0015 — Per-meter historical baseline

Migration 0015 loads 11,412 historical invoice rows extracted from the legacy
spreadsheet per-meter detail tabs. The single combined file is ~1.6MB which
exceeds the Supabase SQL Editor's 1MB cap, so the migration is split into
four parts.

## Files

| File | Purpose | Size |
|------|---------|------|
| `0015a_per_meter_historical.sql` | Cleanup of migration 0012's bad data + create 160 placeholder vendors | ~34KB |
| `0015b_per_meter_historical.sql` | Insert 1,351 utility_accounts | ~155KB |
| `0015c_per_meter_historical.sql` | Insert first 6,000 historical invoices | ~735KB |
| `0015d_per_meter_historical.sql` | Insert remaining ~5,412 historical invoices + sanity check | ~664KB |
| `0015_per_meter_historical.sql.combined-do-not-apply` | Original single-file version, preserved for reference. **Do not apply this directly.** | 1.6MB |

## How to apply

### Option A: Supabase SQL Editor (4 separate runs)
Apply each file in order: `0015a`, then `0015b`, then `0015c`, then `0015d`. Each
file wraps its own transaction (`BEGIN; ... COMMIT;`) so a failure in any part
rolls back cleanly without affecting the others.

After 0015d completes, the sanity check inside it verifies the cumulative row
counts across all four parts. If counts are off, the transaction inside 0015d
rolls back but parts a/b/c remain applied — re-run 0015d after fixing.

### Option B: Supabase CLI (`supabase db push`)
The CLI applies each `.sql` file in lexicographic order, so `0015a` → `0015b` →
`0015c` → `0015d` happen automatically. The combined file has a `.combined-do-
not-apply` extension so the CLI ignores it.

### Option C: psql against the connection string
```bash
psql "$DATABASE_URL" -f supabase/migrations/0015a_per_meter_historical.sql
psql "$DATABASE_URL" -f supabase/migrations/0015b_per_meter_historical.sql
psql "$DATABASE_URL" -f supabase/migrations/0015c_per_meter_historical.sql
psql "$DATABASE_URL" -f supabase/migrations/0015d_per_meter_historical.sql
```

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
