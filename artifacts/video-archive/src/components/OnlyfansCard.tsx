import { useState } from "react";
import { Link } from "wouter";
import { Play, Eye, ThumbsUp, Clock, BookmarkSimple, Check, Sparkle, Broadcast } from "@phosphor-icons/react";
import { proxyImageUrl } from "@/lib/proxy-url";
import { isOnlyfansSite, type OnlyfansVideo } from "@/hooks/useOnlyfansVideos";

function isLikelySignedExpired(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.searchParams.has("v-acctoken") || u.searchParams.has("token") || u.searchParams.has("expires")) return true;
  } catch {}
  return false;
}

function getPlayablePreviewUrl(video: OnlyfansVideo): string | null {
  const rawPayload = video.raw_payload as Record<string, any> | undefined;
  const directServers = [...(rawPayload?.servers || []), ...(rawPayload?.mirrors || [])]
    .filter((server: any) => ["direct_mp4", "direct_webm"].includes(String(server?.type || "").toLowerCase()))
    .sort((a: any, b: any) => (b?.quality_score || 0) - (a?.quality_score || 0))
    .map((server: any) => server?.embed_url || server?.url);
  const candidates = [
    rawPayload?.preview_video_url,
    rawPayload?.preview_url,
    rawPayload?.hover_preview_url,
    video.trailer_preview_url,
    ...directServers,
  ];
  // PimpBunny preview endpoints are often shield-blocked; only use
  // trailer/direct candidates. Do not fall back to full_video_url for hover.
  // If nothing is available, we resolve a fresh signed direct stream on hover.
  if (video.source_site !== "pimpbunny") {
    candidates.push(video.full_video_url);
  }

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      const url = new URL(candidate);
      if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) continue;
      if (!/\.(mp4|webm|webp|gif|jpg|jpeg|png|mp4_preview)(?:[/?#]|$)/i.test(url.pathname + url.search)) continue;
      // Stored signed PimpBunny URLs expire quickly; avoid dead hover previews.
      if (video.source_site === "pimpbunny" && isLikelySignedExpired(url.href)) continue;
      return url.href;
    } catch {
      // Ignore non-absolute or malformed URLs from stored source metadata.
    }
  }
  return null;
}

function getHoverMediaUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // PimpBunny direct get_file media rejects cross-origin referers; do not
    // route through /api/player/stream (can be Bunny Shield-blocked and leaks
    // referer on redirect). The video element uses referrerPolicy=no-referrer.
    if ((parsed.hostname === "pimpbunny.com" || parsed.hostname.endsWith(".pimpbunny.com")) &&
        /\/get_file\/.+\.(mp4|m3u8|webm)(\/|$)/i.test(parsed.pathname)) {
      return url;
    }
    if (parsed.hostname === "pimpbunny.com" || parsed.hostname.endsWith(".pimpbunny.com")) {
      return `/api/player/stream?url=${encodeURIComponent(url)}`;
    }
  } catch {}
  return url;
}

interface OnlyfansCardProps {
  video: OnlyfansVideo;
  isSaved?: boolean;
  onToggleSave?: (id: string) => void;
}

