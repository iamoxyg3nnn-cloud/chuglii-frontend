-- Rotating live-frame thumbnails: the GH Actions live worker captures one
-- frame per video at the current broadcast position each cycle and stores
-- the JPEG inline (bytea) — no object storage involved.
alter table public.live_streams add column if not exists frame_jpeg bytea;
alter table public.live_streams add column if not exists has_frame boolean default false;
alter table public.live_streams add column if not exists frame_captured_at timestamptz;
