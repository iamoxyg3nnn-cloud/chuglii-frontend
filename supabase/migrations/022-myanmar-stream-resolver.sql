-- Resolve fresh, playable BuuMal (Myanmar) R2 MP4 URLs.
--
-- BuuMal's detail page embeds a 1-hour presigned Cloudflare R2 MP4 URL. Cloudflare
-- Worker egress to buumal.com is blocked by their managed bot challenge, but the
-- self-hosted database host can fetch the page fine. We expose that fetch via a
-- security-definer RPC using the synchronous `http` Postgres extension.

create extension if not exists http with schema extensions;

create or replace function public.scraper_resolve_myanmar_stream(p_url text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_resp extensions.http_response;
  v_src  text;
begin
  -- Strict allow-list: only BuuMal video detail pages (prevents SSRF).
  if p_url is null
     or p_url !~* '^https://(www\.)?buumal\.com/video/[A-Za-z0-9]+/?$' then
    return null;
  end if;

  begin
    v_resp := extensions.http_get(
      p_url,
      jsonb_build_object(
        'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer', 'https://www.buumal.com/',
        'Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      )
    );
  exception when others then
    return null;
  end;

  if v_resp.status is distinct from 200 then
    return null;
  end if;

  v_src := substring(v_resp.content from '<source[^>]+src="([^"]+)"');
  if v_src is null or v_src = '' then
    v_src := substring(v_resp.content from '<video[^>]+src="([^"]+)"');
  end if;
  if v_src is null or v_src = '' then
    return null;
  end if;

  v_src := replace(replace(replace(v_src, '&amp;', '&'), '&#38;', '&'), '&quot;', '"');
  return v_src;
end;
$$;

revoke all on function public.scraper_resolve_myanmar_stream(text) from public;
grant execute on function public.scraper_resolve_myanmar_stream(text) to anon, authenticated, service_role;

-- Convenience wrapper so browser clients never build arbitrary URLs.
create or replace function public.scraper_resolve_myanmar_stream_by_id(p_post_id text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_post_id is null or p_post_id !~ '^[A-Za-z0-9]{3,64}$' then
    return null;
  end if;
  return public.scraper_resolve_myanmar_stream('https://www.buumal.com/video/' || p_post_id);
end;
$$;

revoke all on function public.scraper_resolve_myanmar_stream_by_id(text) from public;
grant execute on function public.scraper_resolve_myanmar_stream_by_id(text) to anon, authenticated, service_role;

-- Clean up the temporary probe function used while diagnosing the challenge.
drop function if exists public._test_buumal_fetch(text);
