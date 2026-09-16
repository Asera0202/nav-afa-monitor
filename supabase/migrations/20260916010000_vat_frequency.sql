alter table companies
  add column if not exists vat_frequency text not null default 'negyedeves'
  check (vat_frequency in ('havi', 'negyedeves', 'eves'));
