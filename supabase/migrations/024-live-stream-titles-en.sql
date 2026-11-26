-- English titles for the live-stream catalogue (machine-translated once,
-- cached in Redis + persisted here so translations never re-run).

alter table public.live_streams add column if not exists title_en text;
