ALTER TABLE public.menu_uploads ADD COLUMN IF NOT EXISTS device_id text;
CREATE INDEX IF NOT EXISTS menu_uploads_device_id_idx ON public.menu_uploads (device_id, created_at DESC);