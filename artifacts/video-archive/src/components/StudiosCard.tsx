import { useState } from "react";
import { Link } from "wouter";
import { Play, Clock, BookmarkSimple, Check, MonitorPlay } from "@phosphor-icons/react";
import type { StudiosVideo } from "@/hooks/useStudiosVideos";
import { studiosDisplayTitle } from "@/hooks/useStudiosVideos";
import { proxyImageUrl } from "@/lib/proxy-url";

interface StudiosCardProps {
  video: StudiosVideo;
  isSaved?: boolean;
  onToggleSave?: (id: string) => void;
}

export function StudiosCard({ video, isSaved = false, onToggleSave }: StudiosCardProps) {
  const [imageError, setImageError] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const rawThumb = video.clean_thumbnail_url || video.thumbnail_url || "";
  const proxiedThumb = rawThumb.startsWith("http") ? (proxyImageUrl(rawThumb) || rawThumb) : rawThumb;
  const thumbSrc = imageError ? "/placeholder-thumb.jpg" : (proxiedThumb || "/placeholder-thumb.jpg");

  const watchHref = `/chinese/${video.source_site}/video/${video.id}`;
  const regionLabel = video.region_en || "Studios";

  const handleSaveClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onToggleSave) {
      onToggleSave(video.id);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    }
  };

  return (
    <div className="group relative flex flex-col rounded-2xl bg-card/60 border border-border/40 overflow-hidden hover:border-amber-500/50 hover:shadow-xl hover:shadow-amber-500/5 transition-all duration-300">
      <Link href={watchHref}>
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted/40 cursor-pointer">
          <img
            src={thumbSrc}
            alt={studiosDisplayTitle(video)}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 max-w-[80%]">
            <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold backdrop-blur-md uppercase tracking-wider shadow-sm flex items-center gap-1 bg-amber-500/90 text-white">
              <MonitorPlay size={11} weight="fill" />
              HD
            </span>
            <span className="px-1.5 py-0.5 rounded-md bg-black/55 text-white/75 backdrop-blur-sm text-[10px] truncate">
              {regionLabel}
            </span>
          </div>

          <button
            onClick={handleSaveClick}
            type="button"
            title={isSaved ? "Remove Bookmark" : "Save Bookmark"}
            className={`absolute top-2.5 right-2.5 p-1.5 rounded-lg backdrop-blur-md transition-all ${
              isSaved
                ? "bg-amber-500 text-white shadow-md shadow-amber-500/30"
                : "bg-black/40 text-white/80 hover:text-white hover:bg-black/60 opacity-0 group-hover:opacity-100"
            }`}
          >
            {justSaved ? <Check size={14} weight="bold" /> : <BookmarkSimple size={14} weight={isSaved ? "fill" : "bold"} />}
          </button>

          {video.duration_formatted && (
            <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-black/75 text-white/90 backdrop-blur-sm flex items-center gap-1">
              <Clock size={11} />
              <span>{video.duration_formatted}</span>
            </div>
          )}

          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-amber-500/90 text-white flex items-center justify-center shadow-lg shadow-amber-500/40 transform scale-90 group-hover:scale-100 transition-transform">
              <Play size={20} weight="fill" className="ml-0.5" />
            </div>
          </div>
        </div>
      </Link>

      <div className="p-3.5 flex flex-col flex-1 justify-between gap-2.5">
        <Link href={watchHref}>
          <h3
            title={studiosDisplayTitle(video)}
            className="text-sm font-semibold text-foreground/90 group-hover:text-amber-400 line-clamp-2 transition-colors cursor-pointer leading-snug"
          >
            {studiosDisplayTitle(video)}
          </h3>
        </Link>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/30">
          <span className="truncate max-w-[140px]">{regionLabel}</span>
          <span className="text-[11px] text-muted-foreground/75">
            {video.quality_label || video.resolution || ""}
          </span>
        </div>
      </div>
    </div>
  );
}

export function StudiosCardSkeleton() {
  return (
    <div className="rounded-2xl bg-card/40 border border-border/40 overflow-hidden animate-pulse">
      <div className="aspect-[16/10] bg-muted/60" />
      <div className="p-3.5 space-y-2">
        <div className="h-4 bg-muted/60 rounded w-3/4" />
        <div className="h-3 bg-muted/40 rounded w-1/2" />
      </div>
    </div>
  );
}
