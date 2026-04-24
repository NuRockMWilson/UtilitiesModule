"use client";

import { useState, useTransition } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

/**
 * NoteCell — an inline "note" indicator that wraps a monthly amount and lets
 * the user attach / view / edit a note about it.
 *
 * Visual states:
 *   - With notes    → small filled note icon, solid tan color
 *   - Without notes → small outline note icon, near-invisible until hover
 *
 * Clicking opens a popover with the existing note(s), a textarea to add
 * another, and a save button. Saves go to the `monthly_notes` table via the
 * Supabase browser client.
 *
 * Scope is identified by the combination of props passed:
 *   - (property_id, gl_account_id, year, month)   for summary cells
 *   - (property_id, utility_account_id, year, month) for detail-tab cells
 *   - invoice_id                                  for a specific bill
 */

export type NoteScope = {
  property_id:         string;
  gl_account_id?:      string | null;
  utility_account_id?: string | null;
  invoice_id?:         string | null;
  year:                number;
  month:               number;
};

export type ExistingNote = {
  id:               string;
  note:             string;
  created_at:       string;
  created_by_email: string | null;
};

export function NoteCell({
  children,
  scope,
  existingNotes = [],
  label,
}: {
  /** The amount cell's rendered content */
  children:      React.ReactNode;
  scope:         NoteScope;
  existingNotes?: ExistingNote[];
  /** Descriptive label used in the popover header, e.g. "Water · Jan 2026" */
  label?:        string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [localNotes, setLocalNotes] = useState<ExistingNote[]>(existingNotes);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const hasNotes = localNotes.length > 0;

  async function saveNote() {
    if (!draft.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("monthly_notes")
        .insert({
          property_id:         scope.property_id,
          gl_account_id:       scope.gl_account_id ?? null,
          utility_account_id:  scope.utility_account_id ?? null,
          invoice_id:          scope.invoice_id ?? null,
          year:                scope.year,
          month:               scope.month,
          note:                draft.trim(),
          created_by:          user?.id ?? null,
          created_by_email:    user?.email ?? null,
        })
        .select("id, note, created_at, created_by_email")
        .single();

      if (error) throw error;

      setLocalNotes([data as ExistingNote, ...localNotes]);
      setDraft("");
      // Refresh server data so server-rendered pages pick up the new note
      startTransition(() => router.refresh());
    } catch (err: any) {
      setError(err.message ?? "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  async function deleteNote(id: string) {
    if (!confirm("Delete this note?")) return;
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("monthly_notes").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setLocalNotes(localNotes.filter(n => n.id !== id));
    startTransition(() => router.refresh());
  }

  return (
    <span className="relative inline-flex items-center gap-1">
      <span>{children}</span>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={
          "inline-flex items-center justify-center w-4 h-4 rounded-sm transition-opacity " +
          (hasNotes
            ? "opacity-100 text-nurock-tan-dark hover:text-nurock-navy"
            : "opacity-30 hover:opacity-100 text-nurock-slate-light hover:text-nurock-navy")
        }
        title={hasNotes ? `${localNotes.length} note${localNotes.length === 1 ? "" : "s"}` : "Add note"}
        aria-label="View or add note"
      >
        {hasNotes ? (
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm2 4h8v1H6V7zm0 3h8v1H6v-1zm0 3h5v1H6v-1z"/>
          </svg>
        ) : (
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"/>
            <path strokeLinecap="round" d="M7 9h6M7 12h4"/>
          </svg>
        )}
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* Popover */}
          <div className="absolute top-full right-0 mt-1 w-[320px] card shadow-card-h z-50 text-left">
            <div className="card-h py-2.5">
              <div className="card-t text-[11px]">
                {label ? `Notes · ${label}` : "Notes"}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-nurock-slate-light hover:text-nurock-black"
                aria-label="Close"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
                </svg>
              </button>
            </div>

            <div className="card-b space-y-3 max-h-[320px] overflow-y-auto">
              {localNotes.length === 0 ? (
                <div className="text-[11.5px] text-nurock-slate-light italic">
                  No notes yet. Add one below.
                </div>
              ) : (
                localNotes.map(n => (
                  <div key={n.id} className="pb-2 border-b border-nurock-border last:border-b-0 last:pb-0">
                    <div className="text-[12.5px] text-nurock-black whitespace-pre-wrap">
                      {n.note}
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-[10.5px] text-nurock-slate-light">
                      <span>
                        {n.created_by_email ?? "unknown"} ·{" "}
                        {new Date(n.created_at).toLocaleString(undefined, {
                          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteNote(n.id)}
                        className="text-nurock-slate-light hover:text-flag-red"
                      >
                        delete
                      </button>
                    </div>
                  </div>
                ))
              )}

              <div className="pt-2 border-t border-nurock-border">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  placeholder="Add a note (e.g. 'Irrigation broke in March — repaired 3/15')"
                  rows={3}
                  className="input text-[12px] w-full resize-none"
                />
                {error && <div className="text-[11px] text-flag-red mt-1">{error}</div>}
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => { setDraft(""); setError(null); }}
                    className="btn-ghost px-2 py-1 text-[11px]"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={saveNote}
                    disabled={saving || !draft.trim()}
                    className="btn-primary px-3 py-1 text-[11px]"
                  >
                    {saving ? "Saving…" : "Save note"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </span>
  );
}
