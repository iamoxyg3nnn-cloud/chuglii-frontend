import { useRef, useState, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useScrapedVideoById, useScrapedRelatedVideos, type ScrapedVideo } from "@/hooks/useScrapedVideos";
import {
  Flame,
  ArrowLeft,
  Clock,
  Eye,
  ThumbsUp,
  Tag as TagIcon,
  ShareNetwork,
  DownloadSimple,
  Play,
  Check,
  FilmStrip,
  WarningCircle,
  Sparkle
} from "@phosphor-icons/react";

export default function LeakWatch() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [copied, setCopied] = useState(false);
  const { data: video, isLoading, error } = useScrapedVideoById(id);
  const { data: relatedVideos, isLoading: relatedLoading } = useScrapedRelatedVideos(id, 8);

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-pulse">
          <div className="h-6 w-32 bg-muted/60 rounded mb-6" />
          <div className="aspect-video w-full bg-muted/40 rounded-2xl mb-6" />
          <div className="h-8 w-3/4 bg-muted/60 rounded mb-4" />
          <div className="h-4 w-1/2 bg-muted/40 rounded" />
        </div>
      </Layout>
    );
  }

  if (error || !video) {
    return (
      <Layout>
        <div className="max-w-xl mx-auto px-4 py-20 text-center">
          <WarningCircle size={48} className="mx-auto text-rose-500 mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Video Not Found</h2>
          <p className="text-sm text-muted-foreground mb-6">
            This leak video may have been removed or the ID is invalid.
          </p>
          <Link href="/leak">
            <span className="px-4 py-2 rounded-xl text-sm font-medium bg-rose-500 text-white cursor-pointer hover:bg-rose-600 transition-colors inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Return to Leaks Catalog
            </span>
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          {/* Breadcrumb Header */}
          <div className="flex items-center justify-between gap-4 mb-4">
            <Link href="/leak">
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:text-rose-400 transition-colors cursor-pointer">
                <ArrowLeft size={15} /> Back to Leaks Feed
              </span>
            </Link>

            <div className="flex items-center gap-2">
              <button
                onClick={handleShare}
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/40 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <ShareNetwork size={14} />}
                {copied ? "Copied Link" : "Share"}
              </button>
              {video.full_video_url && (
                <a
                  href={video.full_video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <DownloadSimple size={14} /> Direct MP4
                </a>
              )}
            </div>
          </div>

          {/* Main Cinema Player Container */}
          <div className="rounded-2xl overflow-hidden bg-black border border-border/80 shadow-2xl aspect-video w-full relative">
            {video.full_video_url ? (
              <video
                ref={videoRef}
                src={video.full_video_url}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-contain"
                poster={video.thumbnail_url || undefined}
              >
                Your browser does not support HTML5 video.
              </video>
            ) : video.trailer_preview_url ? (
              <video
                src={video.trailer_preview_url}
                controls
                autoPlay
                loop
                playsInline
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
                <FilmStrip size={48} className="mb-2 text-muted-foreground/60" />
                <p className="text-sm">Stream link is temporarily unavailable.</p>
                {video.detail_url && (
                  <a
                    href={video.detail_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-rose-400 hover:underline mt-2"
                  >
                    View Original Source &rarr;
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Video Metadata & Title */}
          <div className="mt-5 p-5 bg-card/40 border border-border/40 rounded-2xl backdrop-blur-sm">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="flex-1">
                <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-foreground leading-snug">
                  {video.title}
                </h1>

                <div className="flex flex-wrap items-center gap-4 mt-3 text-xs sm:text-sm text-muted-foreground">
                  {video.duration_formatted && (
                    <span className="flex items-center gap-1 text-foreground font-medium">
                      <Clock size={15} className="text-rose-500" /> {video.duration_formatted}
                    </span>
                  )}
                  {video.views_raw && (
                    <span className="flex items-center gap-1">
                      <Eye size={15} /> {video.views_raw} views
                    </span>
                  )}
                  {video.rating_score !== null && (
                    <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                      <ThumbsUp size={15} weight="fill" /> {video.rating_raw}
                    </span>
                  )}
                  {video.published_at && (
                    <span>
                      Added {new Date(video.published_at).toLocaleDateString()}
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[11px] font-semibold uppercase">
                    {video.source_site}
                  </span>
                </div>
              </div>
            </div>

            {/* Tags section */}
            {video.tags && video.tags.length > 0 && (
              <div className="mt-5 pt-4 border-t border-border/30 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1">
                  <TagIcon size={13} /> Tags:
                </span>
                {video.tags.map((t) => (
                  <Link key={t} href={`/leak?tag=${encodeURIComponent(t)}`}>
                    <span className="px-2.5 py-1 rounded-lg bg-secondary/80 hover:bg-secondary text-xs text-muted-foreground hover:text-foreground font-medium border border-border/30 transition-colors cursor-pointer">
                      #{t}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Related Videos Grid */}
          <div className="mt-12">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Flame size={20} weight="fill" className="text-rose-500" />
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                  Related Leaks
                </h2>
              </div>
            </div>

            {relatedLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="aspect-video bg-muted/40 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : relatedVideos && relatedVideos.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
                {relatedVideos.map((item) => (
                  <Link key={item.id} href={`/leak/video/${item.id}`}>
                    <div className="group rounded-xl overflow-hidden bg-card border border-border/40 hover:border-rose-500/50 hover:shadow-lg transition-all duration-200 cursor-pointer flex flex-col">
                      <div className="relative aspect-video w-full bg-black/60 overflow-hidden">
                        <img
                          src={item.thumbnail_url || ""}
                          alt={item.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        {item.duration_formatted && (
                          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/85 text-[11px] font-semibold text-white">
                            {item.duration_formatted}
                          </div>
                        )}
                        {item.views_raw && (
                          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] text-white flex items-center gap-1">
                            <Eye size={11} /> {item.views_raw}
                          </div>
                        )}
                      </div>
                      <div className="p-3 flex-1 flex flex-col justify-between">
                        <h4 className="text-xs font-semibold line-clamp-2 text-foreground group-hover:text-rose-400 transition-colors">
                          {item.title}
                        </h4>
                        <div className="mt-2 text-[11px] text-muted-foreground flex items-center justify-between">
                          <span>{item.source_site}</span>
                          {item.rating_score && (
                            <span className="text-emerald-400 font-medium">
                              {item.rating_raw}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No related leaks found.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
