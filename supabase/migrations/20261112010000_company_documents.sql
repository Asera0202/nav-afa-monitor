-- Dokumentumtár: a vállalkozó szabadon létrehozhat mappákat (tetszőleges
-- mélységben), és fájlokat tölthet fel beléjük. A hozzá rendelt könyvelő
-- (companies.referred_by_accountant_id) ugyanezt látja, de csak OLVASÁSRA —
-- se mappát, se fájlt nem hozhat létre/törölhet/módosíthat.

create table if not exists document_folders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  parent_folder_id uuid references document_folders(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists document_folders_company_id_idx on document_folders(company_id);
create index if not exists document_folders_parent_folder_id_idx on document_folders(parent_folder_id);

create table if not exists company_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  folder_id uuid not null references document_folders(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  size_bytes bigint,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);

create index if not exists company_documents_folder_id_idx on company_documents(folder_id);
create index if not exists company_documents_company_id_idx on company_documents(company_id);

alter table document_folders enable row level security;
alter table company_documents enable row level security;

-- Cégtulajdonos: teljes hozzáférés a saját cégéhez.
create policy owner_can_manage_own_folders on document_folders
  for all
  using (company_id in (select id from companies where owner_user_id = auth.uid()))
  with check (company_id in (select id from companies where owner_user_id = auth.uid()));

create policy owner_can_manage_own_documents on company_documents
  for all
  using (company_id in (select id from companies where owner_user_id = auth.uid()))
  with check (company_id in (select id from companies where owner_user_id = auth.uid()));

-- Könyvelő: csak olvasás, csak az általa ajánlott cégeknél.
create policy accountant_can_select_referred_folders on document_folders
  for select
  using (
    company_id in (
      select companies.id from companies
      where companies.referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
    )
  );

create policy accountant_can_select_referred_documents on company_documents
  for select
  using (
    company_id in (
      select companies.id from companies
      where companies.referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
    )
  );

grant select, insert, update, delete on document_folders to authenticated;
grant select, insert, update, delete on company_documents to authenticated;
grant select, insert, update, delete on document_folders to service_role;
grant select, insert, update, delete on company_documents to service_role;

-- Storage bucket a tényleges fájloknak. Az útvonal konvenció:
-- {company_id}/{random-uuid}-{eredeti fájlnév} — így a jogosultság-ellenőrzés
-- a path első szegmensét (company_id) tudja összevetni a companies táblával,
-- anélkül hogy a storage.objects tábla ismerné a company_id fogalmát.
insert into storage.buckets (id, name, public)
values ('company-documents', 'company-documents', false)
on conflict (id) do nothing;

create policy owner_can_manage_own_storage_objects on storage.objects
  for all
  using (
    bucket_id = 'company-documents'
    and (storage.foldername(name))[1]::uuid in (select id from companies where owner_user_id = auth.uid())
  )
  with check (
    bucket_id = 'company-documents'
    and (storage.foldername(name))[1]::uuid in (select id from companies where owner_user_id = auth.uid())
  );

create policy accountant_can_select_referred_storage_objects on storage.objects
  for select
  using (
    bucket_id = 'company-documents'
    and (storage.foldername(name))[1]::uuid in (
      select companies.id from companies
      where companies.referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
    )
  );
