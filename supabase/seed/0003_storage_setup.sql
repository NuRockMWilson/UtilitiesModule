-- Run after the schema migration. Creates the private "invoices" storage
-- bucket that holds bill PDFs, and its access policies.

insert into storage.buckets (id, name, public) values
  ('invoices',     'invoices',     false),
  ('sage-exports', 'sage-exports', false)
on conflict (id) do nothing;

-- Authenticated users read their own files via signed URLs.
create policy "authenticated read invoices" on storage.objects
  for select to authenticated using (bucket_id = 'invoices');

create policy "authenticated read sage exports" on storage.objects
  for select to authenticated using (bucket_id = 'sage-exports');

-- Service role (ingest webhook, extraction, batch generation) can write anywhere.
create policy "service write invoices" on storage.objects
  for insert to service_role with check (bucket_id = 'invoices');

create policy "service write sage exports" on storage.objects
  for insert to service_role with check (bucket_id = 'sage-exports');

-- Authenticated users can upload bills through /api/invoices/upload.
create policy "authenticated upload invoices" on storage.objects
  for insert to authenticated with check (bucket_id = 'invoices');

-- Authenticated users can generate Sage exports through the batch API.
create policy "authenticated upload sage exports" on storage.objects
  for insert to authenticated with check (bucket_id = 'sage-exports');
