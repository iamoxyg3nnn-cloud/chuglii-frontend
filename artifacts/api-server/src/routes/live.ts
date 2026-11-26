import { Router } from "express";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseTsVideoResolution } from "../lib/h264-sps.js";
import { getRedis, isRedisConnected } from "../lib/redis.js";
import { supabase } from "../lib/supabase.js";
import {
  ensureRemux,
  getRemuxDuration,
  getRemuxStatus,
  openRemuxFile,
  warmCatalogue,
} from "../lib/live-remux.js";

/**
 * Live streams (91吃瓜网 "实时监控" candid feed).
 *
 * The upstream site server-renders everything we need:
 *  - the live tab lists 20 cards: `a.realtime-card[href="/category/sstp/video/{id}/"]`
 *    with the full title in `aria-label` and the cover in an obfuscated
 *    lazy-load attribute (`data-*` pointing at pic.biacea.cn).
 *  - each video page embeds the whole player config inline in
 *    `div.dplayer[data-config='{JSON}']` — `video.url` is a signed HLS
 *    manifest (auth_key token, enforced upstream) on op.micgqv.cn.
 *
 * Stream tokens are minted per page render, so resolution must happen at
 * request time; both endpoints cache briefly to stay polite upstream.
 * Playback itself goes through the existing /api/media proxy, which rewrites
 * segment + AES-key URIs back to same-origin.
 */

const UPSTREAM_BASE = "https://h4gaz3.jpzydpzm.cc";
// The brand serves the same app from rotating mirror hosts — if the primary
// is down (or blocks us), transparently try the next one.
const MIRROR_BASES = [UPSTREAM_BASE, "https://box.jpzydpzm.cc"];
const LIVE_TAB_URL = `${UPSTREAM_BASE}/category/sstp/live/`;
const LIVE_PAGE_URL = (page: number) => `${UPSTREAM_BASE}/category/sstp/live/${page}/`; // pagination: /live/2/, /live/3/, …
const VIDEO_PAGE_PATH = "/category/sstp/video/{id}/";
const VIDEO_PAGE_URL = (id: string) => `${UPSTREAM_BASE}/category/sstp/video/${id}/`;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const LIST_CACHE_TTL_MS = 60_000; // card list — stable, refresh once a minute
const RESOLVE_CACHE_TTL_MS = 45_000; // tokens re-mint constantly; keep fresh
const STALE_SERVE_MS = 10 * 60_000; // serve stale on upstream failure

interface LiveStreamItem {
  id: string;
  title: string;
  title_en?: string | null;
  thumbnail_url: string;
  page_url: string;
  /** Resolution badge (e.g. "1080p") once the background probe finishes. */
  quality_label?: string | null;
}

interface ResolvedStream {
  id: string;
  m3u8_url: string;
  poster_url: string | null;
  live: boolean;
  title_en?: string | null;
}

interface CacheEntry<T> {
  value: T;
  at: number;
}

// ── Cover-image decryption ─────────────────────────────────────────────────
// Cover images on pic.biacea.cn are AES-128-CBC encrypted at rest; the site
// decrypts them client-side in a Web Worker (AiSuite image.0821.js, CryptoJS
// with the key/IV below embedded as obfuscated charcode strings). Verified:
// raw CDN bytes -> AES-128-CBC/PKCS7 decrypt -> valid JPEG (ffd8ffe0 JFIF).
const IMAGE_HOSTS = new Set(["pic.biacea.cn"]);
const IMAGE_KEY = Buffer.from("f5d965df75336270", "utf8");
const IMAGE_IV = Buffer.from("97b60394abc2fbe1", "utf8");

function decryptImage(buf: Buffer): Buffer {
  // autoPadding default = PKCS7, matching CryptoJS pad.Pkcs7
  const d = crypto.createDecipheriv("aes-128-cbc", IMAGE_KEY, IMAGE_IV);
  return Buffer.concat([d.update(buf), d.final()]);
}

const thumbCache = new Map<string, CacheEntry<Buffer>>();
const THUMB_CACHE_TTL_MS = 10 * 60_000;
const THUMB_CACHE_MAX = 512;
// Covers are immutable per URL — let Cloudflare hold them at the edge for a
// full day (browsers revalidate after 10 min). Requires a CF cache rule for
// /api/live/* if the zone doesn't already cache API paths.
const THUMB_CACHE_HEADER = "public, max-age=600, s-maxage=86400, stale-while-revalidate=600";

