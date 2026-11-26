-- Live worker (GitHub Actions batch) output storage:
--  - storage_path:  Supabase Storage path of the remuxed HLS (index.m3u8 dir)
--  - duration_secs: loop length, drives the shared broadcast position
--  - cover_path:    decrypted cover JPEG in storage
--  - frame_count:   number of live frames (frame_000.jpg...) uploaded

alter table public.live_streams add column if not exists storage_path text;
alter table public.live_streams add column if not exists duration_secs int;
alter table public.live_streams add column if not exists cover_path text;
alter table public.live_streams add column if not exists frame_count int default 0;

-- Public-read bucket for remuxed HLS + frames (site is public anyway).
insert into storage.buckets (id, name, public, file_size_limit)
values ('live-remux', 'live-remux', true, 524288000)
on conflict (id) do nothing;
