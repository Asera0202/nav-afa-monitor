alter table companies
  add column if not exists entity_type text not null default 'ev'
  check (entity_type in ('ev', 'tarsas'));
