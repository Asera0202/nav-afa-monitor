-- A könyvelői Dokumentumok-oldal számla-elemzés kártyájához a könyvelőnek
-- is látnia kell az általa ajánlott cégek NAV-számla sorait (eddig csak a
-- cégtulajdonos láthatta).
create policy accountant_can_select_referred_invoices on invoice_vat_lines
  for select
  using (
    company_id in (
      select companies.id from companies
      where companies.referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
    )
  );
