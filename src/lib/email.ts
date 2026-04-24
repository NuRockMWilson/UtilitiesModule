/**
 * Variance inquiry emails.
 *
 * When a bill flips to variance_flagged, AP can trigger this to notify the
 * property's primary variance contact (or all contacts with cc_on_variance).
 * Reply-tracking is handled via a plus-addressed return-path so Resend
 * inbound webhooks can thread the response back onto the inquiry record.
 */

import { Resend } from "resend";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { formatDollars, formatDate, formatPercent, formatNumber } from "@/lib/format";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export interface VarianceEmailContext {
  invoiceId: string;
}

export async function sendVarianceInquiry(ctx: VarianceEmailContext): Promise<{
  success: boolean;
  detail: string;
  inquiry_id?: string;
}> {
  if (!resend) {
    return { success: false, detail: "RESEND_API_KEY not configured" };
  }

  const supabase = createSupabaseServiceClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select(`
      *,
      property:properties(id, code, name),
      vendor:vendors(name),
      gl:gl_accounts(code, description),
      utility_account:utility_accounts(account_number, variance_threshold_pct)
    `)
    .eq("id", ctx.invoiceId)
    .single();

  if (!invoice) return { success: false, detail: "Invoice not found" };

  const { data: contacts } = await supabase
    .from("property_contacts")
    .select("*")
    .eq("property_id", (invoice.property as any).id)
    .eq("active", true);

  const primary = (contacts ?? []).find((c: any) => c.is_primary_for_variance);
  const cc      = (contacts ?? []).filter((c: any) => c.cc_on_variance && c.id !== primary?.id);

  if (!primary) {
    return { success: false, detail: "No primary variance contact configured for this property" };
  }

  const subject = `Variance inquiry — ${(invoice.property as any).name} · ${(invoice.vendor as any).name} · ${formatDate(invoice.invoice_date)}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const detailUrl = `${appUrl}/invoices/${invoice.id}`;

  const body = renderEmail({
    propertyName: (invoice.property as any).name,
    vendorName: (invoice.vendor as any).name,
    invoiceNumber: invoice.invoice_number,
    servicePeriodStart: invoice.service_period_start,
    servicePeriodEnd: invoice.service_period_end,
    totalAmount: invoice.total_amount_due,
    glDescription: (invoice.gl as any)?.description ?? "Utility",
    baselineValue: invoice.variance_baseline,
    variancePct: invoice.variance_pct,
    threshold: (invoice.utility_account as any)?.variance_threshold_pct ?? 3,
    detailUrl,
    recipientName: primary.name,
  });

  const { data, error } = await resend.emails.send({
    from: process.env.VARIANCE_FROM_EMAIL ?? "ap-utilities@nurock.com",
    to: primary.email,
    cc: cc.map((c: any) => c.email),
    replyTo: `variance-reply+${invoice.id}@${new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost").hostname}`,
    subject,
    html: body.html,
    text: body.text,
  });

  if (error) return { success: false, detail: error.message };

  const { data: inquiry } = await supabase
    .from("variance_inquiries")
    .insert({
      invoice_id: invoice.id,
      property_contact_id: primary.id,
      recipient_email: primary.email,
      cc_emails: cc.map((c: any) => c.email),
      subject,
      body: body.text,
    })
    .select()
    .single();

  await supabase.from("approval_log").insert({
    invoice_id: invoice.id,
    action: "variance_inquiry_sent",
    notes: `Sent to ${primary.email}${cc.length ? ` (cc: ${cc.map((c:any)=>c.email).join(", ")})` : ""}`,
  });

  return { success: true, detail: `Sent to ${primary.email}`, inquiry_id: inquiry?.id };
}

