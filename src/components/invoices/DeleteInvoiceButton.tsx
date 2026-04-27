"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteInvoice } from "@/app/(app)/invoices/delete-actions";

/**
 * Delete invoice button — two-click confirmation. Refuses on the server
 * if the invoice is in a non-deletable status; surfaces the error inline.
 *
 * Used on the invoice detail page next to the workflow actions.
 */
export function DeleteInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function fire() {
    setError(null);
    const fd = new FormData();
    fd.set("invoice_id", invoiceId);
    startTransition(async () => {
      const r = await deleteInvoice(fd);
      if (!r.ok) {
        setError(r.error ?? "Delete failed");
        setArmed(false);
      } else {
        router.push("/invoices");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      {!armed ? (
        <button
          type="button"
          onClick={() => { setArmed(true); setError(null); }}
          className="text-[12px] text-flag-red hover:underline"
        >
          Delete invoice
        </button>
      ) : (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
          <div className="text-[12.5px] text-flag-red font-medium mb-2">
            Delete this invoice and its PDF? This can't be undone.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={fire}
              disabled={pending}
              className="px-3 py-1 rounded-md text-[12px] font-medium bg-flag-red text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Yes, delete"}
            </button>
            <button
              type="button"
              onClick={() => setArmed(false)}
              disabled={pending}
              className="px-3 py-1 rounded-md text-[12px] text-nurock-slate hover:text-nurock-black"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="text-[11.5px] text-flag-red bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
          {error}
        </div>
      )}
    </div>
  );
}
