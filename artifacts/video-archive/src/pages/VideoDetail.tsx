import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  useGetRecording,
  useListRelatedRecordings,
  useGetReactions,
  useToggleReaction,
  getGetRecordingQueryKey,
  getListRelatedRecordingsQueryKey,
  getGetReactionsQueryKey,
  getRecording,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { CommentSection } from "@/components/CommentSection";
import { VideoCard } from "@/components/VideoCard";
import { PlatformBadge } from "@/components/PlatformBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { formatBytes, formatRelativeTime, formatDuration } from "@/lib/formatters";
import { getSessionId } from "@/lib/session";
import { trackView, useListRecommendations } from "@/lib/api";
import { trackActivity } from "@/lib/rum";
import { useAuth } from "@/contexts/AuthContext";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { userApi, recordingToMeta, type CloudCollection, type PerformerFollow } from "@/lib/user-api";
import { addWatchedId } from "@/lib/watched-storage";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { useWatchProgress } from "@/hooks/use-watch-progress";
import { usePreloadRecordings } from "@/hooks/use-preload-recordings";
import { usePlayQueue } from "@/hooks/use-play-queue";
import { QueueBar } from "@/components/QueueBar";
import { UpNextOverlay } from "@/components/UpNextOverlay";
import { advanceQueue, nextQueueItem, toQueueItem } from "@/lib/play-queue";
import { proxyUrl } from "@/lib/proxy-url";
import { safeExternalUrl } from "@/lib/safe-url";
import { deriveServers, detectHostLabel, iframeReferrerPolicy } from "@/lib/video-hosts";
import { AdBanner } from "@/components/ads/AdBanner";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { PrerollPlayer } from "@/components/ads/PrerollPlayer";
import { usePremium } from "@/contexts/PremiumContext";
import { useAds } from "@/contexts/AdsContext";
import { pickPreroll, type PrerollCreative } from "@/lib/preroll";
import {
  absoluteUrl,
  canonicalUrl,
  isoDuration,
  organizationNode,
  SITE_URL,
  truncate,
  usePageSeo,
  websiteNode,
} from "@/lib/seo";

import {
  WarningCircle, ArrowLeft, CornersOut, CornersIn,
  UserCircle, FilmStrip, ThumbsUp, ThumbsDown, BookmarkSimple, ShareNetwork,
  Check, HardDrives, DownloadSimple, Clock, Play, Code, Playlist, Shuffle,
  FolderSimplePlus, Plus, CaretDown, CaretLeft, CaretRight, ArrowSquareOut, SignIn, CheckCircle, ArrowClockwise,
  Television, Lightbulb, Keyboard, SlidersHorizontal, Sparkle, Info, MonitorPlay, Heart,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function useFullscreen(ref: React.RefObject<HTMLDivElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const enter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Element has requestFullscreen; add webkit variant for Safari support
    type FullEl = Element & { webkitRequestFullscreen?: () => Promise<void> };
    const fEl = el as FullEl;
    if (fEl.requestFullscreen) fEl.requestFullscreen();
    else if (fEl.webkitRequestFullscreen) fEl.webkitRequestFullscreen();
  }, [ref]);
  const exit = useCallback(() => {
    type FullDoc = Document & { webkitExitFullscreen?: () => void };
    const fDoc = document as FullDoc;
    if (fDoc.exitFullscreen) fDoc.exitFullscreen();
    else if (fDoc.webkitExitFullscreen) fDoc.webkitExitFullscreen();
  }, []);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  return { isFullscreen, enter, exit };
}

// Host detection, normalization (Dropload, AnonMP4, LuluStream, VOE, etc.),
// and embed/server derivation are handled centrally in "@/lib/video-hosts".

