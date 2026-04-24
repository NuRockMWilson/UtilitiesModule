/**
 * Domain types mirroring the Supabase schema. Hand-maintained for now;
 * can be auto-generated later via `supabase gen types typescript`.
 */

export type UtilityCategory =
  | "electric" | "water" | "sewer" | "storm_water" | "environmental"
  | "irrigation" | "gas" | "trash" | "cable" | "phone" | "fedex" | "other";

export type InvoiceStatus =
  | "new" | "extracting" | "extraction_failed" | "needs_coding"
  | "needs_variance_note" | "ready_for_approval" | "approved"
  | "posted_to_sage" | "paid" | "rejected" | "on_hold";

export type SageSystem = "sage_300_cre" | "sage_intacct";
export type UserRole = "admin" | "ap_clerk" | "approver" | "property_manager" | "viewer";
export type BillSource = "email" | "portal" | "upload" | "scan" | "manual";

export interface Property {
  id: string;
  code: string;
  full_code: string;
  name: string;
  short_name: string | null;
  state: "GA" | "TX" | "FL";
  address: string | null;
  city: string | null;
  zip: string | null;
  unit_count: number | null;
  active: boolean;
  sage_system: SageSystem;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface GLAccount {
  id: string;
  code: string;
  description: string;
  utility_category: UtilityCategory;
  active: boolean;
  created_at: string;
}

export interface Vendor {
  id: string;
  name: string;
  short_name: string | null;
  sage_vendor_id: string | null;
  portal_url: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  remit_address: string | null;
  default_payment_terms: number;
  category: UtilityCategory | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface UtilityAccount {
  id: string;
  property_id: string;
  vendor_id: string;
  gl_account_id: string;
  account_number: string;
  meter_id: string | null;
  service_address: string | null;
  description: string | null;
  sub_code: string;
  is_house_meter: boolean;
  is_vacant_unit: boolean;
  is_clubhouse: boolean;
  baseline_window_months: number;
  variance_threshold_pct: number;
  usage_unit: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PropertyContact {
  id: string;
  property_id: string;
  name: string;
  role: string | null;
  email: string;
  phone: string | null;
  is_primary_for_variance: boolean;
  cc_on_variance: boolean;
  active: boolean;
}

export interface Invoice {
  id: string;
  utility_account_id: string | null;
  property_id: string | null;
  vendor_id: string | null;
  gl_account_id: string | null;

  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  service_period_start: string | null;
  service_period_end: string | null;
  service_days: number | null;

  current_charges: number | null;
  previous_balance: number;
  adjustments: number;
  late_fees: number;
  total_amount_due: number | null;

  gl_coding: string | null;

  pdf_path: string | null;
  pdf_pages: number | null;
  raw_extraction: unknown;
  extraction_confidence: number | null;
  extraction_warnings: string[];
  requires_human_review: boolean;

  variance_baseline: number | null;
  variance_pct: number | null;
  variance_flagged: boolean;
  variance_explanation: string | null;
  exclude_from_baseline: boolean;

  status: InvoiceStatus;
  submitted_by: string | null;
  submitted_at: string;
  coded_by: string | null;
  coded_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;

  sage_system: SageSystem | null;
  sage_batch_id: string | null;
  sage_invoice_id: string | null;
  sage_posted_at: string | null;

  check_number: string | null;
  check_date: string | null;
  check_amount: number | null;
  mailed_at: string | null;
  mailed_by: string | null;

  source: BillSource | null;
  source_reference: string | null;

  created_at: string;
  updated_at: string;
}

export interface UsageReading {
  id: string;
  invoice_id: string;
  utility_account_id: string;
  reading_type: string;
  service_start: string | null;
  service_end: string | null;
  days: number | null;
  usage_amount: number | null;
  usage_unit: string | null;
  meter_start: number | null;
  meter_end: number | null;
  occupancy_pct: number | null;
  daily_usage: number | null;
  baseline_daily_usage: number | null;
  variance_pct: number | null;
  variance_flagged: boolean;
}

export interface Budget {
  id: string;
  property_id: string;
  gl_account_id: string;
  year: number;
  month: number;
  amount: number;
}

export interface ApprovalLogEntry {
  id: string;
  invoice_id: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  previous_status: InvoiceStatus | null;
  new_status: InvoiceStatus | null;
  notes: string | null;
  metadata: unknown;
  created_at: string;
}

export interface VarianceInquiry {
  id: string;
  invoice_id: string;
  property_contact_id: string | null;
  recipient_email: string;
  cc_emails: string[];
  subject: string | null;
  body: string | null;
  sent_at: string;
  response_received_at: string | null;
  response_body: string | null;
  response_source: string | null;
  status: "sent" | "responded" | "escalated" | "closed";
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  property_scope: string[];
  can_approve_up_to: number | null;
  can_approve_variance_flagged: boolean;
  active: boolean;
}

/* Status display helpers */

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  new: "New",
  extracting: "Extracting",
  extraction_failed: "Extraction failed",
  needs_coding: "Needs coding",
  needs_variance_note: "Needs variance note",
  ready_for_approval: "Ready for approval",
  approved: "Approved",
  posted_to_sage: "Posted to Sage",
  paid: "Paid",
  rejected: "Rejected",
  on_hold: "On hold",
};

export const STATUS_COLOR: Record<InvoiceStatus, string> = {
  new: "bg-tan-100 text-tan-800",
  extracting: "bg-tan-100 text-tan-800",
  extraction_failed: "bg-red-100 text-red-800",
  needs_coding: "bg-yellow-100 text-yellow-800",
  needs_variance_note: "bg-yellow-100 text-yellow-800",
  ready_for_approval: "bg-navy-100 text-navy-800",
  approved: "bg-green-100 text-green-800",
  posted_to_sage: "bg-green-100 text-green-800",
  paid: "bg-green-200 text-green-900",
  rejected: "bg-red-100 text-red-800",
  on_hold: "bg-tan-200 text-tan-900",
};
