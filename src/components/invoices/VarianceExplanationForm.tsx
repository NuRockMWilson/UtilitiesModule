"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  invoiceId: string;
  currentExplanation: string | null;
  propertyId?: string;
}

export function VarianceExplanationForm({ invoiceId, currentExplanation }: Props) {
  const router = useRouter();
  const [text, setText] = useState(currentExplanation ?? "");
  const [exclude, setExclude] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoiceId}/variance-explanation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ explanation: text, exclude_from_baseline: exclude }),
    });
    setSaving(false);
    if (res.ok) router.refresh();
    else alert("Save failed");
  }

  async function sendInquiry() {
    setSending(true);
    const res = await fetch(`/api/invoices/${invoiceId}/send-variance-inquiry`, {
      method: "POST",
    });
    setSending(false);
    if (res.ok) router.refresh();
    else {
      const err = await res.text();
      alert(`Send failed: ${err}`);
    }
  }

  return (
    <div>
      <label className="label">Variance explanation</label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        className="input"
        placeholder="e.g. irrigation turned on for the season; rate increase effective 3/1; confirmed leak repaired 3/15"
      />
      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={exclude}
          onChange={e => setExclude(e.target.checked)}
          className="rounded border-navy-200"
        />
        Exclude this bill from future baseline calculations (confirmed anomaly)
      </label>
      <div className="flex gap-2 mt-3">
        <button onClick={save} disabled={saving || !text.trim()} className="btn-primary">
          {saving ? "Saving…" : "Save explanation"}
        </button>
        <button onClick={sendInquiry} disabled={sending} className="btn-secondary">
          {sending ? "Sending…" : "Email property for explanation"}
        </button>
      </div>
    </div>
  );
}