export function OnlyfansCard({ video, isSaved = false, onToggleSave }: OnlyfansCardProps) {
  const [imageError, setImageError] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  const getRawThumb = (): string => {
    if (imageError) return "/placeholder-thumb.jpg";
    const raw = video.clean_thumbnail_url || video.thumbnail_url;
    if (raw && !raw.startsWith("data:")) {
      return raw;
    }
    // If thumbnail was a base64 placeholder, derive from SheeshFans video post ID
    if (video.source_site === "sheeshfans" && video.source_post_id) {
      const pid = parseInt(video.source_post_id, 10);
      if (!isNaN(pid) && pid > 0) {
        const folder = Math.floor(pid / 1000) * 1000;
        return `https://sheeshfans.com/contents/videos_screenshots/${folder}/${pid}/preview.jpg`;
      }
    }
    return "/placeholder-thumb.jpg";
  };

  const thumbUrl = getRawThumb();

  const proxiedThumb = thumbUrl.startsWith("http")
    ? (proxyImageUrl(thumbUrl) || thumbUrl)
    : thumbUrl;

  const [resolvedPreview, setResolvedPreview] = useState<string | null>(null);
  const previewUrl = resolvedPreview || getPlayablePreviewUrl(video);
  const previewMediaUrl = previewUrl ? getHoverMediaUrl(previewUrl) : null;
  const previewIsImage = !!previewUrl && /\.(webp|jpg|jpeg|png|gif|mp4_preview)$/i.test(new URL(previewUrl).pathname);

  const resolvePimpbunnyPreview = async () => {
    if (resolvedPreview || previewFailed) return;
    if (video.source_site !== "pimpbunny" || !video.detail_url) return;
    // Prefer any non-expired playable candidate; otherwise resolve fresh signed stream.
    if (getPlayablePreviewUrl(video)) return;
    try {
      const resp = await fetch(`/api/player?url=${encodeURIComponent(video.detail_url)}&format=json`, {
        headers: { Accept: "application/json" },
        redirect: "manual",
        cache: "no-store",
      });
      const ct = resp.headers.get("content-type") || "";
      if (resp.ok && ct.includes("application/json")) {
        const data = await resp.json().catch(() => null);
        const streams = Array.isArray(data?.streams) ? data.streams : [];
        const best = [...streams]
          .filter((s: any) => typeof s?.url === "string" && /\.(mp4|webm)(?:[/?#]|$)/i.test(s.url))
          .sort((a: any, b: any) => (Number(b?.quality) || 0) - (Number(a?.quality) || 0))[0];
        if (best?.url) {
          setResolvedPreview(String(best.url));
          return;
        }
      }
      // Worker resolve can be Bunny Shield-blocked; try direct browser fetch with no-referrer.
      const pageResp = await fetch(video.detail_url, { referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store" });
      if (!pageResp.ok) return;
      const html = await pageResp.text();
      const matches = html.matchAll(/(?:['"]?(?:video_url|video_alt_url\d*)(?:_text)?['"]?)\s*[:=]\s*(['"])(.*?)\1/gi);
      const candidates: Array<{url:string;quality:number}> = [];
      for (const m of matches) {
        let u = (m[2] || "").replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&").trim();
        if (!u || !/pimpbunny\.com\/get_file\/.+\.(mp4|webm)/i.test(u)) continue;
        try { u = new URL(u, video.detail_url).toString(); } catch { continue; }
        const qm = u.match(/(?<!\d)(2160|1440|1080|720|480|360)p?(?!\d)/i);
        candidates.push({ url: u, quality: qm ? Number(qm[1]) : 0 });
      }
      const bestDirect = candidates.sort((a,b)=>b.quality-a.quality)[0];
      if (bestDirect?.url) setResolvedPreview(bestDirect.url);
    } catch {
      // ignore; hover preview is non-critical
    }
  };

  const handleSaveClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onToggleSave) {
      onToggleSave(video.id);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    }
  };

  const modelName = video.actors?.[0] || video.raw_payload?.model || "";
  const rawServers = video.raw_payload?.servers || video.raw_payload?.mirrors || [];
  const mirrorCount = rawServers.length > 0 ? rawServers.length : (video.full_video_url ? 1 : 0);
  const parseQ = (v: unknown) => {
    const s = String(v || "");
    const m = s.match(/(?<!\d)(2160|1440|1080|720|480|360)p?(?!\d)/i);
    return m ? parseInt(m[1], 10) : 0;
  };
  const formatQuality = (raw: unknown, url?: string) => {
    const text = String(raw || "").trim();
    const n = parseQ(text) || parseQ(url);
    if (n >= 2160) return "4K";
    if (n > 0) return `${n}p`;
    if (/^https?:\/\//i.test(text)) return "Original";
    return text || "HD";
  };
  const isPimpBunnySourcePlayer = video.source_site === "pimpbunny" && (
    video.video_mime_type?.toLowerCase() === "embed/iframe" ||
    /\/embed\//i.test(video.full_video_url || "") ||
    rawServers.some((server: any) => String(server?.type || "").toLowerCase() === "iframe")
  );
  const bestServer = [...rawServers].sort((a:any,b:any)=>{
    const qa = parseQ(a?.quality_label) || parseQ(a?.name) || parseQ(a?.embed_url) || (a?.quality_score||0);
    const qb = parseQ(b?.quality_label) || parseQ(b?.name) || parseQ(b?.embed_url) || (b?.quality_score||0);
    return qb-qa;
  })[0];
  const quality = isPimpBunnySourcePlayer ? "Source player" : formatQuality(
    bestServer?.quality_label || bestServer?.name || video.quality_label,
    bestServer?.embed_url || bestServer?.url || video.full_video_url || undefined
  );
  const watchHref = isOnlyfansSite(video.source_site)
    ? `/onlyfans/${video.source_site}/video/${video.id}`
    : "/onlyfans";
  const is4K = quality.includes("4K") || (video.quality_score && video.quality_score >= 2000);
  const is1080p = quality.includes("1080p") || (video.quality_score && video.quality_score >= 1000 && video.quality_score < 2000);

  return (
    <div className="group relative flex flex-col rounded-2xl bg-card/60 border border-border/40 overflow-hidden hover:border-cyan-500/50 hover:shadow-xl hover:shadow-cyan-500/5 transition-all duration-300">
      <Link
        href={watchHref}
        onMouseEnter={() => {
          setIsHovered(true);
          setPreviewReady(false);
          setPreviewFailed(false);
          void resolvePimpbunnyPreview();
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          setPreviewReady(false);
        }}
        onFocus={() => {
          setIsHovered(true);
          setPreviewReady(false);
          void resolvePimpbunnyPreview();
        }}
        onBlur={() => setIsHovered(false)}
      >
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted/40 cursor-pointer">
          <img
            src={proxiedThumb}
            alt={video.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className={`absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out ${isHovered && previewReady ? "opacity-0" : "opacity-100"}`}
          />

          {isHovered && previewMediaUrl && !previewFailed && (
            previewIsImage ? (
              <img
                src={previewMediaUrl}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                onLoad={() => setPreviewReady(true)}
                onError={() => setPreviewFailed(true)}
                className={`absolute inset-0 z-10 h-full w-full object-cover transition-opacity duration-200 ${previewReady ? "opacity-100" : "opacity-0"}`}
              />
            ) : (
              <video
                src={previewMediaUrl}
                aria-hidden="true"
                tabIndex={-1}
                autoPlay
                muted
                loop
                {...({ referrerPolicy: "no-referrer" } as any)}
                playsInline
                preload="none"
                onCanPlay={() => setPreviewReady(true)}
                onError={() => setPreviewFailed(true)}
                className={`absolute inset-0 z-10 h-full w-full object-cover transition-opacity duration-200 ${previewReady ? "opacity-100" : "opacity-0"}`}
              />
            )
          )}

          <div className="absolute inset-0 z-20 bg-gradient-to-t from-black/85 via-black/20 to-black/30 opacity-80 group-hover:opacity-60 transition-opacity" />

          {/* Quality Badge (Promoting 4K UHD or 1080p) */}
          <div className="absolute top-2.5 left-2.5 z-30 flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider backdrop-blur-md shadow-sm ${
                is4K
                  ? "bg-amber-500/90 text-black font-extrabold"
                  : is1080p
                  ? "bg-cyan-500/90 text-white"
                  : "bg-blue-600/80 text-white"
              }`}
            >
              {is4K ? "4K UHD" : is1080p ? "1080p FHD" : quality}
            </span>

            {mirrorCount > 1 && (
              <span className="px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[10px] font-medium text-cyan-300 border border-cyan-500/30">
                {mirrorCount} mirrors
              </span>
            )}
          </div>

          {/* Save / Favorite Action */}
          <button
            onClick={handleSaveClick}
            className={`absolute top-2.5 right-2.5 z-30 p-1.5 rounded-lg backdrop-blur-md transition-all ${
              isSaved
                ? "bg-cyan-500 text-white"
                : "bg-black/40 text-white/80 hover:bg-black/70 hover:text-white"
            }`}
            title={isSaved ? "Saved" : "Save video"}
          >
            {justSaved ? <Check size={14} weight="bold" /> : <BookmarkSimple size={14} weight={isSaved ? "fill" : "bold"} />}
          </button>

          {/* Center Play Button Overlay */}
          <div className="absolute inset-0 z-30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="w-12 h-12 rounded-full bg-cyan-500 text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
              <Play size={20} weight="fill" className="translate-x-0.5" />
            </div>
          </div>

          {/* Duration Badge */}
          {video.duration_formatted && video.duration_formatted !== "0:00" && video.duration_formatted !== "00:00" && (
            <div className="absolute bottom-2.5 right-2.5 z-30 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-[11px] font-medium text-white flex items-center gap-1">
              <Clock size={11} weight="bold" />
              <span>{video.duration_formatted}</span>
            </div>
          )}
        </div>
      </Link>

      {/* Card Info */}
      <div className="flex flex-col flex-1 p-3.5">
        <Link href={watchHref}>
          <h3
            className="text-sm font-semibold text-foreground line-clamp-2 leading-snug group-hover:text-cyan-400 transition-colors cursor-pointer mb-2"
            title={video.title}
          >
            {video.title}
          </h3>
        </Link>

        {/* Model Badge */}
        {modelName && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              @{modelName}
            </span>
          </div>
        )}

        {/* Card Footer: Source site & views */}
        <div className="mt-auto pt-2 flex items-center justify-between text-xs text-muted-foreground/80 border-t border-border/30">
          <span className="capitalize text-[11px] font-medium text-muted-foreground/70">
            {video.source_site}
          </span>

          <div className="flex items-center gap-2.5">
            {video.views_count > 0 && (
              <span className="flex items-center gap-1 text-[11px]">
                <Eye size={12} />
                <span>{video.views_raw || video.views_count.toLocaleString()}</span>
              </span>
            )}
            {video.rating_score && video.rating_score > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-amber-400">
                <ThumbsUp size={12} weight="fill" />
                <span>{video.rating_score}%</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function OnlyfansCardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl bg-card/60 border border-border/40 overflow-hidden animate-pulse">
      <div className="aspect-[16/10] w-full bg-muted/60" />
      <div className="p-3.5 space-y-2">
        <div className="h-4 bg-muted/60 rounded w-4/5" />
        <div className="h-3 bg-muted/40 rounded w-2/5" />
        <div className="pt-2 flex justify-between">
          <div className="h-3 bg-muted/40 rounded w-1/4" />
          <div className="h-3 bg-muted/40 rounded w-1/4" />
        </div>
      </div>
    </div>
  );
}
