-- Megjegyzés-funkció a Dokumentumok oldalon: a könyvelő és a vállalkozó is
-- tud rövid üzenetet hagyni egy adott mappánál (pl. "ez hiányos", "ide
-- kérek bankszámlakivonatot") — ez az egyetlen hely, ahol a könyvelő
-- (egyébként csak olvasásra jogosult) ÍRHAT is.

create table if not exists document_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  folder_id uuid not null references document_folders(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  author_role text not null check (author_role in ('owner', 'accountant')),
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists document_comments_folder_id_idx on document_comments(folder_id);

alter table document_comments enable row level security;

create policy owner_can_select_own_comments on document_comments
  for select
  using (company_id in (select id from companies where owner_user_id = auth.uid()));

create policy accountant_can_select_referred_comments on document_comments
  for select
  using (
    company_id in (
      select companies.id from companies
      where companies.referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
    )
  );

create policy owner_can_insert_own_comments on document_comments
  for insert
  with check (
    author_user_id = auth.uid() and author_role = 'owner'
    and company_id in (select id from companies where owner_user_id = auth.uid())
  );

create policy accountant_can_insert_referred_comments on document_comments
  for insert
  with check (
    author_user_id = auth.uid() and author_role = 'accountant'
    and company_id in (
      select companies.id from companies
      where companies.referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
    )
  );

grant select, insert on document_comments to authenticated;
grant select, insert on document_comments to service_role;
