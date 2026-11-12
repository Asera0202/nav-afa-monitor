-- A korábban hozzáadott owner_can_select_own_companys_accountant policy
-- végtelen rekurziót okozott: accountants -> companies -> accountants.
-- Javítás: egy SECURITY DEFINER függvénnyel törjük meg a kört, ami RLS
-- nélkül (megkerülve a companies tábla saját szabályait) ellenőrzi, hogy a
-- hívó tulajdonosa-e egy, az adott könyvelőhöz rendelt cégnek.

drop policy if exists owner_can_select_own_companys_accountant on accountants;

create or replace function public.caller_owns_company_referred_to(p_accountant_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from companies
    where owner_user_id = auth.uid() and referred_by_accountant_id = p_accountant_id
  );
$$;

revoke all on function public.caller_owns_company_referred_to(uuid) from public;
grant execute on function public.caller_owns_company_referred_to(uuid) to authenticated;

create policy owner_can_select_own_companys_accountant on accountants
  for select
  using (public.caller_owns_company_referred_to(id));
