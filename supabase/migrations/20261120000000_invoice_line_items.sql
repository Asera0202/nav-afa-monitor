-- Iparűzési adó-becslő alapja: a NAV-számlák TÉTELSOR-szintű adatai (szöveg,
-- mennyiség, egységár) — eddig csak az ÁFA-kulcsonkénti összesítőt tároltuk
-- (invoice_vat_lines), ez viszont tételenként adja a megnevezést, amiből a
-- levonható tételek (anyagköltség, ELÁBÉ, közvetített szolgáltatás,
-- alvállalkozói díj) kategorizálhatók.

create table if not exists invoice_line_items (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  direction text not null check (direction in ('INBOUND', 'OUTBOUND')),
  invoice_number text not null,
  line_number integer not null,
  partner_name text,
  issue_date date,
  description text,
  quantity numeric,
  unit text,
  unit_price numeric,
  net_amount numeric not null default 0,
  vat_percentage numeric not null default 0,
  vat_amount numeric not null default 0,
  gross_amount numeric not null default 0,
  category text check (category in ('anyagkoltseg', 'elabe', 'kozvetitett_szolgaltatas', 'alvallalkozoi_dij', 'egyeb')),
  category_source text check (category_source in ('user', 'partner_default', 'ai_suggested')),
  fetched_at timestamptz not null default now(),
  unique (company_id, direction, invoice_number, line_number)
);

create index if not exists invoice_line_items_company_id_idx on invoice_line_items(company_id);
create index if not exists invoice_line_items_partner_name_idx on invoice_line_items(company_id, partner_name);
create index if not exists invoice_line_items_category_idx on invoice_line_items(company_id, category);

alter table invoice_line_items enable row level security;

create policy owner_can_select_own_line_items on invoice_line_items
  for select using (company_id in (select id from companies where owner_user_id = auth.uid()));

create policy owner_can_update_own_line_items on invoice_line_items
  for update
  using (company_id in (select id from companies where owner_user_id = auth.uid()))
  with check (company_id in (select id from companies where owner_user_id = auth.uid()));

create policy accountant_can_select_referred_line_items on invoice_line_items
  for select
  using (
    company_id in (
      select companies.id from companies
      where companies.referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
    )
  );

grant select, insert, update on invoice_line_items to authenticated;
grant select, insert, update on invoice_line_items to service_role;

-- Partner-memória: ha egyszer eldöntöd, hogy egy adott partner tételei milyen
-- kategóriába tartoznak, a rendszer legközelebb automatikusan ugyanazt
-- ajánlja fel (vagy alkalmazza) — nem kell minden számlánál újra kiválasztani.
create table if not exists partner_category_defaults (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  partner_name text not null,
  category text not null check (category in ('anyagkoltseg', 'elabe', 'kozvetitett_szolgaltatas', 'alvallalkozoi_dij', 'egyeb')),
  created_at timestamptz not null default now(),
  unique (company_id, partner_name)
);

alter table partner_category_defaults enable row level security;

create policy owner_can_manage_own_partner_defaults on partner_category_defaults
  for all
  using (company_id in (select id from companies where owner_user_id = auth.uid()))
  with check (company_id in (select id from companies where owner_user_id = auth.uid()));

grant select, insert, update, delete on partner_category_defaults to authenticated;
grant select, insert, update, delete on partner_category_defaults to service_role;

-- Helyi iparűzési adókulcs (településenként eltérő, jellemzően 2%).
alter table companies add column if not exists local_business_tax_rate numeric not null default 0.02;
