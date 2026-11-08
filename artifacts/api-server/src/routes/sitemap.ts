import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

/**
 * Public XML sitemap.
 *
 * The frontend is a single-page app, so a hand-written static sitemap can only
 * ever list the handful of top-level routes. This endpoint lists the real
 * catalogue instead — recent recordings, performer profiles and tag views —
 * so search engines can discover the archive's long tail.
 *
 * Served at /sitemap.xml through the Vercel rewrite in vercel.json.
 */

const router = Router();

const SITE = "https://chuglii.in";
// Caps keep the generated XML comfortably below Vercel's 4.5 MB response
// limit while still exposing the newest and most relevant long tail.
const MAX_RECORDINGS = 10_000;
const MAX_PERFORMERS = 5_000;
const MAX_TAGS = 2_500;
const PAGE_SIZE = 1_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;

interface SitemapEntry {
  loc: string;
  lastmod?: string | null;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

interface RecordingRow {
  id?: string | number | null;
  username?: string | null;
  updated_at?: string | null;
  timestamp?: string | null;
}

interface PerformerRow {
  username?: string | null;
  latest_timestamp?: string | null;
}

interface TagRow {
  tag?: string | null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Normalise any timestamp-ish value into a sitemap-compatible YYYY-MM-DD. */
function toLastmod(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function renderEntry(entry: SitemapEntry): string {
  const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];
  if (entry.lastmod) parts.push(`    <lastmod>${entry.lastmod}</lastmod>`);
  if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  if (entry.priority) parts.push(`    <priority>${entry.priority}</priority>`);
  return `  <url>\n${parts.join("\n")}\n  </url>`;
}

function buildSitemap(entries: SitemapEntry[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(renderEntry),
    "</urlset>",
    "",
  ].join("\n");
}

function coreEntries(today: string): SitemapEntry[] {
  return [
    { loc: `${SITE}/`, lastmod: today, changefreq: "daily", priority: "1.0" },
    { loc: `${SITE}/browse`, lastmod: today, changefreq: "daily", priority: "0.9" },
    { loc: `${SITE}/performers`, lastmod: today, changefreq: "daily", priority: "0.8" },
    { loc: `${SITE}/tags`, lastmod: today, changefreq: "weekly", priority: "0.7" },
    { loc: `${SITE}/premium`, lastmod: today, changefreq: "monthly", priority: "0.6" },
    { loc: `${SITE}/playlists`, lastmod: today, changefreq: "weekly", priority: "0.5" },
  ];
}

/** Newest recordings first, capped so a single sitemap stays well under 50k URLs. */
async function fetchRecordings(): Promise<RecordingRow[]> {
  const rows: RecordingRow[] = [];
  for (let start = 0; start < MAX_RECORDINGS; start += PAGE_SIZE) {
    const end = Math.min(start + PAGE_SIZE - 1, MAX_RECORDINGS - 1);
    const { data, error } = await supabase
      .from("linked_recordings")
      .select("id,username,updated_at,timestamp")
      .order("timestamp", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(start, end);
    if (error) throw error;
    rows.push(...((data ?? []) as RecordingRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchPerformers(fallbackNames: string[]): Promise<PerformerRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_performer_stats");
    if (!error && Array.isArray(data) && data.length > 0) {
      return (data as PerformerRow[]).slice(0, MAX_PERFORMERS);
    }
  } catch (err) {
    logger.warn({ err }, "sitemap: performer RPC unavailable, using recording usernames");
  }
  return fallbackNames.slice(0, MAX_PERFORMERS).map((username) => ({ username }));
}

async function fetchTags(): Promise<TagRow[]> {
  try {
    const { data, error } = await supabase.rpc("get_tag_counts");
    if (!error && Array.isArray(data)) {
      return (data as TagRow[]).slice(0, MAX_TAGS);
    }
  } catch (err) {
    logger.warn({ err }, "sitemap: tag RPC unavailable, skipping tag URLs");
  }
  return [];
}

async function generateSitemap(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const core = coreEntries(today);

  let recordings: RecordingRow[] = [];
  try {
    recordings = await fetchRecordings();
  } catch (err) {
    logger.error({ err }, "sitemap: recordings query failed");
    return buildSitemap(core);
  }

  const fallbackNames = [
    ...new Set(
      recordings
        .map((row) => row.username?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  const [performers, tags] = await Promise.all([
    fetchPerformers(fallbackNames),
    fetchTags(),
  ]);

  const entries: SitemapEntry[] = [...core];

  for (const row of recordings) {
    if (row.id == null || row.id === "") continue;
    entries.push({
      loc: `${SITE}/video/${encodeURIComponent(String(row.id))}`,
      lastmod: toLastmod(row.updated_at ?? row.timestamp),
    });
  }

  for (const row of performers) {
    const username = row.username?.trim();
    if (!username) continue;
    entries.push({
      loc: `${SITE}/performers/${encodeURIComponent(username)}`,
      lastmod: toLastmod(row.latest_timestamp),
    });
  }

  for (const row of tags) {
    const tag = row.tag?.trim();
    if (!tag) continue;
    entries.push({
      loc: `${SITE}/browse?tags=${encodeURIComponent(tag)}`,
    });
  }

  return buildSitemap(entries);
}

let cachedSitemap: { body: string; expiresAt: number } | null = null;
let inflightSitemap: Promise<string> | null = null;

async function getSitemap(): Promise<string> {
  const now = Date.now();
  if (cachedSitemap && cachedSitemap.expiresAt > now) {
    return cachedSitemap.body;
  }
  if (inflightSitemap) return inflightSitemap;

  inflightSitemap = generateSitemap()
    .then((body) => {
      cachedSitemap = { body, expiresAt: Date.now() + CACHE_TTL_MS };
      return body;
    })
    .finally(() => {
      inflightSitemap = null;
    });

  return inflightSitemap;
}

router.get(["/sitemap", "/sitemap.xml"], async (_req, res) => {
  try {
    const body = await getSitemap();
    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set(
      "Cache-Control",
      "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400, stale-if-error=86400",
    );
    res.send(body);
  } catch (err) {
    logger.error({ err }, "sitemap: generation failed");
    const today = new Date().toISOString().slice(0, 10);
    res
      .status(200)
      .type("application/xml")
      .send(buildSitemap(coreEntries(today)));
  }
});

export default router;
