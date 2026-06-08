
CREATE TABLE public.menu_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  raw_response JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.menu_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  upload_id UUID NOT NULL REFERENCES public.menu_uploads(id) ON DELETE CASCADE,
  category TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2),
  currency TEXT DEFAULT 'BRL',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_menu_items_upload ON public.menu_items(upload_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_uploads TO anon, authenticated;
GRANT ALL ON public.menu_uploads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO anon, authenticated;
GRANT ALL ON public.menu_items TO service_role;

ALTER TABLE public.menu_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read uploads" ON public.menu_uploads FOR SELECT USING (true);
CREATE POLICY "Public insert uploads" ON public.menu_uploads FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update uploads" ON public.menu_uploads FOR UPDATE USING (true);
CREATE POLICY "Public delete uploads" ON public.menu_uploads FOR DELETE USING (true);

CREATE POLICY "Public read items" ON public.menu_items FOR SELECT USING (true);
CREATE POLICY "Public insert items" ON public.menu_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update items" ON public.menu_items FOR UPDATE USING (true);
CREATE POLICY "Public delete items" ON public.menu_items FOR DELETE USING (true);
