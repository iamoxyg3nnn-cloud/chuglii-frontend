import { useRef, useState, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { PlayerFrame } from "@/components/PlayerFrame";
import { HlsVideoPlayer } from "@/components/HlsVideoPlayer";
import { copyText } from "@/lib/clipboard";
import { buildEdgePlayerUrl } from "@/lib/video-source";
import { rankRelatedVideos } from "@/lib/recommendations";
import {
  useChineseVideoById,
  useChineseVideos,
  CHINESE_GROUP_LABELS,
  chineseDisplayTitle,
  isChineseGroup,
} from "@/hooks/useChineseVideos";
import { ChineseCard } from "@/components/ChineseCard";
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
  Magnet,
  HardDrives,
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

export default function ChineseWatch() {
  const { id } = useParams<{ id: string }>();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedMagnet, setCopiedMagnet] = useState(false);
  const [copiedStream, setCopiedStream] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [streamError, setStreamError] = useState(false);
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  const { data: video, isLoading, error } = useChineseVideoById(id);
  const { data: relatedPool } = useChineseVideos({
    category: video?.category_id || undefined,
    limit: 24,
    page: 1,
  });

  const related = useMemo(
    () => rankRelatedVideos(video, relatedPool?.items || [], 8),
    [video, relatedPool],
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem("chinese_saved_videos");
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
        localStorage.setItem("chinese_saved_videos", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const groupLabel = isChineseGroup(video?.category_group || undefined)
    ? CHINESE_GROUP_LABELS[video!.category_group as keyof typeof CHINESE_GROUP_LABELS]
    : "Chinese";
  const backHref = "/chinese";
  const isTorrent = video?.content_type === "torrent";

  useEffect(() => {
    if (!video) return;
    window.scrollTo({ top: 0 });
    document.title = `${chineseDisplayTitle(video)} - Chinese | Chuglii`;
    setMeta("description", `Watch ${chineseDisplayTitle(video)} on Chuglii. Chinese isolated category archive.`);
    setMeta("og:title", `${chineseDisplayTitle(video)} | Chinese`, true);
    setMeta("og:description", `Watch ${chineseDisplayTitle(video)} on Chuglii.`, true);
    const ogThumb = video.clean_thumbnail_url || video.thumbnail_url || "";
    if (ogThumb) setMeta("og:image", ogThumb, true);
    if (video.full_video_url) {
      setMeta("og:video", video.full_video_url, true);
      setMeta("og:video:type", video.video_mime_type === "video/mp4" ? "video/mp4" : "text/html", true);
    }
  }, [video]);

  const handleCopyMagnet = async () => {
    if (video?.magnet_uri && (await copyText(video.magnet_uri))) {
      setCopiedMagnet(true);
      window.setTimeout(() => setCopiedMagnet(false), 2000);
    }
  };

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
            This Chinese category item may have been removed or the ID is invalid.
          </p>
          <Link href={backHref}>
            <span className="px-4 py-2 rounded-xl text-sm font-medium bg-amber-500 text-white cursor-pointer hover:bg-amber-600 transition-colors inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Return to Chinese Feed
            </span>
          </Link>
        </div>
      </Layout>
    );
  }

  // Ordered CDN endpoint fallbacks: the source site rotates 8 api.php
  // endpoints because individual CDN hosts go down or get geo-blocked. The
  // edge player fails over through them when the primary manifest dies.
  // Plain computation (not useMemo) — this sits after conditional early
  // returns, so hooks are not allowed here.
  const streamFallbacks = (video.cdn_endpoints || [])
    .map((e) => (typeof e === "string" ? e : e?.url))
    .filter((u): u is string => typeof u === "string" && u.startsWith("http"));

  const playerFrameSrc = video.full_video_url
    ? buildEdgePlayerUrl(video.full_video_url, {
        title: chineseDisplayTitle(video),
        poster: video.clean_thumbnail_url || video.thumbnail_url || "",
        detail: video.detail_url,
        fallbacks: streamFallbacks,
      })
    : null;

  // HLS candidates for the in-page native player: primary manifest first,
  // then every CDN endpoint fallback, all proxied through the edge stream
  // route (CORS + referer + root-relative segment rewriting happen there).
  // Plain computation (not useMemo) — this sits after conditional early
  // returns, so hooks are not allowed here.
  const hlsCandidates = (() => {
    const primary = video.full_video_url || "";
    if (!primary) return [];
    const seen = new Set<string>();
    const urls = [primary, ...streamFallbacks];
    return urls
      .filter((u) => {
        if (!u || seen.has(u)) return false;
        seen.add(u);
        return true;
      })
      .map((u) => `/api/player/stream?url=${encodeURIComponent(u)}`);
  })();

  const screenshots = (video.screenshots || []).slice(0, 12);

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <Link href={backHref}>
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:text-amber-400 transition-colors cursor-pointer">
                <ArrowLeft size={15} /> Back to Chinese Feed
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
            {isTorrent ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-sky-950/40 to-black">
                <Magnet size={52} className="mb-3 text-sky-400" />
                <p className="text-sm font-semibold text-foreground">Torrent Release</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">
                  {video.size_label || "Unknown size"} {video.resolution ? `· ${video.resolution}` : ""} — grab the
                  magnet or .torrent file below to download this release.
                </p>
              </div>
            ) : streamError ? (
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
                key={`chinese-hls-${video.id}-${retryNonce}`}
                candidates={hlsCandidates}
                poster={video.clean_thumbnail_url || video.thumbnail_url || undefined}
                title={chineseDisplayTitle(video)}
                autoPlay
                onExhausted={() => setUseIframeFallback(true)}
              />
            ) : playerFrameSrc ? (
              <PlayerFrame
                src={playerFrameSrc}
                resetKey={`chinese-${video.id}-${retryNonce}`}
                title={chineseDisplayTitle(video)}
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
              {!isTorrent && (
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
              )}

              {!isTorrent && video.full_video_url && (
                <button
                  type="button"
                  onClick={handleCopyStream}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-secondary/80 hover:bg-secondary text-foreground border border-border/40 transition-colors cursor-pointer"
                >
                  {copiedStream ? <Check size={14} className="text-emerald-400" /> : <LinkSimple size={14} />}
                  <span>{copiedStream ? "Stream Copied" : "Copy Stream"}</span>
                </button>
              )}

              {isTorrent && video.magnet_uri && (
                <button
                  type="button"
                  onClick={handleCopyMagnet}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-500/40 transition-colors cursor-pointer"
                >
                  {copiedMagnet ? <Check size={14} className="text-emerald-400" /> : <Magnet size={14} />}
                  <span>{copiedMagnet ? "Magnet Copied" : "Copy Magnet"}</span>
                </button>
              )}

              {isTorrent && video.torrent_file_url && (
                <a
                  href={video.torrent_file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-secondary/80 hover:bg-secondary text-foreground border border-border/40 transition-colors"
                >
                  <HardDrives size={14} />
                  <span>Download .torrent</span>
                </a>
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
              {video.size_label && (
                <span className="flex items-center gap-1">
                  <HardDrives size={14} />
                  <span>{video.size_label}</span>
                </span>
              )}
            </div>
          </div>

          <div className="mt-6 p-6 rounded-2xl bg-card/40 border border-border/40">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                {groupLabel}
              </span>
              {video.category_name_en && (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-secondary/80 text-muted-foreground border border-border/30">
                  {video.category_name_en}
                  {video.category_name_cn ? ` · ${video.category_name_cn}` : ""}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1 ${
                isTorrent ? "bg-sky-500/15 text-sky-400 border border-sky-500/30" : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
              }`}>
                {isTorrent ? <Magnet size={11} /> : <MonitorPlay size={11} />}
                {isTorrent ? "Magnet" : "Stream"}
              </span>
            </div>
            <h1 className="text-lg sm:text-2xl font-bold text-foreground leading-snug">{chineseDisplayTitle(video)}</h1>

            {isTorrent && video.magnet_hash && (
              <div className="mt-3 space-y-1.5">
                <div className="text-xs text-muted-foreground">Info hash</div>
                <code className="block px-3 py-2 rounded-lg bg-black/40 border border-border/40 text-[11px] font-mono text-sky-300 break-all select-all">
                  {video.magnet_hash}
                </code>
              </div>
            )}

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

          {screenshots.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-foreground mb-3">Screenshots</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {screenshots.map((src, idx) => (
                  <a key={idx} href={src} target="_blank" rel="noopener noreferrer" className="block">
                    <img
                      src={src}
                      alt={`${chineseDisplayTitle(video)} screenshot ${idx + 1}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full aspect-video object-cover rounded-xl border border-border/40 hover:border-amber-500/50 transition-colors"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {related.length > 0 && (
            <div className="mt-10">
              <h2 className="text-base sm:text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                <Sparkle size={18} className="text-amber-400" />
                <span>More like this</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {related.map((rv) => (
                  <ChineseCard key={rv.id} video={rv} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

// asset-cache-bust: 2026-11-25T2 (poisoned /assets/* immutable entries)

if (typeof window !== "undefined") { (window as unknown as { __chunkBuilds?: Record<string, number> }).__chunkBuilds = { b2: 1 }; }
