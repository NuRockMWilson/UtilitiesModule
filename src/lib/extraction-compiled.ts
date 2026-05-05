/**
 * Compiled-PDF processor.
 *
 * Called by the extract route when the structure detector identifies a
 * PDF containing multiple distinct sub-bills (e.g. Georgia Power batch
 * download with 7 accounts).
 *
 * Operation:
 *   1. Mark the original (parent) invoice as `compiled_parent` — a
 *      holding state that won't be approved or posted. The parent row
 *      keeps the original PDF as an immutable audit artifact.
 *
 *   2. For each sub-bill:
 *      a. Split the parent PDF to a child PDF by page range
 *      b. Upload the child PDF to Supabase Storage
 *      c. Create a new invoice row pointing at the child PDF
 *      d. Trigger extraction on the child via /api/extract internally
 *
 *   3. Return the list of child invoice IDs so the route handler can
 *      reply with useful data.
 *
 * The function is intentionally NOT recursive — child invoices that
 * themselves come back as compiled would be a degenerate case (we'd
 * fall back to single per the safety policy). Each invocation handles
 * exactly one parent → N children split.
 *
 * Storage paths:
 *   Original (parent):  invoices/{userId}/{originalName}.pdf  (unchanged)
 *   Child:              invoices/{userId}/_split/{parentId}/p{start}-p{end}.pdf
 *
 * The "_split" prefix keeps split children visually grouped in storage
 * browsing. The parent's UUID disambiguates child sets across uploads.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { splitPdfRange } from "./pdf-split";
import type { ExtractedSubBillT } from "./extraction";

export interface ProcessCompiledArgs {
  supabase:        SupabaseClient;
  parentInvoiceId: string;
  parentPdfPath:   string;        // The path in Supabase Storage
  parentPdfBytes:  Uint8Array;    // The full PDF bytes (already downloaded)
  subBills:        ExtractedSubBillT[];
}

export interface ProcessCompiledResult {
  parentId:    string;
  childIds:    string[];
  childPaths:  string[];
  errors:      string[];          // Non-fatal: one error per failed child
}

export async function processCompiledBill(
  args: ProcessCompiledArgs,
): Promise<ProcessCompiledResult> {
  const { supabase, parentInvoiceId, parentPdfPath, parentPdfBytes, subBills } = args;
  const childIds:   string[] = [];
  const childPaths: string[] = [];
  const errors:     string[] = [];

  // ── Mark parent as compiled_parent ──────────────────────────────────
  // The parent row is now a holding row; it will never be approved or
  // posted. It exists for the audit trail and to anchor the parent_invoice_id
  // FK from the children.
  const { error: parentUpdErr } = await supabase
    .from("invoices")
    .update({
      status: "compiled_parent",
      extraction_warnings: [
        `This PDF contained ${subBills.length} bills. Split into child invoices below.`,
      ],
    })
    .eq("id", parentInvoiceId);

  if (parentUpdErr) {
    errors.push(`Failed to mark parent: ${parentUpdErr.message}`);
    return { parentId: parentInvoiceId, childIds, childPaths, errors };
  }

  // ── For each sub-bill: split, upload, create child invoice ──────────
  for (let i = 0; i < subBills.length; i++) {
    const sub = subBills[i];

    // 1. Split the PDF
    let childBytes: Uint8Array;
    try {
      childBytes = await splitPdfRange(parentPdfBytes, sub.page_start, sub.page_end);
    } catch (e) {
      errors.push(`Sub-bill ${i + 1} (pages ${sub.page_start}-${sub.page_end}): split failed — ${(e as Error).message}`);
      continue;
    }

    // 2. Upload to storage. Storage path is derived from the parent's
    //    path by replacing the filename with a child-specific path.
    //    We strip the parent filename and replace with a structured
    //    subdirectory so all children of one parent live together.
    const parentDir = parentPdfPath.split("/").slice(0, -1).join("/");
    const childPath = `${parentDir}/_split/${parentInvoiceId}/p${sub.page_start}-p${sub.page_end}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("invoices")
      // Wrap the Uint8Array in a Node Buffer for upload. Buffer is a
      // subclass of Uint8Array but its `.buffer` property is always a
      // plain ArrayBuffer (never SharedArrayBuffer), which is what the
      // Supabase storage API expects. Avoids a TypeScript narrowing issue
      // where Uint8Array.buffer can be ArrayBuffer | SharedArrayBuffer.
      .upload(childPath, Buffer.from(childBytes), {
        contentType: "application/pdf",
        upsert:      true,
      });

    if (uploadErr) {
      errors.push(`Sub-bill ${i + 1}: storage upload failed — ${uploadErr.message}`);
      continue;
    }

    // 3. Create child invoice row in `extracting` status. The
    //    /api/extract endpoint will be invoked on this invoice next
    //    to populate the extracted fields. We DON'T do extraction
    //    inline here because each child extract call is its own LLM
    //    request — sequencing them inline would block this HTTP
    //    request for a long time on Vercel, and risks timeout.
    //
    //    Instead, we create the invoice with status='extracting' and
    //    return the child IDs. The frontend or a follow-up worker
    //    triggers extraction on each. (Alternative: fire-and-forget
    //    fetch() to /api/extract — viable but harder to debug.)
    const { data: childInvoice, error: insertErr } = await supabase
      .from("invoices")
      .insert({
        pdf_path:           childPath,
        parent_invoice_id:  parentInvoiceId,
        status:             "extracting",
        source:             "compiled_split",
        // Pre-populate any hints we got from the structure detector;
        // the extractor will overwrite/refine these.
        raw_extraction: {
          structure_hint: {
            from_compiled_parent: parentInvoiceId,
            page_start:           sub.page_start,
            page_end:             sub.page_end,
            account_number:       sub.account_number,
            service_address:      sub.service_address,
            total_amount:         sub.total_amount,
          },
        },
      })
      .select("id")
      .single();

    if (insertErr || !childInvoice) {
      errors.push(`Sub-bill ${i + 1}: child invoice insert failed — ${insertErr?.message}`);
      continue;
    }

    childIds.push(childInvoice.id);
    childPaths.push(childPath);

    // 4. Approval log: parent had this child created
    await supabase.from("approval_log").insert({
      invoice_id: parentInvoiceId,
      action:     "split_child_created",
      new_status: "compiled_parent",
      notes:      `Created child invoice ${childInvoice.id} for pages ${sub.page_start}-${sub.page_end}.`,
      metadata: {
        child_id:        childInvoice.id,
        page_start:      sub.page_start,
        page_end:        sub.page_end,
        account_number:  sub.account_number,
        service_address: sub.service_address,
      },
    });
  }

  return {
    parentId:   parentInvoiceId,
    childIds,
    childPaths,
    errors,
  };
}
