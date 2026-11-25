import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { PlayerFrame } from "@/components/PlayerFrame";
import { HlsVideoPlayer } from "@/components/HlsVideoPlayer";
import { copyText } from "@/lib/clipboard";
import { buildEdgePlayerUrl } from "@/lib/video-source";
import { rankRelatedVideos } from "@/lib/recommendations";
import {
  useStudiosVideoById,
  useStudiosVideos,
  studiosDisplayTitle,
} from "@/hooks/useStudiosVideos";
import { StudiosCard } from "@/components/StudiosCard";
import {
  ArrowLeft,
  Clock,
  ShareNetwork,
  Check,
  FilmStrip,
  WarningCircle,
  Sparkle,
  BookmarkSimple,
  LinkSimple,
  ArrowClockwise,
  MonitorPlay,
} from "@phosphor-icons/react";

function setMeta(name: string, content: string, isProp = false) {
  if (isProp) {
    let el = document.querySelector<HTMLMetaElement>(`meta[property="${name}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("property", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  } else {
    let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }
}

export default function StudiosWatch({ site: siteProp }: { site?: string }) {
  const { id } = useParams<{ id: string }>();
  const site = ["dasj91", "madouhd"].includes(siteProp || "") ? siteProp! : "madouer";
  const [copied, setCopied] = useState(false);
  const [copiedStream, setCopiedStream] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [streamError, setStreamError] = useState(false);
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  const { data: video, isLoading, error } = useStudiosVideoById(id, site);
  const { data: relatedPool } = useStudiosVideos({
    site: video?.source_site || site,
    category: video?.region || undefined,
    limit: 24,
    page: 1,
  });

  const related = useMemo(
    () => rankRelatedVideos(video, relatedPool?.items || [], 8),
    [video, relatedPool],
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem("studios_saved_videos");
      if (stored) setSavedIds(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  const isSaved = Boolean(video && savedIds.includes(video.id));

  const toggleSave = () => {
    if (!video) return;
    setSavedIds((prev) => {
      const next = prev.includes(video.id) ? prev.filter((x) => x !== video.id) : [...prev, video.id];
      try {
        localStorage.setItem("studios_saved_videos", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const backHref = `/chinese/${site}`;

  useEffect(() => {
    if (!video) return;
    window.scrollTo({ top: 0 });
    document.title = `${studiosDisplayTitle(video)} - Studios | Chuglii`;
    setMeta("description", `Watch ${studiosDisplayTitle(video)} on Chuglii. Studios isolated category archive.`);
    setMeta("og:title", `${studiosDisplayTitle(video)} | Studios`, true);
    setMeta("og:description", `Watch ${studiosDisplayTitle(video)} on Chuglii.`, true);
    const ogThumb = video.clean_thumbnail_url || video.thumbnail_url || "";
    if (ogThumb) setMeta("og:image", ogThumb, true);
    if (video.full_video_url) {
      setMeta("og:video", video.full_video_url, true);
      setMeta("og:video:type", video.video_mime_type === "video/mp4" ? "video/mp4" : "text/html", true);
    }
  }, [video]);

  const handleCopyStream = async () => {
    const stream = video?.full_video_url;
    if (stream && (await copyText(stream))) {
      setCopiedStream(true);
      window.setTimeout(() => setCopiedStream(false), 2000);
    }
  };

  const handleShare = async () => {
    if (video && (await copyText(window.location.href))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
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
          <h2 className="text-xl font-bold text-foreground mb-2">Item Not Found</h2>
          <p className="text-sm text-muted-foreground mb-6">
            This studios video may have been removed or the ID is invalid.
          </p>
          <Link href={backHref}>
            <span className="px-4 py-2 rounded-xl text-sm font-medium bg-amber-500 text-white cursor-pointer hover:bg-amber-600 transition-colors inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Return to Studios Feed
            </span>
          </Link>
        </div>
      </Layout>
    );
  }

  const playerFrameSrc = video.full_video_url && video.full_video_url !== "resolve"
    ? buildEdgePlayerUrl(video.full_video_url, {
        title: studiosDisplayTitle(video),
        poster: video.clean_thumbnail_url || video.thumbnail_url || "",
        detail: video.detail_url,
      })
    : null;

  // HLS candidates for the in-page native player. madouer stream CDNs
  // (t{N}.cdn2020.com, t{N}.97img.com, thm3u8.co) serve browsers directly
  // with CORS * and no Referer requirement, so they get the direct-first
  // treatment; the Worker proxy is the fallback (and the only path for any
  // other host). dasj91 rows carry the "resolve" sentinel instead of a URL:
  // their auth_key tokens expire in ~1h, so playback goes through the
  // Worker resolver, which fetches a fresh playlist at play time.
  // Plain computation (not useMemo) — this sits after conditional early
  // returns, so hooks are not allowed here.
  const hlsCandidates = (() => {
    const primary = video.full_video_url || "";
    if (!primary) return [];
    if (primary === "resolve") {
      return [`/api/studios/resolve?url=${encodeURIComponent(video.detail_url)}`];
    }
    let host = "";
    try {
      host = new URL(primary).hostname;
    } catch {
      host = "";
    }
    const proxied = `/api/player/stream?url=${encodeURIComponent(primary)}`;
    if (
      /(^|\.)(cdn2020\.com|97img\.com|thm3u8\.co)$/i.test(host)
    ) {
      return [primary, proxied];
    }
    return [proxied];
  })();

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <Link href={backHref}>
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:text-amber-400 transition-colors cursor-pointer">
                <ArrowLeft size={15} /> Back to Feed
              </span>
            </Link>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleSave}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  isSaved
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                    : "bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/40"
                }`}
              >
                {isSaved ? <Check size={14} weight="bold" /> : <BookmarkSimple size={14} />}
                <span>{isSaved ? "Saved" : "Save"}</span>
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

          <div className="relative aspect-video w-full max-h-[72vh] mx-auto bg-black rounded-2xl overflow-hidden shadow-2xl border border-border/40">
            {streamError ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground bg-black">
                <FilmStrip size={48} className="mb-2 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">Video stream is temporarily unavailable.</p>
                <button
                  onClick={() => {
                    setStreamError(false);
                    setRetryNonce((n) => n + 1);
                  }}
                  className="mt-4 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowClockwise size={14} /> Retry Stream
                </button>
              </div>
            ) : hlsCandidates.length > 0 && !useIframeFallback ? (
              <HlsVideoPlayer
                key={`studios-hls-${video.id}-${retryNonce}`}
                candidates={hlsCandidates}
                poster={video.clean_thumbnail_url || video.thumbnail_url || undefined}
                title={studiosDisplayTitle(video)}
                autoPlay
                sourceQualityLabel={video.quality_label || undefined}
                onExhausted={() => setUseIframeFallback(true)}
              />
            ) : playerFrameSrc ? (
              <PlayerFrame
                src={playerFrameSrc}
                resetKey={`studios-${video.id}-${retryNonce}`}
                title={studiosDisplayTitle(video)}
                poster={video.clean_thumbnail_url || video.thumbnail_url || undefined}
                onRetry={() => setRetryNonce((value) => value + 1)}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground bg-black">
                <FilmStrip size={48} className="mb-2 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">No playable source available.</p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setStreamError(false);
                  setRetryNonce((n) => n + 1);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition-colors cursor-pointer"
                title="Reload Video Stream"
              >
                <ArrowClockwise size={14} className="text-amber-400" />
                <span>Reload Stream</span>
              </button>

              {video.full_video_url && (
                <button
                  type="button"
                  onClick={handleCopyStream}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-secondary/80 hover:bg-secondary text-foreground border border-border/40 transition-colors cursor-pointer"
                >
                  {copiedStream ? <Check size={14} className="text-emerald-400" /> : <LinkSimple size={14} />}
                  <span>{copiedStream ? "Stream Copied" : "Copy Stream"}</span>
                </button>
              )}

              <a
                href={video.detail_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-amber-400 transition-colors"
              >
                <span>Source &rarr;</span>
              </a>
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {video.duration_formatted && (
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  <span>{video.duration_formatted}</span>
                </span>
              )}
              {video.resolution && (
                <span className="flex items-center gap-1">
                  <MonitorPlay size={14} />
                  <span>{video.resolution}</span>
                </span>
              )}
            </div>
          </div>

          <div className="mt-6 p-6 rounded-2xl bg-card/40 border border-border/40">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {video.region_en && (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  {video.region_en}
                </span>
              )}
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1 bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <MonitorPlay size={11} />
                Stream
              </span>
            </div>
            <h1 className="text-lg sm:text-2xl font-bold text-foreground leading-snug">{studiosDisplayTitle(video)}</h1>

            {video.tags && video.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Tags:</span>
                {video.tags.map((tag) => (
                  <Link key={tag} href={`${backHref}?q=${encodeURIComponent(tag)}`}>
                    <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-secondary/80 hover:bg-amber-500/20 hover:text-amber-400 text-muted-foreground border border-border/30 transition-colors cursor-pointer">
                      #{tag}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {related.length > 0 && (
            <div className="mt-10">
              <h2 className="text-base sm:text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                <Sparkle size={18} className="text-amber-400" />
                <span>More like this</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {related.map((rv) => (
                  <StudiosCard key={rv.id} video={rv} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
