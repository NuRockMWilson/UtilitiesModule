"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { InvoiceStatus } from "@/lib/types";

interface Props {
  invoiceId: string;
  status: InvoiceStatus;
  varianceFlagged: boolean;
  hasExplanation: boolean;
  sageBatchId?: string | null;
  sageSystem?: string | null;
}

interface PostToSageResult {
  success: boolean;
  batch_id?: string;
  batch_reference?: string;
  download_url?: string | null;
  download_filename?: string | null;
  sage_system?: string;
  error?: string;
}

export function ApprovalPanel({
  invoiceId, status, varianceFlagged, hasExplanation, sageBatchId,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [postResult, setPostResult] = useState<PostToSageResult | null>(null);

  const canApprove = (status === "ready_for_approval" || status === "needs_variance_note")
    && (!varianceFlagged || hasExplanation);

  async function post(action: "approve" | "reject" | "mark_ready") {
    setLoading(true);
    const endpoint = action === "mark_ready"
      ? `/api/invoices/${invoiceId}/mark-ready`
      : `/api/invoices/${invoiceId}/${action}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason }),
    });
    setLoading(false);
    if (res.ok) {
      setShowReject(false);
      setRejectReason("");
      router.refresh();
    } else {
      const err = await res.text();
      alert(`Action failed: ${err}`);
    }
  }

  async function postToSage() {
    setLoading(true);
    setPostResult(null);
    const res = await fetch(`/api/invoices/${invoiceId}/post-to-sage`, { method: "POST" });
    const data: PostToSageResult = await res.json();
    setLoading(false);

    if (!res.ok || !data.success) {
      alert(`Sage posting failed: ${data.error ?? "unknown error"}`);
      return;
    }

    setPostResult(data);

    // Auto-trigger the download for 300 CRE so Sharon gets the file immediately.
    if (data.download_url) {
      const a = document.createElement("a");
      a.href = data.download_url;
      if (data.download_filename) a.download = data.download_filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    router.refresh();
  }

  async function confirmPosted() {
    if (!postResult?.batch_id && !sageBatchId) return;
    const targetId = postResult?.batch_id ?? sageBatchId!;
    setLoading(true);
    const res = await fetch(`/api/sage/batches/${targetId}/confirm`, { method: "POST" });
    setLoading(false);
    if (res.ok) {
      setPostResult(null);
      router.refresh();
    } else {
      const err = await res.text();
      alert(`Confirmation failed: ${err}`);
    }
  }

  if (status === "paid" || status === "rejected") {
    return (
      <div className="card p-5">
        <h3 className="font-display text-base font-semibold text-navy-800 mb-2">Approval</h3>
        <p className="text-sm text-tan-700">
          This invoice is {status === "paid" ? "paid" : "rejected"} and no further action is available.
        </p>
      </div>
    );
  }

  if (status === "posted_to_sage") {
    return (
      <div className="card p-5">
        <h3 className="font-display text-base font-semibold text-navy-800 mb-2">Posted</h3>
        <p className="text-sm text-tan-700">
          This invoice is recorded in Sage and awaiting payment selection on Thursday.
        </p>
        {sageBatchId && (
          <Link
            href={`/admin/sage/batches/${sageBatchId}`}
            className="text-xs text-navy-600 hover:underline mt-2 inline-block"
          >
            View Sage batch →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="font-display text-base font-semibold text-navy-800 mb-3">Action</h3>

      {varianceFlagged && !hasExplanation && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-900 mb-4">
          This bill is flagged above baseline. An explanation is required before approval —
          either contact the property or mark the anomaly as confirmed and excluded from future baselines.
        </div>
      )}

      {/* Post-to-Sage success state for 300 CRE: show download + confirm flow */}
      {postResult && postResult.download_url && (
        <div className="bg-navy-50 border border-navy-200 rounded-md p-4 mb-4 space-y-3">
          <div className="text-sm text-navy-800">
            <strong>Sage AP Import file generated</strong> · batch {postResult.batch_reference}
          </div>
          <div className="text-xs text-tan-800">
            The download should have started automatically. If not, use the link below.
            After Sharon runs AP Tasks → Import Invoices in Sage, click <em>Confirm Sage import</em> to
            mark the invoice posted.
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <a
              href={postResult.download_url}
              download={postResult.download_filename ?? "ap_import.txt"}
              className="btn-secondary text-xs"
            >
              Re-download {postResult.download_filename}
            </a>
            <button onClick={confirmPosted} disabled={loading} className="btn-primary text-xs">
              Confirm Sage import
            </button>
          </div>
        </div>
      )}

      {/* Post-to-Sage for Intacct: already posted, just acknowledge */}
      {postResult && !postResult.download_url && postResult.sage_system === "sage_intacct" && (
        <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4 text-sm text-green-900">
          Posted to Intacct · batch {postResult.batch_reference}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {status === "needs_coding" && (
          <button
            disabled={loading}
            onClick={() => post("mark_ready")}
            className="btn-secondary"
          >
            Mark ready for approval
          </button>
        )}
        {(status === "ready_for_approval" || status === "needs_variance_note") && (
          <>
            <button
              disabled={loading || !canApprove}
              onClick={() => post("approve")}
              className="btn-primary"
              title={!canApprove ? "Variance explanation required" : undefined}
            >
              {loading ? "Working…" : "Approve"}
            </button>
            <button
              disabled={loading}
              onClick={() => setShowReject(s => !s)}
              className="btn-secondary"
            >
              Reject
            </button>
          </>
        )}
        {status === "approved" && !postResult && (
          <button
            disabled={loading}
            onClick={postToSage}
            className="btn-primary"
          >
            {loading ? "Generating…" : "Post to Sage"}
          </button>
        )}
      </div>

      {showReject && (
        <div className="mt-4">
          <label className="label">Reason for rejection</label>
          <textarea
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            rows={3}
            className="input"
            placeholder="e.g. wrong property, possible duplicate, coding dispute"
          />
          <button
            disabled={loading || !rejectReason.trim()}
            onClick={() => post("reject")}
            className="btn-danger mt-2"
          >
            Confirm rejection
          </button>
        </div>
      )}
    </div>
  );
}
