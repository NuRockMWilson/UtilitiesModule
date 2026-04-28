"use client";

/**
 * AttachPdfButton — small file-upload control mounted on the invoice
 * detail page. Lets a user attach a PDF to any invoice (including
 * historical baseline rows that were imported without a PDF).
 *
 * Renders as either:
 *   - "Attach PDF" button (when no PDF is currently attached)
 *   - "Replace PDF" button (when a PDF is already attached)
 *
 * On success, the page is refreshed so the PDF preview shows up
 * immediately.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  invoiceId: string;
  /** True if the invoice already has a pdf_path set */
  hasExistingPdf: boolean;
};

export function AttachPdfButton({ invoiceId, hasExistingPdf }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClick() {
    setError(null);
    if (hasExistingPdf && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    inputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/attach-pdf`, {
          method: "POST",
          body:   fd,
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Upload failed");
          return;
        }
        setConfirmReplace(false);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        // Reset the input so the same file can be re-selected if needed
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={handleFileChange}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          className={
            confirmReplace
              ? "text-[12px] px-3 py-1 rounded-md font-medium bg-flag-amber text-white hover:bg-amber-600 disabled:opacity-50"
              : "text-[12px] px-3 py-1 rounded-md font-medium bg-nurock-navy text-white hover:bg-blue-900 disabled:opacity-50"
          }
        >
          {pending
            ? "Uploading…"
            : confirmReplace
              ? "Click again to replace"
              : hasExistingPdf
                ? "Replace PDF"
                : "Attach PDF"}
        </button>
        {confirmReplace && !pending && (
          <button
            type="button"
            onClick={() => setConfirmReplace(false)}
            className="text-[12px] text-nurock-slate hover:underline"
          >
            Cancel
          </button>
        )}
      </div>
      {error && (
        <div className="text-[11px] text-flag-red">{error}</div>
      )}
    </div>
  );
}
