-- ============================================================================
-- NuRock Utilities AP — Initial schema
-- ============================================================================
-- Covers: properties, vendors, GL accounts, utility accounts, invoices,
-- usage readings, budgets, property contacts, variance inquiries, users,
-- and the audit log.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

create type utility_category as enum (
  'electric',
  'water',
  'sewer',
  'storm_water',
  'environmental',
  'irrigation',
  'gas',
  'trash',
  'cable',
  'phone',
  'fedex',
  'other'
);

create type invoice_status as enum (
  'new',
  'extracting',
  'extraction_failed',
  'needs_coding',
  'needs_variance_note',
  'ready_for_approval',
  'approved',
  'posted_to_sage',
  'paid',
  'rejected',
  'on_hold'
);

create type sage_system as enum ('sage_300_cre', 'sage_intacct');

create type user_role as enum (
  'admin',
  'ap_clerk',
  'approver',
  'property_manager',
  'viewer'
);

create type bill_source as enum ('email', 'portal', 'upload', 'scan', 'manual');

-- ----------------------------------------------------------------------------
-- Properties
-- ----------------------------------------------------------------------------

create table properties (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,              -- '555', '558', '508', etc.
  full_code text unique not null,         -- '500-555'
  name text not null,                     -- 'Sunset Pointe'
  short_name text,                        -- 'SSP'
  state text not null check (state in ('GA','TX','FL')),
  address text,
  city text,
  zip text,
  unit_count int,
  active boolean default true,
  sage_system sage_system default 'sage_300_cre',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on properties (state, active);

-- ----------------------------------------------------------------------------
-- GL accounts (chart of accounts, utilities-relevant only)
-- ----------------------------------------------------------------------------

create table gl_accounts (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,              -- '5112', '5120'
  description text not null,              -- 'House Electric'
  utility_category utility_category not null,
  active boolean default true,
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- Vendors
-- ----------------------------------------------------------------------------

create table vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  sage_vendor_id text,                    -- vendor id as stored in Sage
  portal_url text,
  contact_phone text,
  contact_email text,
  remit_address text,
  default_payment_terms int default 30,
  category utility_category,
  active boolean default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- Utility accounts: the link between a property, vendor, meter, and GL
-- ----------------------------------------------------------------------------

create table utility_accounts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete restrict,
  vendor_id uuid not null references vendors(id) on delete restrict,
  gl_account_id uuid not null references gl_accounts(id),
  account_number text not null,
  meter_id text,
  service_address text,
  description text,                       -- 'House Meter', 'Clubhouse', 'Water', etc.
  sub_code text default '00',             -- suffix for 500-XXX-XXXX.XX format
  is_house_meter boolean default false,
  is_vacant_unit boolean default false,
  is_clubhouse boolean default false,
  baseline_window_months int default 12,
  variance_threshold_pct numeric(5,2) default 3.00,
  usage_unit text,                        -- 'gallons', 'kwh', 'ccf', null for flat-rate
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (vendor_id, account_number)
);

create index on utility_accounts (property_id, active);
create index on utility_accounts (account_number);

-- ----------------------------------------------------------------------------
-- Property contacts (for variance inquiry emails)
-- ----------------------------------------------------------------------------

create table property_contacts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  name text not null,
  role text,                              -- 'Property Manager', 'Maintenance Supervisor'
  email text not null,
  phone text,
  is_primary_for_variance boolean default false,
  cc_on_variance boolean default false,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on property_contacts (property_id, active);

-- ----------------------------------------------------------------------------
-- Invoices (the main transactional table)
-- ----------------------------------------------------------------------------

create table invoices (
  id uuid primary key default gen_random_uuid(),

  -- Denormalized FKs for query speed; all three match via utility_account
  utility_account_id uuid references utility_accounts(id),
  property_id uuid references properties(id),
  vendor_id uuid references vendors(id),
  gl_account_id uuid references gl_accounts(id),

  -- Bill details
  invoice_number text,
  invoice_date date,
  due_date date,
  service_period_start date,
  service_period_end date,
  service_days int,

  -- Amounts
  current_charges numeric(12,2),
  previous_balance numeric(12,2) default 0,
  adjustments numeric(12,2) default 0,
  late_fees numeric(12,2) default 0,
  total_amount_due numeric(12,2),

  -- Coding
  gl_coding text,                         -- '500-555-5120.00'

  -- Storage + extraction
  pdf_path text,                          -- Supabase Storage path
  pdf_pages int,
  raw_extraction jsonb,
  extraction_confidence numeric(3,2),
  extraction_warnings text[] default array[]::text[],
  requires_human_review boolean default false,

  -- Variance
  variance_baseline numeric(14,4),
  variance_pct numeric(6,2),
  variance_flagged boolean default false,
  variance_explanation text,
  exclude_from_baseline boolean default false,  -- set true for leak/anomaly months

  -- Workflow state
  status invoice_status default 'new',
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz default now(),
  coded_by uuid references auth.users(id),
  coded_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_reason text,

  -- Sage integration
  sage_system sage_system,
  sage_batch_id text,
  sage_invoice_id text,
  sage_posted_at timestamptz,

  -- Payment
  check_number text,
  check_date date,
  check_amount numeric(12,2),
  mailed_at timestamptz,
  mailed_by uuid references auth.users(id),

  -- Source
  source bill_source,
  source_reference text,                  -- email message id, portal ref, upload file name

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on invoices (status);
create index on invoices (property_id, status);
create index on invoices (utility_account_id, service_period_end desc);
create index on invoices (vendor_id);
create index on invoices (invoice_date);
create index on invoices (due_date) where status in ('approved', 'posted_to_sage');
create index on invoices (variance_flagged) where variance_flagged = true;

-- ----------------------------------------------------------------------------
-- Usage readings (water, electric detail for variance analysis)
-- ----------------------------------------------------------------------------

create table usage_readings (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade,
  utility_account_id uuid references utility_accounts(id),
  reading_type text not null,             -- 'water', 'sewer', 'irrigation', 'electric'
  service_start date,
  service_end date,
  days int,
  usage_amount numeric(14,2),
  usage_unit text,
  meter_start numeric(14,2),
  meter_end numeric(14,2),
  occupancy_pct numeric(5,4),
  daily_usage numeric(14,4) generated always as (
    case when days > 0 then usage_amount / days else null end
  ) stored,
  baseline_daily_usage numeric(14,4),
  variance_pct numeric(6,2),
  variance_flagged boolean default false,
  created_at timestamptz default now()
);

create index on usage_readings (utility_account_id, service_end desc);

-- ----------------------------------------------------------------------------
-- Budgets (monthly, per property per GL account)
-- ----------------------------------------------------------------------------

create table budgets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  gl_account_id uuid not null references gl_accounts(id),
  year int not null,
  month int not null check (month between 1 and 12),
  amount numeric(12,2) not null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (property_id, gl_account_id, year, month)
);

create index on budgets (property_id, year);

-- ----------------------------------------------------------------------------
-- Approval / audit log
-- ----------------------------------------------------------------------------

create table approval_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade,
  action text not null,                   -- 'submitted','extracted','coded','flagged','explained','approved','rejected','posted','paid','mailed'
  actor_id uuid references auth.users(id),
  actor_email text,
  previous_status invoice_status,
  new_status invoice_status,
  notes text,
  metadata jsonb,
  created_at timestamptz default now()
);