function setThumbCache(key: string, value: Buffer): void {
  if (thumbCache.size >= THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value;
    if (oldest) thumbCache.delete(oldest);
  }
  thumbCache.set(key, { value, at: Date.now() });
}

const listCache = new Map<string, CacheEntry<LiveStreamItem[]>>();
const resolveCache = new Map<string, CacheEntry<ResolvedStream>>();

// ── Quality probing (resolution badge) ───────────────────────────────────
// Each stream is a single-rendition media playlist; the real resolution is
// only discoverable by decrypting segment 0 and parsing the H.264 SPS.
// Probed once per video (24h cache), in a small background queue so list
// responses never block on it.

interface StreamQuality {
  width: number;
  height: number;
  label: string; // e.g. "1080p"
}

const QUALITY_TTL_MS = 24 * 60 * 60_000;
const qualityCache = new Map<string, CacheEntry<StreamQuality>>();

function qualityLabel(width: number, height: number): string {
  // Common tiers by height; odd sizes snap to the nearest known tier.
  const tiers: Array<[number, string]> = [
    [4320, "4320p"], [2160, "2160p"], [1440, "1440p"], [1080, "1080p"],
    [720, "720p"], [480, "480p"], [360, "360p"], [240, "240p"],
  ];
  for (const [h, label] of tiers) {
    if (height >= h - 24) return label;
  }
  return `${height}p`;
}

async function fetchBuf(url: string, headers: Record<string, string>, timeoutMs = 15_000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function probeQuality(id: string): Promise<StreamQuality | null> {
  const cached = qualityCache.get(id);
  if (cached && Date.now() - cached.at < QUALITY_TTL_MS) return cached.value;

  // L2: shared Redis (24h) — a probe done by any instance counts for all.
  const fromRedis = await redisGetJson<StreamQuality>(`quality:${id}`);
  if (fromRedis && fromRedis.label) {
    qualityCache.set(id, { value: fromRedis, at: Date.now() });
    return fromRedis;
  }

  const html = await fetchUpstream(VIDEO_PAGE_URL(id));
  const resolved = parseVideoPage(html, id);
  if (!resolved) throw new Error("no player config");

  const playlist = await fetchBuf(resolved.m3u8_url, { "User-Agent": BROWSER_UA }, 15_000);
  const text = playlist.toString("utf8");
  const segMatch = text.match(/#EXTINF:[\d.]+,\s*\n(https?:\/\/[^\n]+?0\.ts\?[^\n]+)/);
  if (!segMatch) throw new Error("no segment found");

  // First 256 KB is plenty for PAT/PMT/SPS. CBC prefix decrypt works on
  // complete 16-byte blocks with autoPadding off.
  let seg = await fetchBuf(segMatch[1]!, { "User-Agent": BROWSER_UA, Range: "bytes=0-262143" }, 20_000);
  const keyMatch = text.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"(?:,IV=0x([0-9a-fA-F]+))?/);
  if (keyMatch) {
    const key = await fetchBuf(keyMatch[1]!, { "User-Agent": BROWSER_UA }, 10_000);
    if (key.length !== 16) throw new Error("bad key length");
    const ivHex = keyMatch[2] ?? "0".repeat(32);
    const iv = Buffer.from(ivHex.padStart(32, "0").slice(0, 32), "hex");
    const aligned = seg.subarray(0, seg.length - (seg.length % 16));
    const d = crypto.createDecipheriv("aes-128-cbc", key, iv);
    d.setAutoPadding(false); // prefix decrypt: no PKCS7 tail to strip
    seg = Buffer.concat([d.update(aligned), d.final()]);
  }

  const dims = parseTsVideoResolution(seg);
  if (!dims) throw new Error("SPS not found");
  const q: StreamQuality = {
    width: dims.width,
    height: dims.height,
    label: qualityLabel(dims.width, dims.height),
  };
  qualityCache.set(id, { value: q, at: Date.now() });
  redisSetJson(`quality:${id}`, q, 24 * 60 * 60);
  return q;
}

// Small background probe queue — never blocks a request.
const probePending = new Set<string>();
let probeActive = 0;
const PROBE_MAX_CONCURRENT = 2;
const probeQueue: string[] = [];

function pumpProbeQueue(): void {
  while (probeActive < PROBE_MAX_CONCURRENT && probeQueue.length > 0) {
    const id = probeQueue.shift()!;
    if (qualityCache.has(id)) continue;
    probePending.add(id);
    probeActive += 1;
    probeQuality(id)
      .catch(() => {
        // Best-effort: leave uncached so a later pass can retry.
      })
      .finally(() => {
        probeActive -= 1;
        probePending.delete(id);
        setImmediate(pumpProbeQueue);
      });
  }
}

function enqueueQualityProbes(streams: LiveStreamItem[]): void {
  for (const s of streams) {
    if (qualityCache.has(s.id) || probePending.has(s.id)) continue;
    probePending.add(s.id);
    probeQueue.push(s.id);
  }
  pumpProbeQueue();
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string, ttl: number): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl + STALE_SERVE_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

// Serve from cache even when past TTL (within STALE_SERVE_MS) if upstream fails.
function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, at: Date.now() });
}

