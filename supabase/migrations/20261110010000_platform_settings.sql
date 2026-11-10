-- A könyvelői jutalékszázalékot nem a kódba égetjük, hanem egy
-- egysoros beállítás-táblába, hogy a rendszergazda bármikor átírhassa
-- SQL-lel, kódfrissítés/deploy nélkül.
create table if not exists platform_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into platform_settings (key, value) values ('accountant_commission_rate', '0.25')
  on conflict (key) do nothing;

alter table platform_settings enable row level security;

create policy anyone_can_select_platform_settings on platform_settings
  for select using (true);

grant select on platform_settings to authenticated, anon;
grant select, insert, update on platform_settings to service_role;

-- A jutalékszázalékot a FIZETÉS PILLANATÁBAN rögzítjük minden
-- subscription_payments soron — így ha a rendszergazda később megváltoztatja
-- a platform_settings-ben lévő rátát, az a múltbeli hónapok már kiszámolt
-- jutalékát nem írja felül visszamenőleg, csak az ezutáni fizetésekre
-- vonatkozik.
alter table subscription_payments add column if not exists commission_rate numeric not null default 0.25;