function renderEmail(v: {
  propertyName: string;
  vendorName: string;
  invoiceNumber: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  totalAmount: number | null;
  glDescription: string;
  baselineValue: number | null;
  variancePct: number | null;
  threshold: number;
  detailUrl: string;
  recipientName: string;
}): { html: string; text: string } {
  const period = v.servicePeriodStart && v.servicePeriodEnd
    ? `${formatDate(v.servicePeriodStart)} – ${formatDate(v.servicePeriodEnd)}`
    : "—";

  const text = `Hi ${v.recipientName},

The NuRock AP team received this utility bill for ${v.propertyName} and it came in above the ${formatPercent(v.threshold)} variance threshold against the trailing baseline. Before we approve it for payment, could you confirm whether anything at the property explains the increase?

Bill:      ${v.vendorName} — ${v.glDescription}
Invoice:   ${v.invoiceNumber ?? "—"}
Period:    ${period}
Total:     ${formatDollars(v.totalAmount)}
Baseline:  ${v.baselineValue !== null ? formatNumber(v.baselineValue, 2) : "insufficient history"}
Variance:  ${v.variancePct !== null ? formatPercent(v.variancePct, { sign: true }) : "—"}

Common explanations include: irrigation schedule changes, rate increases effective during the period, filled vacant units, confirmed and repaired leaks, or holiday community events. Please reply to this email with whatever context you have.

View the bill: ${v.detailUrl}

Thanks,
NuRock AP`;

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Inter, system-ui, sans-serif; color: #0F1720; background: #FBFBF8; margin: 0; padding: 24px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #E7EEF6; border-radius: 8px; overflow: hidden;">
    <div style="background: #164576; color: #fff; padding: 16px 20px;">
      <div style="font-family: Oswald, system-ui, sans-serif; font-weight: 600; font-size: 18px;">NuRock · Utilities AP</div>
      <div style="color: #B4AE92; font-size: 12px; margin-top: 2px;">Variance inquiry</div>
    </div>
    <div style="padding: 20px;">
      <p style="margin: 0 0 16px;">Hi ${v.recipientName},</p>
      <p style="margin: 0 0 16px;">The NuRock AP team received this utility bill for <strong>${v.propertyName}</strong> and it came in above the <strong>${formatPercent(v.threshold)}</strong> variance threshold against the trailing baseline. Before we approve it for payment, could you confirm whether anything at the property explains the increase?</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
        <tr><td style="padding: 6px 0; color: #7F7A5B; width: 110px;">Bill</td><td style="padding: 6px 0;">${v.vendorName} — ${v.glDescription}</td></tr>
        <tr><td style="padding: 6px 0; color: #7F7A5B;">Invoice</td><td style="padding: 6px 0; font-family: monospace;">${v.invoiceNumber ?? "—"}</td></tr>
        <tr><td style="padding: 6px 0; color: #7F7A5B;">Period</td><td style="padding: 6px 0;">${period}</td></tr>
        <tr><td style="padding: 6px 0; color: #7F7A5B;">Total</td><td style="padding: 6px 0;"><strong>${formatDollars(v.totalAmount)}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #7F7A5B;">Baseline</td><td style="padding: 6px 0;">${v.baselineValue !== null ? formatNumber(v.baselineValue, 2) : "insufficient history"}</td></tr>
        <tr><td style="padding: 6px 0; color: #7F7A5B;">Variance</td><td style="padding: 6px 0; color: #B8372B; font-weight: 500;">${v.variancePct !== null ? formatPercent(v.variancePct, { sign: true }) : "—"}</td></tr>
      </table>
      <p style="margin: 0 0 16px;">Common explanations include: irrigation schedule changes, rate increases during the period, filled vacant units, confirmed and repaired leaks, or community events. Please reply to this email with whatever context you have.</p>
      <p style="margin: 0 0 16px;">
        <a href="${v.detailUrl}" style="background: #164576; color: #fff; text-decoration: none; padding: 10px 16px; border-radius: 6px; font-weight: 500;">View the bill</a>
      </p>
      <p style="margin: 0; color: #7F7A5B; font-size: 13px;">Thanks,<br/>NuRock AP</p>
    </div>
  </div>
</body>
</html>`;

  return { html, text };
}
