-- A Beállítások oldalon az ajánlói kód beírásakor, az összekötés előtt
-- megerősítő kérdést mutatunk a könyvelő nevével — ehhez kell egy biztonságos
-- (SECURITY DEFINER) lekérdezés, mert a kliens önmagában nem olvashatja
-- mások accountants-sorát (RLS).
create or replace function public.lookup_accountant_name_by_code(p_referral_code text)
returns text
language sql
security definer
set search_path = public
as $$
  select name from accountants where referral_code ilike p_referral_code limit 1;
$$;

revoke all on function public.lookup_accountant_name_by_code(text) from public;
grant execute on function public.lookup_accountant_name_by_code(text) to authenticated;
