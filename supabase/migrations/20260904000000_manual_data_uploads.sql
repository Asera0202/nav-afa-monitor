-- Kézi feltöltésű dokumentumok (KOBAK-export, könyvelői kimutatás stb.)
-- nyilvántartása és tárolása. A tényleges fájl a Supabase Storage
-- "manual-uploads" bucket-jébe kerül, ez a tábla csak a metaadatot és a
-- feldolgozási állapotot tárolja.

create table if not exists manual_data_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('kobak_penztargep', 'konyveloi_afa', 'egyeb')),
  file_name text not null,
  storage_path text not null,
  period_from date,
  period_to date,
  status text not null default 'feltoltve' check (status in ('feltoltve', 'feldolgozva', 'hiba')),
  note text,
  created_at timestamptz not null default now()
);

alter table manual_data_uploads enable row level security;

create policy owner_can_select_own_manual_data_uploads on manual_data_uploads
  for select using (company_id in (select companies.id from companies where owner_user_id = auth.uid()));

create policy owner_can_insert_own_manual_data_uploads on manual_data_uploads
  for insert with check (company_id in (select companies.id from companies where owner_user_id = auth.uid()));

create policy owner_can_delete_own_manual_data_uploads on manual_data_uploads
  for delete using (company_id in (select companies.id from companies where owner_user_id = auth.uid()));

-- Storage bucket a fájlokhoz (nem publikus).
insert into storage.buckets (id, name, public)
values ('manual-uploads', 'manual-uploads', false)
on conflict (id) do nothing;

-- A fájlnév-útvonal konvenció: "<company_id>/<fájlnév>" — így a policy a
-- path első szegmensét (a cég UUID-jét) hasonlítja a felhasználó cégeihez.
create policy owner_can_upload_own_manual_files on storage.objects
  for insert with check (
    bucket_id = 'manual-uploads'
    and (storage.foldername(name))[1] in (select companies.id::text from companies where owner_user_id = auth.uid())
  );

create policy owner_can_read_own_manual_files on storage.objects
  for select using (
    bucket_id = 'manual-uploads'
    and (storage.foldername(name))[1] in (select companies.id::text from companies where owner_user_id = auth.uid())
  );

create policy owner_can_delete_own_manual_files on storage.objects
  for delete using (
    bucket_id = 'manual-uploads'
    and (storage.foldername(name))[1] in (select companies.id::text from companies where owner_user_id = auth.uid())
  );
