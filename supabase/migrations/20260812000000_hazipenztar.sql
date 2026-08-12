-- Házipénztár (pénztárkönyv) tábláinak létrehozása.
--
-- cash_movements: kézzel rögzített készpénz-mozgások (kiadás/bevétel) — ezeket
-- a NAV egyetlen adatszolgáltatásból sem látjuk (csak a pénztárgépes eladást),
-- ezért ezt a felhasználónak kell rögzítenie.
--
-- cash_counts: időszaki fizikai pénztár-leltárak. Az expected_amount a
-- rögzítés PILLANATÁBAN számolt várható egyenleget menti el (nem élő
-- számítás), hogy a történeti eltérés utólag is pontosan visszanézhető
-- maradjon akkor is, ha közben új mozgások kerülnek be.

CREATE TABLE public.cash_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    occurred_at date NOT NULL,
    direction text NOT NULL,
    amount numeric(14,2) NOT NULL,
    category text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_movements_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
    CONSTRAINT cash_movements_amount_check CHECK ((amount > (0)::numeric))
);

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_can_select_own_cash_movements ON public.cash_movements FOR SELECT TO authenticated USING ((company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.owner_user_id = auth.uid()))));

CREATE POLICY owner_can_insert_own_cash_movements ON public.cash_movements FOR INSERT TO authenticated WITH CHECK ((company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.owner_user_id = auth.uid()))));

CREATE POLICY owner_can_delete_own_cash_movements ON public.cash_movements FOR DELETE TO authenticated USING ((company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.owner_user_id = auth.uid()))));


CREATE TABLE public.cash_counts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    counted_at timestamp with time zone NOT NULL,
    counted_amount numeric(14,2) NOT NULL,
    expected_amount numeric(14,2) NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cash_counts_counted_amount_check CHECK ((counted_amount >= (0)::numeric))
);

ALTER TABLE ONLY public.cash_counts
    ADD CONSTRAINT cash_counts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cash_counts
    ADD CONSTRAINT cash_counts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.cash_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_can_select_own_cash_counts ON public.cash_counts FOR SELECT TO authenticated USING ((company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.owner_user_id = auth.uid()))));

CREATE POLICY owner_can_insert_own_cash_counts ON public.cash_counts FOR INSERT TO authenticated WITH CHECK ((company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.owner_user_id = auth.uid()))));

CREATE POLICY owner_can_delete_own_cash_counts ON public.cash_counts FOR DELETE TO authenticated USING ((company_id IN ( SELECT companies.id
   FROM public.companies
  WHERE (companies.owner_user_id = auth.uid()))));
