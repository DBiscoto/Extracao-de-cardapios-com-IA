ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS attributes jsonb;

CREATE TABLE IF NOT EXISTS public.menu_items_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL,
  category text,
  name text,
  description text,
  price numeric,
  currency text DEFAULT 'BRL',
  attributes jsonb,
  raw jsonb,
  reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items_review TO anon, authenticated;
GRANT ALL ON public.menu_items_review TO service_role;

ALTER TABLE public.menu_items_review ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read review" ON public.menu_items_review FOR SELECT USING (true);
CREATE POLICY "Public insert review" ON public.menu_items_review FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update review" ON public.menu_items_review FOR UPDATE USING (true);
CREATE POLICY "Public delete review" ON public.menu_items_review FOR DELETE USING (true);