create index on approval_log (invoice_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Variance inquiries sent to property contacts
-- ----------------------------------------------------------------------------

create table variance_inquiries (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  property_contact_id uuid references property_contacts(id),
  recipient_email text not null,
  cc_emails text[] default array[]::text[],
  subject text,
  body text,
  sent_at timestamptz default now(),
  response_received_at timestamptz,
  response_body text,
  response_source text,                   -- 'email','web','phone'
  status text default 'sent' check (status in ('sent','responded','escalated','closed')),
  created_at timestamptz default now()
);

create index on variance_inquiries (invoice_id);

-- ----------------------------------------------------------------------------
-- User profiles (extends Supabase auth.users)
-- ----------------------------------------------------------------------------

create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role user_role not null default 'viewer',
  property_scope uuid[] default array[]::uuid[],  -- empty = all properties role allows
  can_approve_up_to numeric(12,2),                -- null = no cap
  can_approve_variance_flagged boolean default false,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on user_profiles (role) where active = true;

-- ----------------------------------------------------------------------------
-- Updated-at triggers
-- ----------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array[
    'properties','vendors','utility_accounts','property_contacts',
    'invoices','budgets','user_profiles'
  ]
  loop
    execute format(
      'create trigger trg_%I_updated_at before update on %I
       for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Helper view: the Summary sheet shape (property x GL x month)
-- ----------------------------------------------------------------------------

create or replace view v_property_summary as
select
  p.id as property_id,
  p.code as property_code,
  p.name as property_name,
  g.id as gl_account_id,
  g.code as gl_code,
  g.description as gl_description,
  g.utility_category,
  extract(year from coalesce(i.service_period_end, i.invoice_date))::int as year,
  extract(month from coalesce(i.service_period_end, i.invoice_date))::int as month,
  sum(coalesce(i.total_amount_due, 0)) as total_amount
from properties p
  cross join gl_accounts g
  left join invoices i
    on i.property_id = p.id
   and i.gl_account_id = g.id
   and i.status in ('approved','posted_to_sage','paid')
group by p.id, p.code, p.name, g.id, g.code, g.description, g.utility_category,
         extract(year from coalesce(i.service_period_end, i.invoice_date)),
         extract(month from coalesce(i.service_period_end, i.invoice_date));

-- ----------------------------------------------------------------------------
-- RLS: enable now, policies refined in phase 2
-- ----------------------------------------------------------------------------

alter table properties enable row level security;
alter table vendors enable row level security;
alter table gl_accounts enable row level security;
alter table utility_accounts enable row level security;
alter table property_contacts enable row level security;
alter table invoices enable row level security;
alter table usage_readings enable row level security;
alter table budgets enable row level security;
alter table approval_log enable row level security;
alter table variance_inquiries enable row level security;
alter table user_profiles enable row level security;

-- Temporary permissive policy for authenticated users; replace with
-- role + property_scope logic in migration 0003 when admin UI lands.
create policy auth_all on properties for all to authenticated using (true) with check (true);
create policy auth_all on vendors for all to authenticated using (true) with check (true);
create policy auth_all on gl_accounts for all to authenticated using (true) with check (true);
create policy auth_all on utility_accounts for all to authenticated using (true) with check (true);
create policy auth_all on property_contacts for all to authenticated using (true) with check (true);
create policy auth_all on invoices for all to authenticated using (true) with check (true);
create policy auth_all on usage_readings for all to authenticated using (true) with check (true);
create policy auth_all on budgets for all to authenticated using (true) with check (true);
create policy auth_all on approval_log for all to authenticated using (true) with check (true);
create policy auth_all on variance_inquiries for all to authenticated using (true) with check (true);
create policy own_profile on user_profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
