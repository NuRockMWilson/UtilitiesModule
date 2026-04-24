/**
 * Sage batch lifecycle.
 *
 *   createBatch(invoiceIds)        — generate the AP Import file (or push
 *                                     to Intacct), store the artifact,
 *                                     return signed download URL
 *   confirmBatchPosted(batchId)    — Sharon clicks this after importing
 *                                     in Sage; invoices flip to
 *                                     `posted_to_sage` status
 *   downloadBatchArtifact(batchId) — regenerate a signed URL for re-download
 *   voidBatch(batchId, reason)     — release invoices back to approved
 *                                     status so a new batch can be built
 *
 * All invoices in a single batch must share the same sage_system, because
 * a 300 CRE file and an Intacct push can't be combined. The createBatch
 * function groups the input by system and returns an error if mixed.
 */

import { createSupabaseServiceClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { getAdapter } from "./adapter";
import type { SagePostResult } from "./adapter";
import type { SageSystem } from "@/lib/types";

const SIGNED_URL_EXPIRES_SECONDS = 60 * 60 * 24 * 7; // one week

export interface CreateBatchResult {
  success: boolean;
  error?: string;
  batch_id?: string;
  batch_reference?: string;
  sage_system?: SageSystem;
  invoice_count?: number;
  total_amount?: number;
  download_url?: string | null;
  download_filename?: string | null;
  per_invoice?: SagePostResult["per_invoice"];
}

export async function createBatch(invoiceIds: string[]): Promise<CreateBatchResult> {
  if (!invoiceIds || invoiceIds.length === 0) {
    return { success: false, error: "No invoices supplied" };
  }

  const userSupabase = createSupabaseServerClient();
  const { data: { user } } = await userSupabase.auth.getUser();

  const supabase = createSupabaseServiceClient();

  const { data: invoices, error } = await supabase
    .from("invoices")
    .select(`
      id, invoice_number, invoice_date, due_date, total_amount_due, gl_coding,
      service_period_start, service_period_end, status, sage_batch_uuid,
      property:properties(id, sage_system),
      vendor:vendors(sage_vendor_id, name),
      gl:gl_accounts(description)
    `)
    .in("id", invoiceIds);

  if (error) return { success: false, error: `DB: ${error.message}` };
  if (!invoices || invoices.length === 0) {
    return { success: false, error: "No invoices found for those IDs" };
  }

  // Validation
  const notApproved = invoices.filter(i => i.status !== "approved");
  if (notApproved.length > 0) {
    return {
      success: false,
      error: `${notApproved.length} invoice(s) are not in 'approved' status: ` +
             notApproved.map(i => i.invoice_number ?? i.id).join(", "),
    };
  }

  const alreadyBatched = invoices.filter(i => i.sage_batch_uuid);
  if (alreadyBatched.length > 0) {
    return {
      success: false,
      error: `${alreadyBatched.length} invoice(s) are already in a live batch. ` +
             "Void the existing batch first or select different invoices.",
    };
  }

  const systems = new Set(invoices.map(i => (i.property as any)?.sage_system ?? "sage_300_cre"));
  if (systems.size > 1) {
    return {
      success: false,
      error: "Batch contains invoices for properties on different Sage systems. " +
             "Build separate batches for 300 CRE properties and Intacct properties.",
    };
  }
  const sageSystem = Array.from(systems)[0] as SageSystem;

  const missingVendorIds = invoices.filter(i => !(i.vendor as any)?.sage_vendor_id);
  if (missingVendorIds.length > 0) {
    return {
      success: false,
      error: `Vendors missing sage_vendor_id: ` +
             missingVendorIds.map(i => (i.vendor as any)?.name).filter(Boolean).join(", "),
    };
  }

  const missingFields = invoices.filter(i =>
    !i.invoice_number || !i.invoice_date || !i.total_amount_due || !i.gl_coding);
  if (missingFields.length > 0) {
    return {
      success: false,
      error: `${missingFields.length} invoice(s) missing required Sage fields`,
    };
  }

  // Generate
  const batchRef = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const adapter = getAdapter(sageSystem);
  const result = await adapter.postBatch({
    batch_reference: batchRef,
    invoices: invoices.map((i: any) => ({
      internal_id: i.id,
      vendor_id: i.vendor?.sage_vendor_id,
      invoice_number: i.invoice_number,
      invoice_date: i.invoice_date,
      due_date: i.due_date ?? i.invoice_date,
      gl_coding: i.gl_coding,
      amount: Number(i.total_amount_due),
      description: `${i.vendor?.name ?? ""} — ${i.gl?.description ?? ""}`.slice(0, 30),
      service_period_start: i.service_period_start ?? undefined,
      service_period_end: i.service_period_end ?? undefined,
    })),
  });

  if (!result.success) {
    return {
      success: false,
      error: result.per_invoice[0]?.error ?? "Sage adapter reported failure",
      per_invoice: result.per_invoice,
    };
  }

  // Upload artifact (300 CRE only)
  let artifactPath: string | null = null;
  let artifactFilename: string | null = null;
  let downloadUrl: string | null = null;

  if (result.artifact_content && result.artifact_filename) {
    artifactFilename = result.artifact_filename;
    artifactPath = `batches/${batchRef}/${result.artifact_filename}`;

    const { error: upErr } = await supabase.storage
      .from("sage-exports")
      .upload(artifactPath, new Blob([result.artifact_content], { type: "text/plain" }), {
        contentType: "text/plain",
      });
    if (upErr) {
      return { success: false, error: `Storage upload failed: ${upErr.message}` };
    }

    const { data: urlData, error: urlErr } = await supabase.storage
      .from("sage-exports")
      .createSignedUrl(artifactPath, SIGNED_URL_EXPIRES_SECONDS, {
        download: artifactFilename,
      });
    if (urlErr) {
      return { success: false, error: `Signed URL failed: ${urlErr.message}` };
    }
    downloadUrl = urlData.signedUrl;
  }

  // Record batch
  const totalAmount = invoices.reduce((s, i) => s + Number(i.total_amount_due ?? 0), 0);
  const singleProperty = new Set(invoices.map(i => (i.property as any)?.id)).size === 1
    ? (invoices[0].property as any)?.id
    : null;

  const { data: batch, error: batchErr } = await supabase
    .from("sage_batches")
    .insert({
      batch_reference: batchRef,
      sage_system: sageSystem,
      property_id: singleProperty,
      invoice_count: invoices.length,
      total_amount: totalAmount,
      artifact_path: artifactPath,
      artifact_filename: artifactFilename,
      generated_by: user?.id,
      status: sageSystem === "sage_intacct" ? "confirmed_posted" : "generated",
      confirmed_posted_at: sageSystem === "sage_intacct" ? new Date().toISOString() : null,
      confirmed_by: sageSystem === "sage_intacct" ? user?.id : null,
    })
    .select()
    .single();

  if (batchErr || !batch) {
    return { success: false, error: `Batch record insert failed: ${batchErr?.message}` };
  }

  // Link invoices to the batch
  await supabase
    .from("invoices")
    .update({
      sage_batch_uuid: batch.id,
      sage_system: sageSystem,
      sage_batch_id: batchRef,
      // For Intacct: API push is authoritative, flip to posted immediately.
      // For 300 CRE: stay on 'approved' until Sharon confirms import.
      ...(sageSystem === "sage_intacct"
        ? {
            status: "posted_to_sage",
            sage_posted_at: new Date().toISOString(),
            sage_invoice_id: null,  // Intacct assigns these; future webhook backfills
          }
        : {}),
    })
    .in("id", invoiceIds);

  // Audit
  await supabase.from("approval_log").insert(
    invoices.map(i => ({
      invoice_id: i.id,
      action: sageSystem === "sage_intacct" ? "posted_to_intacct" : "added_to_sage_batch",
      actor_id: user?.id,
      actor_email: user?.email,
      previous_status: "approved",
      new_status: sageSystem === "sage_intacct" ? "posted_to_sage" : "approved",
      notes: `Batch ${batchRef}`,
      metadata: { batch_id: batch.id, artifact_filename: artifactFilename },
    })),
  );

  return {
    success: true,
    batch_id: batch.id,
    batch_reference: batchRef,
    sage_system: sageSystem,
    invoice_count: invoices.length,
    total_amount: totalAmount,
    download_url: downloadUrl,
    download_filename: artifactFilename,
    per_invoice: result.per_invoice,
  };
}

export async function confirmBatchPosted(batchId: string): Promise<{
  success: boolean; error?: string; invoice_count?: number;
}> {
  const userSupabase = createSupabaseServerClient();
  const { data: { user } } = await userSupabase.auth.getUser();

  const supabase = createSupabaseServiceClient();
  const { data: batch } = await supabase
    .from("sage_batches")
    .select("id, batch_reference, status, sage_system")
    .eq("id", batchId)
    .single();

  if (!batch) return { success: false, error: "Batch not found" };
  if (batch.status === "confirmed_posted") {
    return { success: false, error: "Batch already confirmed as posted" };
  }
  if (batch.status === "void") {
    return { success: false, error: "Batch has been voided" };
  }

  const nowIso = new Date().toISOString();

  await supabase
    .from("sage_batches")
    .update({
      status: "confirmed_posted",
      confirmed_posted_at: nowIso,
      confirmed_by: user?.id,
    })
    .eq("id", batchId);

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id")
    .eq("sage_batch_uuid", batchId);

  const invoiceIds = (invoices ?? []).map(i => i.id);

  if (invoiceIds.length > 0) {
    await supabase
      .from("invoices")
      .update({
        status: "posted_to_sage",
        sage_posted_at: nowIso,
      })
      .in("id", invoiceIds);

    await supabase.from("approval_log").insert(
      invoiceIds.map(id => ({
        invoice_id: id,
        action: "sage_import_confirmed",
        actor_id: user?.id,
        actor_email: user?.email,
        previous_status: "approved",
        new_status: "posted_to_sage",
        notes: `Batch ${batch.batch_reference} confirmed imported in Sage`,
      })),
    );
  }

  return { success: true, invoice_count: invoiceIds.length };
}

export async function refreshBatchDownload(batchId: string): Promise<{
  success: boolean; download_url?: string; download_filename?: string; error?: string;
}> {
  const supabase = createSupabaseServiceClient();
  const { data: batch } = await supabase
    .from("sage_batches")
    .select("artifact_path, artifact_filename")
    .eq("id", batchId)
    .single();
  if (!batch || !batch.artifact_path) {
    return { success: false, error: "Batch has no downloadable artifact" };
  }
  const { data, error } = await supabase.storage
    .from("sage-exports")
    .createSignedUrl(batch.artifact_path, SIGNED_URL_EXPIRES_SECONDS, {
      download: batch.artifact_filename ?? undefined,
    });
  if (error) return { success: false, error: error.message };

  // Mark as downloaded (only if not already confirmed)
  const userSupabase = createSupabaseServerClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  await supabase
    .from("sage_batches")
    .update({
      status: "downloaded",
      downloaded_at: new Date().toISOString(),
      downloaded_by: user?.id,
    })
    .eq("id", batchId)
    .eq("status", "generated");

  return {
    success: true,
    download_url: data.signedUrl,
    download_filename: batch.artifact_filename ?? undefined,
  };
}

export async function voidBatch(batchId: string, reason: string): Promise<{
  success: boolean; error?: string; invoice_count?: number;
}> {
  if (!reason?.trim()) return { success: false, error: "Reason required" };

  const userSupabase = createSupabaseServerClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  const supabase = createSupabaseServiceClient();

  const { data: batch } = await supabase
    .from("sage_batches")
    .select("id, batch_reference, status")
    .eq("id", batchId)
    .single();
  if (!batch) return { success: false, error: "Batch not found" };
  if (batch.status === "confirmed_posted") {
    return { success: false, error: "Cannot void a confirmed batch. Create an offsetting entry in Sage." };
  }

  await supabase
    .from("sage_batches")
    .update({ status: "void", void_reason: reason.trim() })
    .eq("id", batchId);

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id")
    .eq("sage_batch_uuid", batchId);
  const invoiceIds = (invoices ?? []).map(i => i.id);

  if (invoiceIds.length > 0) {
    await supabase
      .from("invoices")
      .update({
        sage_batch_uuid: null,
        sage_batch_id: null,
      })
      .in("id", invoiceIds);

    await supabase.from("approval_log").insert(
      invoiceIds.map(id => ({
        invoice_id: id,
        action: "sage_batch_voided",
        actor_id: user?.id,
        actor_email: user?.email,
        notes: `Batch ${batch.batch_reference} voided: ${reason.trim()}`,
      })),
    );
  }

  return { success: true, invoice_count: invoiceIds.length };
}
