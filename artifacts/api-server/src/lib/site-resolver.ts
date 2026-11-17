import { supabase } from "./supabase.js";

let siteMapCache: Map<string, string> | null = null;
let siteMapExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Loads performer -> site mapping from channel_assignments.
 * Results are cached in-memory for 5 minutes.
 */
export async function getPerformerSiteMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (siteMapCache && now < siteMapExpiry) {
    return siteMapCache;
  }

  try {
    const { data, error } = await supabase
      .from("channel_assignments")
      .select("username, site");

    if (!error && data) {
      const map = new Map<string, string>();
      for (const row of data) {
        if (row.username && row.site) {
          map.set(row.username.toLowerCase(), row.site.toLowerCase());
        }
      }
      siteMapCache = map;
      siteMapExpiry = now + CACHE_TTL_MS;
      return map;
    }
  } catch (err) {
    console.error("[site-resolver] Error fetching channel_assignments:", err);
  }

  return siteMapCache ?? new Map();
}

/**
 * Enriches recordings with their origin site ("stripchat" or "chaturbate").
 * If the recording already has a site, that is preserved.
 * Otherwise looks up the performer in channel_assignments.
 * Defaults to "chaturbate" for unmapped/legacy recordings.
 */
export async function enrichWithSite<T extends { username?: string; site?: string | null }>(
  recordings: T[],
): Promise<(T & { site: string })[]> {
  if (!recordings || recordings.length === 0) return recordings as (T & { site: string })[];
  const siteMap = await getPerformerSiteMap();
  for (const rec of recordings) {
    if (!rec.site && rec.username) {
      rec.site = siteMap.get(rec.username.toLowerCase()) ?? "chaturbate";
    } else if (!rec.site) {
      rec.site = "chaturbate";
    }
  }
  return recordings as (T & { site: string })[];
}

/**
 * Enriches a single recording with its origin site.
 */
export async function enrichSingleWithSite<T extends { username?: string; site?: string | null }>(
  recording: T,
): Promise<T & { site: string }> {
  if (!recording) return recording as T & { site: string };
  if (!recording.site && recording.username) {
    const siteMap = await getPerformerSiteMap();
    recording.site = siteMap.get(recording.username.toLowerCase()) ?? "chaturbate";
  } else if (!recording.site) {
    recording.site = "chaturbate";
  }
  return recording as T & { site: string };
}

/** Reset cache (useful for tests) */
export function _resetSiteMapCache(): void {
  siteMapCache = null;
  siteMapExpiry = 0;
}
