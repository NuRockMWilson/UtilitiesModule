"use client";

import { useState, useRef } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

export default function UploadPage() {
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<Array<{ name: string; invoice_id?: string; error?: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setResults([]);
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    const res = await fetch("/api/invoices/upload", { method: "POST", body: form });
    const data = await res.json();
    setResults(data.results ?? []);
    setUploading(false);
    router.refresh();
  }

  return (
    <>
      <TopBar title="Upload bills" subtitle="Drop one or more PDF bills to queue them for extraction" />
      <div className="p-8 max-w-2xl">
        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-10 text-center transition-colors",
            dragOver ? "border-navy bg-[#FAFBFC]" : "border-nurock-border bg-white",
          )}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            upload(e.dataTransfer.files);
          }}
        >
          <div className="text-nurock-black font-medium">Drop PDF bills here</div>
          <div className="text-sm text-nurock-slate mt-1">or</div>
          <button
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="btn-primary mt-3"
          >
            {uploading ? "Uploading…" : "Choose files"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={e => e.target.files && upload(e.target.files)}
          />
          <div className="text-xs text-nurock-slate mt-4">
            Bills run through Claude extraction automatically. You'll see each one
            under <strong>Invoices</strong> within a few seconds — no action
            needed from you unless the bill needs coding or was flagged above the
            variance threshold.
          </div>
        </div>

        {results.length > 0 && (
          <div className="card mt-6 p-5">
            <h3 className="font-display font-semibold text-nurock-black mb-3">Queued</h3>
            <ul className="space-y-2 text-sm">
              {results.map((r, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="text-ink">{r.name}</span>
                  {r.invoice_id ? (
                    <a href={`/invoices/${r.invoice_id}`} className="text-nurock-navy text-xs hover:underline">
                      View invoice →
                    </a>
                  ) : (
                    <span className="text-flag-red text-xs">{r.error}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
