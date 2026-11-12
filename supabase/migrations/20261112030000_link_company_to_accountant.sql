-- A Beállítások oldalon a vállalkozó utólag is megadhatja/módosíthatja a
-- könyvelője ajánlói kódját. A kliens nem olvashatja közvetlenül mások
-- accountants-sorát (RLS), ezért ezt egy SECURITY DEFINER függvény oldja
-- fel, ami saját maga ellenőrzi, hogy a hívó tényleg a cég tulajdonosa-e.
create or replace function public.link_company_to_accountant(p_company_id uuid, p_referral_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_accountant_id uuid;
begin
  if not exists (select 1 from companies where id = p_company_id and owner_user_id = auth.uid()) then
    raise exception 'Nincs jogosultságod ehhez a céghez.';
  end if;

  select id into v_accountant_id from accountants where referral_code ilike p_referral_code limit 1;

  if v_accountant_id is null then
    return false;
  end if;

  update companies set referred_by_accountant_id = v_accountant_id where id = p_company_id;
  return true;
end;
$$;

revoke all on function public.link_company_to_accountant(uuid, text) from public;
grant execute on function public.link_company_to_accountant(uuid, text) to authenticated;

-- A könyvelő nevét is meg kell tudnia nézni a vállalkozónak (jelenleg csak
-- a saját sorát látja) — egy szűk, csak a saját cégéhez rendelt könyvelőre
-- vonatkozó SELECT policy-val.
create policy owner_can_select_own_companys_accountant on accountants
  for select
  using (
    id in (select referred_by_accountant_id from companies where owner_user_id = auth.uid())
  );
