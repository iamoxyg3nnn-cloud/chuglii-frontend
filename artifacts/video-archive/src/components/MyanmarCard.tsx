import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { Play, Eye, Clock, BookmarkSimple, Check } from "@phosphor-icons/react";
import type { MyanmarVideo, MyanmarSite } from "@/hooks/useMyanmarVideos";

function toMediaProxyUrl(raw: string): string {
  return raw.startsWith("http") ? `/api/media?url=${encodeURIComponent(raw)}` : raw;
}

interface MyanmarCardProps {
  video: MyanmarVideo;
  site?: MyanmarSite;
  isSaved?: boolean;
  onToggleSave?: (id: string) => void;
}

export function MyanmarCard({ video, site = "buumal", isSaved = false, onToggleSave }: MyanmarCardProps) {
  const [imageError, setImageError] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const rawFrames = video.raw_payload?.media?.preview_frames ?? [];
  const previewFrames = Array.isArray(rawFrames)
    ? rawFrames.filter((u): u is string => typeof u === "string" && u.length > 0).map(toMediaProxyUrl)
    : [];

  useEffect(() => {
    if (!isHovered || previewFrames.length <= 1) {
      setFrameIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % previewFrames.length);
    }, 550);
    return () => clearInterval(timer);
  }, [isHovered, previewFrames.length]);

  const rawThumb = video.clean_thumbnail_url || video.thumbnail_url || "";
  const resolvedBaseThumb = imageError || !rawThumb
    ? "/placeholder-thumb.jpg"
    : (site === "samusar" || rawThumb.includes("samusar.com") ? toMediaProxyUrl(rawThumb) : rawThumb);
  const thumbSrc = isHovered && previewFrames.length > 1
    ? previewFrames[frameIndex] || resolvedBaseThumb
    : resolvedBaseThumb;

  const targetHref = site && site !== "buumal"
    ? `/myanmar/${site}/video/${video.id}`
    : `/myanmar/video/${video.id}`;

  const handleSaveClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onToggleSave) {
      onToggleSave(video.id);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    }
  };

  const categoryBadge = video.tags?.find((t) => t !== "myanmar" && !["🍑", "⭐️", "👇🏻"].includes(t)) || "Myanmar";
  const relativeTime = video.raw_payload?.relative_time || "";

  return (
    <div
      className="group relative flex flex-col rounded-2xl bg-card/60 border border-border/40 overflow-hidden hover:border-rose-500/50 hover:shadow-xl hover:shadow-rose-500/5 transition-all duration-300"
      onMouseEnter={() => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = setTimeout(() => setIsHovered(true), 200);
      }}
      onMouseLeave={() => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        setIsHovered(false);
        setFrameIndex(0);
      }}
    >
      <Link href={targetHref}>
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted/40 cursor-pointer">
          <img
            src={thumbSrc}
            alt={video.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />

          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

          {/* Category Tag Badge */}
          <div className="absolute top-2.5 left-2.5">
            <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-500/90 text-white backdrop-blur-md uppercase tracking-wider shadow-sm">
              {categoryBadge}
            </span>
          </div>

          {/* Bookmark Button */}
          <button
            onClick={handleSaveClick}
            type="button"
            title={isSaved ? "Remove Bookmark" : "Save Bookmark"}
            className={`absolute top-2.5 right-2.5 p-1.5 rounded-lg backdrop-blur-md transition-all ${
              isSaved
                ? "bg-rose-500 text-white shadow-md shadow-rose-500/30"
                : "bg-black/40 text-white/80 hover:text-white hover:bg-black/60 opacity-0 group-hover:opacity-100"
            }`}
          >
            {justSaved ? <Check size={14} weight="bold" /> : <BookmarkSimple size={14} weight={isSaved ? "fill" : "bold"} />}
          </button>

          {/* Duration Badge */}
          {video.duration_formatted && video.duration_formatted !== "00:00" && (
            <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-black/75 text-white/90 backdrop-blur-sm flex items-center gap-1">
              <Clock size={11} />
              <span>{video.duration_formatted}</span>
            </div>
          )}

          {/* Play Icon on Hover */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-rose-500/90 text-white flex items-center justify-center shadow-lg shadow-rose-500/40 transform scale-90 group-hover:scale-100 transition-transform">
              <Play size={20} weight="fill" className="ml-0.5" />
            </div>
          </div>
        </div>
      </Link>

      {/* Video Info Section */}
      <div className="p-3.5 flex flex-col flex-1 justify-between gap-2.5">
        <Link href={targetHref}>
          <h3
            title={video.title}
            className="text-sm font-semibold text-foreground/90 group-hover:text-rose-400 line-clamp-2 transition-colors cursor-pointer leading-snug"
          >
            {video.title}
          </h3>
        </Link>

        {/* Footer Meta */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/30">
          <span className="flex items-center gap-1">
            <Eye size={13} />
            <span className="tabular-nums">
              {video.views_raw && video.views_raw !== "0"
                ? video.views_raw
                : video.views_count > 0
                  ? `${video.views_count} views`
                  : "HD"}
            </span>
          </span>

          <span className="text-[11px] text-muted-foreground/75 truncate max-w-[130px]">
            {relativeTime || "Recent"}
          </span>
        </div>
      </div>
    </div>
  );
}
