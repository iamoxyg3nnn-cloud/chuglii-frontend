import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { Eye, Clock, BookmarkSimple, Check, ThumbsUp, Play } from "@phosphor-icons/react";
import { formatRelativeTime, formatViewers } from "@/lib/formatters";
import type { ScrapedVideo, ViralMmsSite } from "@/hooks/useScrapedVideos";

function toMediaProxyUrl(raw: string): string {
  return raw.startsWith("http") ? `/api/media?url=${encodeURIComponent(raw)}` : raw;
}

function toPreviewStreamUrl(raw: string): string {
  const low = raw.toLowerCase();
  if (low.includes("spicymms.com") || low.includes("indianbfclips.com")) {
    return `/api/player/stream?url=${encodeURIComponent(raw)}`;
  }
  return raw;
}

interface LeakCardProps {
  video: ScrapedVideo;
  site?: ViralMmsSite;
  isSaved?: boolean;
  onToggleSave?: (id: string) => void;
}

export function LeakCard({ video, site, isSaved = false, onToggleSave }: LeakCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const rawPreviewFrames = ((video.raw_payload as any)?.media?.preview_frames ?? []) as unknown[];
  const previewFrames = Array.isArray(rawPreviewFrames)
    ? rawPreviewFrames.filter((u): u is string => typeof u === "string" && u.length > 0).map(toMediaProxyUrl)
    : [];

  useEffect(() => {
    if (!isHovered || previewFrames.length <= 1 || video.trailer_preview_url) {
      setFrameIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % previewFrames.length);
    }, 550);
    return () => clearInterval(timer);
  }, [isHovered, previewFrames.length, video.trailer_preview_url]);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true);
    }, 200);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(false);
    setFrameIndex(0);
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

  const rawThumb = video.clean_thumbnail_url || video.thumbnail_url || "";
  const baseThumbUrl = imageError || !rawThumb
    ? "/placeholder-thumb.jpg"
    : toMediaProxyUrl(rawThumb);
  const thumbUrl = isHovered && previewFrames.length > 1
    ? previewFrames[frameIndex] || baseThumbUrl
    : baseThumbUrl;

  // Derive a clean badge label (category or primary tag)
  const categoryBadge = video.categories?.find((c) => c !== "viral-mms") || video.tags?.[0] || "Viral";

  // Freshly ingested clips should stand out even when their source publish
  // date is old (historical backfills).
  const isRecentlyScraped = Boolean(
    video.scraped_at && Date.now() - new Date(video.scraped_at).getTime() < 48 * 60 * 60 * 1000,
  );

  const targetHref = site && site !== "mmsvibex"
    ? `/leak/${site}/video/${video.id}`
    : `/leak/video/${video.id}`;

  return (
    <Link
      href={targetHref}
      className="group block select-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="space-y-2">
        {/* Aspect-video Media Thumbnail Container (matching homepage VideoCard) */}
        <div className="relative aspect-video rounded-lg overflow-hidden bg-muted/60 mb-2 border border-border/20 group-hover:border-primary/40 transition-colors">
          {isHovered && video.trailer_preview_url ? (
            <video
              src={toPreviewStreamUrl(video.trailer_preview_url)}
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
            />
          ) : (
            <img
              src={thumbUrl}
              alt={video.title}
              loading="lazy"
              onError={() => setImageError(true)}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          )}

          {/* Top-left: Stream & Category badges */}
          <div className="absolute top-2 left-2 flex items-center gap-1 pointer-events-none z-10">
            {isRecentlyScraped && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-white bg-emerald-500/90 px-1.5 py-0.5 rounded-md ring-1 ring-white/15">
                New
              </span>
            )}
            {video.full_video_url && (
              <span className="text-[10px] font-semibold text-white/95 bg-black/60 backdrop-blur-md ring-1 ring-white/10 px-1.5 py-0.5 rounded-md">
                HD
              </span>
            )}
            <span className="text-[10px] font-medium text-white/80 bg-black/60 backdrop-blur-md ring-1 ring-white/10 px-1.5 py-0.5 rounded-md capitalize">
              {categoryBadge.replace(/-/g, " ")}
            </span>
          </div>

          {/* Top-right: Bookmark / Save Action */}
          <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5">
            <button
              onClick={handleSaveClick}
              className={`w-7 h-7 flex items-center justify-center rounded-md backdrop-blur-md ring-1 ring-white/10 transition-all cursor-pointer ${
                isSaved
                  ? "bg-rose-500 text-white opacity-100"
                  : "bg-black/50 hover:bg-rose-500 text-white opacity-0 group-hover:opacity-100"
              }`}
              title={isSaved ? "Saved" : "Save leak"}
              aria-label="Save leak"
            >
              {justSaved ? (
                <Check size={13} weight="bold" />
              ) : (
                <BookmarkSimple size={14} weight={isSaved ? "fill" : "regular"} />
              )}
            </button>
          </div>

          {/* Bottom-right: Duration badge */}
          {video.duration_formatted && video.duration_formatted !== "00:00" && (
            <div className="absolute bottom-2 right-2 pointer-events-none z-10">
              <span className="flex items-center gap-1 text-[10px] font-medium text-white/90 bg-black/70 backdrop-blur-md ring-1 ring-white/10 px-1.5 py-0.5 rounded-md tabular-nums">
                <Clock size={11} weight="regular" />
                {video.duration_formatted}
              </span>
            </div>
          )}

          {/* Hover Play Icon overlay */}
          <div className="absolute inset-0 bg-black/15 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 rounded-full bg-rose-500/90 text-white flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
              <Play size={18} weight="fill" className="ml-0.5" />
            </div>
          </div>
        </div>

        {/* Text Info Below Thumbnail (Matching Homepage VideoCard) */}
        <div className="px-0.5 space-y-1">
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <h3
              className="text-[13px] font-medium text-foreground group-hover:text-primary transition-colors truncate"
              title={video.title}
            >
              {video.title}
            </h3>
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground/75 tabular-nums">
            <span>
              {formatRelativeTime(video.published_at || video.scraped_at)}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {video.rating_raw && (
                <span className="flex items-center gap-0.5 text-emerald-400 font-medium">
                  <ThumbsUp size={11} weight="fill" />
                  {video.rating_raw}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Eye size={12} weight="regular" className="text-muted-foreground/50" />
                {video.views_raw || formatViewers(video.views_count) || "0"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function LeakCardSkeleton() {
  return (
    <div className="space-y-2.5">
      <div className="w-full aspect-video rounded-lg bg-muted/60 animate-pulse mb-2" />
      <div className="h-3 w-3/4 rounded bg-muted/60 animate-pulse" />
      <div className="h-3 w-1/2 rounded bg-muted/40 animate-pulse" />
    </div>
  );
}
