DROP POLICY IF EXISTS "Public read uploads" ON public.menu_uploads;
DROP POLICY IF EXISTS "Public read items" ON public.menu_items;
DROP POLICY IF EXISTS "Public read review" ON public.menu_items_review;
REVOKE SELECT ON public.menu_uploads FROM anon, authenticated;
REVOKE SELECT ON public.menu_items FROM anon, authenticated;
REVOKE SELECT ON public.menu_items_review FROM anon, authenticated;