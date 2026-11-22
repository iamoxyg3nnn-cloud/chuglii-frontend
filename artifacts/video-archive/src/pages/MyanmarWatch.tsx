import { useRef, useState, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useMyanmarVideoById, useMyanmarRelatedVideos, type MyanmarVideo } from "@/hooks/useMyanmarVideos";
import { MyanmarCard } from "@/components/MyanmarCard";
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

export default function MyanmarWatch() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [copied, setCopied] = useState(false);
  const [copiedStream, setCopiedStream] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const { data: video, isLoading, error } = useMyanmarVideoById(id);
  const { data: relatedVideos, isLoading: relatedLoading } = useMyanmarRelatedVideos(id, 8);

  const isDirectMp4 = Boolean(
    video?.full_video_url && (video.full_video_url.includes(".mp4") || video.video_mime_type === "video/mp4")
  );

  // Check saved state from localStorage
  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem("chuglii_saved_myanmar");
      const list: string[] = raw ? JSON.parse(raw) : [];
      setIsSaved(list.includes(id));
    } catch {
      setIsSaved(false);
    }
  }, [id]);

  // SEO & OpenGraph Document Meta Tags
  useEffect(() => {
    if (!video) return;
    const prevTitle = document.title;
    document.title = `${video.title} - Myanmar Video Archive`;

    const setMeta = (name: string, content: string, isProp = false) => {
      let el = document.querySelector(isProp ? `meta[property="${name}"]` : `meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        if (isProp) el.setAttribute("property", name);
        else el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("description", `Watch ${video.title} on Chuglii. High quality Myanmar leaks & private video archives.`);
    setMeta("og:title", `${video.title} | Myanmar Video`, true);
    setMeta("og:description", `Watch ${video.title} on Chuglii.`, true);
    const ogThumb = video.clean_thumbnail_url || video.thumbnail_url || "";
    setMeta("og:image", ogThumb, true);
    if (video.full_video_url) {
      setMeta("og:video", video.full_video_url, true);
      setMeta("og:video:type", "video/mp4", true);
    }

    return () => {
      document.title = prevTitle;
    };
  }, [video]);

  const toggleSave = () => {
    if (!id) return;
    try {
      const raw = localStorage.getItem("chuglii_saved_myanmar");
      let list: string[] = raw ? JSON.parse(raw) : [];
      if (list.includes(id)) {
        list = list.filter((x) => x !== id);
        setIsSaved(false);
      } else {
        list.unshift(id);
        setIsSaved(true);
      }
      localStorage.setItem("chuglii_saved_myanmar", JSON.stringify(list));
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
    const stream = video?.detail_url || video?.full_video_url;
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
            This Myanmar video may have been removed or the ID is invalid.
          </p>
          <Link href="/myanmar">
            <span className="px-4 py-2 rounded-xl text-sm font-medium bg-rose-500 text-white cursor-pointer hover:bg-rose-600 transition-colors inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Return to Myanmar Feed
            </span>
          </Link>
        </div>
      </Layout>
    );
  }

  const primaryStream = video.full_video_url || video.detail_url;

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          {/* Breadcrumb Header */}
          <div className="flex items-center justify-between gap-4 mb-4">
            <Link href="/myanmar">
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:text-rose-400 transition-colors cursor-pointer">
                <ArrowLeft size={15} /> Back to Myanmar Feed
              </span>
            </Link>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleSave}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  isSaved
                    ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                    : "bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground border-border/40"
                }`}
              >
                {isSaved ? <Check size={14} weight="bold" /> : <BookmarkSimple size={14} />}
                <span>{isSaved ? "Saved" : "Save Video"}</span>
              </button>

              <button
                onClick={handleShare}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/40 transition-colors"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <ShareNetwork size={14} />}
                <span>{copied ? "Copied" : "Share"}</span>
              </button>
            </div>
          </div>

          {/* Video Player Cinema Frame - Masks website chrome, displays only video */}
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black shadow-2xl border border-border/40">
            {video.detail_url ? (
              <div className="relative w-full h-full overflow-hidden bg-black">
                <iframe
                  key={video.detail_url}
                  src={video.detail_url}
                  title={video.title}
                  referrerPolicy="no-referrer"
                  allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; accelerometer *; gyroscope *"
                  allowFullScreen
                  className="w-full border-none bg-black pointer-events-auto"
                  style={{
                    position: "absolute",
                    top: "-52px",
                    left: "0",
                    width: "100%",
                    height: "calc(100% + 140px)",
                  }}
                />
              </div>
            ) : isDirectMp4 && video.full_video_url ? (
              <video
                ref={videoRef}
                src={video.full_video_url}
                poster={video.clean_thumbnail_url || video.thumbnail_url || undefined}
                controls
                playsInline
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
                <FilmStrip size={48} className="mb-2 text-muted-foreground/60" />
                <p className="text-sm">Video stream is currently unavailable.</p>
              </div>
            )}
          </div>

          {/* Video Action Toolbar */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {video.detail_url && (
                <button
                  onClick={() => {
                    const iframe = document.querySelector('iframe');
                    if (iframe && video.detail_url) iframe.src = video.detail_url;
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border border-rose-500/40 transition-colors"
                >
                  <Sparkle size={14} className="text-rose-400" />
                  <span>Reload Player</span>
                </button>
              )}

              <button
                onClick={handleCopyStream}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-secondary/80 hover:bg-secondary text-foreground border border-border/40 transition-colors"
              >
                {copiedStream ? <Check size={14} className="text-emerald-400" /> : <LinkSimple size={14} />}
                <span>{copiedStream ? "Link Copied" : "Copy Link"}</span>
              </button>

              {video.detail_url && (
                <a
                  href={video.detail_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-rose-400 transition-colors"
                >
                  <span>Source Page &rarr;</span>
                </a>
              )}
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Eye size={14} />
                <span className="tabular-nums">{video.views_raw || `${video.views_count || 120} views`}</span>
              </span>
              {video.raw_payload?.relative_time && (
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  <span>{video.raw_payload.relative_time}</span>
                </span>
              )}
            </div>
          </div>

          {/* Title and Metadata */}
          <div className="mt-6 p-6 rounded-2xl bg-card/40 border border-border/40">
            <h1 className="text-lg sm:text-2xl font-bold text-foreground leading-snug">
              {video.title}
            </h1>

            {/* Tags Badges */}
            {video.tags && video.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <TagIcon size={13} /> Tags:
                </span>
                {video.tags
                  .filter((t) => !["🍑", "⭐️", "👇🏻"].includes(t))
                  .map((tag) => (
                    <Link key={tag} href={`/myanmar?tag=${encodeURIComponent(tag)}`}>
                      <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-secondary/80 hover:bg-rose-500/20 hover:text-rose-400 text-muted-foreground border border-border/30 transition-colors cursor-pointer">
                        #{tag}
                      </span>
                    </Link>
                  ))}
              </div>
            )}
          </div>

          {/* Related Videos */}
          <div className="mt-10">
            <h2 className="text-base sm:text-lg font-bold text-foreground mb-4 flex items-center gap-2">
              <Sparkle size={18} className="text-rose-400" />
              <span>More Myanmar Videos</span>
            </h2>

            {relatedLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-2xl bg-card/40 border border-border/40 overflow-hidden animate-pulse">
                    <div className="aspect-[16/10] bg-muted/60" />
                    <div className="p-3 space-y-2">
                      <div className="h-4 bg-muted/60 rounded w-3/4" />
                      <div className="h-3 bg-muted/40 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : relatedVideos && relatedVideos.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {relatedVideos.map((rv) => (
                  <MyanmarCard key={rv.id} video={rv} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No related Myanmar videos found.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