export default function VideoDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const sessionId = getSessionId();
  const playerRef = useRef<HTMLDivElement>(null);
  const recSectionRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, enter: enterFS, exit: exitFS } = useFullscreen(playerRef);
  const { user } = useAuth();

  // â”€â”€â”€ Video Player Enhancements & States â”€â”€â”€
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [ambientGlow, setAmbientGlow] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("v_ambient_glow") !== "false";
  });
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "21:9" | "4:3">(() => {
    if (typeof window === "undefined") return "16:9";
    const stored = localStorage.getItem("v_aspect_ratio");
    return stored === "21:9" || stored === "4:3" ? stored : "16:9";
  });
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);


  const [serverToast, setServerToast] = useState<string | null>(null);
  const [autoplayEnabled, setAutoplayEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("v_autoplay") !== "false";
  });

  const toggleAutoplay = useCallback(() => {
    setAutoplayEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("v_autoplay", String(next));
      setServerToast(`Autoplay ${next ? "Enabled" : "Disabled"}`);
      setTimeout(() => setServerToast(null), 2000);
      return next;
    });
  }, []);

  const toggleAmbientGlow = useCallback(() => {
    setAmbientGlow((prev) => {
      const next = !prev;
      localStorage.setItem("v_ambient_glow", String(next));
      return next;
    });
  }, []);

  const handleAspectRatioChange = useCallback((ratio: "16:9" | "21:9" | "4:3") => {
    setAspectRatio(ratio);
    localStorage.setItem("v_aspect_ratio", ratio);
  }, []);

  const [activeServer, setActiveServer] = useState(() => {
    if (typeof window === "undefined") return 0;
    const stored = sessionStorage.getItem("vserver");
    return stored ? parseInt(stored, 10) : 0;
  });
  const [videoStarted, setVideoStarted] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("vplayed") === id;
  });
  // Pre-roll ad (Admin â†’ Ads â†’ "Pre-roll video" slot): "idle" waits for the
  // play gesture on the poster click, "playing" shows the overlay, "done"
  // never re-arms during this page visit (server switches included).
  const [prerollPhase, setPrerollPhase] = useState<"idle" | "playing" | "done">("idle");
  const [activePreroll, setActivePreroll] = useState<PrerollCreative | null>(null);
  const [prerollWithGesture, setPrerollWithGesture] = useState(false);
  const { showAds } = usePremium();
  const { rows: adRows, status: adsStatus, settings: adSettings } = useAds();
  const prerollOn = showAds && adSettings.placements.preroll !== false;
  // Do not let the build-time file fallback win while the authoritative
  // database request is still pending. "file" means the provider settled
  // on fallback; "database" means even an empty DB result is authoritative.
  const preroll = useMemo(
    () => (prerollOn && adsStatus !== "pending" ? pickPreroll(adRows) : null),
    [prerollOn, adsStatus, adRows],
  );

  const startPlayback = useCallback(() => {
    setVideoStarted(true);
    if (id) sessionStorage.setItem("vplayed", id);
  }, [id]);

  /** Poster click: gate through the preroll when one is armed, else start. */
  const handlePosterClick = () => {
    if (prerollOn && prerollPhase === "idle" && preroll) {
      setPrerollWithGesture(true);
      setActivePreroll(preroll);
      setPrerollPhase("playing");
      return;
    }
    startPlayback();
  };

  /** Preroll ended/errored/skipped â†’ start the main video (never the other way around). */
  const finishPreroll = useCallback(() => {
    setPrerollPhase("done");
    setActivePreroll(null);
    setPrerollWithGesture(false);
    startPlayback();
  }, [startPlayback]);
  const [bookmarked, setBookmarked] = useState(false);
  const bookmarkedRef = useRef(false);
  const [watchLater, setWatchLater] = useState(false);
  const watchLaterRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const collectionRef = useRef<HTMLDivElement>(null);
  const [cloudCollections, setCloudCollections] = useState<CloudCollection[]>([]);
  const [newColName, setNewColName] = useState("");
  const [addedToCol, setAddedToCol] = useState<string | null>(null);
  const [creatingCol, setCreatingCol] = useState(false);
  const [addingColId, setAddingColId] = useState<string | null>(null);

  useEffect(() => {
    if (!collectionOpen) return;
    const handler = (e: MouseEvent) => {
      if (collectionRef.current && !collectionRef.current.contains(e.target as Node)) {
        setCollectionOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [collectionOpen]);
  const [recPage, setRecPage] = useState(1);
  const REC_PAGE_SIZE = 12;
  const queryClient = useQueryClient();
  const recentlyWatched = useRecentlyWatched();
  const { data: video, isLoading, isError, refetch: retryRecording } = useGetRecording(id || "", {
    query: { enabled: !!id, queryKey: getGetRecordingQueryKey(id || "") },
  });

  // Performer follow state
  const { data: follows = [] } = useQuery({
    queryKey: ["user", "follows"],
    queryFn: () => userApi.getFollows(),
    enabled: !!user,
  });

  const isFollowing = useMemo(() => {
    if (!video?.username) return false;
    return (follows as PerformerFollow[]).some((f: PerformerFollow) => f.performer_username === video.username);
  }, [follows, video?.username]);

  const followMutation = useTrackedMutation({
    mutationFn: () => userApi.addFollow(video!.username),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "follows"] }),
  });

  const unfollowMutation = useTrackedMutation({
    mutationFn: () => userApi.removeFollow(video!.username),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user", "follows"] }),
  });

  const handleToggleFollow = () => {
    if (!user) {
      setLocation("/login");
      return;
    }
    if (!video?.username) return;
    if (isFollowing) {
      unfollowMutation.mutate();
    } else {
      followMutation.mutate();
    }
    trackActivity("follow", { meta: { username: video.username, action: isFollowing ? "unfollow" : "follow" } });
  };

  // Playback queue (Playlists â†’ Play all): position is derived from the route,
  // so deep links, back/forward and manual URL edits all stay in sync.
  // nextInQueue is loop-aware (wraps to the first item when loop is on).
  const queue = usePlayQueue();
  const queueIndex = queue ? queue.items.findIndex((it) => it.id === id) : -1;
  const nextInQueue = queue && queueIndex >= 0 ? nextQueueItem(queue, id) : null;

  // Analytics: recording detail view (once per recording mount).
  useEffect(() => {
    if (id) trackActivity("recording_view", { meta: { recording_id: id } });
  }, [id]);

  const { data: related, isLoading: relatedLoading } = useListRelatedRecordings(
    { id: id || "", limit: 12 },
    { query: { enabled: !!id, queryKey: getListRelatedRecordingsQueryKey({ id: id || "", limit: 12 }) } },
  );

  const {
    data: recData,
    isLoading: recLoading,
    isFetching: recFetching,
    isError: recError,
  } = useListRecommendations(
    { page: recPage, limit: REC_PAGE_SIZE, exclude: id },
    { enabled: !!id, placeholderData: keepPreviousData, staleTime: 30_000 },
  );

  // Standalone Autoplay recommendation: when not in an explicit playlist queue,
  // pick the next related recording by the same performer or shared tags,
  // falling back to top catalogue recommendation.
  const nextRecommended = useMemo(() => {
    if (!video) return null;
    const fromRelated = related?.find((r) => r.id !== id);
    if (fromRelated) return toQueueItem(fromRelated);
    const fromRecs = recData?.data?.find((r) => r.id !== id);
    if (fromRecs) return toQueueItem(fromRecs);
    return null;
  }, [video, id, related, recData?.data]);

  const effectiveNext = nextInQueue ?? (autoplayEnabled ? nextRecommended : null);

  const effectiveDuration = useMemo(() => {
    if (typeof video?.duration === "number" && video.duration > 0) {
      return video.duration;
    }
    if (typeof video?.filesize === "number" && video.filesize > 0) {
      return Math.max(120, Math.round(video.filesize / 250000));
    }
    return 600; // 10 min fallback for unknown duration
  }, [video?.duration, video?.filesize]);

  const { data: reactions, refetch: refetchReactions } = useGetReactions(
    { recording_id: id || "", session_id: sessionId },
    { query: { enabled: !!id, queryKey: getGetReactionsQueryKey({ recording_id: id || "", session_id: sessionId }) } },
  );

  usePreloadRecordings(related);
  usePreloadRecordings(recData?.data);

  // Warm the next recording so auto-advance / manual next feels instant.
  useEffect(() => {
    if (!effectiveNext) return;
    void queryClient.prefetchQuery({
      queryKey: getGetRecordingQueryKey(effectiveNext.id),
      queryFn: ({ signal }) => getRecording(effectiveNext.id, { signal }),
    });
  }, [effectiveNext, queryClient]);

  const toggleReaction = useToggleReaction();

  useEffect(() => {
    // Consume a pending queue-arrival flag (vauto, set by handleQueueAdvance /
    // QueueBar before navigation): start playback immediately instead of
    // parking on the click-to-play poster â€” a queue means continuous
    // playback. When a preroll is loaded it is armed for the auto-arrival
    // without a gesture (PrerollPlayer then autoplays it muted); otherwise
    // the video starts straight away. The flag is consumed unconditionally so
    // a stale value can never auto-start an unrelated video later.
    const autoId = sessionStorage.getItem("vauto");
    sessionStorage.removeItem("vauto");
    const isAutoArrival = !!id && autoId === id;
    if (isAutoArrival && prerollOn && preroll) {
      setVideoStarted(false);
      setPrerollWithGesture(false);
      setActivePreroll(preroll);
      setPrerollPhase("playing");
    } else {
      setPrerollWithGesture(false);
      setPrerollPhase("idle");
      setActivePreroll(null);
      if (isAutoArrival) startPlayback();
      else setVideoStarted(sessionStorage.getItem("vplayed") === id);
    }
    setActiveServer(0);
    setCollectionOpen(false);
    setAddedToCol(null);
    setBookmarked(false);
    bookmarkedRef.current = false;
    setWatchLater(false);
    watchLaterRef.current = false;
    setRecPage(1);
    if (id && user) {
      userApi.getSaved().then((items) => {
        setBookmarked(items.some((i) => i.recording_id === id));
      }).catch(() => {});
      userApi.getWatchLater().then((items) => {
        setWatchLater(items.some((i) => i.recording_id === id));
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);

  useEffect(() => {
    if (recPage > 1 && recSectionRef.current) {
      recSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recPage]);

  useEffect(() => {
    if (collectionOpen && user) {
      userApi.getCollections().then(setCloudCollections).catch(() => {});
    }
  }, [collectionOpen, user]);

  const getVideoMeta = () => {
    if (!video) return null;
    return {
      id: video.id,
      username: video.username,
      filename: video.filename,
      room_title: video.room_title,
      thumbnail_url: video.thumbnail_url,
      preview_url: video.preview_url,
      resolution: video.resolution,
      timestamp: video.timestamp,
      saved_at: new Date().toISOString(),
    };
  };

  const handleAddToCollection = async (colId: string) => {
    const meta = getVideoMeta();
    if (!meta || !user || addingColId !== null) return;
    setAddingColId(colId);
    try {
      await userApi.addCollectionItem(colId, meta.id, recordingToMeta(meta));
      // Analytics: recording added to an existing collection.
      trackActivity("collection_item_add", { meta: { collection_id: colId, recording_id: meta.id } });
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
      queryClient.invalidateQueries({ queryKey: ["public-playlists"] });
      queryClient.invalidateQueries({ queryKey: ["public-playlist-items", colId] });
      setAddedToCol(colId);
      setTimeout(() => {
        setCollectionOpen(false);
        setAddedToCol(null);
      }, 1200);
    } catch (err) {
      console.error("Failed to add to collection:", err);
    } finally {
      setAddingColId(null);
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newColName.trim() || !user || creatingCol) return;
    const meta = getVideoMeta();
    if (!meta) return;
    setCreatingCol(true);
    try {
      const col = await userApi.createCollection(newColName.trim());
      await userApi.addCollectionItem(col.id, meta.id, recordingToMeta(meta));
      // Analytics: collection created (with a recording added in one action).
      trackActivity("collection_create", { meta: { collection_id: col.id, recording_id: meta.id } });
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
      queryClient.invalidateQueries({ queryKey: ["public-playlists"] });
      queryClient.invalidateQueries({ queryKey: ["public-playlist-items", col.id] });
      setCloudCollections((prev) => [{ ...col, item_count: 1 }, ...prev]);
      setAddedToCol(col.id);
      setNewColName("");
      setTimeout(() => {
        setCollectionOpen(false);
        setAddedToCol(null);
      }, 1200);
    } catch (err) {
      console.error("Failed to create collection and add video:", err);
    } finally {
      setCreatingCol(false);
    }
  };

  useEffect(() => {
    if (!video) return;
    // Always write to localStorage for instant badge feedback,
    // regardless of auth state. Authenticated users also sync to
    // the server for cross-device history.
    addWatchedId(video.id, {
      username: video.username,
      filename: video.filename,
      thumbnail_url: video.thumbnail_url,
    });
    if (user) {
      const meta = {
        id: video.id,
        username: video.username,
        filename: video.filename,
        room_title: video.room_title,
        thumbnail_url: video.thumbnail_url,
        preview_url: video.preview_url,
        sprite_url: video.sprite_url,
        resolution: video.resolution,
        timestamp: video.timestamp,
        saved_at: new Date().toISOString(),
      };
      userApi.addHistory(video.id, recordingToMeta(meta)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, user]);

  // â”€â”€â”€ Track view on page load (once per video ID) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const trackedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!video?.id || trackedRef.current.has(video.id)) return;
    trackedRef.current.add(video.id);
    trackView(video.id);
  }, [video?.id]);

  useEffect(() => {
    if (!video?.thumbnail_url) return;
    const proxiedUrl = proxyUrl(video.thumbnail_url);
    if (!proxiedUrl) return;
    const img = new Image();
    img.fetchPriority = "high";
    img.src = proxiedUrl;
  }, [video?.thumbnail_url]);

  const safeEmbedSource = safeExternalUrl(video?.embed_url);
  const servers = deriveServers(video?.embed_url, video?.links);
  const currentServer = servers[activeServer] ?? servers[0];

  const handleSelectServer = useCallback((index: number) => {
    setActiveServer(index);
    sessionStorage.setItem("vserver", String(index));
    setPlayerReloadKey((k) => k + 1);
    const target = servers[index];
    if (target) {
      setServerToast(`Switched to Server ${index + 1}: ${target.label}`);
      setTimeout(() => setServerToast(null), 2400);
    }
  }, [servers]);

  const handleNextServer = useCallback(() => {
    if (servers.length <= 1) return;
    const nextIdx = (activeServer + 1) % servers.length;
    handleSelectServer(nextIdx);
  }, [servers.length, activeServer, handleSelectServer]);

  const handleReloadPlayer = useCallback(() => {
    setPlayerReloadKey((k) => k + 1);
    setServerToast(`Reloading ${currentServer?.label || "Player"}...`);
    setTimeout(() => setServerToast(null), 2000);
  }, [currentServer?.label]);

  /**
   * Universal next-video advance:
   * Advances through active playlist queue if present, or continuous autoplay to next recommended video.
   */
  const handleAdvance = useCallback(() => {
    // 1. Active playlist queue
    if (queue && nextInQueue) {
      if (nextInQueue.id === id) {
        trackActivity("queue_advance", { meta: { recording_id: nextInQueue.id } });
        sessionStorage.removeItem("vplayed");
        setVideoStarted(false);
        setPrerollPhase("idle");
        window.scrollTo({ top: 0, behavior: "auto" });
        return;
      }
      sessionStorage.setItem("vauto", nextInQueue.id);
      advanceQueue(queue, id, {
        navigate: (href) => setLocation(href),
        scrollToTop: () => window.scrollTo({ top: 0, behavior: "auto" }),
        track: (event, meta) => trackActivity(event, { meta }),
      });
      return;
    }

    // 2. Continuous Autoplay for standalone recordings
    if (effectiveNext && effectiveNext.id !== id) {
      sessionStorage.setItem("vauto", effectiveNext.id);
      trackActivity("autoplay_advance", { meta: { from_id: id, to_id: effectiveNext.id } });
      setLocation(`/video/${encodeURIComponent(effectiveNext.id)}`);
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [queue, nextInQueue, id, effectiveNext, setLocation]);

  // Handle postMessage events from embeds reporting ended playback
  useEffect(() => {
    if (!videoStarted || !effectiveNext || !autoplayEnabled) return;

    const handleMessage = (e: MessageEvent) => {
      try {
        let data = e.data;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch {
            if (data === "ended" || data === "video:ended" || data === "player:ended") {
              handleAdvance();
              return;
            }
          }
        }
        if (data && typeof data === "object") {
          const event = (data.event || data.type || data.status || "").toString().toLowerCase();
          if (
            event === "ended" ||
            event === "video_ended" ||
            event === "complete" ||
            event === "finish" ||
            data.state === 0 ||
            (data.event === "onStateChange" && data.info === 0)
          ) {
            handleAdvance();
          }
        }
      } catch {
        // Ignore cross-origin parsing errors
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [videoStarted, effectiveNext, autoplayEnabled, handleAdvance]);

  const aspectClass = useMemo(() => {
    if (aspectRatio === "21:9") return "aspect-[21/9]";
    if (aspectRatio === "4:3") return "aspect-[4/3]";
    return "aspect-video";
  }, [aspectRatio]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        isFullscreen ? exitFS() : enterFS();
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setIsTheaterMode((prev) => !prev);
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        toggleAmbientGlow();
      } else if (e.key === "s" || e.key === "S") {
        if (servers.length > 1) {
          e.preventDefault();
          handleNextServer();
        }
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        handleReloadPlayer();
      } else if (e.key === "n" || e.key === "N") {
        if (effectiveNext) {
          e.preventDefault();
          handleAdvance();
        }
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      } else if (e.key === " " || e.key === "k" || e.key === "K") {
        if (!videoStarted) {
          e.preventDefault();
          handlePosterClick();
        }
      } else if (e.key === "Escape") {
        if (isTheaterMode) {
          setIsTheaterMode(false);
        }
        if (shortcutsOpen) {
          setShortcutsOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isFullscreen, enterFS, exitFS, isTheaterMode, shortcutsOpen, servers.length, videoStarted, effectiveNext, handleNextServer, handleReloadPlayer, toggleAmbientGlow, handlePosterClick, handleAdvance]);
  
  // Count estimated watch time only after the in-page player is launched.
  useWatchProgress({ video, durationSeconds: video?.duration, isActive: videoStarted && currentServer?.type === "iframe" });

  const posterUrl = video?.sprite_url || video?.thumbnail_url;

  // Public, indexable detail-page metadata. RouteSeoMeta supplies a generic
  // fallback while the recording request is in flight; this upgrade runs as
  // soon as the recording data (or a cached copy) is available.
  const seoConfig = useMemo(() => {
    if (!video) return null;

    const performer = video.username;
    const displayTitle =
      video.room_title && video.room_title !== performer
        ? `${performer}: ${video.room_title}`
        : `${performer} — ${video.filename}`;
    const tags = (video.tags ?? []).filter(Boolean).slice(0, 8);
    const image = absoluteUrl(
      proxyUrl(video.thumbnail_url || video.sprite_url || video.preview_url),
    );
    const canonical = canonicalUrl(`/video/${encodeURIComponent(video.id)}`);
    const description = truncate(
      [
        `Watch ${performer}'s archived adult cam recording${
          video.room_title ? ` “${video.room_title}”` : ""
        } on VAULT.`,
        video.duration ? `Duration ${formatDuration(video.duration)}.` : "",
        video.resolution ? `${video.resolution} quality.` : "",
        video.viewers ? `${video.viewers.toLocaleString()} views.` : "",
        tags.length ? `Tags: ${tags.join(", ")}.` : "",
        "Adults only (18+).",
      ]
        .filter(Boolean)
        .join(" "),
      300,
    );
    const pageTitle = truncate(displayTitle, 68);

    const graph: Record<string, unknown>[] = [
      websiteNode(),
      organizationNode(),
    ];
    if (image) {
      graph.push({
        "@type": "VideoObject",
        "@id": `${canonical}#video`,
        url: canonical,
        name: pageTitle,
        description,
        thumbnailUrl: [image],
        uploadDate: video.timestamp,
        duration: isoDuration(video.duration),
        embedUrl: video.embed_url ?? undefined,
        isFamilyFriendly: false,
        inLanguage: "en",
        keywords: tags.length ? tags.join(", ") : undefined,
        actor: {
          "@type": "Person",
          name: performer,
          url: `${SITE_URL}/performers/${encodeURIComponent(performer)}`,
        },
      });
    }
    graph.push({
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: `${pageTitle} | VAULT`,
      description,
      inLanguage: "en",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      about: image ? { "@id": `${canonical}#video` } : undefined,
      primaryImageOfPage: image ? { "@type": "ImageObject", url: image } : undefined,
    });

    return {
      title: pageTitle,
      description,
      canonical,
      image,
      imageAlt: `${performer} archived adult cam recording on VAULT`,
      type: "video.other" as const,
      jsonLd: { "@context": "https://schema.org", "@graph": graph },
    };
  }, [video]);

  usePageSeo(seoConfig);

  const handleReaction = (type: "like" | "dislike") => {
    if (!id) return;

    // Analytics: reaction toggle (like/dislike).
    trackActivity("reaction", { meta: { recording_id: id, type } });

    const queryKey = getGetReactionsQueryKey({ recording_id: id, session_id: sessionId });

    // Cancel any in-flight refetches so they don't overwrite our optimistic update
    queryClient.cancelQueries({ queryKey });

    // Snapshot previous value for rollback
    const previousReactions = queryClient.getQueryData(queryKey);

    // Optimistic update â€” UI responds instantly
    queryClient.setQueryData(queryKey, (old: unknown) => {
      const current = (old as { likes: number; dislikes: number; user_reaction?: string | null }) ?? { likes: 0, dislikes: 0, user_reaction: null };
      const prevReaction = current.user_reaction;

      if (prevReaction === type) {
        // Toggle off
        return {
          ...current,
          [type === "like" ? "likes" : "dislikes"]: Math.max(0, (current[type === "like" ? "likes" : "dislikes"] ?? 0) - 1),
          user_reaction: null,
        };
      }

      // Toggle on or switch
      const result = { ...current };
      if (prevReaction) {
        result[prevReaction === "like" ? "likes" : "dislikes"] = Math.max(0, (result[prevReaction === "like" ? "likes" : "dislikes"] ?? 0) - 1);
      }
      result[type === "like" ? "likes" : "dislikes"] = (result[type === "like" ? "likes" : "dislikes"] ?? 0) + 1;
      result.user_reaction = type;
      return result;
    });

    toggleReaction.mutate(
      { data: { recording_id: id, type, session_id: sessionId } },
      {
        onSuccess: (data) => {
          // Use the exact server response to avoid race conditions
          queryClient.setQueryData(queryKey, data);
        },
        onError: () => {
          // Rollback on failure
          if (previousReactions) {
            queryClient.setQueryData(queryKey, previousReactions);
          }
        },
      },
    );
  };

  const handleBookmark = async () => {
    if (!video || !user) return;
    const isCurrently = bookmarkedRef.current;
    // Optimistic toggle
    const newState = !isCurrently;
    bookmarkedRef.current = newState;
    setBookmarked(newState);
    try {
      const savedRec = {
        id: video.id,
        username: video.username,
        filename: video.filename,
        room_title: video.room_title,
        thumbnail_url: video.thumbnail_url,
        preview_url: video.preview_url,
        sprite_url: video.sprite_url,
        resolution: video.resolution,
        timestamp: video.timestamp,
        saved_at: new Date().toISOString(),
      };
      if (isCurrently) {
        await userApi.removeSaved(video.id);
      } else {
        await userApi.addSaved(video.id, recordingToMeta(savedRec));
      }
      // Analytics: bookmark add/remove.
      trackActivity("bookmark", { meta: { recording_id: video.id, action: isCurrently ? "remove" : "add" } });
    } catch {
      // Revert optimistic toggle on failure
      bookmarkedRef.current = isCurrently;
      setBookmarked(isCurrently);
    }
  };

  const handleWatchLater = async () => {
    if (!video || !user) return;
    const isCurrently = watchLaterRef.current;
    // Optimistic toggle
    const newState = !isCurrently;
    watchLaterRef.current = newState;
    setWatchLater(newState);
    try {
      const savedRec = {
        id: video.id,
        username: video.username,
        filename: video.filename,
        room_title: video.room_title,
        thumbnail_url: video.thumbnail_url,
        preview_url: video.preview_url,
        sprite_url: video.sprite_url,
        resolution: video.resolution,
        timestamp: video.timestamp,
        saved_at: new Date().toISOString(),
      };
      if (isCurrently) {
        await userApi.removeWatchLater(video.id);
      } else {
        await userApi.addWatchLater(video.id, recordingToMeta(savedRec));
      }
      // Analytics: watch-later add/remove.
      trackActivity("watch_later", { meta: { recording_id: video.id, action: isCurrently ? "remove" : "add" } });
    } catch {
      // Revert optimistic toggle on failure
      watchLaterRef.current = isCurrently;
      setWatchLater(isCurrently);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: select from a temporary textarea for HTTP or denied clipboard
      try {
        const ta = document.createElement("textarea");
        ta.value = window.location.href;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch { /* clipboard unavailable */ }
    }
  };

  const handleCopyEmbed = async () => {
    if (!currentServer?.src) return;
    const code = `<iframe src="${currentServer.src}" width="960" height="540" frameborder="0" allow="autoplay; fullscreen; picture-in-picture"></iframe>`;
    try {
      await navigator.clipboard.writeText(code);
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2500);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setEmbedCopied(true);
        setTimeout(() => setEmbedCopied(false), 2500);
      } catch { /* clipboard unavailable */ }
    }
  };



  const totalReactions = (reactions?.likes ?? 0) + (reactions?.dislikes ?? 0);
  const likePercent = totalReactions > 0 ? Math.round(((reactions?.likes ?? 0) / totalReactions) * 100) : null;

  if (isError) {
    // A recording can vanish from the archive while it sits in a playback
    // queue â€” offer the next queued item instead of dead-ending.
    const deadNext = queue ? nextQueueItem(queue, id) : null;
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-24 text-center">
          <WarningCircle size={40} weight="duotone" className="text-muted-foreground/40 mx-auto mb-5" />
          <h1 className="text-lg font-bold mb-2">Couldn&apos;t load this recording</h1>
          <p className="text-sm text-muted-foreground mb-6">
            It may have been removed, or there may be a temporary connection issue. Try again.
          </p>
          <div className="mb-6">
            <button
              onClick={() => void retryRecording()}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-primary/40 text-primary hover:border-primary/70 transition-colors rounded-lg cursor-pointer"
            >
              <ArrowClockwise size={14} weight="bold" />
              Try again
            </button>
          </div>
          {deadNext && (
            <div className="mb-6">
              <button
                onClick={handleAdvance}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold border border-primary/40 text-primary hover:border-primary/70 transition-colors rounded-lg cursor-pointer"
              >
                <Play size={14} weight="fill" />
                Play next in queue: {deadNext.username}
              </button>
            </div>
          )}
          <Link href="/browse" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <ArrowLeft size={14} weight="bold" /> Back to Browse
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-7xl">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/browse"
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors group"
          >
            <ArrowLeft size={13} weight="bold" className="group-hover:-translate-x-0.5 transition-transform" />
            Browse
          </Link>
        </div>

        {/* Theater mode ambient backdrop */}
        {isTheaterMode && (
          <div
            className="fixed inset-0 bg-black/85 z-30 transition-opacity duration-300 backdrop-blur-sm cursor-pointer"
            onClick={() => setIsTheaterMode(false)}
            title="Exit theater mode (Esc or T)"
            aria-label="Exit theater mode"
          />
        )}

        <div className={cn("grid gap-8 transition-all duration-300", isTheaterMode ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-[1fr_300px]")}>
          {/* â”€â”€â”€ Main column â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div className={cn("space-y-4 min-w-0 transition-all duration-300", isTheaterMode && "relative z-40 max-w-6xl mx-auto w-full")}>
            {/* Ad above the player â€” 728Ã—90 / 468Ã—60 / 300Ã—100 */}
            {!isTheaterMode && <AdLeaderboard />}



            {/* Player — click-to-play with Ambient glow wrapper */}
            {isLoading ? (
              <Skeleton className="w-full aspect-video rounded-2xl" />
            ) : video ? (
              <div className="relative">
                {/* Ambient lighting glow */}
                {ambientGlow && proxyUrl(posterUrl) && (
                  <div
                    className={cn(
                      "pointer-events-none absolute -inset-3 sm:-inset-6 -z-10 rounded-3xl opacity-35 blur-2xl sm:blur-3xl transition-opacity duration-700 bg-cover bg-center overflow-hidden",
                      isTheaterMode ? "opacity-55 blur-3xl scale-105" : "opacity-35"
                    )}
                    style={{
                      backgroundImage: `url(${proxyUrl(posterUrl)})`,
                      transform: "translate3d(0, 0, 0)",
                    }}
                    aria-hidden="true"
                  />
                )}

                <div
                  ref={playerRef}
                  className={cn(
                    "relative group w-full bg-black overflow-hidden rounded-2xl border border-border/70 shadow-sm transition-all duration-300",
                    aspectClass,
                    isTheaterMode && "z-40 ring-1 ring-white/20 shadow-2xl scale-[1.01]"
                  )}
                >
                  {/* Transient action feedback toast */}
                  {serverToast && (
                    <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 px-4 py-1.5 rounded-full bg-black/85 backdrop-blur-md border border-white/20 text-white text-xs font-semibold shadow-2xl pointer-events-none flex items-center gap-2 animate-in fade-in zoom-in-95 duration-150">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{serverToast}</span>
                    </div>
                  )}

                  {currentServer?.type === "iframe" && !videoStarted ? (
                    /* Pre-roll first (armed by this click), else poster / click-to-play */
                    prerollPhase === "playing" && prerollOn && activePreroll ? (
                      <PrerollPlayer creative={activePreroll} onDone={finishPreroll} withGesture={prerollWithGesture} />
                    ) : (
                    <button
                      className="absolute inset-0 w-full h-full cursor-pointer focus:outline-none group/poster"
                      onClick={handlePosterClick}
                      aria-label="Play video"
                    >
                    {proxyUrl(posterUrl) ? (
                      <OptimizedImage
                        src={proxyUrl(posterUrl)!}
                        alt={video.username}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover/poster:scale-[1.02]"
                        containerClassName="w-full h-full"
                        width="hero"
                        fetchPriority="high"
                        loading="eager"
                        fallback={
                          <div className="w-full h-full bg-black flex items-center justify-center">
                            <FilmStrip size={44} weight="duotone" className="text-white/10" />
                          </div>
                        }
                      />
                    ) : (
                      <div className="w-full h-full bg-black flex items-center justify-center">
                        <FilmStrip size={44} weight="duotone" className="text-white/10" />
                      </div>
                    )}

                    {/* Cinema Stage Vignette & Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/60 flex flex-col justify-between p-4 sm:p-6 transition-colors group-hover/poster:from-black/80 group-hover/poster:via-black/20">
                      {/* Top poster bar */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-semibold text-white/95 shadow-xs">
                            {video.username}
                          </span>
                          {video.timestamp && (
                            <span className="text-[11px] text-white/70 hidden sm:inline">
                              {new Date(video.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-medium text-white/90 shadow-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            <span>{currentServer.label}</span>
                          </div>
                        </div>
                      </div>

                      {/* Center Play Button */}
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="w-18 h-18 sm:w-20 sm:h-20 rounded-full bg-black/50 backdrop-blur-md border border-white/25 group-hover/poster:border-primary/80 group-hover/poster:bg-primary/20 flex items-center justify-center transition-all duration-300 group-hover/poster:scale-105 active:scale-95 shadow-2xl">
                          <Play size={28} weight="fill" className="text-white ml-1 group-hover/poster:text-primary transition-colors" />
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-white font-medium text-xs tracking-wide">
                            Click or press <kbd className="px-1.5 py-0.5 text-[10px] bg-white/10 border border-white/20 rounded font-mono">Space</kbd> to play
                          </span>
                          <span className="text-white/50 text-[11px]">
                            Streaming via {currentServer.label}
                          </span>
                        </div>
                      </div>

                      {/* Bottom Metadata Badges */}
                      <div className="flex items-center justify-between text-xs text-white/80">
                        <div className="flex items-center gap-2">
                          <PlatformBadge recording={video} />
                          {video.resolution && (
                            <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-bold text-white/90">
                              {video.resolution}
                            </span>
                          )}
                          {video.duration != null && video.duration > 0 && (
                            <span className="px-2 py-0.5 rounded bg-black/60 backdrop-blur-md border border-white/10 text-[11px] tabular-nums font-mono text-white/80">
                              {formatDuration(video.duration)}
                            </span>
                          )}
                          {video.filesize ? (
                            <span className="text-[11px] text-white/60 hidden sm:inline tabular-nums">
                              {formatBytes(video.filesize)}
                            </span>
                          ) : null}
                        </div>

                        <div className="text-[11px] text-white/60 font-mono hidden sm:inline">
                          Direct Embed Player
                        </div>
                      </div>
                    </div>
                    </button>
                    )
                ) : currentServer?.type === "link" ? (
                  <div className="relative w-full h-full flex flex-col items-center justify-center p-6 text-center overflow-hidden bg-black/90 select-none">
                    {/* Atmospheric blurred poster backdrop */}
                    {posterUrl && (
                      <div
                        className="absolute inset-0 bg-cover bg-center opacity-15 blur-2xl scale-110 pointer-events-none"
                        style={{ backgroundImage: `url(${proxyUrl(posterUrl)})` }}
                      />
                    )}
                    <div className="absolute inset-0 bg-radial from-transparent via-black/60 to-black pointer-events-none" />

                    {/* Centered Glassmorphism Launcher Box */}
                    <div className="relative z-10 max-w-md w-full mx-auto p-6 sm:p-8 rounded-2xl bg-neutral-900/85 backdrop-blur-xl border border-white/10 shadow-2xl flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-200">
                      <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center text-primary shadow-inner">
                        <MonitorPlay size={30} weight="duotone" />
                      </div>

                      <div className="flex flex-col items-center gap-1.5">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-semibold text-primary">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>{currentServer.label} Dedicated Player</span>
                        </div>
                        <h3 className="text-lg font-bold text-white tracking-tight">
                          {currentServer.label === "AnonMP4"
                            ? "AnonMP4 Secure Playback"
                            : `Launch ${currentServer.label}`}
                        </h3>
                        <p className="text-xs text-white/60 leading-relaxed max-w-xs">
                          {currentServer.label === "AnonMP4"
                            ? "AnonMP4 uses single-session ticket security requiring direct top-level browser access. Launch the dedicated popout player below."
                            : `This mirror requires direct playback on ${currentServer.label} for optimal streaming performance.`}
                        </p>
                      </div>

                      <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            window.open(
                              currentServer.src,
                              "anonmp4_player",
                              "width=1120,height=680,menubar=no,toolbar=no,location=no,status=no,resizable=yes"
                            );
                          }}
                          className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs sm:text-sm font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 active:scale-95 transition-all cursor-pointer"
                        >
                          <MonitorPlay size={16} weight="bold" />
                          <span>Launch Popout</span>
                        </button>

                        <a
                          href={currentServer.src}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white/90 text-xs sm:text-sm font-medium transition-colors"
                        >
                          <ArrowSquareOut size={16} weight="bold" />
                          <span>New Tab</span>
                        </a>
                      </div>

                      {/* Mirror switch shortcut if other in-page servers exist */}
                      {servers.some((s) => s.type === "iframe") && (
                        <button
                          type="button"
                          onClick={() => {
                            const firstIframe = servers.findIndex((s) => s.type === "iframe");
                            if (firstIframe !== -1) handleSelectServer(firstIframe);
                          }}
                          className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors pt-1 cursor-pointer"
                        >
                          <ArrowClockwise size={13} weight="bold" />
                          <span>Switch to In-Page Server ({servers.find((s) => s.type === "iframe")?.label})</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : currentServer?.type === "iframe" ? (
                  <iframe
                    key={`${currentServer.src}-${activeServer}-${playerReloadKey}`}
                    src={currentServer.src}
                    className="w-full h-full border-0"
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    referrerPolicy={iframeReferrerPolicy(currentServer.src)}
                    title={video.room_title || video.filename}
                  />
                ) : proxyUrl(posterUrl) ? (
                  <OptimizedImage
                    src={proxyUrl(posterUrl)!}
                    alt={video.filename}
                    className="w-full h-full object-contain"
                    containerClassName="w-full h-full"
                    width="hero"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center">
                        <FilmStrip size={44} weight="duotone" className="text-muted-foreground/20" />
                      </div>
                    }
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FilmStrip size={44} weight="duotone" className="text-muted-foreground/20" />
                  </div>
                )}

                {/* Up Next countdown & Autoplay Overlay */}
                {currentServer?.type === "iframe" && videoStarted && video && effectiveNext && (
                  <UpNextOverlay
                    key={`${video.id}-${effectiveNext.id}`}
                    next={effectiveNext}
                    durationSeconds={effectiveDuration}
                    autoplay={autoplayEnabled}
                    onPlayNow={handleAdvance}
                  />
                )}

                {/* Fullscreen Floating Exit Button (only shown in native fullscreen) */}
                {isFullscreen && (
                  <div className="absolute bottom-4 right-4 z-40 flex items-center gap-2">
                    <button
                      onClick={exitFS}
                      className="h-9 px-3.5 flex items-center gap-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/20 text-white text-xs font-semibold hover:bg-black transition-all cursor-pointer shadow-2xl"
                      title="Exit fullscreen (F or Esc)"
                    >
                      <CornersIn size={16} weight="bold" />
                      <span>Exit Fullscreen</span>
                    </button>
                  </div>
                )}
                </div>

                {/* Docked Cinema Deck — Consolidated Pro Toolbar */}
                {video && servers.length > 0 && (
                  <div className="w-full mt-2.5 p-2 sm:p-2.5 rounded-2xl bg-neutral-900/90 backdrop-blur-md border border-white/[0.08] shadow-lg flex items-center justify-between gap-3 flex-wrap select-none">
                    {/* Left: Source Mirrors */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="flex items-center gap-1 px-1.5 text-[11px] font-semibold text-white/40 uppercase tracking-wider">
                        <HardDrives size={13} weight="bold" />
                        <span className="hidden sm:inline">Source</span>
                      </div>

                      <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-xl border border-white/5">
                        {servers.map((s, i) => (
                          <button
                            key={i}
                            onClick={() => handleSelectServer(i)}
                            className={cn(
                              "px-2.5 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1.5",
                              activeServer === i
                                ? "bg-white/15 text-white font-semibold shadow-xs border border-white/10"
                                : "text-white/60 hover:text-white hover:bg-white/5"
                            )}
                            title={`Switch to ${s.label} (${s.type === "iframe" ? "In-Page Embed" : "External Popout"})`}
                          >
                            <span className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              activeServer === i ? "bg-emerald-400 animate-pulse" : "bg-white/30"
                            )} />
                            <span>{s.label}</span>
                            <span className="text-[10px] text-white/40 hidden md:inline font-mono">
                              {s.type === "iframe" ? "embed" : "popout"}
                            </span>
                          </button>
                        ))}
                      </div>

                      {/* Stream Reload */}
                      <button
                        onClick={handleReloadPlayer}
                        className="h-7 w-7 flex items-center justify-center rounded-lg bg-black/40 border border-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                        title="Reload mirror stream (R)"
                        aria-label="Reload stream"
                      >
                        <ArrowClockwise size={13} weight="bold" />
                      </button>
                    </div>

                    {/* Center Telemetry (Resolution & Duration) */}
                    <div className="hidden lg:flex items-center gap-2 text-xs text-white/40 font-mono">
                      {video.resolution && (
                        <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5 text-white/70 font-semibold text-[11px]">
                          {video.resolution}
                        </span>
                      )}
                      {video.duration != null && video.duration > 0 && (
                        <span className="tabular-nums">
                          {formatDuration(video.duration)}
                        </span>
                      )}
                    </div>

                    {/* Right: Stage Controls */}
                    <div className="flex items-center gap-1.5 ml-auto">
                      {/* Aspect Ratio */}
                      <div className="hidden sm:flex items-center bg-black/40 rounded-lg p-0.5 border border-white/5">
                        {(["16:9", "21:9", "4:3"] as const).map((ratio) => (
                          <button
                            key={ratio}
                            onClick={() => handleAspectRatioChange(ratio)}
                            className={cn(
                              "px-2 py-0.5 text-[11px] font-medium rounded-md transition-all cursor-pointer",
                              aspectRatio === ratio
                                ? "bg-white/15 text-white font-semibold shadow-xs"
                                : "text-white/50 hover:text-white"
                            )}
                            title={`Aspect ratio: ${ratio}`}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>

                      {/* Autoplay Next */}
                      <button
                        onClick={toggleAutoplay}
                        className={cn(
                          "h-7 px-2.5 flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer",
                          autoplayEnabled
                            ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10 shadow-xs"
                            : "border-white/5 bg-black/40 text-white/60 hover:text-white hover:border-white/15"
                        )}
                        title={`Autoplay next video: ${autoplayEnabled ? "ON" : "OFF"}`}
                      >
                        <span className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          autoplayEnabled ? "bg-emerald-400 animate-pulse" : "bg-white/30"
                        )} />
                        <span className="hidden sm:inline">Autoplay</span>
                      </button>

                      {/* Ambient Glow */}
                      <button
                        onClick={toggleAmbientGlow}
                        className={cn(
                          "h-7 px-2.5 flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer",
                          ambientGlow
                            ? "border-amber-400/40 text-amber-300 bg-amber-400/10"
                            : "border-white/5 bg-black/40 text-white/60 hover:text-white hover:border-white/15"
                        )}
                        title="Toggle Ambient Glow (A)"
                        aria-label="Toggle ambient lighting"
                      >
                        <Lightbulb size={13} weight={ambientGlow ? "fill" : "regular"} />
                        <span className="hidden md:inline">Glow</span>
                      </button>

                      {/* Theater Mode */}
                      <button
                        onClick={() => setIsTheaterMode((prev) => !prev)}
                        className={cn(
                          "h-7 px-2.5 flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer",
                          isTheaterMode
                            ? "border-primary/50 text-primary bg-primary/10 shadow-xs"
                            : "border-white/5 bg-black/40 text-white/60 hover:text-white hover:border-white/15"
                        )}
                        title="Theater Mode (T)"
                        aria-label="Toggle theater mode"
                      >
                        <Television size={13} weight={isTheaterMode ? "fill" : "regular"} />
                        <span className="hidden md:inline">Theater</span>
                      </button>

                      {/* Popout Player */}
                      {currentServer?.src && (
                        <button
                          type="button"
                          onClick={() => {
                            window.open(
                              currentServer.src,
                              "player_popout",
                              "width=1120,height=680,menubar=no,toolbar=no,location=no,status=no,resizable=yes"
                            );
                          }}
                          className="h-7 w-7 flex items-center justify-center rounded-lg bg-black/40 border border-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                          title="Open in dedicated popout window"
                          aria-label="Popout window"
                        >
                          <ArrowSquareOut size={14} weight="bold" />
                        </button>
                      )}

                      {/* Fullscreen */}
                      <button
                        onClick={isFullscreen ? exitFS : enterFS}
                        className="h-7 w-7 flex items-center justify-center rounded-lg bg-black/40 border border-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                        title="Fullscreen (F)"
                        aria-label="Fullscreen"
                      >
                        {isFullscreen ? <CornersIn size={14} weight="bold" /> : <CornersOut size={14} weight="bold" />}
                      </button>

                      {/* Shortcuts */}
                      <button
                        onClick={() => setShortcutsOpen(true)}
                        className="h-7 w-7 flex items-center justify-center rounded-lg bg-black/40 border border-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                        title="Keyboard Shortcuts (?)"
                        aria-label="Keyboard shortcuts"
                      >
                        <Keyboard size={13} weight="regular" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Keyboard Shortcuts Dialog */}
            <DialogRoot open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
              <DialogContent className="max-w-md bg-card border-border/70 rounded-2xl p-6">
                <DialogHeader className="mb-4">
                  <div className="flex items-center gap-2 text-foreground">
                    <Keyboard size={20} weight="bold" className="text-primary" />
                    <DialogTitle className="text-base font-semibold">Player Keyboard Shortcuts</DialogTitle>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Control the video player directly from your keyboard for an uninterrupted cinema experience.
                  </p>
                </DialogHeader>

                <div className="space-y-2.5">
                  {[
                    { key: "Space / K", desc: "Start playback from poster", action: "Play" },
                    { key: "F", desc: "Toggle Fullscreen mode", action: "Fullscreen" },
                    { key: "T", desc: "Toggle Cinema / Theater mode", action: "Theater" },
                    { key: "N", desc: "Advance to next video", action: "Next Video" },
                    { key: "S", desc: "Cycle through mirror servers", action: "Next Server" },
                    { key: "R", desc: "Reload player & refresh ticket", action: "Reload" },
                    { key: "A", desc: "Toggle ambient backlight glow", action: "Ambient" },
                    { key: "Esc", desc: "Exit theater or fullscreen", action: "Exit" },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/40 border border-border/40"
                    >
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-foreground">{item.action}</span>
                        <span className="text-[11px] text-muted-foreground">{item.desc}</span>
                      </div>
                      <kbd className="px-2 py-1 text-xs font-mono font-semibold bg-card border border-border/70 rounded-md text-foreground shadow-xs">
                        {item.key}
                      </kbd>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-3 border-t border-border/40 flex justify-end">
                  <button
                    onClick={() => setShortcutsOpen(false)}
                    className="px-4 py-1.5 text-xs font-medium rounded-lg border border-border/60 hover:bg-secondary transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </DialogContent>
            </DialogRoot>

            {/* Queue â€” up-next strip (seeded from Playlists / Collections / Watch Later) */}
            {queue && queueIndex >= 0 && (
              <QueueBar queue={queue} index={queueIndex} />
            )}

            {/* Performer Channel Strip & Action Hub */}
            {isLoading ? (
              <div className="p-4 sm:p-5 rounded-2xl bg-neutral-900/60 border border-white/[0.06] backdrop-blur-md shadow-sm space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-12 h-12 rounded-full" />
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              </div>
            ) : video ? (
              <div className="space-y-4">
                {/* Unified Channel & Action Strip */}
                <div className="p-4 sm:p-5 rounded-2xl bg-neutral-900/70 border border-white/[0.08] backdrop-blur-md shadow-sm space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Performer Profile Identity & Follow Button */}
                    <div className="flex items-center gap-3 min-w-0">
                      <Link href={`/performers/${video.username}`} className="relative shrink-0 group/avatar">
                        <div className="w-12 h-12 rounded-full overflow-hidden bg-neutral-800 border-2 border-white/10 group-hover/avatar:border-primary/60 transition-colors flex items-center justify-center">
                          {proxyUrl(video.thumbnail_url) ? (
                            <OptimizedImage
                              src={proxyUrl(video.thumbnail_url)!}
                              alt={video.username}
                              className="w-full h-full object-cover"
                              containerClassName="w-full h-full"
                              width="avatar"
                            />
                          ) : (
                            <UserCircle size={32} weight="duotone" className="text-white/40" />
                          )}
                        </div>
                        <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-neutral-900" title="Archived Performer" />
                      </Link>

                      <div className="min-w-0 flex flex-col">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Link
                            href={`/performers/${video.username}`}
                            className="text-lg sm:text-xl font-bold tracking-tight text-white hover:text-primary transition-colors truncate"
                          >
                            {video.username}
                          </Link>
                          <span title="Verified recording archive" className="inline-flex items-center"><CheckCircle size={15} weight="fill" className="text-primary shrink-0" /></span>
                          <PlatformBadge recording={video} />
                        </div>

                        {/* Telemetry line */}
                        <div className="flex items-center gap-1.5 text-xs text-white/50 flex-wrap">
                          {video.timestamp && (
                            <span className="tabular-nums">{new Date(video.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                          )}
                          {video.viewers != null && video.viewers > 0 && (
                            <>
                              <span className="text-white/20">•</span>
                              <span className="tabular-nums">{video.viewers.toLocaleString()} views</span>
                            </>
                          )}
                          {video.duration != null && video.duration > 0 && (
                            <>
                              <span className="text-white/20">•</span>
                              <span className="tabular-nums font-mono">{formatDuration(video.duration)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Follow Button */}
                      <button
                        onClick={handleToggleFollow}
                        disabled={followMutation.isPending || unfollowMutation.isPending}
                        className={cn(
                          "ml-2 sm:ml-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 active:scale-95",
                          user && isFollowing
                            ? "bg-white/10 hover:bg-white/15 text-white/90 border border-white/15"
                            : "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm shadow-primary/20"
                        )}
                        title={user && isFollowing ? "Unfollow performer" : "Follow performer for updates"}
                      >
                        <Heart size={14} weight={user && isFollowing ? "fill" : "bold"} className={user && isFollowing ? "text-rose-400" : ""} />
                        <span>{!user ? "Follow" : isFollowing ? "Following" : "Follow"}</span>
                      </button>
                    </div>

                    {/* Grouped Actions: Segmented Like/Dislike + Save + Queue + Share + More */}
                    <div className="flex items-center gap-2 flex-wrap md:ml-auto">
                      {/* Segmented Like / Dislike Control */}
                      <div className="inline-flex items-center rounded-xl bg-black/40 border border-white/10 p-0.5 shadow-xs">
                        <button
                          onClick={() => handleReaction("like")}
                          className={cn(
                            "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                            reactions?.user_reaction === "like"
                              ? "text-primary bg-primary/15 font-semibold"
                              : "text-white/70 hover:text-white hover:bg-white/5"
                          )}
                          title="Like recording"
                          aria-label="Like"
                        >
                          <ThumbsUp size={15} weight={reactions?.user_reaction === "like" ? "fill" : "regular"} />
                          {reactions?.likes != null && reactions.likes > 0 && (
                            <span className="tabular-nums font-mono text-[11px]">{reactions.likes.toLocaleString()}</span>
                          )}
                        </button>

                        <div className="w-px h-4 bg-white/10" />

                        <button
                          onClick={() => handleReaction("dislike")}
                          className={cn(
                            "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                            reactions?.user_reaction === "dislike"
                              ? "text-rose-400 bg-rose-500/15 font-semibold"
                              : "text-white/70 hover:text-white hover:bg-white/5"
                          )}
                          title="Dislike recording"
                          aria-label="Dislike"
                        >
                          <ThumbsDown size={15} weight={reactions?.user_reaction === "dislike" ? "fill" : "regular"} />
                        </button>
                      </div>

                      {/* Save / Bookmark Button */}
                      {user && (
                        <button
                          onClick={handleBookmark}
                          className={cn(
                            "inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border text-xs font-medium transition-all cursor-pointer",
                            bookmarked
                              ? "bg-amber-400/10 border-amber-400/40 text-amber-300 font-semibold"
                              : "bg-black/40 border-white/10 text-white/70 hover:text-white hover:border-white/20"
                          )}
                          title={bookmarked ? "Remove bookmark" : "Save to bookmarks"}
                        >
                          <BookmarkSimple size={15} weight={bookmarked ? "fill" : "regular"} />
                          <span>{bookmarked ? "Saved" : "Save"}</span>
                        </button>
                      )}

                      {/* Watch Later Queue Button */}
                      {user && (
                        <button
                          onClick={handleWatchLater}
                          className={cn(
                            "inline-flex items-center gap-1.5 h-8 px-3 rounded-xl border text-xs font-medium transition-all cursor-pointer",
                            watchLater
                              ? "bg-sky-400/10 border-sky-400/40 text-sky-300 font-semibold"
                              : "bg-black/40 border-white/10 text-white/70 hover:text-white hover:border-white/20"
                          )}
                          title={watchLater ? "Remove from Watch Later" : "Add to Watch Later"}
                        >
                          <Clock size={15} weight={watchLater ? "fill" : "regular"} />
                          <span>{watchLater ? "Queued" : "Watch Later"}</span>
                        </button>
                      )}

                      {/* Share Button */}
                      <button
                        onClick={handleShare}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-black/40 border border-white/10 text-white/70 hover:text-white hover:border-white/20 text-xs font-medium transition-all cursor-pointer"
                        title="Share recording link"
                      >
                        {copied ? (
                          <>
                            <Check size={14} weight="bold" className="text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <ShareNetwork size={15} weight="regular" />
                            <span>Share</span>
                          </>
                        )}
                      </button>

                      {/* Embed Code Button (for in-page iframe player) */}
                      {currentServer?.src && currentServer.type === "iframe" && (
                        <button
                          onClick={handleCopyEmbed}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-black/40 border border-white/10 text-white/70 hover:text-white hover:border-white/20 text-xs font-medium transition-all cursor-pointer"
                          title="Copy iframe embed code"
                        >
                          {embedCopied ? (
                            <>
                              <Check size={14} weight="bold" className="text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Code size={15} weight="bold" />
                              <span>Embed</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Collection Dropdown */}
                      {user && (
                        <div ref={collectionRef} className="relative">
                          <button
                            onClick={() => setCollectionOpen((v) => !v)}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-black/40 border border-white/10 text-white/70 hover:text-white hover:border-white/20 text-xs font-medium transition-all cursor-pointer"
                          >
                            <FolderSimplePlus size={15} weight="regular" />
                            <span>Collection</span>
                            <CaretDown size={11} weight="bold" className={cn("transition-transform", collectionOpen && "rotate-180")} />
                          </button>
                          {collectionOpen && (
                            <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-xl bg-neutral-900 border border-white/15 p-1.5 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                              <div className="p-1.5 border-b border-white/10">
                                <div className="flex gap-1">
                                  <input
                                    autoFocus
                                    type="text"
                                    aria-label="New collection name"
                                    placeholder="New collection…"
                                    value={newColName}
                                    onChange={(e) => setNewColName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleCreateAndAdd(); }}
                                    maxLength={60}
                                    className="flex-1 h-7 bg-black/50 border border-white/10 focus:border-primary/50 rounded-lg px-2 text-xs text-white outline-none"
                                  />
                                  <button
                                    onClick={handleCreateAndAdd}
                                    disabled={!newColName.trim() || creatingCol}
                                    className="w-7 h-7 flex items-center justify-center bg-primary text-primary-foreground rounded-lg disabled:opacity-40 hover:bg-primary/90 transition-opacity cursor-pointer shrink-0"
                                    title="Create and add"
                                  >
                                    <Plus size={13} weight="bold" />
                                  </button>
                                </div>
                              </div>
                              {cloudCollections.length === 0 ? (
                                <div className="px-3 py-4 text-center">
                                  <p className="text-[11px] text-white/60">No collections yet.</p>
                                  <p className="text-[11px] text-white/40">Create one above.</p>
                                </div>
                              ) : (
                                <div className="max-h-48 overflow-y-auto">
                                  {cloudCollections.map((col) => (
                                    <button
                                      key={col.id}
                                      onClick={() => handleAddToCollection(col.id)}
                                      disabled={addingColId !== null}
                                      className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                      {addedToCol === col.id ? (
                                        <Check size={13} weight="bold" className="text-emerald-400 shrink-0" />
                                      ) : (
                                        <Playlist size={14} weight="regular" className="text-white/40 shrink-0" />
                                      )}
                                      <span className="truncate">{col.name}</span>
                                      <span className="ml-auto text-[10px] text-white/40 shrink-0 tabular-nums">
                                        {col.item_count ?? 0}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Source Direct Download Link */}
                      {safeEmbedSource && (
                        <a
                          href={safeEmbedSource}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-black/40 border border-white/10 text-white/70 hover:text-white hover:border-white/20 text-xs font-medium transition-all"
                        >
                          <DownloadSimple size={15} weight="regular" />
                          <span>Source</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Optional Room Topic */}
                  {video.room_title && video.room_title !== video.username && (
                    <p className="text-xs text-white/60 italic leading-relaxed pt-2 border-t border-white/[0.06]">
                      {video.room_title}
                    </p>
                  )}
                </div>
            {/* Tags */}
                {video.tags && video.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {video.tags.map((tag) => (
                      <Link key={tag} href={`/browse?tags=${encodeURIComponent(tag)}`}>
                        <span className="inline-block px-2.5 py-1 text-[11px] border border-border/50 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all cursor-pointer rounded-lg">
                          {tag}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}

                {/* Like ratio bar */}
                {likePercent !== null && totalReactions > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground/50">
                      <span>{likePercent}% liked</span>
                      <span>{totalReactions.toLocaleString()} ratings</span>
                    </div>
                    <div className="h-1 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${likePercent}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Sign-in prompt for unauthenticated users */}
                {!user && (
                  <div className="flex items-center gap-2 p-3 border border-border/40 rounded-lg bg-secondary">
                    <SignIn size={16} weight="regular" className="text-muted-foreground/60" />
                    <p className="text-xs text-muted-foreground/60">
                      <Link href="/login" className="text-primary hover:underline font-medium">Sign in</Link> to like, save, or add to collections
                    </p>
                  </div>
                )}

                {video.gender && (
                  <div className="text-xs text-muted-foreground/60 pt-1">
                    <Link
                      href={`/browse?gender=${encodeURIComponent(video.gender)}`}
                      className="hover:text-muted-foreground transition-colors capitalize"
                    >
                      Browse {video.gender} recordings →
                    </Link>
                  </div>
                )}

                {/* In-content ad above comments — full-width 300×100 row */}
                <AdBanner file="rect-300x100" fluid />

                {/* Comments */}
                <div className="pt-4 border-t border-border/30">
                  <CommentSection recordingId={id || ""} />
                </div>
              </div>
            ) : null}
          </div>

          {/* â”€â”€â”€ Sidebar â€” Related â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          <div className="space-y-4">
            {/* Sidebar ads â€” 300Ã—250 medium rect + 300Ã—600 half page (lg+) */}
            <AdBanner file="medium-rect-300x250" />
            <AdBanner file="half-page-300x600" breakpoint="lg" />

            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">
                More from {video?.username ?? "this performer"}
              </p>
            </div>

            {relatedLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-28 aspect-video shrink-0 rounded-lg" />
                    <div className="flex-1 space-y-1.5 pt-0.5">
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : related && related.filter((r) => r.id !== id && r.username === video?.username).length > 0 ? (
              <div className="space-y-3">
                {related
                  .filter((r) => r.id !== id && r.username === video?.username)
                  .map((rec, i) => (
                    <Link key={rec.id} href={`/video/${rec.id}`} className="group flex gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                      <div className="w-28 aspect-video shrink-0 overflow-hidden bg-secondary rounded-lg border border-border/40 relative">
                        {proxyUrl(rec.thumbnail_url) ? (
                          <OptimizedImage
                            src={proxyUrl(rec.thumbnail_url)!}
                            alt={rec.username}
                            fetchPriority={i < 10 ? "high" : undefined}
                            width="thumb"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            containerClassName="w-full h-full"
                            fallback={
                              <div className="w-full h-full flex items-center justify-center">
                                <FilmStrip size={16} weight="duotone" className="text-muted-foreground/30" />
                              </div>
                            }
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <FilmStrip size={16} weight="duotone" className="text-muted-foreground/30" />
                          </div>
                        )}
                        {recentlyWatched.has(rec.id) && (
                          <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5 bg-black/60 backdrop-blur-md ring-1 ring-white/10 px-1 py-0.5 rounded-md pointer-events-none">
                            <CheckCircle size={9} weight="fill" className="text-emerald-400" />
                            <span className="text-[7px] font-semibold text-emerald-300 uppercase tracking-wider">Watched</span>
                          </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                          <Play className="w-4 h-4 text-white fill-white" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                        <p className="text-[11px] font-semibold text-primary/80 group-hover:text-primary transition-colors truncate">
                          {rec.username}
                        </p>
                        <p className="text-[10px] text-muted-foreground/50">
                          {formatRelativeTime(rec.timestamp)}
                        </p>
                        {rec.resolution && (
                          <p className="text-[10px] text-muted-foreground/40">{rec.resolution}</p>
                        )}
                      </div>
                    </Link>
                  ))}

                {video?.username && (
                  <Link
                    href={`/performers/${video.username}`}
                    className="block pt-2 text-[11px] text-primary/70 hover:text-primary transition-colors"
                  >
                    All recordings by {video.username} →
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/40">No related recordings found.</p>
            )}
          </div>
        </div>

        {/* â”€â”€â”€ Bottom Recommendations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        {!isLoading ? (
          <div ref={recSectionRef} className="mt-10 space-y-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-semibold text-foreground">
                Recommendations
              </h2>
              <p className="text-[11px] text-muted-foreground/60">
                {user ? "Based on your watch history" : "More like this"}
              </p>
            </div>

            {recLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="w-full aspect-video rounded-lg" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2 w-1/2" />
                  </div>
                ))}
              </div>
            ) : recError ? (
              <p className="text-xs text-destructive/60">Could not load recommendations.</p>
            ) : recData && recData.data.filter((r) => r.id !== id).length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {recData.data
                    .filter((r) => r.id !== id)
                    .map((rec) => (
                      <VideoCard key={rec.id} recording={rec} isWatched={recentlyWatched.has(rec.id)} showAdd />
                    ))}
                </div>

                {recData.totalPages > 1 && (
                  <div className="flex items-center justify-center gap-1.5 pt-3 flex-wrap">
                    <button
                      onClick={() => setRecPage((p) => Math.max(1, p - 1))}
                      disabled={recData.page <= 1 || recFetching}
                      aria-label="Previous page"
                      className="inline-flex items-center justify-center w-8 h-8 text-xs rounded-lg border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <CaretLeft size={14} />
                    </button>

                    {Array.from({ length: recData.totalPages }, (_, i) => i + 1).map((p) => {
                      const isCurrent = p === recData.page;
                      const isEdge =
                        p === 1 || p === recData.totalPages || Math.abs(p - recData.page) <= 1;
                      if (!isEdge && p > 1 && p < recData.totalPages) {
                        // collapse middle gaps with a single ellipsis
                        if (p === recData.page - 2 || p === recData.page + 2) {
                          return (
                            <span key={p} className="px-1 text-[10px] text-muted-foreground/40">
                              …
                            </span>
                          );
                        }
                        return null;
                      }
                      return (
                        <button
                          key={p}
                          onClick={() => setRecPage(p)}
                          disabled={recFetching}
                          className={`inline-flex items-center justify-center min-w-8 h-8 px-2 text-xs rounded-lg border transition-all disabled:cursor-not-allowed ${
                            isCurrent
                              ? "border-primary/60 text-primary bg-primary/5 font-semibold"
                              : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}

                    <button
                      onClick={() => setRecPage((p) => Math.min(recData.totalPages, p + 1))}
                      disabled={recData.page >= recData.totalPages || recFetching}
                      aria-label="Next page"
                      className="inline-flex items-center justify-center w-8 h-8 text-xs rounded-lg border border-border/50 text-muted-foreground hover:border-border hover:text-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <CaretRight size={14} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground/40">No recommendations available.</p>
            )}
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
