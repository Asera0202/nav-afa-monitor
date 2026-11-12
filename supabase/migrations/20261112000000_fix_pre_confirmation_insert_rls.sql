-- A "Confirm email" bekapcsolása után a signUp() már nem ad azonnali
-- munkamenetet, tehát a regisztráció utáni első beírás (pending_registrations,
-- accountants) anon szerepkörrel történik, nem authenticated-del. A régi
-- "auth.uid() = user_id" szabály emiatt mindig elutasítja ezeket.
--
-- Megoldás: egy SECURITY DEFINER függvénnyel ellenőrizzük, hogy a megadott
-- user_id ténylegesen egy olyan auth.users sorra mutat, aminek az email
-- címe megegyezik a beírt email-lel — ez kizárja, hogy valaki más (találgatott
-- vagy ismert) user_id-jával írjon be adatot, mert a UUID nem kitalálható,
-- az email egyezés pedig megköveteli, hogy ténylegesen az adott fiókkal
-- regisztráljanak.

create or replace function public.registering_user_matches(p_user_id uuid, p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users u where u.id = p_user_id and lower(u.email) = lower(p_email)
  );
$$;

revoke all on function public.registering_user_matches(uuid, text) from public;
grant execute on function public.registering_user_matches(uuid, text) to anon, authenticated;

drop policy if exists authenticated_insert_own on pending_registrations;
create policy insert_if_registering_user_matches on pending_registrations
  for insert
  with check (public.registering_user_matches(user_id, contact_email));

drop policy if exists accountant_can_insert_own_row on accountants;
create policy insert_if_registering_user_matches on accountants
  for insert
  with check (public.registering_user_matches(user_id, email));

grant insert on accountants to anon;
