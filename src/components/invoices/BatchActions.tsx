"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  batchId: string;
  status: string;
  sageSystem: string;
  hasArtifact: boolean;
}

export function BatchActions({ batchId, status, sageSystem, hasArtifact }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canDownload = hasArtifact && status !== "void";
  const canConfirm  = sageSystem !== "sage_intacct" && status !== "confirmed_posted" && status !== "void";
  const canVoid     = status !== "confirmed_posted" && status !== "void";

  async function download() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/sage/batches/${batchId}/download`);
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Download failed");
      return;
    }
    const a = document.createElement("a");
    a.href = data.download_url;
    if (data.download_filename) a.download = data.download_filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    router.refresh();
  }

  async function confirm() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/sage/batches/${batchId}/confirm`, { method: "POST" });
    setLoading(false);
    if (res.ok) router.refresh();
    else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Confirmation failed");
    }
  }

  async function voidIt() {
    if (!voidReason.trim()) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/sage/batches/${batchId}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: voidReason.trim() }),
    });
    setLoading(false);
    if (res.ok) {
      setShowVoid(false);
      setVoidReason("");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Void failed");
    }
  }

  return (
    <div className="card p-5">
      <h3 className="font-display font-semibold text-navy-800 mb-3">Actions</h3>
      {error && <div className="text-sm text-flag-red mb-3">{error}</div>}
      <div className="flex flex-wrap gap-2">
        {canDownload && (
          <button onClick={download} disabled={loading} className="btn-secondary text-sm">
            {loading ? "Working…" : "Download AP Import file"}
          </button>
        )}
        {canConfirm && (
          <button onClick={confirm} disabled={loading} className="btn-primary text-sm">
            Confirm Sage import
          </button>
        )}
        {canVoid && (
          <button
            onClick={() => setShowVoid(s => !s)}
            disabled={loading}
            className="btn-ghost text-sm"
          >
            Void batch
          </button>
        )}
      </div>
      {showVoid && (
        <div className="mt-4">
          <label className="label">Void reason</label>
          <textarea
            value={voidReason}
            onChange={e => setVoidReason(e.target.value)}
            rows={2}
            className="input"
            placeholder="e.g. wrong coding caught after generation; Sage rejected import"
          />
          <button
            onClick={voidIt}
            disabled={loading || !voidReason.trim()}
            className="btn-danger text-sm mt-2"
          >
            Confirm void (releases invoices back to Approved)
          </button>
        </div>
      )}
      {!canDownload && !canConfirm && !canVoid && (
        <p className="text-sm text-tan-700">
          This batch is settled. No further actions available.
        </p>
      )}
    </div>
  );
}
