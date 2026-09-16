alter table companies
  add column if not exists jarulek_frequency text not null default 'negyedeves'
  check (jarulek_frequency in ('havi', 'negyedeves'));
