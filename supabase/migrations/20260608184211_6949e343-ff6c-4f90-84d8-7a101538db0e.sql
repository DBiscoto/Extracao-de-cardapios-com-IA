
DROP POLICY IF EXISTS "Public insert items" ON public.menu_items;
DROP POLICY IF EXISTS "Public update items" ON public.menu_items;
DROP POLICY IF EXISTS "Public delete items" ON public.menu_items;
DROP POLICY IF EXISTS "Public insert review" ON public.menu_items_review;
DROP POLICY IF EXISTS "Public update review" ON public.menu_items_review;
DROP POLICY IF EXISTS "Public delete review" ON public.menu_items_review;
DROP POLICY IF EXISTS "Public insert uploads" ON public.menu_uploads;
DROP POLICY IF EXISTS "Public update uploads" ON public.menu_uploads;
DROP POLICY IF EXISTS "Public delete uploads" ON public.menu_uploads;

REVOKE INSERT, UPDATE, DELETE ON public.menu_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.menu_items_review FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.menu_uploads FROM anon, authenticated;
