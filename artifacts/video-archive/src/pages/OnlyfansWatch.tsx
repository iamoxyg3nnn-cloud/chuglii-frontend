import { useRef, useState, useEffect, useMemo } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { iframeReferrerPolicy, detectHostLabel } from "@/lib/video-hosts";
import { proxyImageUrl } from "@/lib/proxy-url";
import { useOnlyfansVideoById, useOnlyfansRelatedVideos, type OnlyfansVideo } from "@/hooks/useOnlyfansVideos";
import { OnlyfansCard } from "@/components/OnlyfansCard";
import {
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
  LinkSimple,
  User,
  Broadcast,
  ArrowClockwise
} from "@phosphor-icons/react";

export default function OnlyfansWatch() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  const [copied, setCopied] = useState(false);
  const [copiedStream, setCopiedStream] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [selectedServerUrl, setSelectedServerUrl] = useState<string | null>(null);
  const [playerKey, setPlayerKey] = useState(0);

  // Reset selected server whenever navigating to a different video
  useEffect(() => {
    setSelectedServerUrl(null);
  }, [id]);

  const { data: video, isLoading, error } = useOnlyfansVideoById(id);
  const { data: relatedVideos, isLoading: relatedLoading } = useOnlyfansRelatedVideos(id, 8);

  const rawPayload = video?.raw_payload as any;

  // Build complete list of streaming servers
  const allServers = useMemo(() => {
    const rawList: any[] = rawPayload?.servers || rawPayload?.mirrors || [];
    const list: Array<{ server: string; url: string; quality_score?: number; quality_label?: string }> = [];

    for (const item of rawList) {
      let u = item.embed_url || item.url || "";
      if (!u) continue;
      // Normalize dead influencersgonewild cdn hostnames to active cdn04
      if (u.includes(".influencersgonewild.net/")) {
        u = u.replace(/cdn\d+\.influencersgonewild\.net/, "cdn04.influencersgonewild.net");
      }
      const label = item.name || item.server || detectHostLabel(u);
      list.push({
        server: label,
        url: u,
        quality_score: item.quality_score,
        quality_label: item.quality_label,
      });
    }

    let primaryUrl = video?.full_video_url || "";
    if (primaryUrl.includes(".influencersgonewild.net/")) {
      primaryUrl = primaryUrl.replace(/cdn\d+\.influencersgonewild\.net/, "cdn04.influencersgonewild.net");
    }

    if (primaryUrl && !list.some((m) => m.url === primaryUrl)) {
      list.unshift({
        server: "Primary Stream",
        url: primaryUrl,
        quality_score: video?.quality_score || 1080,
        quality_label: video?.quality_label || "1080p Full HD",
      });
    }

    return list;
  }, [rawPayload, video]);

  const activeUrl = selectedServerUrl || (allServers.length > 0 ? allServers[0].url : video?.full_video_url);

  // Check if active URL is a true direct MP4 video file
  const isDirectMp4 = useMemo(() => {
    if (!activeUrl) return false;
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
    return u.endsWith(".mp4") || u.includes(".mp4?") || u.includes("/video.mp4");
  }, [activeUrl]);

  // If direct MP4 from influencersgonewild, proxy through /api/player/stream with Referer & Range support
  const directPlaybackUrl = useMemo(() => {
    if (!activeUrl) return "";
    if (isDirectMp4 && activeUrl.includes("influencersgonewild")) {
      return `/api/player/stream?url=${encodeURIComponent(activeUrl)}`;
    }
    return activeUrl;
  }, [activeUrl, isDirectMp4]);

  const cleanPosterUrl = useMemo(() => {
    const raw = video?.clean_thumbnail_url || video?.thumbnail_url;
    if (raw && !raw.startsWith("data:")) {
      return raw.startsWith("http") ? (proxyImageUrl(raw) || raw) : raw;
    }
    if (video?.source_post_id) {
      const pid = parseInt(video.source_post_id, 10);
      if (!isNaN(pid) && pid > 0) {
        const folder = Math.floor(pid / 1000) * 1000;
        return `https://sheeshfans.com/contents/videos_screenshots/${folder}/${pid}/preview.jpg`;
      }
    }
    return undefined;
  }, [video]);

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

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyStream = () => {
    if (activeUrl && navigator.clipboard) {
      navigator.clipboard.writeText(activeUrl);
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
          <WarningCircle size={48} className="mx-auto text-cyan-500 mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">OnlyFans Video Not Found</h2>
          <p className="text-sm text-muted-foreground mb-6">
            This video may have been removed or the ID is invalid.
          </p>
          <Link href="/onlyfans">
            <span className="px-4 py-2 rounded-xl text-sm font-medium bg-cyan-500 text-white cursor-pointer hover:bg-cyan-600 transition-colors inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Return to OnlyFans Catalog
            </span>
          </Link>
        </div>
      </Layout>
    );
  }

  const modelName = video.actors?.[0] || video.raw_payload?.model || "";
  const quality = video.quality_label || "1080p Full HD";

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          {/* Breadcrumb / Back button */}
          <div className="flex items-center justify-between mb-4">
            <Link href="/onlyfans">
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
          <div className="relative aspect-video w-full bg-black rounded-2xl overflow-hidden border border-border/50 shadow-2xl mb-6">
            {activeUrl ? (
              isDirectMp4 ? (
                <video
                  key={`${directPlaybackUrl}-${playerKey}`}
                  src={directPlaybackUrl}
                  poster={cleanPosterUrl}
                  controls
                  playsInline
                  autoPlay={false}
                  onError={() => {
                    // Auto-fallback to next server mirror if direct stream errors
                    const curIdx = allServers.findIndex((s) => s.url === activeUrl);
                    if (curIdx >= 0 && curIdx < allServers.length - 1) {
                      setSelectedServerUrl(allServers[curIdx + 1].url);
                      setPlayerKey((k) => k + 1);
                    }
                  }}
                  className="w-full h-full object-contain"
                />
              ) : (
                <iframe
                  key={`${activeUrl}-${playerKey}`}
                  src={activeUrl}
                  title={video.title}
                  className="w-full h-full border-0"
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy={refPolicy as any}
                />
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-3">
                <WarningCircle size={40} className="text-amber-400" />
                <div className="text-sm font-semibold">No direct stream available for this entry</div>
                <p className="text-xs text-muted-foreground max-w-md">
                  Please try selecting another mirror from the servers below.
                </p>
              </div>
            )}
          </div>

          {/* Server Switcher Bar */}
          {allServers.length > 0 && (
            <div className="mb-6 p-4 rounded-2xl bg-card/60 border border-border/40 backdrop-blur-sm space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                  <Broadcast size={14} className="text-cyan-400" />
                  <span>Available Server Mirrors ({allServers.length})</span>
                </span>
                <span className="text-[11px] text-muted-foreground/70">
                  Switch mirror if stream fails or buffers
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {allServers.map((srv, idx) => {
                  const isActive = activeUrl === srv.url;
                  const label = srv.server || `Server ${idx + 1}`;
                  const qLabel = srv.quality_label || "1080p";
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        setSelectedServerUrl(srv.url);
                        setPlayerKey((k) => k + 1);
                      }}
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
                    <Link href={`/onlyfans?tag=${encodeURIComponent(modelName)}`}>
                      <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors cursor-pointer flex items-center gap-1">
                        <User size={12} weight="bold" />
                        <span>@{modelName}</span>
                      </span>
                    </Link>
                  )}
                  <span className="text-xs text-muted-foreground/70 capitalize">
                    Source: {video.source_site}
                  </span>
                </div>

                <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-snug">
                  {video.title}
                </h1>

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
                  <Link key={idx} href={`/onlyfans?tag=${encodeURIComponent(tag)}`}>
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
