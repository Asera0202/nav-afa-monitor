-- Új feltöltés-típus: a könyvelő/bérszámfejtő szoftver havonta generált
-- "Járulék utalási összesítő" riportja (szocho/TB-járulék/SZJA-előleg
-- tényleges, pontos befizetendő összegei és határideje).
alter table manual_data_uploads drop constraint if exists manual_data_uploads_kind_check;
alter table manual_data_uploads
  add constraint manual_data_uploads_kind_check
  check (kind in ('kobak_penztargep', 'konyveloi_afa', 'jarulek_osszesito', 'egyeb'));

-- A feltöltött járulék utalási összesítőkből kiolvasott, tételes,
-- tényleges (nem becsült) befizetendő sorok — a NAV-határidő-naptár ezeket
-- a generikus, jogszabály alapján számolt becslés helyett/mellett mutatja,
-- amikor egy adott hónapra van feltöltött valódi adat.
create table if not exists jarulek_deadlines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  upload_id uuid not null references manual_data_uploads(id) on delete cascade,
  period_year int not null,
  period_month int not null,
  due_date date not null,
  adonem_kod text not null,
  jogcim text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists jarulek_deadlines_company_due_idx on jarulek_deadlines (company_id, due_date);

alter table jarulek_deadlines enable row level security;

create policy owner_can_select_own_jarulek_deadlines on jarulek_deadlines
  for select using (company_id in (select companies.id from companies where owner_user_id = auth.uid()));

grant select on jarulek_deadlines to authenticated;
grant select, insert, delete on jarulek_deadlines to service_role;
