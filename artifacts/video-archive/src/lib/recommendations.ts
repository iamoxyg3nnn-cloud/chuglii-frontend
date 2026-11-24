/**
 * Shared recommendation ranking for watch pages.
 *
 * The old behaviour was "take the newest N videos from this site and exclude
 * the current id", which meant every video on a site showed the same cards.
 * This module ranks by shared metadata (rare tags matter more than generic
 * ones), collapses mirrored duplicates of the same clip, and uses scrape time
 * as the freshness tie-breaker.
 */

export interface RecommendationCandidate {
  id: string;
  title: string;
  source_site?: string | null;
  tags?: string[] | null;
  categories?: string[] | null;
  actors?: string[] | null;
  scraped_at?: string | null;
  views_count?: number | null;
}

function normalizeTitle(title: string | null | undefined): string {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildFrequency(values: ReadonlyArray<string | null | undefined>): Map<string, number> {
  const freq = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    const key = value.toLowerCase().trim();
    if (!key) continue;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  return freq;
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Weight shared attributes; uncommon ones are stronger signals. */
function overlapWeight(freq: Map<string, number>, value: string, max: number): number {
  const count = freq.get(value.toLowerCase().trim()) || 1;
  return Math.min(max, Math.max(1, (max * 2) / count));
}

export function rankRelatedVideos<T extends RecommendationCandidate>(
  current: T | null | undefined,
  candidates: ReadonlyArray<T>,
  limit: number,
): T[] {
  if (!current || limit <= 0 || candidates.length === 0) return [];

  const currentTitleKey = normalizeTitle(current.title);
  const currentTags = new Set((current.tags || []).map((t) => t.toLowerCase().trim()));
  const currentCategories = new Set(
    (current.categories || []).map((c) => c.toLowerCase().trim()),
  );
  const currentActors = new Set((current.actors || []).map((a) => a.toLowerCase().trim()));

  const tagFreq = buildFrequency(candidates.flatMap((v) => v.tags || []));
  const categoryFreq = buildFrequency(candidates.flatMap((v) => v.categories || []));

  const scored = candidates
    .filter((v) => v.id !== current.id && normalizeTitle(v.title) !== currentTitleKey)
    .map((video) => {
      let score = 0;
      for (const tag of new Set((video.tags || []).map((t) => t.toLowerCase().trim()))) {
        if (currentTags.has(tag)) score += overlapWeight(tagFreq, tag, 4);
      }
      for (const category of new Set(
        (video.categories || []).map((c) => c.toLowerCase().trim()),
      )) {
        if (currentCategories.has(category)) score += overlapWeight(categoryFreq, category, 3);
      }
      if ((video.actors || []).some((a) => currentActors.has(a.toLowerCase().trim()))) {
        score += 3;
      }
      if (current.source_site && video.source_site === current.source_site) score += 1;
      return { video, score };
    });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      timestamp(b.video.scraped_at) - timestamp(a.video.scraped_at) ||
      (b.video.views_count || 0) - (a.video.views_count || 0),
  );

  const seen = new Set<string>();
  const result: T[] = [];
  for (const { video } of scored) {
    const dedupeKey = normalizeTitle(video.title) || video.id;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(video);
    if (result.length >= limit) break;
  }
  return result;
}
