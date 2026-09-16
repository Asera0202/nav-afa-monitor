-- Előfizetés/számlázás. Sávos, forgalom-alapú árazás: minden hónap végén
-- a company tényleges bizonylatszáma (kimenő + bejövő számla + pénztárgépes
-- napok együtt) dönti el, melyik sávban számlázunk a KÖVETKEZŐ hónapra.
-- Minden új cégnek 30 napos ingyenes próbaidőszaka van regisztrációkor.
create table if not exists subscriptions (
  company_id uuid primary key references companies(id) on delete cascade,
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'canceled')),
  trial_ends_at date not null default (current_date + interval '30 days')::date,
  tier text check (tier in ('sav1', 'sav2', 'sav3')),
  current_period_start date,
  current_period_end date,
  barion_payment_id text,
  last_usage_count int,
  updated_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

create policy owner_can_select_own_subscription on subscriptions
  for select using (company_id in (select companies.id from companies where owner_user_id = auth.uid()));

grant select on subscriptions to authenticated;
grant select, insert, update on subscriptions to service_role;

-- Egy hónapra vonatkozó bizonylatszám: kimenő + bejövő számlák (darabra,
-- nem ÁFA-kulcsonkénti sorra) + azok a NAPOK, amikre van pénztárgépes
-- adat (nem nyugtánként — a NAV API-t is naponta egyszer hívjuk egy
-- pénztárgépre, ez tükrözi a tényleges terhelést, és nem bünteti a sok
-- kis tételes retail forgalmú cégeket).
create or replace function compute_billing_usage(p_company_id uuid, p_from date, p_to date)
returns integer
language sql
security invoker
stable
as $$
  select
    coalesce((
      select count(distinct invoice_number) from invoice_vat_lines
      where company_id = p_company_id and direction = 'OUTBOUND'
        and issue_date >= p_from and issue_date <= p_to
    ), 0)
    +
    coalesce((
      select count(distinct invoice_number) from invoice_vat_lines
      where company_id = p_company_id and direction = 'INBOUND'
        and issue_date >= p_from and issue_date <= p_to
    ), 0)
    +
    coalesce((
      select count(distinct (ap_number, date_trunc('day', transaction_at))) from opg_receipt_items
      where company_id = p_company_id
        and transaction_at >= p_from and transaction_at < (p_to + 1)
    ), 0)
$$;

grant execute on function compute_billing_usage(uuid, date, date) to authenticated, service_role;
