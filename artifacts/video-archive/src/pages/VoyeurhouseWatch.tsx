import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoPlayer } from "@/components/VideoPlayer";
import { PlayerFrame } from "@/components/PlayerFrame";
import { copyText } from "@/lib/clipboard";
import { buildEdgePlayerUrl, resolveEdgeStreams, type ResolvedStream } from "@/lib/video-source";
import { rankRelatedVideos } from "@/lib/recommendations";
import {
  useVoyeurhouseVideoById,
  useVoyeurhouseVideos,
  isVoyeurhouseSite,
  VOYEURHOUSE_SITE_LABELS,
  VOYEURHOUSE_SITE_SOURCES,
  type VoyeurhouseVideo,
  type VoyeurhouseSite,
} from "@/hooks/useVoyeurhouseVideos";
import { VoyeurhouseCard } from "@/components/VoyeurhouseCard";
import {
  ArrowLeft,
  Clock,
  Eye,
  Tag as TagIcon,
  ShareNetwork,
  DownloadSimple,
  Check,
  FilmStrip,
  WarningCircle,
  Sparkle,
  BookmarkSimple,
  LinkSimple,
  ArrowClockwise,
  MonitorPlay,
  SpinnerGap,
} from "@phosphor-icons/react";

export default function VoyeurhouseWatch() {
  const { site: routeSite, id } = useParams<{ site: string; id: string }>();
  const site: VoyeurhouseSite = isVoyeurhouseSite(routeSite) ? routeSite : "voyeurhouseorg";
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [copied, setCopied] = useState(false);
  const [copiedStream, setCopiedStream] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [useIframe, setUseIframe] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [streamError, setStreamError] = useState(false);
  const [resolvedStreams, setResolvedStreams] = useState<ResolvedStream[]>([]);
  const [activeStreamIndex, setActiveStreamIndex] = useState(0);
  const [resolving, setResolving] = useState(false);

  const { data: video, isLoading, error } = useVoyeurhouseVideoById(site, id);

  const { data: relatedPool } = useVoyeurhouseVideos({
    site,
    limit: 32,
    page: 1,
  });
  const related = useMemo(
    () => rankRelatedVideos(video, relatedPool?.items || [], 8),
    [video, relatedPool],
  );

  const backHref = `/voyeurhouse/${site}`;
  const siteLabel = VOYEURHOUSE_SITE_LABELS[site];

  useEffect(() => {
    setUseIframe(false);
    setStreamError(false);
    setRetryNonce(0);
    setResolvedStreams([]);
    setActiveStreamIndex(0);
    setResolving(false);
  }, [id]);

  // AVS/ClicknPlay MP4 filenames rotate per embed request. The stored URL is
  // usually expired by playback time, so ask the edge resolver for a fresh
  // direct MP4 and feed that into our native VideoPlayer by default.
  useEffect(() => {
    if (!video?.id) return;

    // DoodStream-family embeds are geo/VPN gated; keep them on the iframe path.
    if (isDoodstreamSource(video)) {
      setUseIframe(true);
      setResolving(false);
      return;
    }

    if (!isAvsDirectSource(video)) {
      setResolvedStreams(
        video.full_video_url
          ? [{ url: video.full_video_url, label: "Original", type: "direct_mp4" }]
          : [],
      );
      setActiveStreamIndex(0);
      setUseIframe(false);
      setResolving(false);
      return;
    }

    const target =
      video.full_video_url ||
      video.raw_payload?.embed_url ||
      video.detail_url ||
      "";
    if (!/^https?:\/\//i.test(target)) {
      setUseIframe(true);
      setResolving(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setUseIframe(false);
    setResolving(true);
    resolveEdgeStreams(
      target,
      {
        title: video.title,
        poster: video.clean_thumbnail_url || video.thumbnail_url || "",
        embed: video.raw_payload?.embed_url || "",
        detail: video.detail_url || "",
      },
      controller.signal,
    )
      .then((streams) => {
        if (cancelled) return;
        setResolvedStreams(
          streams.length > 0
            ? streams
            : video.full_video_url
              ? [{ url: video.full_video_url, label: "Original", type: "direct_mp4" }]
              : [],
        );
        setActiveStreamIndex(0);
        setResolving(false);
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedStreams([]);
        setResolving(false);
        setUseIframe(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [video?.id, retryNonce]);

  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem("chuglii_saved_voyeurhouse");
      const list: string[] = raw ? JSON.parse(raw) : [];
      setIsSaved(list.includes(id));
    } catch {
      setIsSaved(false);
    }
  }, [id]);

  useEffect(() => {
    if (!video) return;
    const prevTitle = document.title;
    document.title = `${video.title} - ${siteLabel} | Voyeur House`;

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

    setMeta("description", `Watch ${video.title} on Chuglii. ${siteLabel} isolated video archive.`);
    setMeta("og:title", `${video.title} | ${siteLabel}`, true);
    setMeta("og:description", `Watch ${video.title} on Chuglii.`, true);
    const ogThumb = video.clean_thumbnail_url || video.thumbnail_url || "";
    if (ogThumb) setMeta("og:image", ogThumb, true);
    if (video.full_video_url) {
      setMeta("og:video", video.full_video_url, true);
      setMeta("og:video:type", video.video_mime_type === "video/mp4" ? "video/mp4" : "text/html", true);
    }

    return () => {
      document.title = prevTitle;
    };
  }, [video, siteLabel]);

  const toggleSave = () => {
    if (!id) return;
    try {
      const raw = localStorage.getItem("chuglii_saved_voyeurhouse");
      let list: string[] = raw ? JSON.parse(raw) : [];
      if (list.includes(id)) {
        list = list.filter((x) => x !== id);
        setIsSaved(false);
      } else {
        list.unshift(id);
        setIsSaved(true);
      }
      localStorage.setItem("chuglii_saved_voyeurhouse", JSON.stringify(list));
    } catch {
      // ignore
    }
  };

  const handleShare = async () => {
    if (await copyText(window.location.href)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyStream = async () => {
    const stream = video?.full_video_url || embedUrl(video);
    if (stream && await copyText(stream)) {
      setCopiedStream(true);
      window.setTimeout(() => setCopiedStream(false), 2000);
    }
  };

  const handleVideoError = useCallback(() => {
    setUseIframe(true);
    setStreamError(false);
  }, []);

  const reloadStream = useCallback(() => {
    setUseIframe(false);
    setStreamError(false);
    setResolvedStreams([]);
    setActiveStreamIndex(0);
    setRetryNonce((n) => n + 1);
  }, []);

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
            This {siteLabel} video may have been removed or the ID is invalid.
          </p>
          <Link href={backHref}>
            <span className="px-4 py-2 rounded-xl text-sm font-medium bg-amber-500 text-white cursor-pointer hover:bg-amber-600 transition-colors inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Return to {siteLabel} Feed
            </span>
          </Link>
        </div>
      </Layout>
    );
  }

  // AVS rows need the resolver URL carrying embed/detail, not a bare embed
  // wrapper, otherwise the worker falls back to the slow proxy path.
  const iframeSrc = isAvsDirectSource(video) ? avsDirectPlayerUrl(video) : embedUrl(video);
  const playerFrameSrc = iframeSrc?.startsWith("/api/player?")
    ? iframeSrc
    : iframeSrc
      ? buildEdgePlayerUrl(iframeSrc, {
          title: video.title,
          poster: video.clean_thumbnail_url || video.thumbnail_url || "",
          detail: video.detail_url || iframeSrc,
        })
      : null;
  const isDirect = video.video_mime_type === "video/mp4" && Boolean(video.full_video_url);
  const nativeStreams = resolvedStreams.filter((stream) => /^https?:\/\//i.test(stream.url));
  const activeStream = nativeStreams[Math.min(activeStreamIndex, Math.max(0, nativeStreams.length - 1))];
  const nativeSrc = activeStream?.url || null;
  const nativeQualities = nativeStreams.map((stream, index) => ({
    url: stream.url,
    label: stream.label || `Source ${index + 1}`,
  }));

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <Link href={backHref}>
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:text-amber-400 transition-colors cursor-pointer">
                <ArrowLeft size={15} /> Back to {siteLabel} Feed
              </span>
            </Link>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleSave}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  isSaved
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
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

          <div className="relative aspect-video w-full max-h-[72vh] mx-auto bg-black rounded-2xl overflow-hidden shadow-2xl border border-border/40">
            {streamError ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground bg-black">
                <FilmStrip size={48} className="mb-2 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">Video stream is temporarily unavailable.</p>
                <button
                  onClick={reloadStream}
                  className="mt-4 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowClockwise size={14} /> Retry Stream
                </button>
              </div>
            ) : resolving && !nativeSrc ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground bg-black">
                <SpinnerGap size={34} className="animate-spin text-cyan-400" />
                <p className="text-sm font-medium text-foreground">Resolving fresh stream...</p>
              </div>
            ) : nativeSrc && !useIframe ? (
              <VideoPlayer
                key={`vh-${site}-${nativeSrc}-${retryNonce}`}
                src={nativeSrc}
                poster={video.clean_thumbnail_url || video.thumbnail_url || undefined}
                title={video.title}
                autoPlay
                videoRef={videoRef}
                qualities={nativeQualities}
                activeQualityUrl={nativeSrc}
                onAutoDowngrade={(fromUrl) => {
                  if (nativeStreams.length < 2) return;
                  const current = nativeStreams.findIndex((stream) => stream.url === fromUrl);
                  setActiveStreamIndex(((current < 0 ? 0 : current) + 1) % nativeStreams.length);
                }}
                onError={handleVideoError}
                onReload={reloadStream}
              />
            ) : playerFrameSrc ? (
              <PlayerFrame
                src={playerFrameSrc}
                resetKey={`${site}-${video.id}-${retryNonce}`}
                title={video.title}
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
                onClick={reloadStream}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition-colors cursor-pointer"
                title="Reload Video Stream"
              >
                <ArrowClockwise size={14} className="text-amber-400" />
                <span>Reload Stream</span>
              </button>

              {iframeSrc && (
                <button
                  type="button"
                  onClick={() => setUseIframe((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-secondary/80 hover:bg-secondary text-foreground border border-border/40 transition-colors cursor-pointer"
                  title="Switch Player Engine"
                >
                  <MonitorPlay size={14} className="text-muted-foreground" />
                  <span>{useIframe ? "Use Native Player" : "Use Cinema Embed"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopyStream}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-secondary/80 hover:bg-secondary text-foreground border border-border/40 transition-colors cursor-pointer"
              >
                {copiedStream ? <Check size={14} className="text-emerald-400" /> : <LinkSimple size={14} />}
                <span>{copiedStream ? "Link Copied" : "Copy Link"}</span>
              </button>

              {video.full_video_url && isDirect && (
                <a
                  href={video.full_video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={`${video.slug || "voyeurhouse-video"}.mp4`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-secondary/80 hover:bg-secondary text-foreground border border-border/40 transition-colors"
                >
                  <DownloadSimple size={14} />
                  <span>Download MP4</span>
                </a>
              )}

              {video.detail_url && (
                <a
                  href={video.detail_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-amber-400 transition-colors"
                >
                  <span>Source &rarr;</span>
                </a>
              )}
            </div>

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Eye size={14} />
                <span className="tabular-nums">{video.views_raw || `${video.views_count || 0} views`}</span>
              </span>
              {video.duration_formatted && (
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  <span>{video.duration_formatted}</span>
                </span>
              )}
            </div>
          </div>

          <div className="mt-6 p-6 rounded-2xl bg-card/40 border border-border/40">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                {siteLabel}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground/70">{VOYEURHOUSE_SITE_SOURCES[site]}</span>
            </div>
            <h1 className="text-lg sm:text-2xl font-bold text-foreground leading-snug">{video.title}</h1>
            {video.raw_payload?.description && (
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed line-clamp-4">{video.raw_payload.description}</p>
            )}
            {video.tags && video.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <TagIcon size={13} /> Tags:
                </span>
                {video.tags.map((tag) => (
                  <Link key={tag} href={`${backHref}?tag=${encodeURIComponent(tag)}`}>
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
                <span>More like this on {siteLabel}</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {related.map((rv) => (
                  <VoyeurhouseCard key={rv.id} video={rv} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function isAvsDirectSource(video: VoyeurhouseVideo | null | undefined): boolean {
  if (!video?.full_video_url) return false;
  try {
    const host = new URL(video.full_video_url).hostname.toLowerCase();
    return /(^|\.)(clicknplay\.to|hotscopes\.(io|net|com|org)|reallifecam\.to|reallifecams\.net|voyeur-house\.org)$/.test(host);
  } catch {
    return false;
  }
}

function isDoodstreamSource(video: VoyeurhouseVideo | null | undefined): boolean {
  const candidates = [video?.full_video_url, video?.raw_payload?.embed_url].filter(Boolean) as string[];
  return candidates.some((value) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return /(^|\.)(doodstream\.com|dood\.(la|wf|so|pm|ws|to|sh|cx|yt|re|li)|myvidplay\.com|ds2play\.com)$/.test(host);
    } catch {
      return false;
    }
  });
}

function avsDirectPlayerUrl(video: VoyeurhouseVideo | null | undefined): string | null {
  if (!video?.full_video_url) return null;
  let host: string;
  try {
    host = new URL(video.full_video_url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!/(^|\.)(clicknplay\.to|hotscopes\.(io|net|com|org)|reallifecam\.to|reallifecams\.net|voyeur-house\.org)$/.test(host)) return null;

  const params = new URLSearchParams({
    url: video.full_video_url,
    title: video.title,
    poster: video.clean_thumbnail_url || video.thumbnail_url || "",
  });
  const embed = video.raw_payload?.embed_url || (video.video_mime_type === "embed/iframe" ? video.full_video_url : "");
  if (embed) params.set("embed", embed);
  if (video.detail_url) params.set("detail", video.detail_url);
  return `/api/player?${params.toString()}`;
}

function embedUrl(video: VoyeurhouseVideo | null | undefined): string | null {
  if (!video) return null;
  if (video.raw_payload?.embed_url) return video.raw_payload.embed_url;
  if (video.video_mime_type === "embed/iframe" && video.full_video_url) return video.full_video_url;
  return null;
}

// asset-cache-bust: 2026-11-25T2 (poisoned /assets/* immutable entries)

if (typeof window !== "undefined") { (window as unknown as { __chunkBuilds?: Record<string, number> }).__chunkBuilds = { b2: 1 }; }
