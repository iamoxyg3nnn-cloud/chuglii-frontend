/** Shared helpers for deciding how a scraped stream should be played. */

const DIRECT_VIDEO_PATH = /\.(mp4|webm)$/i;

/** True for native browser-playable files, including URLs with query tokens. */
export function isDirectVideoUrl(value?: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value, typeof window === "undefined" ? "http://localhost" : window.location.href);
    return DIRECT_VIDEO_PATH.test(url.pathname);
  } catch {
    return DIRECT_VIDEO_PATH.test(value.split("?")[0]);
  }
}

/** Builds the edge player URL while preserving metadata used by its renderers. */
export function buildEdgePlayerUrl(
  rawUrl: string,
  options: {
    title?: string;
    poster?: string;
    detail?: string;
    /** Ordered alternate stream endpoints (api.php or m3u8) for player failover. */
    fallbacks?: string[];
  } = {},
): string {
  const params = new URLSearchParams({ url: rawUrl });
  if (options.title) params.set("title", options.title);
  if (options.poster) params.set("poster", options.poster);
  if (options.detail) params.set("detail", options.detail);
  if (options.fallbacks && options.fallbacks.length > 0) {
    params.set("fallbacks", JSON.stringify(options.fallbacks));
  }
  return `/api/player?${params.toString()}`;
}

export interface ResolvedStream {
  url: string;
  fallbackUrl?: string;
  rawUrl?: string;
  type?: string;
  quality?: number;
  label?: string;
}

/** Builds the edge resolver URL used to refresh rotating AVS MP4 links. */
export function buildEdgeResolveUrl(
  rawUrl: string,
  options: {
    title?: string;
    poster?: string;
    embed?: string;
    detail?: string;
  } = {},
): string {
  const params = new URLSearchParams({ url: rawUrl });
  if (options.title) params.set("title", options.title);
  if (options.poster) params.set("poster", options.poster);
  if (options.embed) params.set("embed", options.embed);
  if (options.detail) params.set("detail", options.detail);
  return `/api/player/resolve?${params.toString()}`;
}

function isUsableStreamUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value, typeof window === "undefined" ? "http://localhost" : window.location.href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Fetches fresh direct stream candidates for the native player. */
export async function resolveEdgeStreams(
  rawUrl: string,
  options: {
    title?: string;
    poster?: string;
    embed?: string;
    detail?: string;
  } = {},
  signal?: AbortSignal,
): Promise<ResolvedStream[]> {
  const response = await fetch(buildEdgeResolveUrl(rawUrl, options), { signal });
  if (!response.ok) return [];
  const payload = (await response.json()) as { streams?: unknown };
  if (!Array.isArray(payload.streams)) return [];
  const streams: ResolvedStream[] = [];
  for (const item of payload.streams) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as ResolvedStream;
    if (!isUsableStreamUrl(candidate.url)) continue;
    const fallbackUrl = isUsableStreamUrl(candidate.fallbackUrl) ? candidate.fallbackUrl : undefined;
    if (!streams.some((s) => s.url === candidate.url)) {
      streams.push({
        url: candidate.url,
        fallbackUrl,
        rawUrl: candidate.rawUrl,
        type: candidate.type,
        quality: candidate.quality,
        label: candidate.label,
      });
    }
    if (fallbackUrl && !streams.some((s) => s.url === fallbackUrl)) {
      streams.push({
        url: fallbackUrl,
        rawUrl: candidate.rawUrl || candidate.url,
        type: candidate.type,
        quality: candidate.quality,
        label: candidate.label ? `${candidate.label} (proxy)` : "Proxy",
      });
    }
  }
  return streams;
}
