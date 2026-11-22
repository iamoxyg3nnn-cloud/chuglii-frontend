import { useState } from "react";
import { Link } from "wouter";
import { Play, Eye, ThumbsUp, Clock, BookmarkSimple, Check, Sparkle, Broadcast } from "@phosphor-icons/react";
import { proxyImageUrl } from "@/lib/proxy-url";
import type { OnlyfansVideo } from "@/hooks/useOnlyfansVideos";

interface OnlyfansCardProps {
  video: OnlyfansVideo;
  isSaved?: boolean;
  onToggleSave?: (id: string) => void;
}

export function OnlyfansCard({ video, isSaved = false, onToggleSave }: OnlyfansCardProps) {
  const [imageError, setImageError] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const thumbUrl = imageError
    ? "/placeholder-thumb.jpg"
    : (video.clean_thumbnail_url || video.thumbnail_url || "/placeholder-thumb.jpg");

  const proxiedThumb = thumbUrl.startsWith("http")
    ? (proxyImageUrl(thumbUrl) || thumbUrl)
    : thumbUrl;

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
  const mirrors = video.raw_payload?.mirrors || [];
  const quality = video.quality_label || "1080p Full HD";
  const is4K = quality.includes("4K") || (video.quality_score && video.quality_score >= 2000);
  const is1080p = quality.includes("1080p") || (video.quality_score && video.quality_score >= 1000 && video.quality_score < 2000);

  return (
    <div className="group relative flex flex-col rounded-2xl bg-card/60 border border-border/40 overflow-hidden hover:border-cyan-500/50 hover:shadow-xl hover:shadow-cyan-500/5 transition-all duration-300">
      <Link href={`/onlyfans/video/${video.id}`}>
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted/40 cursor-pointer">
          <img
            src={proxiedThumb}
            alt={video.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/30 opacity-80 group-hover:opacity-60 transition-opacity" />

          {/* Quality Badge (Promoting 4K UHD or 1080p) */}
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
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

            {mirrors.length > 1 && (
              <span className="px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[10px] font-medium text-cyan-300 border border-cyan-500/30">
                {mirrors.length} mirrors
              </span>
            )}
          </div>

          {/* Save / Favorite Action */}
          <button
            onClick={handleSaveClick}
            className={`absolute top-2.5 right-2.5 p-1.5 rounded-lg backdrop-blur-md transition-all ${
              isSaved
                ? "bg-cyan-500 text-white"
                : "bg-black/40 text-white/80 hover:bg-black/70 hover:text-white"
            }`}
            title={isSaved ? "Saved" : "Save video"}
          >
            {justSaved ? <Check size={14} weight="bold" /> : <BookmarkSimple size={14} weight={isSaved ? "fill" : "bold"} />}
          </button>

          {/* Center Play Button Overlay */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="w-12 h-12 rounded-full bg-cyan-500 text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
              <Play size={20} weight="fill" className="translate-x-0.5" />
            </div>
          </div>

          {/* Duration Badge */}
          {video.duration_formatted && (
            <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-[11px] font-medium text-white flex items-center gap-1">
              <Clock size={11} weight="bold" />
              <span>{video.duration_formatted}</span>
            </div>
          )}
        </div>
      </Link>

      {/* Card Info */}
      <div className="flex flex-col flex-1 p-3.5">
        <Link href={`/onlyfans/video/${video.id}`}>
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
