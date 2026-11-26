-- The edge worker reads the catalogue with the anon key; the data is public
-- (titles, covers, quality). Service role keeps write access.
drop policy if exists "live_streams_public_read" on public.live_streams;
create policy "live_streams_public_read" on public.live_streams
  for select using (true);
