import { useRef, useState, useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoPlayer } from "@/components/VideoPlayer";
import { PlayerFrame } from "@/components/PlayerFrame";
import { copyText } from "@/lib/clipboard";
import { buildEdgePlayerUrl } from "@/lib/video-source";
import { iframeReferrerPolicy, detectHostLabel } from "@/lib/video-hosts";
import { proxyImageUrl } from "@/lib/proxy-url";
import {
  useOnlyfansVideoById,
  useOnlyfansRelatedVideos,
  isOnlyfansSite,
  ONLYFANS_SITE_LABELS,
} from "@/hooks/useOnlyfansVideos";
import { OnlyfansCard } from "@/components/OnlyfansCard";
import {
  ArrowLeft,
  Clock,
  Eye,
  Tag as TagIcon,
  ShareNetwork,
  Play,
  Check,
  WarningCircle,
  Sparkle,
  BookmarkSimple,
  LinkSimple,
  User,
  Broadcast,
  ArrowSquareOut,
  CaretDown
} from "@phosphor-icons/react";

/**
 * Several historical IGW CDN hostnames no longer resolve. cdn04 serves the
 * same video paths, so normalize every host before handing the URL to the
 * player (or to the stream proxy).
 */
function normalizeStreamUrl(url: string): string {
  return url.replace(/cdn\d+\.influencersgonewild\.net/gi, "cdn04.influencersgonewild.net");
}

/**
 * Read a rendition height only from a clean quality label or the final URL
 * path segment, so random hash segments cannot be misread as a resolution.
 */
function parseQuality(value: unknown): number {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  let text = raw;
  if (/^(?:https?:)?\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw.startsWith("//") ? `https:${raw}` : raw, window.location.origin);
      const parts = parsed.pathname.split("/").filter(Boolean);
      text = decodeURIComponent(parts[parts.length - 1] || "");
    } catch {
      text = "";
    }
  }
  if (/\b(?:4k|uhd|2160p?)\b/i.test(text)) return 2160;
  const match = text.match(/(?<!\d)(2160|1440|1080|720|480|360)p?(?!\d)/i);
  return match ? Number(match[1]) : 0;
}

function formatQualityLabel(raw: unknown, url?: string): string {
  const quality = parseQuality(raw) || parseQuality(url);
  if (quality >= 2160) return "4K UHD";
  if (quality === 1440) return "1440p QHD";
  if (quality === 1080) return "1080p Full HD";
  if (quality > 0) return `${quality}p`;
  const text = String(raw || "").trim();
  return text || "Original";
}

/** Hosts that require a spoofed Referer / Range-capable proxy for direct MP4s. */
function needsStreamProxy(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("influencersgonewild") ||
    u.includes("sheeshfans") ||
    u.includes("internetchicks")
  );
}

