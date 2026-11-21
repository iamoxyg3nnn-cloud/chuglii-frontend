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
  Sparkle,
  BookmarkSimple,
  LinkSimple
} from "@phosphor-icons/react";

export default function LeakWatch() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [copied, setCopied] = useState(false);
  const [copiedStream, setCopiedStream] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const { data: video, isLoading, error } = useScrapedVideoById(id);
  const { data: relatedVideos, isLoading: relatedLoading } = useScrapedRelatedVideos(id, 8);

  // Check saved state from localStorage
  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem("chuglii_saved_leaks");
      const list: string[] = raw ? JSON.parse(raw) : [];
      setIsSaved(list.includes(id));
    } catch {
      setIsSaved(false);
    }
  }, [id]);

  const toggleSave = () => {
    if (!id) return;
    try {
      const raw = localStorage.getItem("chuglii_saved_leaks");
      let list: string[] = raw ? JSON.parse(raw) : [];
      if (list.includes(id)) {
        list = list.filter((x) => x !== id);
        setIsSaved(false);
      } else {
        list.unshift(id);
        setIsSaved(true);
      }
      localStorage.setItem("chuglii_saved_leaks", JSON.stringify(list));
    } catch {}
  };

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyStream = () => {
    const stream = video?.full_video_url || video?.trailer_preview_url;
    if (stream && navigator.clipboard) {
      navigator.clipboard.writeText(stream);
      setCopiedStream(true);
      setTimeout(() => setCopiedStream(false), 2000);
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

  const primaryStream = video.full_video_url || video.trailer_preview_url;

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
              {/* Save / Favorite Button */}
              <button
                onClick={toggleSave}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  isSaved
                    ? "bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-500/20"
                    : "bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground border-border/40"
                }`}
                title={isSaved ? "Saved to Favorites" : "Save to Favorites"}
              >
                <BookmarkSimple size={15} weight={isSaved ? "fill" : "bold"} />
                <span>{isSaved ? "Saved" : "Save"}</span>
              </button>

              {/* Share Button */}
              <button
                onClick={handleShare}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/40 transition-colors"
              >
                {copied ? (
                  <>
                    <Check size={14} className="text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <ShareNetwork size={14} />
                    <span>Share</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Video Player Cinema Frame */}
          <div className="relative aspect-video w-full max-h-[70vh] mx-auto bg-black rounded-2xl overflow-hidden shadow-2xl border border-border/30">
            {primaryStream ? (
              <video
                ref={videoRef}
                src={primaryStream}
                poster={video.clean_thumbnail_url || video.thumbnail_url || undefined}
                controls
                autoPlay
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

          {/* Video Action Toolbar */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Direct Download Button */}
              {primaryStream && (
                <a
                  href={primaryStream}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-rose-500 hover:bg-rose-600 text-white shadow-sm transition-all"
                >
                  <DownloadSimple size={16} weight="bold" />
                  <span>Download MP4</span>
                </a>
              )}

              {/* Copy Direct Stream Link */}
              {primaryStream && (
                <button
                  onClick={handleCopyStream}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium bg-secondary/80 hover:bg-secondary text-foreground border border-border/40 transition-colors"
                >
                  {copiedStream ? (
                    <>
                      <Check size={16} className="text-emerald-400" />
                      <span className="text-emerald-400 font-semibold">Stream Copied!</span>
                    </>
                  ) : (
                    <>
                      <LinkSimple size={16} />
                      <span>Copy Stream Link</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Original Source Reference */}
            {video.detail_url && (
              <a
                href={video.detail_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-rose-400 transition-colors flex items-center gap-1"
              >
                <span>Source: {video.source_site}</span> &rarr;
              </a>
            )}
          </div>

          {/* Video Metadata & Title */}
          <div className="mt-4 p-5 bg-card/40 border border-border/40 rounded-2xl backdrop-blur-sm">
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
                      <div className="relative aspect-video w-full bg-muted/50 overflow-hidden">
                        <img
                          src={item.clean_thumbnail_url || item.thumbnail_url || undefined}
                          alt={item.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        {item.duration_formatted && (
                          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-[11px] font-semibold text-white">
                            {item.duration_formatted}
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <p className="text-xs sm:text-sm font-semibold line-clamp-2 text-foreground group-hover:text-rose-400 transition-colors">
                          {item.title}
                        </p>
                        <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-muted-foreground">
                          <span>{item.views_raw || "0 views"}</span>
                          {item.rating_raw && (
                            <span className="text-emerald-400 font-medium flex items-center gap-0.5">
                              <ThumbsUp size={11} weight="fill" /> {item.rating_raw}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No related leaks found.
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
