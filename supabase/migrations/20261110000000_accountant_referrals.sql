-- Könyvelői partnerprogram: a könyvelő saját fiókkal regisztrál, kap egy
-- ajánlói kódot, amit a vállalkozás a regisztrációnál megadhat. Amíg az
-- így beregisztrált cég előfizet, a könyvelő a havi előfizetési díj
-- 25%-át kapja jutalékként (lásd COMMISSION_RATE a könyvelői dashboardon
-- és a subscription_payments-ből számolva, nem külön tárolt mezőben, hogy
-- a kulcsszám később is egyszerűen változtatható legyen).

create table if not exists accountants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  referral_code text not null unique,
  created_at timestamptz not null default now()
);

alter table accountants enable row level security;

create policy accountant_can_select_own_row on accountants
  for select using (user_id = auth.uid());

create policy accountant_can_insert_own_row on accountants
  for insert with check (user_id = auth.uid());

grant select, insert on accountants to authenticated;
grant select, insert on accountants to service_role;

-- A regisztrációnál megadott ajánlói kódot (nyers szöveg) a
-- pending_registrations sorban visszük át, és az automatikus
-- aktiváláskor oldjuk fel accountant_id-ra (így egy elgépelt/érvénytelen
-- kód nem akasztja meg a cég-regisztrációt, csak egyszerűen nem lesz
-- ajánló hozzárendelve).
alter table pending_registrations add column if not exists referral_code_used text;
alter table companies add column if not exists referred_by_accountant_id uuid references accountants(id);

-- Minden sikeres előfizetési befizetés egy sort kap itt — ez a
-- számlázási/jutalék-elszámolási napló (a subscriptions tábla csak a
-- JELENLEGI állapotot tartja, ez viszont a teljes történetet).
create table if not exists subscription_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tier text not null,
  price numeric not null,
  period_start date not null,
  period_end date not null,
  barion_payment_id text,
  paid_at timestamptz not null default now()
);

alter table subscription_payments enable row level security;

create policy owner_can_select_own_subscription_payments on subscription_payments
  for select using (company_id in (select companies.id from companies where owner_user_id = auth.uid()));

create policy accountant_can_select_referred_subscription_payments on subscription_payments
  for select using (
    company_id in (
      select companies.id from companies
      where companies.referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
    )
  );

grant select, insert on subscription_payments to authenticated;
grant select, insert on subscription_payments to service_role;

-- A könyvelő lássa az általa ajánlott cégek alapadatait és feltöltéseit
-- (hogy amint a vállalkozó feltölt valamit, azonnal lássa).
create policy accountant_can_select_referred_companies on companies
  for select using (
    referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
  );

create policy accountant_can_select_referred_uploads on manual_data_uploads
  for select using (
    company_id in (
      select companies.id from companies
      where companies.referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
    )
  );

create policy accountant_can_select_referred_subscriptions on subscriptions
  for select using (
    company_id in (
      select companies.id from companies
      where companies.referred_by_accountant_id in (select accountants.id from accountants where accountants.user_id = auth.uid())
    )
  );
