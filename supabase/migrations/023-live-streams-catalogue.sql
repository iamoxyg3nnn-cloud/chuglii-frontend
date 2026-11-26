-- Persist the scraped live-stream catalogue so the Watch Live page survives
-- upstream outages and keeps history (what appeared, when, at what quality).
--
-- The api-server upserts every stream it scrapes (fire-and-forget) and
-- deactivates ids that disappear from the upstream tabs. On total scrape
-- failure the API falls back to reading this table.

create table if not exists public.live_streams (
  id              integer primary key,
  title           text not null default '',
  thumbnail_url   text,
  quality_label   text,
  quality_width   integer,
  quality_height  integer,
  active          boolean not null default true,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create index if not exists live_streams_active_idx
  on public.live_streams (active, last_seen_at desc);

-- Service-role API writes these rows; no client-facing RLS policies needed
-- (reads go through the api-server, which uses the service role).
alter table public.live_streams enable row level security;
