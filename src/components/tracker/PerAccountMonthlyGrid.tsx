import Link from "next/link";
import { formatDollars } from "@/lib/format";
import { NoteCell, type ExistingNote } from "./NoteCell";

/**
 * Per-account monthly grid — matches the legacy spreadsheet layout that
 * NuRock property managers are used to reading:
 *
 *   Account | Description      | Jan | Feb | Mar | ... | Dec | YTD
 *   -------------------------------------------------------------------
 *   xxxx-01 | #1 House         | $439| $510| $330| ... | —   | $1,597
 *   ...
 *   Total                        1,767 1,822 1,638                3,117
 *
 * Each monthly amount cell also supports attaching notes — useful for
 * documenting variance explanations like "irrigation leak repaired 3/15".
 */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type AccountRow = {
  id:              string;               // utility_accounts.id
  account_number:  string;
  description:     string | null;
  meter_id?:       string | null;
  esi_id?:         string | null;
  category?:       string | null;         // display subtitle — e.g. meter category
  vendor_name?:    string | null;
};

export interface PerAccountMonthlyGridProps {
  accounts:                  AccountRow[];
  amountsByAccountMonth:     Map<string, Record<number, number>>;
  /** Optional: invoice links, keyed by "accountId:month" */
  invoiceHrefByAccountMonth?: Map<string, { id: string; number: string | null }>;
  /** What label to show in column 1 header — e.g. "Account", "Meter", "Unit" */
  leftHeader?: string;
  /** What label to show in column 2 header — e.g. "Description", "Category" */
  middleHeader?: string;
  /** When true, show the category badge under the description */
  showCategory?: boolean;
  /**
   * If provided, each monthly amount cell becomes a NoteCell anchored to
   * (property_id, utility_account_id, year, month). Omit to hide note UI.
   */
  noteAnchor?: {
    property_id: string;
    year:        number;
    /** Map of "accountId:month" → ExistingNote[] */
    notesByCell: Map<string, ExistingNote[]>;
  };
  /**
   * When the data displayed includes any month at or before April 2026,
   * a disclaimer banner is shown below the table noting that pre-May-2026
   * amounts come from the legacy spreadsheet detail tabs and may not
   * reconcile exactly to the legacy Summary tab roll-ups. Migration 0015
   * loaded these as "posted to Sage" historical baselines.
   *
   * Pass the year displayed by the grid; the banner is rendered when
   * `year < 2026` or `year === 2026 && currentMonth < 5` (i.e. anywhere
   * up through and including April 2026).
   */
  historicalDisclaimerYear?: number;
}