export default function OnlyfansWatch() {
  const { site: routeSite, id } = useParams<{ site: string; id: string }>();
  const site = isOnlyfansSite(routeSite) ? routeSite : undefined;

  const [copied, setCopied] = useState(false);
  const [copiedStream, setCopiedStream] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [selectedServerUrl, setSelectedServerUrl] = useState<string | null>(null);
  const [playerKey, setPlayerKey] = useState(0);
  const videoPlayerRef = useRef<HTMLVideoElement>(null);
  const pendingQualitySwitch = useRef<{ time: number; resume: boolean } | null>(null);

  // Reset selected server whenever navigating to a different video
  useEffect(() => {
    setSelectedServerUrl(null);
  }, [id]);

  const { data: video, isLoading, error } = useOnlyfansVideoById(site, id);
  const { data: relatedVideos, isLoading: relatedLoading } = useOnlyfansRelatedVideos(site, video, 8);

  const rawPayload = video?.raw_payload as any;

  // Build complete list of streaming servers
  const allServers = useMemo(() => {
    const rawList: any[] = rawPayload?.servers || rawPayload?.mirrors || [];
    const list: Array<{ server: string; url: string; quality_score?: number; quality_label?: string }> = [];

    const pushUnique = (item: { server: string; url: string; quality_score?: number; quality_label?: string }) => {
      if (!item.url || list.some((m) => m.url === item.url)) return;
      list.push(item);
    };

    for (const item of rawList) {
      let u = item.embed_url || item.url;
      if (!u) continue;
      u = normalizeStreamUrl(u);
      const qLabel = formatQualityLabel(item.quality_label || item.name || item.server, u);
      const label = item.name || item.server || detectHostLabel(u);
      pushUnique({ server: label, url: u, quality_score: item.quality_score, quality_label: qLabel });
    }

    const primaryUrl = normalizeStreamUrl(video?.full_video_url || "");
    if (primaryUrl && !list.some((m) => m.url === primaryUrl)) {
      list.unshift({
        server: "Primary Stream",
        url: primaryUrl,
        quality_score: video?.quality_score || 1080,
        quality_label: formatQualityLabel(video?.quality_label, primaryUrl) || "1080p Full HD",
      });
    }

    const DEAD_FIRST_HOSTS = [
      "sbfast.com",
      "sbfull.com",
      "streamlare.com",
      "vidoza.net",
      "bysejpadsk.com",
      "playmogo.com",
    ];
    const isDemoted = (url: string) => DEAD_FIRST_HOSTS.some((h) => url.toLowerCase().includes(h));
    return [...list.filter((s) => !isDemoted(s.url)), ...list.filter((s) => isDemoted(s.url))];
  }, [rawPayload, video]);

  const activeUrl =
    selectedServerUrl ||
    (allServers.length > 0 ? allServers[0].url : normalizeStreamUrl(video?.full_video_url || ""));

  // Check if active URL is a true direct video file, not an embed page.
  const isDirectVideo = useMemo(() => {
    if (!activeUrl) return false;
    let pathname = activeUrl.toLowerCase();
    try {
      pathname = new URL(activeUrl, window.location.origin).pathname.toLowerCase();
    } catch {}
    const u = activeUrl.toLowerCase();
    // Exclude iframe locker and embed patterns
    if (
      u.includes("/embed/") ||
      u.includes("/e/") ||
      u.includes("voe.sx") ||
      u.includes("streamtape") ||
      u.includes("playmogo") ||
      u.includes("bysezejataos") ||
      u.includes("dood")
    ) {
      return false;
    }
    return /\.(mp4|webm)\/?$/.test(pathname);
  }, [activeUrl]);

  useEffect(() => {
    if (!activeUrl) return;
    let origin = "";
    try { origin = new URL(activeUrl, window.location.origin).origin; } catch { return; }
    if (!origin || origin === window.location.origin) return;
    const id = "va-video-preconnect";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "preconnect";
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
    link.href = origin;
    return () => { /* keep latest; cleaned on next change */ };
  }, [activeUrl]);

  // Direct MP4s from these hosts require a spoofed Referer and Range support.
  const directPlaybackUrl = useMemo(() => {
    if (!activeUrl) return "";
    if (isDirectVideo && needsStreamProxy(activeUrl)) {
      return `/api/player/stream?url=${encodeURIComponent(activeUrl)}`;
    }
    return activeUrl;
  }, [activeUrl, isDirectVideo]);

  // Change renditions in the site's native video element without losing the
  // current playhead or turning a quality switch into a new playback session.
  useEffect(() => {
    const pending = pendingQualitySwitch.current;
    const player = videoPlayerRef.current;
    if (!pending || !isDirectVideo || !player) return;

    pendingQualitySwitch.current = null;
    const restorePlayback = () => {
      if (videoPlayerRef.current !== player) return;
      const lastPlayableTime = Number.isFinite(player.duration)
        ? Math.max(0, player.duration - 0.25)
        : pending.time;
      player.currentTime = Math.min(pending.time, lastPlayableTime);
      if (pending.resume) player.play().catch(() => {});
    };

    if (player.readyState >= 1) {
      restorePlayback();
      return;
    }

    player.addEventListener("loadedmetadata", restorePlayback, { once: true });
    return () => player.removeEventListener("loadedmetadata", restorePlayback);
  }, [directPlaybackUrl, isDirectVideo, playerKey]);

  const selectServer = (url: string) => {
    if (url === activeUrl) return;
    const player = videoPlayerRef.current;
    pendingQualitySwitch.current = isDirectVideo && player
      ? { time: player.currentTime, resume: !player.paused && !player.ended }
      : null;
    setSelectedServerUrl(url);
    setPlayerKey((key) => key + 1);
  };

  // Third-party embed lockers (VOE, Streamtape, DoodStream, PlayMogo, Byse,
  // Filemoon, Vidoza, sbfull, etc.) must load directly in the browser iframe
  // so anti-proxy scripts, Cloudflare WAF, SPAs, and IP-bound tokens (e.g.
  // Streamtape /get_video or VPN-accessed DoodStream) work as on the source site.
  const needsEdgePlayer = useMemo(() => {
    if (!activeUrl) return false;
    const u = activeUrl.toLowerCase();
    if (
      u.includes("voe.sx") ||
      u.includes("caseyseemavoid.com") ||
      u.includes("streamtape") ||
      u.includes("dood") ||
      u.includes("playmogo") ||
      u.includes("bysezejataos") ||
      u.includes("filemoon") ||
      u.includes("sbfull") ||
      u.includes("vidoza") ||
      u.includes("streamwish") ||
      u.includes("streamlare") ||
      u.includes("sltube") ||
      u.includes("lulustream") ||
      u.includes("luminscdn") ||
      u.includes("luluvdo") ||
      u.includes("mixdrop") ||
      u.includes("dropload") ||
      u.includes("dr0pstream") ||
      u.includes("vidara") ||
      u.includes("upns") ||
      u.includes("embedseek") ||
      u.includes("seeks.cloud")
    ) {
      return false;
    }
    if (site === "internetchicks" && !u.includes("internetchicks.com")) {
      return false;
    }
    return true;
  }, [activeUrl, site]);

  // First-party/site-hosted embed URLs go through the edge player, which
  // applies the right Referer and can unwrap direct streams.
  const embedPlaybackUrl = useMemo(() => {
    if (!activeUrl) return "";
    if (!needsEdgePlayer) return activeUrl;
    return buildEdgePlayerUrl(activeUrl, {
      title: video?.title,
      poster: video?.clean_thumbnail_url || video?.thumbnail_url || "",
      detail: video?.detail_url || activeUrl,
    });
  }, [activeUrl, needsEdgePlayer, video?.title, video?.clean_thumbnail_url, video?.thumbnail_url, video?.detail_url]);

  const cleanPosterUrl = useMemo(() => {
    const raw = video?.clean_thumbnail_url || video?.thumbnail_url;
    if (raw && !raw.startsWith("data:")) {
      return raw.startsWith("http") ? (proxyImageUrl(raw) || raw) : raw;
    }
    if (video?.source_post_id && video?.source_site === "sheeshfans") {
      const pid = parseInt(video.source_post_id, 10);
      if (!isNaN(pid) && pid > 0) {
        const folder = Math.floor(pid / 1000) * 1000;
        return `https://sheeshfans.com/contents/videos_screenshots/${folder}/${pid}/preview.jpg`;
      }
    }
    return undefined;
  }, [video]);

  const screenshots = useMemo(() => {
    const raw = [
      ...((video?.raw_payload?.screenshots as string[] | undefined) || []),
      ...((video?.raw_payload?.gallery as string[] | undefined) || []),
    ].filter((u): u is string => typeof u === "string" && u.trim().length > 0);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of raw) {
      const clean = u.trim();
      if (!/^https?:\/\//i.test(clean)) continue;
      if (seen.has(clean)) continue;
      // Skip obvious non-screenshot assets that slip through.
      if (/\/(logo|avatar|favicon|icon|banner|emoji)\b|gravatar\.com|wp-content\/plugins|wp-content\/themes/i.test(clean)) continue;
      seen.add(clean);
      out.push(clean);
      if (out.length <= 24) {
        // keep collecting; cap later
      }
    }
    return out.slice(0, 24);
  }, [video]);
  const [screenshotsOpen, setScreenshotsOpen] = useState(false);

  // Check if URL needs proxy or specific referrer policy
  const refPolicy = useMemo(() => {
    if (!activeUrl) return "no-referrer";
    return iframeReferrerPolicy(activeUrl);
  }, [activeUrl]);

  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem("onlyfans_saved_videos");
      const list: string[] = raw ? JSON.parse(raw) : [];
      setIsSaved(list.includes(id));
    } catch {
      setIsSaved(false);
    }
  }, [id]);

  useEffect(() => {
    if (!video) return;
    const prevTitle = document.title;
    document.title = `${video.title} - OnlyFans Leaks`;
    return () => {
      document.title = prevTitle;
    };
  }, [video]);

  const toggleSave = () => {
    if (!id) return;
    try {
      const raw = localStorage.getItem("onlyfans_saved_videos");
      let list: string[] = raw ? JSON.parse(raw) : [];
      if (list.includes(id)) {
        list = list.filter((x) => x !== id);
        setIsSaved(false);
      } else {
        list.unshift(id);
        setIsSaved(true);
      }
      localStorage.setItem("onlyfans_saved_videos", JSON.stringify(list));
    } catch {}
  };

  const handleShare = async () => {
    if (await copyText(window.location.href)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyStream = async () => {
    if (activeUrl && await copyText(activeUrl)) {
      setCopiedStream(true);
      window.setTimeout(() => setCopiedStream(false), 2000);
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
          <WarningCircle size={48} className="mx-auto text-cyan-500 mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">OnlyFans Video Not Found</h2>
          <p className="text-sm text-muted-foreground mb-6">
            This video may have been removed or the ID is invalid.
          </p>
          <Link href={site ? `/onlyfans/${site}` : "/onlyfans"}>
            <span className="px-4 py-2 rounded-xl text-sm font-medium bg-cyan-500 text-white cursor-pointer hover:bg-cyan-600 transition-colors inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Return to OnlyFans Catalog
            </span>
          </Link>
        </div>
      </Layout>
    );
  }

  const modelName = video?.actors?.[0] || video?.raw_payload?.model || "";
  const quality = formatQualityLabel(video?.quality_label, activeUrl) || "1080p Full HD";

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          {/* Breadcrumb / Back button */}
          <div className="flex items-center justify-between mb-4">
            <Link href={site ? `/onlyfans/${site}` : "/onlyfans"}>
              <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-cyan-400 transition-colors cursor-pointer">
                <ArrowLeft size={14} /> Back to OnlyFans Catalog
              </span>
            </Link>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleSave}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                  isSaved
                    ? "bg-cyan-500 text-white font-semibold shadow-sm"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <BookmarkSimple size={14} weight={isSaved ? "fill" : "regular"} />
                <span>{isSaved ? "Saved" : "Save"}</span>
              </button>
              <button
                onClick={handleShare}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <ShareNetwork size={14} />}
                <span>{copied ? "Copied Link" : "Share"}</span>
              </button>
              <button
                onClick={handleCopyStream}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
                title="Copy Direct Video / Embed URL"
              >
                {copiedStream ? <Check size={14} className="text-emerald-400" /> : <LinkSimple size={14} />}
                <span>{copiedStream ? "Copied Stream" : "Stream URL"}</span>
              </button>
            </div>
          </div>

          {/* Main Video Player Container */}
          <div className="relative aspect-video w-full bg-black rounded-2xl overflow-hidden border border-white/10 shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)] ring-1 ring-cyan-500/10 mb-6">
            {activeUrl ? (
              isDirectVideo ? (
                <VideoPlayer
                  key={`${directPlaybackUrl}-${playerKey}`}
                  src={directPlaybackUrl}
                  poster={cleanPosterUrl}
                  title={video.title}
                  videoRef={videoPlayerRef}
                  onReload={() => {
                    const curIdx = allServers.findIndex((s) => s.url === activeUrl);
                    if (curIdx >= 0 && curIdx < allServers.length - 1) {
                      setSelectedServerUrl(allServers[curIdx + 1].url);
                      setPlayerKey((key) => key + 1);
                    }
                  }}
                  onError={() => {
                    const curIdx = allServers.findIndex((s) => s.url === activeUrl);
                    if (curIdx >= 0 && curIdx < allServers.length - 1) {
                      setSelectedServerUrl(allServers[curIdx + 1].url);
                      setPlayerKey((key) => key + 1);
                    }
                  }}
                />
              ) : (
                <PlayerFrame
                  src={embedPlaybackUrl}
                  resetKey={`${activeUrl}-${playerKey}`}
                  title={video.title}
                  poster={cleanPosterUrl || undefined}
                  referrerPolicy={refPolicy as any}
                  onRetry={() => setPlayerKey((key) => key + 1)}
                  onNextSource={allServers.length > 1 ? () => {
                    const curIdx = allServers.findIndex((s) => s.url === activeUrl);
                    const nextIdx = curIdx >= 0 ? (curIdx + 1) % allServers.length : 0;
                    setSelectedServerUrl(allServers[nextIdx].url);
                    setPlayerKey((key) => key + 1);
                  } : undefined}
                />
              )
            ) : (
              <div className="relative flex flex-col items-center justify-center h-full text-center p-8 space-y-4 overflow-hidden">
                {cleanPosterUrl && (
                  <div className="absolute inset-0 bg-cover bg-center filter blur-xl opacity-20 scale-105 pointer-events-none" style={{ backgroundImage: `url(${cleanPosterUrl})` }} />
                )}
                <div className="relative z-10 w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-inner">
                  <WarningCircle size={26} weight="bold" />
                </div>
                <div className="relative z-10 space-y-1 max-w-md">
                  <h3 className="text-base font-semibold text-foreground">Video Stream Unavailable</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {allServers.length > 0 ? "The current server mirror is unreachable. Please select another mirror from the options below." : "This entry does not have an active playable video stream."}
                  </p>
                </div>
                <div className="relative z-10 pt-2 flex items-center gap-3">
                  <Link href={site ? `/onlyfans/${site}` : "/onlyfans"}>
                    <button className="px-4 py-2 rounded-xl text-xs font-medium bg-cyan-500 hover:bg-cyan-400 text-white shadow-md shadow-cyan-500/20 transition-all flex items-center gap-2 cursor-pointer">
                      <ArrowLeft size={14} /> Browse OnlyFans Catalog
                    </button>
                  </Link>
                  {video?.detail_url && (
                    <a href={video.detail_url} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-xl text-xs font-medium bg-card border border-border/80 hover:bg-accent text-muted-foreground hover:text-foreground transition-all inline-flex items-center gap-1.5">
                      <ArrowSquareOut size={14} /> Open Original Source
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Server Switcher Bar */}
          {allServers.length > 0 && (
            <div className="mb-6 p-4 rounded-2xl bg-card/60 border border-border/40 backdrop-blur-sm space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                  <Broadcast size={14} className="text-cyan-400" />
                  <span>
                    Available Server Mirrors (${allServers.length})
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground/70">
                  Switch mirror if stream fails or buffers
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {allServers.map((srv, idx) => {
                  const isActive = activeUrl === srv.url;
                  const label = srv.server || `Server ${idx + 1}`;
                  const qLabel = formatQualityLabel(srv.quality_label || srv.server, srv.url);
                  return (
                    <button
                      key={idx}
                      onClick={() => selectServer(srv.url)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                        isActive
                          ? "bg-cyan-500 text-white font-semibold shadow-md shadow-cyan-500/20"
                          : "bg-card text-muted-foreground hover:text-foreground hover:bg-card/80 border border-border/50"
                      }`}
                    >
                      <Play size={12} weight={isActive ? "fill" : "bold"} />
                      <span>{label}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded font-bold uppercase ${
                          isActive ? "bg-white/20 text-white" : "bg-cyan-500/10 text-cyan-400"
                        }`}
                      >
                        {qLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Video Metadata Header */}
          <div className="space-y-4 mb-8">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 uppercase">
                    {quality}
                  </span>
                  {modelName && (
                    <Link href={`/onlyfans/${video.source_site}?tag=${encodeURIComponent(modelName)}`}>
                      <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors cursor-pointer flex items-center gap-1">
                        <User size={12} weight="bold" />
                        <span>@{modelName}</span>
                      </span>
                    </Link>
                  )}
                  <span className="text-xs text-muted-foreground/70 capitalize">
                    Source: {ONLYFANS_SITE_LABELS[video.source_site as keyof typeof ONLYFANS_SITE_LABELS] || video.source_site}
                  </span>
                </div>

                <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-snug">
                  {video.title}
                </h1>

                {screenshots.length > 0 && (
                  <section className="rounded-2xl border border-border/40 bg-card/30 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setScreenshotsOpen((v) => !v)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                      aria-expanded={screenshotsOpen}
                      aria-controls="video-screenshots"
                    >
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-foreground">Screenshots</h2>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {screenshots.length} frame{screenshots.length === 1 ? "" : "s"} from this video
                        </p>
                      </div>
                      <span className={`shrink-0 text-muted-foreground transition-transform duration-200 ${screenshotsOpen ? "rotate-180" : ""}`}>
                        <CaretDown size={16} weight="bold" />
                      </span>
                    </button>
                    {screenshotsOpen && (
                      <div id="video-screenshots" className="px-4 pb-4 pt-1">
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                          {screenshots.map((src, i) => (
                            <a
                              key={`${src}-${i}`}
                              href={src}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group relative block overflow-hidden rounded-xl border border-border/40 bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                              aria-label={`Open screenshot ${i + 1}`}
                            >
                              <img
                                src={src}
                                alt={`Screenshot ${i + 1}`}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                                onError={(e) => {
                                  const img = e.currentTarget as HTMLImageElement;
                                  if (!img.dataset.fallback) {
                                    img.dataset.fallback = "1";
                                    img.src = `/api/media?url=${encodeURIComponent(src)}&no_webp=1`;
                                  } else {
                                    img.closest("a")?.remove();
                                  }
                                }}
                              />
                              <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5 rounded-xl" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {video.duration_formatted && (
                    <span className="flex items-center gap-1">
                      <Clock size={13} />
                      <span>{video.duration_formatted}</span>
                    </span>
                  )}
                  {video.views_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Eye size={13} />
                      <span>{video.views_raw || video.views_count.toLocaleString()} views</span>
                    </span>
                  )}
                  {video.published_at && (
                    <span>Published: {video.published_at.slice(0, 10)}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Tags */}
            {video.tags && video.tags.length > 0 && (
              <div className="pt-2 flex flex-wrap gap-1.5 items-center">
                <TagIcon size={14} className="text-muted-foreground mr-1" />
                {video.tags.map((tag, idx) => (
                  <Link key={idx} href={`/onlyfans/${video.source_site}?tag=${encodeURIComponent(tag)}`}>
                    <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-card/60 text-muted-foreground hover:text-foreground hover:bg-card border border-border/40 transition-colors cursor-pointer">
                      #{tag}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Related Videos Section */}
          <div className="mt-12 pt-8 border-t border-border/40 space-y-4">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Sparkle size={18} weight="fill" className="text-cyan-400" />
              <span>More OnlyFans Leaks & Archives</span>
            </h2>

            {relatedLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={idx} className="h-48 bg-muted/40 rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : relatedVideos && relatedVideos.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {relatedVideos.map((item) => (
                  <OnlyfansCard key={item.id} video={item} />
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No related videos found.</div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

// asset-cache-bust: 2026-11-25T2 (poisoned /assets/* immutable entries)

if (typeof window !== "undefined") { (window as unknown as { __chunkBuilds?: Record<string, number> }).__chunkBuilds = { b2: 1 }; }
