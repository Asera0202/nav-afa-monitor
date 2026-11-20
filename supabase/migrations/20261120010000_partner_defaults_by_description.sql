-- A szállító-memória eddig csak a partner neve alapján jegyezte meg a
-- kategóriát (anyagköltség/ELÁBÉ/stb.) — ez hibás lenne, ha ugyanattól a
-- partnertől VEGYES célú tételeket veszünk (pl. a boltból WC-papírt egyszer
-- eladásra, máskor saját használatra). Mostantól a tétel SZÖVEGE (leírása)
-- is a kulcs része, hogy csak a valóban azonos tételek ragadjanak össze.

alter table partner_category_defaults
  add column if not exists description text not null default '';

alter table partner_category_defaults
  drop constraint if exists partner_category_defaults_company_id_partner_name_key;

alter table partner_category_defaults
  add constraint partner_category_defaults_company_id_partner_name_description_key
  unique (company_id, partner_name, description);