export function PerAccountMonthlyGrid({
  accounts,
  amountsByAccountMonth,
  invoiceHrefByAccountMonth,
  leftHeader   = "Account",
  middleHeader = "Description",
  showCategory = false,
  noteAnchor,
  historicalDisclaimerYear,
}: PerAccountMonthlyGridProps) {
  // Sort accounts by category + description for stable ordering
  const sortedAccounts = [...accounts].sort((a, b) => {
    const catCmp = (a.category ?? "").localeCompare(b.category ?? "");
    if (catCmp !== 0) return catCmp;
    return (a.description ?? "").localeCompare(b.description ?? "");
  });

  // Monthly and YTD per account
  const ytdByAccount = new Map<string, number>();
  const monthlyByAccount = new Map<string, (number | null)[]>();
  for (const a of sortedAccounts) {
    const map = amountsByAccountMonth.get(a.id) ?? {};
    const monthly = new Array(12).fill(null) as (number | null)[];
    let ytd = 0;
    for (let m = 1; m <= 12; m++) {
      if (map[m] != null && map[m] > 0) {
        monthly[m - 1] = map[m];
        ytd += map[m];
      }
    }
    monthlyByAccount.set(a.id, monthly);
    ytdByAccount.set(a.id, ytd);
  }

  // Column totals across all accounts
  const colTotals = new Array(12).fill(0);
  let grandTotal = 0;
  for (const a of sortedAccounts) {
    const monthly = monthlyByAccount.get(a.id) ?? [];
    for (let i = 0; i < 12; i++) {
      colTotals[i] += monthly[i] ?? 0;
    }
    grandTotal += ytdByAccount.get(a.id) ?? 0;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr>
            <th className="cell-head sticky left-0 bg-[#FAFBFC] z-10">{leftHeader}</th>
            <th className="cell-head">{middleHeader}</th>
            {MONTHS.map(m => (
              <th key={m} className="cell-head text-right">{m}</th>
            ))}
            <th className="cell-head text-right">YTD</th>
          </tr>
        </thead>
        <tbody>
          {sortedAccounts.length === 0 && (
            <tr>
              <td colSpan={15} className="cell text-center text-nurock-slate-light py-6">
                No account data for this period yet.
              </td>
            </tr>
          )}
          {sortedAccounts.map(a => {
            const monthly = monthlyByAccount.get(a.id) ?? [];
            const ytd     = ytdByAccount.get(a.id) ?? 0;
            return (
              <tr key={a.id} className="table-row border-b border-nurock-border last:border-b-0">
                <td className="cell sticky left-0 bg-white z-10">
                  <span className="code">{a.account_number}</span>
                </td>
                <td className="cell">
                  <div className="text-nurock-black font-medium">{a.description ?? "—"}</div>
                  {showCategory && a.category && (
                    <div className="text-[10.5px] text-nurock-slate-light uppercase tracking-wide mt-0.5">
                      {a.category}
                    </div>
                  )}
                  {a.meter_id && a.meter_id !== a.account_number && (
                    <div className="text-[10.5px] text-nurock-slate-light font-mono mt-0.5">
                      meter {a.meter_id}
                    </div>
                  )}
                </td>
                {monthly.map((v, i) => {
                  const month = i + 1;
                  const key = `${a.id}:${month}`;
                  const inv = invoiceHrefByAccountMonth?.get(key);
                  const noteKey = `${a.id}:${month}`;
                  const cellNotes = noteAnchor?.notesByCell.get(noteKey) ?? [];

                  const valueContent = v !== null && v > 0 ? (
                    inv ? (
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="text-nurock-navy hover:underline"
                        title={inv.number ?? undefined}
                      >
                        {formatDollars(v)}
                      </Link>
                    ) : (
                      formatDollars(v)
                    )
                  ) : (
                    <span className="text-nurock-slate-light">—</span>
                  );

                  return (
                    <td key={i} className="cell text-right num text-nurock-slate">
                      {noteAnchor && !a.id.startsWith("__summary-") ? (
                        <NoteCell
                          scope={{
                            property_id:        noteAnchor.property_id,
                            utility_account_id: a.id,
                            year:               noteAnchor.year,
                            month,
                          }}
                          existingNotes={cellNotes}
                          label={`${a.description ?? a.account_number} · ${MONTHS[i]} ${noteAnchor.year}`}
                        >
                          {valueContent}
                        </NoteCell>
                      ) : (
                        valueContent
                      )}
                    </td>
                  );
                })}
                <td className="cell text-right num font-semibold text-nurock-black bg-[#FAFBFC]">
                  {ytd > 0 ? formatDollars(ytd) : <span className="text-nurock-slate-light">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
        {sortedAccounts.length > 0 && (
          <tfoot>
            <tr className="bg-[#FAFBFC] border-t-2 border-nurock-border">
              <td className="cell sticky left-0 bg-[#FAFBFC] z-10" />
              <td className="cell font-display font-semibold uppercase tracking-wide text-nurock-navy text-[12px]">
                Property total — {sortedAccounts.length} {sortedAccounts.length === 1 ? "account" : "accounts"}
              </td>
              {colTotals.map((v, i) => (
                <td key={i} className="cell text-right num font-semibold text-nurock-black">
                  {v > 0 ? formatDollars(v) : <span className="text-nurock-slate-light">—</span>}
                </td>
              ))}
              <td className="cell text-right num font-bold text-nurock-black bg-nurock-flag-navy-bg">
                {formatDollars(grandTotal)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      {historicalDisclaimerYear !== undefined &&
        historicalDisclaimerYear < 2026 && (
          <HistoricalDisclaimer year={historicalDisclaimerYear} />
        )}
      {historicalDisclaimerYear === 2026 && (
        <HistoricalDisclaimer year={2026} onlyEarlyMonths />
      )}
    </div>
  );
}

/**
 * Banner shown beneath the grid when any displayed amount comes from
 * migration 0015's per-meter historical baseline. These amounts were
 * extracted from the legacy spreadsheet detail tabs and may not exactly
 * tie to the Summary tab roll-ups. Live invoice data starts May 2026.
 */
function HistoricalDisclaimer({ year, onlyEarlyMonths }: { year?: number; onlyEarlyMonths?: boolean }) {
  return (
    <div className="border-t border-nurock-tan/40 bg-nurock-tan/10 px-4 py-3 text-[12px] text-nurock-slate-dark leading-relaxed">
      <span className="font-semibold text-nurock-navy">Historical data note: </span>
      {onlyEarlyMonths ? (
        <>
          Amounts shown for January through April 2026 were sourced from the
          legacy spreadsheet per-meter detail tabs and may not reconcile exactly
          to the legacy Summary tab roll-ups. From May 2026 forward, every
          amount on this page comes directly from a processed invoice.
        </>
      ) : (
        <>
          Amounts shown for {year ?? "this period"} were sourced from the legacy
          spreadsheet per-meter detail tabs and may not reconcile exactly to the
          legacy Summary tab roll-ups. From May 2026 forward, every amount on
          this page comes directly from a processed invoice.
        </>
      )}
    </div>
  );
}