// ─── Shared Redis cache (L2) ─────────────────────────────────────────────
// Same store the media proxy uses (Redis-over-HTTPS bridge). Memory stays L1
// for hot-path latency; Redis makes the cache survive restarts and share
// across instances so upstream is scraped at most once fleet-wide.

const REDIS_PREFIX = "live:v1:";

async function redisGetJson<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return null;
  try {
    const raw = await redis.get(REDIS_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function redisSetJson(key: string, value: unknown, ttlSeconds: number): void {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return;
  redis.setex(REDIS_PREFIX + key, ttlSeconds, JSON.stringify(value)).catch(() => {});
}

async function redisGetBlob(key: string): Promise<Buffer | null> {
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return null;
  try {
    const raw = await redis.get(REDIS_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { b64: string };
    return Buffer.from(parsed.b64, "base64");
  } catch {
    return null;
  }
}

function redisSetBlob(key: string, buf: Buffer, ttlSeconds: number): void {
  if (buf.length > 1_500 * 1024) return; // keep Redis blobs small (same cap as media-cache)
  const redis = getRedis();
  if (!redis || !isRedisConnected()) return;
  redis
    .setex(REDIS_PREFIX + key, ttlSeconds, JSON.stringify({ b64: buf.toString("base64") }))
    .catch(() => {});
}

async function fetchUpstream(url: string, timeoutMs = 15_000): Promise<string> {
  // Mirror failover: same path on every known mirror origin until one answers.
  let path = "";
  try {
    path = new URL(url).pathname + new URL(url).search;
  } catch {
    path = url; // already a path
  }
  const bases = url.startsWith("http")
    ? [new URL(url).origin, ...MIRROR_BASES.filter((b) => b !== new URL(url).origin)]
    : MIRROR_BASES;
  let lastErr: Error = new Error("no mirror attempted");
  for (const base of bases) {
    try {
      return await fetchUpstreamOnce(base + path, timeoutMs);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr;
}

async function fetchUpstreamOnce(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.google.com/",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the 20 cards out of the server-rendered live tab. */
export function parseLiveTab(html: string): LiveStreamItem[] {
  const items: LiveStreamItem[] = [];
  const seen = new Set<string>();
  const cardRe =
    /<a class="realtime-card" href="([^"]+)" aria-label="([^"]*)">([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const href = m[1];
    const title = m[2].trim();
    const inner = m[3];
    const idMatch = href.match(/\/video\/(\d+)\//);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (seen.has(id)) continue;
    seen.add(id);
    // Cover lives in an obfuscated lazy-load attr; match any data-* holding an image URL.
    const thumbMatch = inner.match(/data-[a-z]+="(https?:\/\/[^"]+\.(?:jpe?g|png|webp))"/i);
    items.push({
      id,
      title,
      thumbnail_url: thumbMatch ? thumbMatch[1] : "",
      page_url: `${UPSTREAM_BASE}${href}`,
    });
  }
  return items;
}

/** Extract the inline DPlayer config from a video page. */
export function parseVideoPage(html: string, id: string): ResolvedStream | null {
  const cfgMatch = html.match(/data-config='([^']+)'/);
  if (!cfgMatch) return null;
  try {
    const cfg = JSON.parse(cfgMatch[1]) as {
      live?: boolean;
      video?: { url?: string; pic?: string | null };
    };
    const url = cfg.video?.url;
    if (!url || !/^https?:\/\//.test(url)) return null;
    return {
      id,
      m3u8_url: url,
      poster_url: cfg.video?.pic ?? null,
      live: cfg.live === true,
    };
  } catch {
    return null;
  }
}

const router = Router();

/**
 * Persist the scraped catalogue to Supabase (fire-and-forget).
 * Upserts every seen stream and deactivates ids that vanished upstream, so
 * the Watch Live page has a DB fallback when the upstream is unreachable.
 */
function persistStreamsToSupabase(streams: LiveStreamItem[]): void {
  if (!supabase) return;
  const rows = streams.map((s) => ({
    id: Number(s.id),
    title: s.title,
    thumbnail_url: s.thumbnail_url || null,
    quality_label: qualityCache.get(s.id)?.value.label ?? null,
    quality_width: qualityCache.get(s.id)?.value.width ?? null,
    quality_height: qualityCache.get(s.id)?.value.height ?? null,
    active: true,
    last_seen_at: new Date().toISOString(),
  }));
  void (async () => {
    await supabase.from("live_streams").upsert(rows, { onConflict: "id" });
    // deactivate anything not in this scrape
    await supabase
      .from("live_streams")
      .update({ active: false })
      .not("id", "in", `(${rows.map((r) => r.id).join(",")})`);
  })().catch(() => {}); // best-effort — never break the response over this
}

async function loadStreamsFromSupabase(): Promise<LiveStreamItem[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("live_streams")
      .select("id,title,thumbnail_url,quality_label")
      .eq("active", true)
      .order("last_seen_at", { ascending: false })
      .limit(200);
    if (error || !data || data.length === 0) return null;
    return data.map((row) => ({
      id: String(row.id),
      title: row.title ?? "",
      thumbnail_url: row.thumbnail_url ?? "",
      page_url: `${UPSTREAM_BASE}/category/sstp/video/${row.id}/`,
      quality_label: row.quality_label ?? null,
    }));
  } catch {
    return null;
  }
}

// ─── English titles (machine translation) ────────────────────────────────
// Upstream titles are Chinese; translate once per video with the free Google
// translate endpoint, cache in memory + Redis (7d) + Supabase (forever).

const titleCache = new Map<string, CacheEntry<string>>();
const TITLE_TTL_MS = 7 * 24 * 60 * 60_000;

async function translateTitle(title: string): Promise<string | null> {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=" +
    encodeURIComponent(title.slice(0, 400));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`translate ${res.status}`);
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    const parts = (data[0] as Array<[string | null, ...unknown[]]>)
      .map((p) => p?.[0] ?? "")
      .join("");
    const out = parts.trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface TitleJob {
  id: string;
  title: string;
}

const titlePending = new Set<string>();
let titleActive = 0;
const TITLE_MAX_CONCURRENT = 2;
const titleQueue: TitleJob[] = [];

function pumpTitleQueue(): void {
  while (titleActive < TITLE_MAX_CONCURRENT && titleQueue.length > 0) {
    const job = titleQueue.shift()!;
    titleActive += 1;
    translateTitle(job.title)
      .then((en) => {
        if (!en) return; // leave uncached; a later pass retries
        titleCache.set(job.id, { value: en, at: Date.now() });
        redisSetJson(`title:${job.id}`, en, 7 * 24 * 60 * 60);
        if (supabase) {
          void supabase
            .from("live_streams")
            .update({ title_en: en })
            .eq("id", Number(job.id))
            .then(null, () => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        titleActive -= 1;
        titlePending.delete(job.id);
        setTimeout(pumpTitleQueue, 250); // small gap — be polite to the endpoint
      });
  }
}

function enqueueTitleTranslations(streams: LiveStreamItem[]): void {
  for (const s of streams) {
    if (!s.title || titleCache.has(s.id) || titlePending.has(s.id)) continue;
    titlePending.add(s.id);
    // seed from Redis first (a translation done by any instance counts);
    // only queue an upstream translation when Redis has nothing.
    void (async () => {
      try {
        const fromRedis = await redisGetJson<string>(`title:${s.id}`);
        if (fromRedis) {
          titleCache.set(s.id, { value: fromRedis, at: Date.now() });
          return;
        }
      } catch {
        /* fall through to queue */
      }
      titleQueue.push({ id: s.id, title: s.title });
      pumpTitleQueue();
    })();
  }
}

// GET /api/live/streams — every stream from all live-tab pages.
// Cache tiers: memory (60s) → Redis (shared, 90s) → upstream scrape.
router.get("/live/streams", async (req, res) => {
  // Cloudflare edge: short s-maxage absorbs bursts; SWR hides refetches.
  res.setHeader("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");

  const cached = getCached(listCache, "list", LIST_CACHE_TTL_MS);
  if (cached) {
    res.json({ streams: withQuality(cached), cached: true });
    return;
  }

  const fromRedis = await redisGetJson<LiveStreamItem[]>("streams");
  if (fromRedis && fromRedis.length > 0) {
    setCached(listCache, "list", fromRedis);
    res.json({ streams: withQuality(fromRedis), cached: true });
    return;
  }

  try {
    const streams = await scrapeAllLive();
    if (streams.length === 0) throw new Error("no cards parsed");
    setCached(listCache, "list", streams);
    redisSetJson("streams", streams, 90);
    persistStreamsToSupabase(streams);
    res.json({ streams: withQuality(streams), cached: false });
  } catch (err) {
    // Stale-on-error: memory first, then the DB catalogue as last resort.
    const stale = getCached(listCache, "list", STALE_SERVE_MS);
    if (stale) {
      res.json({ streams: withQuality(stale), cached: true, stale: true });
      return;
    }
    const fromDb = await loadStreamsFromSupabase();
    if (fromDb) {
      res.json({ streams: fromDb, cached: true, stale: true, source: "db" });
      return;
    }
    req.log?.error?.({ err }, "live streams scrape failed");
    res.status(502).json({ error: "Failed to fetch live streams" });
  }

  function withQuality(list: LiveStreamItem[]): LiveStreamItem[] {
    // Attach known quality labels + English titles + remux status and queue
    // background probes/translations for the rest; the feed's periodic
    // refetch picks them up as they land.
    const out = list.map((s) => ({
      ...s,
      quality_label: qualityCache.get(s.id)?.value.label ?? null,
      title_en: titleCache.get(s.id)?.value ?? null,
      remux_ready: getRemuxStatus(s.id).status === "ready",
    }));
    enqueueQualityProbes(list);
    enqueueTitleTranslations(list);
    // Idempotent: queues any catalogue video that doesn't have a finished
    // remux yet. Runs on every response path (fresh scrape, cache, stale,
    // DB fallback) so the warmer can never be missed.
    warmCatalogue(list.map((s) => s.id));
    return out;
  }
});

/**
 * Scrape ALL live-tab pages (the upstream paginates at 20 cards/page —
 * /live/2/, /live/3/, … until a page adds nothing new or runs short).
 * Verified 2026-11-26: 62 streams across 4 pages. The 热门推荐 hot tab is
 * deliberately NOT merged — 21 of its 23 entries duplicate live-tab videos.
 */
async function scrapeAllLive(): Promise<LiveStreamItem[]> {
  const byId = new Map<string, LiveStreamItem>();
  const MAX_PAGES = 30; // hard stop against a pagination loop
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? LIVE_TAB_URL : LIVE_PAGE_URL(page);
    const html = await fetchUpstream(url);
    const items = parseLiveTab(html);
    const before = byId.size;
    for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
    // Stop when a page adds nothing new (past the end) or runs short (last page).
    if (byId.size === before || items.length < 20) break;
  }
  return Array.from(byId.values());
}

// GET /api/live/thumb?url=<pic.biacea.cn image> — fetch + AES-decrypt a cover.
// Host-restricted (no open proxy); decrypted bytes are plain JPEG.
// Cache tiers: memory (10min) → Redis (shared, 6h) → upstream.
// Cloudflare edge: covers are immutable per URL — cache a full day at the
// edge (s-maxage) so repeat visitors never touch the origin.
router.get("/live/thumb", async (req, res) => {
  const raw = typeof req.query.url === "string" ? req.query.url : "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    res.status(400).json({ error: "Invalid url" });
    return;
  }
  if (parsed.protocol !== "https:" || !IMAGE_HOSTS.has(parsed.hostname)) {
    res.status(400).json({ error: "Host not allowed" });
    return;
  }

  const serve = (buf: Buffer, cacheHeader: string) => {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", cacheHeader);
    res.end(buf);
  };

  // Optional server-side downscale (grid cards don't need 1080p covers).
  const rawWidth = typeof req.query.w === "string" ? req.query.w : "";
  const width =
    /^\d{2,4}$/.test(rawWidth) && !rawWidth.startsWith("0")
      ? Math.min(2000, Math.max(160, parseInt(rawWidth, 10)))
      : null;
  const cacheKey = width ? `thumb:${parsed.toString()}|w${width}` : `thumb:${parsed.toString()}`;

  const memCached = thumbCache.get(cacheKey);
  if (memCached && Date.now() - memCached.at < THUMB_CACHE_TTL_MS) {
    serve(memCached.value, THUMB_CACHE_HEADER);
    return;
  }

  const redisCached = await redisGetBlob(cacheKey);
  if (redisCached) {
    setThumbCache(cacheKey, redisCached);
    serve(redisCached, THUMB_CACHE_HEADER);
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let buf: Buffer;
    try {
      const upstream = await fetch(parsed.toString(), {
        headers: { "User-Agent": BROWSER_UA, Accept: "image/*,*/*" },
        signal: controller.signal,
      });
      if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
      buf = Buffer.from(await upstream.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
    let plain = decryptImage(buf);
    if (width) {
      try {
        // sharp is a native module kept OUTSIDE the esbuild bundle (same as
        // the media proxy) — dynamic import keeps the build clean.
        const { default: sharp } = await import("sharp");
        plain = await sharp(plain, { failOn: "none" })
          .resize({ width, withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();
      } catch (resizeErr) {
        req.log?.warn?.({ err: resizeErr }, "live thumb resize failed; serving original");
      }
    }
    setThumbCache(cacheKey, plain);
    redisSetBlob(cacheKey, plain, 6 * 60 * 60);
    serve(plain, THUMB_CACHE_HEADER);
  } catch (err) {
    req.log?.error?.({ err }, "live thumb failed");
    res.status(502).json({ error: "Failed to fetch thumbnail" });
  }
});

// GET /api/live/resolve?id=19897 — resolve one video to its signed HLS manifest.
// Cache tiers: memory (45s) → Redis (shared, 60s) → upstream page fetch.
router.get("/live/resolve", async (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
  const id = typeof req.query.id === "string" ? req.query.id : "";
  if (!/^\d{1,7}$/.test(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const fresh = req.query.fresh === "1"; // self-healing: bypass caches
  const cached = fresh ? null : getCached(resolveCache, id, RESOLVE_CACHE_TTL_MS);
  if (cached) {
    res.json({ stream: cached, cached: true, remux: remuxInfo(id) });
    return;
  }
  const fromRedis = fresh ? null : await redisGetJson<ResolvedStream>(`resolve:${id}`);
  if (fromRedis && fromRedis.m3u8_url) {
    setCached(resolveCache, id, fromRedis);
    res.json({ stream: fromRedis, cached: true, remux: remuxInfo(id) });
    return;
  }
  try {
    const html = await fetchUpstream(VIDEO_PAGE_URL(id));
    const stream = parseVideoPage(html, id);
    if (!stream) throw new Error("no player config found");
    stream.title_en = titleCache.get(id)?.value ?? null;
    setCached(resolveCache, id, stream);
    redisSetJson(`resolve:${id}`, stream, 60);
    // Kick off the server-side remux (silence-filled clean HLS) — the first
    // viewer watches the upstream feed with the stall watchdog; once the
    // remux lands, everyone gets the smooth local stream.
    ensureRemux(id);
    res.json({ stream, cached: false, remux: remuxInfo(id) });
  } catch (err) {
    const stale = getCached(resolveCache, id, STALE_SERVE_MS);
    if (stale) {
      res.json({ stream: stale, cached: true, stale: true, remux: remuxInfo(id) });
      return;
    }
    req.log?.error?.({ err, id }, "live resolve failed");
    res.status(502).json({ error: "Failed to resolve stream" });
  }
});

function remuxInfo(id: string): { status: string; url?: string } {
  const st = getRemuxStatus(id);
  return st.status === "ready"
    ? { status: "ready", url: `/api/live/hls/${id}/index.m3u8` }
    : { status: st.status };
}

// GET /api/live/hls/:id/:file — serve the remuxed (silence-filled) local HLS.
// Content is immutable per video: cache hard at the edge and in the browser.
router.get("/live/hls/:id/:file", (req, res) => {
  const { id, file } = req.params;
  const f = openRemuxFile(id, file);
  if (!f) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", f.type);
  res.setHeader("Content-Length", String(f.size));
  res.setHeader(
    "Cache-Control",
    file.endsWith(".m3u8")
      ? "public, max-age=300, s-maxage=86400"
      : "public, max-age=604800, s-maxage=2592000, immutable",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  f.stream.pipe(res);
});

// GET /api/live/live-thumb/:id — a REAL live thumbnail: a frame grabbed from
// the remuxed stream at the current broadcast position (same clock formula
// the player uses), so the grid shows what each feed is showing NOW.
// One frame per 2-minute bucket, single-flight per bucket, ffmpeg on local
// files (fast seek). Falls back to the static cover when the remux isn't
// ready yet — the client passes it as `fallback`.
const liveThumbCache = new Map<
  string,
  { buffer: Buffer; expires: number }
>();
const liveThumbInflight = new Map<string, Promise<Buffer | null>>();
let liveThumbActive = 0;
const liveThumbQueue: Array<() => void> = [];

async function extractLiveFrame(
  id: string,
  posSec: number,
): Promise<Buffer | null> {
  const dir = path.join(
    process.env.LIVE_REMUX_DIR ?? path.resolve(process.cwd(), "remux-cache"),
    id,
  );
  if (!existsSync(path.join(dir, "index.m3u8"))) return null;
  return new Promise((resolve) => {
    const proc = spawn(
      "ffmpeg",
      [
        "-v", "error",
        "-ss", posSec.toFixed(1),
        "-i", "index.m3u8",
        "-frames:v", "1",
        "-vf", "scale=640:-2",
        "-q:v", "4",
        "-f", "image2pipe",
        "-c:v", "mjpeg",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "ignore"], cwd: dir },
    );
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      const buf = Buffer.concat(chunks);
      resolve(code === 0 && buf.length > 1000 ? buf : null);
    });
    setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    }, 10_000);
  });
}

router.get("/live/live-thumb/:id", async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!/^\d{1,7}$/.test(id)) {
    res.status(400).end();
    return;
  }
  const fallback =
    typeof req.query.fallback === "string" ? req.query.fallback : "";
  const st = getRemuxStatus(id);
  if (st.status !== "ready") {
    if (fallback) {
      res.redirect(`/api/live/thumb?url=${encodeURIComponent(fallback)}&w=640`);
    } else {
      res.status(404).end();
    }
    return;
  }
  // Same broadcast-position formula the player uses → the thumbnail shows
  // exactly what a viewer joining now would see.
  const dur = getRemuxDuration(id) || 3600;
  const pos = (Date.now() / 1000) % dur;
  const bucket = Math.floor(pos / 120); // 2-minute thumbnail granularity
  const key = `${id}:${bucket}`;
  const cached = liveThumbCache.get(key);
  if (cached && cached.expires > Date.now()) {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.end(cached.buffer);
    return;
  }
  const existing = liveThumbInflight.get(key);
  const job =
    existing ??
    (async () => {
      // limit concurrent ffmpeg frame extractions
      if (liveThumbActive >= 2) {
        await new Promise<void>((r) => liveThumbQueue.push(r));
      }
      liveThumbActive += 1;
      try {
        const buf = await extractLiveFrame(id, pos);
        if (buf) {
          liveThumbCache.set(key, { buffer: buf, expires: Date.now() + 120_000 });
        }
        return buf;
      } finally {
        liveThumbActive -= 1;
        const next = liveThumbQueue.shift();
        if (next) next();
      }
    })();
  if (!existing) liveThumbInflight.set(key, job);
  try {
    const buf = await job;
    if (buf) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=60");
      res.end(buf);
      return;
    }
  } finally {
    liveThumbInflight.delete(key);
  }
  if (fallback) {
    res.redirect(`/api/live/thumb?url=${encodeURIComponent(fallback)}&w=640`);
  } else {
    res.status(404).end();
  }
});

export default router;
