-- 021: private intake queue for privacy, consent, copyright and safety reports.
BEGIN;

CREATE TABLE IF NOT EXISTS public.content_removal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_url text NOT NULL CHECK (char_length(content_url) BETWEEN 1 AND 2048),
  reason text NOT NULL CHECK (reason IN ('privacy','consent','copyright','impersonation','other')),
  details text NOT NULL CHECK (char_length(details) BETWEEN 20 AND 3000),
  contact_email text NULL CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','resolved','rejected')),
  admin_notes text NULL CHECK (admin_notes IS NULL OR char_length(admin_notes) <= 3000),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  reviewed_by uuid NULL
);

CREATE INDEX IF NOT EXISTS content_removal_requests_status_created_idx
  ON public.content_removal_requests (status, created_at DESC);

ALTER TABLE public.content_removal_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.content_removal_requests FROM anon, authenticated;
GRANT ALL ON TABLE public.content_removal_requests TO service_role;

COMMIT;
