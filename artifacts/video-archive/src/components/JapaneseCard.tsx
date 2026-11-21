import { useState } from "react";
import { Link } from "wouter";
import { Play, Eye, ThumbsUp, Clock, BookmarkSimple, Check } from "@phosphor-icons/react";
import type { JapaneseVideo } from "@/hooks/useJapaneseVideos";

interface JapaneseCardProps {
  video: JapaneseVideo;
  isSaved?: boolean;
  onToggleSave?: (id: string) => void;
}

export function JapaneseCard({ video, isSaved = false, onToggleSave }: JapaneseCardProps) {
  const [imageError, setImageError] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const thumbUrl = imageError
    ? "/placeholder-thumb.jpg"
    : (video.clean_thumbnail_url || video.thumbnail_url || "/placeholder-thumb.jpg");

  const proxiedThumb = thumbUrl.startsWith("http")
    ? `/api/media?url=${encodeURIComponent(thumbUrl)}`
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

  const makerCode = video.raw_payload?.maker_code || "";

  return (
    <div className="group relative flex flex-col rounded-2xl bg-card/60 border border-border/40 overflow-hidden hover:border-rose-500/50 hover:shadow-xl hover:shadow-rose-500/5 transition-all duration-300">
      <Link href={`/japanese/video/${video.id}`}>
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted/40 cursor-pointer">
          <img
            src={proxiedThumb}
            alt={video.title}
            loading="lazy"
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 opacity-80 group-hover:opacity-60 transition-opacity" />

          {/* Maker Code Badge (e.g. FC2PPV-5007844) */}
          {makerCode && (
            <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-rose-600/90 backdrop-blur-md text-[11px] font-bold text-white uppercase tracking-wider shadow-sm">
              {makerCode}
            </div>
          )}

          {/* Save / Favorite Action */}
          <button
            onClick={handleSaveClick}
            className={`absolute top-2.5 right-2.5 p-1.5 rounded-lg backdrop-blur-md transition-all ${
              isSaved
                ? "bg-rose-500 text-white"
                : "bg-black/40 text-white/80 hover:bg-black/70 hover:text-white"
            }`}
            title={isSaved ? "Saved" : "Save video"}
          >
            {justSaved ? <Check size={14} weight="bold" /> : <BookmarkSimple size={14} weight={isSaved ? "fill" : "bold"} />}
          </button>

          {/* Center Play Button Overlay */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="w-12 h-12 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
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
        <Link href={`/japanese/video/${video.id}`}>
          <h3
            className="text-sm font-semibold text-foreground line-clamp-2 leading-snug group-hover:text-rose-400 transition-colors cursor-pointer mb-2"
            title={video.title}
          >
            {video.title}
          </h3>
        </Link>

        {/* Actor Pills */}
        {video.actors && video.actors.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2.5">
            {video.actors.slice(0, 2).map((act) => (
              <span
                key={act}
                className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-secondary/80 text-muted-foreground border border-border/30 truncate max-w-[130px]"
              >
                {act}
              </span>
            ))}
          </div>
        )}

        {/* Footer Metrics */}
        <div className="mt-auto pt-2 border-t border-border/20 flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Eye size={13} />
            <span>{video.views_raw || video.views_count.toLocaleString()}</span>
          </div>

          {video.rating_score != null && (
            <div className="flex items-center gap-1 text-emerald-400 font-medium">
              <ThumbsUp size={12} weight="fill" />
              <span>{video.rating_raw || `${video.rating_score}%`}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
