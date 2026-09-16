-- A könyvelői egyeztetés részletes eredményeit tároló tábla: minden olyan
-- NAV-tól ismert bejövő számla, ami nem szerepelt a feltöltött könyvelői
-- kimutatásban, teljes adatokkal (szállító, dátum, összeg) — hogy ne csak
-- egy rövid szöveges összegzésben lássa a felhasználó, hanem táblázatosan.

create table if not exists reconciliation_findings (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references manual_data_uploads(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  invoice_number text not null,
  partner_name text,
  issue_date date,
  net_amount numeric,
  vat_amount numeric,
  gross_amount numeric,
  created_at timestamptz not null default now()
);

alter table reconciliation_findings enable row level security;

create policy owner_can_select_own_reconciliation_findings on reconciliation_findings
  for select using (company_id in (select companies.id from companies where owner_user_id = auth.uid()));

grant select on reconciliation_findings to authenticated;
grant select, insert, delete on reconciliation_findings to service_role;
