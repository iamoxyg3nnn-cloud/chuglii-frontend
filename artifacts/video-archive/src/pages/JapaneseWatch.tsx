import { useRef, useState, useEffect, useMemo } from "react";
import { useParams, Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { PlayerFrame } from "@/components/PlayerFrame";
import { copyText } from "@/lib/clipboard";
import { buildEdgePlayerUrl, isDirectVideoUrl } from "@/lib/video-source";
import { iframeReferrerPolicy } from "@/lib/video-hosts";
import { useJapaneseVideoById, useJapaneseRelatedVideos, type JapaneseVideo } from "@/hooks/useJapaneseVideos";
import { JapaneseCard } from "@/components/JapaneseCard";
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
  GlobeHemisphereWest,
  ArrowClockwise
} from "@phosphor-icons/react";

export default function JapaneseWatch() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  const [copied, setCopied] = useState(false);
  const [copiedStream, setCopiedStream] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [selectedServerUrl, setSelectedServerUrl] = useState<string | null>(null);
  const [playerKey, setPlayerKey] = useState(0);

  // Reset selected server mirror whenever navigating to a different video
  useEffect(() => {
    setSelectedServerUrl(null);
  }, [id]);

  const { data: video, isLoading, error } = useJapaneseVideoById(id);
  const { data: relatedVideos, isLoading: relatedLoading } = useJapaneseRelatedVideos(id, video, 8);

  const poster = video?.clean_thumbnail_url || video?.thumbnail_url || "";
  const rawPayload = video?.raw_payload as any;
  const allServers: Array<{ name: string; embed_url: string }> = rawPayload?.servers || [];
  
  // Sort priority: VOE HD (flawless direct player) -> VidSpeed (instant clean HLS) -> FC2Stream (clean HLS) -> LuluStream (clean HLS) -> EarnVids -> Streamtape
  const sortedServers = useMemo(() => {
    const list = [...allServers];
    const rank = (name: string, url: string = "") => {
      const n = (name + " " + url).toLowerCase();
      if (n.includes("voe") || n.includes("caseyseemavoid")) return 0;
      if (n.includes("vidspeed") || n.includes("vas") || n.includes("vvaassjjav")) return 1;
      if (n.includes("fc2") || n.includes("fst") || n.includes("fc2stream")) return 2;
      if (n.includes("lulu") || n.includes("luc") || n.includes("luminscdn")) return 3;
      if (n.includes("earnvids") || n.includes("evs") || n.includes("vidhide")) return 4;
      if (n.includes("streamtape") || n.includes("st")) return 5;
      return 6;
    };
    return list.sort((a, b) => rank(a.name, a.embed_url) - rank(b.name, b.embed_url));
  }, [allServers]);

  // Keep all active streaming mirrors
  const workingServers = useMemo(() => {
    return sortedServers.filter((s) => {
      const n = s.name.toLowerCase();
      const u = (s.embed_url || "").toLowerCase();
      return (
        n.includes("lulu") || n.includes("luc") || u.includes("luminscdn") ||
        n.includes("fc2") || u.includes("fc2stream") ||
        n.includes("voe") || u.includes("voe.sx") || u.includes("caseyseemavoid") ||
        n.includes("streamtape") || u.includes("streamtape.com") ||
        n.includes("vidspeed") || n.includes("vas") || u.includes("vvaassjjav") ||
        n.includes("earnvids") || u.includes("evsishere") || u.includes("vidhide")
      );
    });
  }, [sortedServers]);

  const effectiveServers = workingServers.length > 0 ? workingServers : sortedServers;

  // Fallback to video.full_video_url if raw_payload.servers is empty
  const servers = useMemo(() => {
    if (effectiveServers.length > 0) return effectiveServers;
    const fallback: Array<{ name: string; embed_url: string }> = [];
    if (video?.full_video_url) {
      const u = video.full_video_url.toLowerCase();
      let label = "Primary Mirror";
      if (u.includes("lulu") || u.includes("luc") || u.includes("luminscdn")) label = "LuluStream";
      else if (u.includes("fc2") || u.includes("fc2stream")) label = "FC2Stream";
      else if (u.includes("voe") || u.includes("caseyseemavoid")) label = "VOE HD";
      else if (u.includes("vidspeed") || u.includes("vas") || u.includes("vvaassjjav")) label = "VidSpeed";
      else if (u.includes("streamtape")) label = "Streamtape";
      fallback.push({ name: label, embed_url: video.full_video_url });
    }
    return fallback;
  }, [effectiveServers, video?.full_video_url]);

  const defaultEmbedUrl = servers[0]?.embed_url || rawPayload?.embed_url || video?.full_video_url || video?.trailer_preview_url;
  const activeEmbedUrl = selectedServerUrl || defaultEmbedUrl;

  const getCleanEmbedUrl = (rawUrl: string | null) => {
    if (!rawUrl) return null;
    return rawUrl;
  };

  const currentEmbedUrl = getCleanEmbedUrl(activeEmbedUrl);

  // Determine if host requires edge referer spoofing / unblocking proxy
  const needsEdgeProxy = (urlStr: string | null) => {
    if (!urlStr) return false;
    const u = urlStr.toLowerCase();
    // VOE HD works best directly (its anti-proxy script blocks proxies, but embeds cleanly directly)
    if (u.includes("voe.sx") || u.includes("caseyseemavoid.com")) return false;
    // LuluStream (luminscdn / lulustream / luluvdo) strictly binds HLS tokens to client TCP socket IP.
    // Must embed directly with referrerpolicy="no-referrer" so client's browser generates and plays token directly without 403 / infinite stalls
    if (u.includes("luminscdn") || u.includes("lulustream") || u.includes("luluvdo")) return false;
    // Direct raw MP4/WebM files (not streamtape) can play directly, even with signed query tokens.
    if (isDirectVideoUrl(urlStr) && !u.includes("streamtape")) return false;
    // All other hosts (FC2Stream, EarnVids, VidSpeed, Streamtape) MUST go through /api/player
    // to bypass domain restrictions (Referer spoofing), CSP frame-ancestors, and rogue download triggers
    return true;
  };

  const resolvedEmbedUrl = currentEmbedUrl
    ? (needsEdgeProxy(currentEmbedUrl)
        ? buildEdgePlayerUrl(currentEmbedUrl, {
            title: video?.title,
            poster,
            detail: video?.detail_url || currentEmbedUrl,
          })
        : currentEmbedUrl)
    : null;

  const serverUrls = servers.map((server) => server.embed_url).filter(Boolean);
  const selectNextMirror = () => {
    if (serverUrls.length < 2) {
      setPlayerKey((key) => key + 1);
      return;
    }
    const currentIndex = serverUrls.indexOf(activeEmbedUrl || "");
    setSelectedServerUrl(serverUrls[(currentIndex + 1) % serverUrls.length]);
    setPlayerKey((key) => key + 1);
  };

  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem("chuglii_saved_japanese");
      const list: string[] = raw ? JSON.parse(raw) : [];
      setIsSaved(list.includes(id));
    } catch {
      setIsSaved(false);
    }
  }, [id]);

  useEffect(() => {
    if (!video) return;
    const prevTitle = document.title;
    document.title = `${video.title} - Japanese Vault`;

    return () => {
      document.title = prevTitle;
    };
  }, [video]);

  const toggleSave = () => {
    if (!id) return;
    try {
      const raw = localStorage.getItem("chuglii_saved_japanese");
      let list: string[] = raw ? JSON.parse(raw) : [];
      if (list.includes(id)) {
        list = list.filter((x) => x !== id);
        setIsSaved(false);
      } else {
        list.unshift(id);
        setIsSaved(true);
      }
      localStorage.setItem("chuglii_saved_japanese", JSON.stringify(list));
    } catch {}
  };

  const handleShare = async () => {
    if (await copyText(window.location.href)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyStream = async () => {
    const stream = activeEmbedUrl || video?.full_video_url || video?.trailer_preview_url;
    if (stream && await copyText(stream)) {
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
          <WarningCircle size={48} className="mx-auto text-rose-500 mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Japanese Video Not Found</h2>
          <p className="text-sm text-muted-foreground mb-6">
            This Japanese video may have been removed or the ID is invalid.
          </p>
          <Link href="/japanese">
            <span className="px-4 py-2 rounded-xl text-sm font-medium bg-rose-500 text-white cursor-pointer hover:bg-rose-600 transition-colors inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Return to Japanese Catalog
            </span>
          </Link>
        </div>
      </Layout>
    );
  }

  const primaryStream = activeEmbedUrl || video.full_video_url || video.trailer_preview_url;
  const makerCode = rawPayload?.maker_code || "";

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          {/* Breadcrumb Header */}
          <div className="flex items-center justify-between gap-4 mb-4">
            <Link href="/japanese">
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:text-rose-400 transition-colors cursor-pointer">
                <ArrowLeft size={15} /> Back to Japanese Vault
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

          {/* Video Cinema Player Frame */}
          <div className="relative aspect-video w-full max-h-[70vh] mx-auto bg-black rounded-2xl overflow-hidden shadow-2xl border border-border/30">
            {resolvedEmbedUrl ? (
              <PlayerFrame
                src={resolvedEmbedUrl}
                resetKey={`${id}-${playerKey}`}
                title={video.title}
                poster={poster || undefined}
                referrerPolicy={iframeReferrerPolicy(resolvedEmbedUrl)}
                onRetry={() => setPlayerKey((key) => key + 1)}
                onNextSource={serverUrls.length > 1 ? selectNextMirror : undefined}
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

          {/* Multi-Server Mirror Switcher */}
          {servers && servers.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-xl bg-card/60 border border-border/40 text-xs shadow-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                  <Sparkle size={14} className="text-rose-400" /> Video Host / Server:
                </span>
                {servers.map((srv, idx) => {
                  const isSelected = activeEmbedUrl === srv.embed_url;
                  return (
                    <button
                      key={srv.name + idx}
                      onClick={() => {
                        setSelectedServerUrl(srv.embed_url);
                        setPlayerKey((k) => k + 1);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        isSelected
                          ? "bg-rose-500 text-white shadow-md shadow-rose-500/25 ring-1 ring-rose-400"
                          : "bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/30 hover:border-border"
                      }`}
                    >
                      {isSelected && <Check size={12} weight="bold" className="text-white" />}
                      <span>{srv.name}</span>
                    </button>
                  );
                })}
              </div>

              {/* Quick reload button */}
              <button
                type="button"
                onClick={() => setPlayerKey((k) => k + 1)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/30 transition-colors cursor-pointer"
                title="Reload Current Host Player"
              >
                <ArrowClockwise size={13} />
                <span>Reload</span>
              </button>
            </div>
          )}

          {/* Video Action Toolbar */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {primaryStream && (
                <a
                  href={primaryStream}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-rose-500 hover:bg-rose-600 text-white shadow-sm transition-all"
                >
                  <DownloadSimple size={16} weight="bold" />
                  <span>Open Stream Mirror</span>
                </a>
              )}

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
                      <span>Copy Stream</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Performance / Views Counter */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Eye size={15} />
                <span>{video.views_raw || video.views_count.toLocaleString()} views</span>
              </div>
              {video.rating_score != null && (
                <div className="flex items-center gap-1 text-emerald-400 font-medium">
                  <ThumbsUp size={14} weight="fill" />
                  <span>{video.rating_raw || `${video.rating_score}%`}</span>
                </div>
              )}
              {video.duration_formatted && (
                <div className="flex items-center gap-1">
                  <Clock size={14} />
                  <span>{video.duration_formatted}</span>
                </div>
              )}
            </div>
          </div>

          {/* Video Metadata & Performer Badges */}
          <div className="mt-6 p-5 rounded-2xl bg-card/40 border border-border/40">
            {makerCode && (
              <span className="inline-block px-2.5 py-1 rounded-md text-xs font-bold uppercase bg-rose-600/90 text-white mb-3">
                {makerCode}
              </span>
            )}
            <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-4 leading-snug">
              {video.title}
            </h1>

            {/* Actors / Models */}
            {video.actors && video.actors.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <User size={14} className="text-rose-400" /> Models / Cast:
                </span>
                {video.actors.map((actor) => (
                  <span
                    key={actor}
                    onClick={() => setLocation(`/japanese?q=${encodeURIComponent(actor)}`)}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500 hover:text-white transition-colors cursor-pointer"
                  >
                    {actor}
                  </span>
                ))}
              </div>
            )}

            {/* Tags */}
            {video.tags && video.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {video.tags.map((tag) => (
                  <span
                    key={tag}
                    onClick={() => setLocation(`/japanese?tag=${encodeURIComponent(tag)}`)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-secondary/80 text-muted-foreground hover:text-foreground border border-border/30 hover:border-border transition-colors cursor-pointer"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Related Japanese Videos Section */}
          <div className="mt-12">
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
              <Sparkle size={18} className="text-rose-400" /> More Japanese Videos
            </h2>
            {relatedLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="aspect-[16/10] bg-muted/40 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {(relatedVideos || []).map((rel) => (
                  <JapaneseCard key={rel.id} video={rel} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
