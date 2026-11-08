import {
  useGetStats,
  useListRecordings,
  useListTags,
  getGetStatsQueryKey,
  getListRecordingsQueryKey,
  getListTagsQueryKey,
} from "@workspace/api-client-react";
import { useListPerformers, useListRecommendations } from "@/lib/api";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { AdGridCard } from "@/components/ads/AdGridCard";
import { isAdCard } from "@/lib/ad-creatives";
import { PerformerCard } from "@/components/PerformerCard";
import { Fragment, useState, useEffect, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, parseCloudItem, cloudItemToRecording } from "@/lib/user-api";
import { Skeleton } from "@/components/ui/skeleton";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { usePreloadRecordings } from "@/hooks/use-preload-recordings";
import { useConnectionConstrained } from "@/hooks/use-connection-quality";
import { buildThumbnailFallbacks } from "@/lib/mirrors";
import { formatBytes, formatDuration, formatRelativeTime } from "@/lib/formatters";
import { proxyUrl } from "@/lib/proxy-url";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import {
  ArrowRight,
  TrendUp,
  Clock,
  UsersThree,
  Tag,
  FilmStrip,
  Sparkle,
  WarningCircle,
  ArrowClockwise,
  Play,
  Fire,
  ShieldCheck,
  Lightning,
  Bookmarks,
  SlidersHorizontal,
  CheckCircle,
  Eye,
  FolderSimplePlus,
} from "@phosphor-icons/react";

type Tab = "popular" | "recent" | "recommended";

function VideoSkeleton() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="w-full aspect-video rounded-xl" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

function hasThumbnail(recording: {
  thumbnail_url?: string | null;
  thumbnail_mirrors?: Record<string, string> | null;
}): boolean {
  return buildThumbnailFallbacks(recording).length > 0;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("popular");
  const [activeHero, setActiveHero] = useState(0);
  const [isHeroPaused, setIsHeroPaused] = useState(false);
  const { user } = useAuth();

  // Connection-aware paging: 12 on slower links, 24 on fast
  const isConstrained = useConnectionConstrained();
  const pageSize = isConstrained ? 12 : 24;

  const { data: stats } = useGetStats({ query: { queryKey: getGetStatsQueryKey(), staleTime: 30_000 } });

  const { data: continueWatching = [] } = useQuery({
    queryKey: ["user", "continue-watching"],
    queryFn: () => userApi.getContinueWatching(8),
    enabled: !!user,
    staleTime: 60_000,
  });

  const recentParams = { limit: pageSize * 2, sort: "newest" as const };
  const { data: recentData, isLoading: recentLoading, isError: recentError, refetch: retryRecent } = useListRecordings(
    recentParams,
    { query: { queryKey: getListRecordingsQueryKey(recentParams), staleTime: 30_000, placeholderData: keepPreviousData } },
  );

  const popularParams = { limit: pageSize * 2, sort: "popular" as const };
  const { data: popularData, isLoading: popularLoading, isError: popularError, refetch: retryPopular } = useListRecordings(
    popularParams,
    { query: { queryKey: getListRecordingsQueryKey(popularParams), staleTime: 30_000, placeholderData: keepPreviousData } },
  );

  const recentlyWatched = useRecentlyWatched();
  const excludeIds = recentlyWatched.size > 0 ? [...recentlyWatched].join(",") : undefined;
  const { data: recData, isLoading: recLoading, isError: recError, refetch: retryRec } = useListRecommendations(
    { limit: 16, exclude: excludeIds },
    { enabled: true, placeholderData: keepPreviousData, staleTime: 30_000 },
  );

  const { data: topPerformersData, isLoading: performersLoading } = useListPerformers(undefined, { staleTime: 30_000 });
  const topPerformers = topPerformersData?.performers ?? [];
  const { data: tags } = useListTags({ query: { queryKey: getListTagsQueryKey(), staleTime: 30_000 } });

  // Top 4 featured recordings for the marquee stage
  const marqueeRecordings = useMemo(() => {
    const list = popularData?.data?.filter(hasThumbnail) ?? [];
    return list.slice(0, 4);
  }, [popularData?.data]);

  const activeFeatured = marqueeRecordings[activeHero] ?? marqueeRecordings[0] ?? null;

  // Auto-advance marquee every 8s unless user is hovering
  useEffect(() => {
    if (isHeroPaused || marqueeRecordings.length <= 1) return;
    const timer = setInterval(() => {
      setActiveHero((prev) => (prev + 1) % marqueeRecordings.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [isHeroPaused, marqueeRecordings.length]);

  // Determine active feed data
  const feedState = useMemo(() => {
    if (tab === "popular") {
      const all = (popularData?.data ?? []).filter(hasThumbnail);
      const filtered = activeFeatured ? all.filter((r) => r.id !== activeFeatured.id) : all;
      return {
        recordings: filtered.slice(0, pageSize),
        loading: popularLoading,
        error: popularError,
        retry: retryPopular,
      };
    }
    if (tab === "recent") {
      const all = (recentData?.data ?? []).filter(hasThumbnail);
      const filtered = activeFeatured ? all.filter((r) => r.id !== activeFeatured.id) : all;
      return {
        recordings: filtered.slice(0, pageSize),
        loading: recentLoading,
        error: recentError,
        retry: retryRecent,
      };
    }
    // "recommended"
    const all = (recData?.data ?? []).filter(hasThumbnail);
    return {
      recordings: all.slice(0, pageSize),
      loading: recLoading,
      error: recError,
      retry: retryRec,
    };
  }, [
    tab,
    popularData?.data,
    recentData?.data,
    recData?.data,
    activeFeatured,
    pageSize,
    popularLoading,
    recentLoading,
    recLoading,
    popularError,
    recentError,
    recError,
    retryPopular,
    retryRecent,
    retryRec,
  ]);

  const continueWithThumbnails = continueWatching.filter((item) => hasThumbnail(cloudItemToRecording(parseCloudItem(item))));

  usePreloadRecordings(feedState.recordings);

  const heroThumb = activeFeatured
    ? proxyUrl(activeFeatured.sprite_url || activeFeatured.thumbnail_url || activeFeatured.preview_url)
    : null;

  return (
    <Layout>
      {/* ─── The Vault Cinema Marquee Hero ──────────────────────────── */}
      <section className="relative px-4 sm:px-6 pt-5 pb-4">
        <div className="container mx-auto max-w-7xl">
          {/* Main Frame Container */}
          <div
            onMouseEnter={() => setIsHeroPaused(true)}
            onMouseLeave={() => setIsHeroPaused(false)}
            className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-zinc-950/80 shadow-2xl backdrop-blur-xl"
          >
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] min-h-[460px] sm:min-h-[500px]">
              {/* Left Stage: Grand Showcase Display */}
              <div className="relative group overflow-hidden flex flex-col justify-end p-6 sm:p-9 lg:p-11 min-h-[360px] sm:min-h-[440px]">
                {/* Background Hero Media with Ambient Glow */}
                {heroThumb ? (
                  <div className="absolute inset-0 -z-10 overflow-hidden bg-black">
                    <OptimizedImage
                      key={activeFeatured?.id}
                      src={heroThumb}
                      alt={activeFeatured?.username || "Featured"}
                      className="w-full h-full object-cover object-center filter brightness-[0.52] contrast-105 transition-all duration-700 group-hover:scale-[1.02]"
                      containerClassName="w-full h-full"
                      width="hero"
                      fetchPriority="high"
                      loading="eager"
                    />
                    {/* Multi-angle Cinema Vignette */}
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/50 to-transparent" />
                    <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/90 via-zinc-950/40 to-transparent" />
                  </div>
                ) : (
                  <div className="absolute inset-0 -z-10 bg-gradient-to-br from-zinc-900 to-zinc-950" />
                )}

                {/* Ambient Center Glow */}
                <div className="absolute -top-24 -left-24 w-96 h-96 bg-primary/20 rounded-full blur-3xl pointer-events-none -z-10" />

                {/* Center Hover Play Icon */}
                {activeFeatured && (
                  <Link
                    href={`/video/${encodeURIComponent(activeFeatured.id)}`}
                    className="absolute inset-0 flex items-center justify-center pointer-events-auto"
                    aria-label={`Play ${activeFeatured.username}'s recording`}
                  >
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center shadow-2xl backdrop-blur-sm transition-transform duration-300 transform group-hover:scale-110 active:scale-95 ring-4 ring-white/10">
                      <Play size={28} weight="fill" className="ml-1" />
                    </div>
                  </Link>
                )}

                {/* Floating Content Layer (Pinned to Bottom Left) */}
                <div className="relative z-10 space-y-3 max-w-xl pointer-events-none">
                  {/* Status Badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary text-primary-foreground text-[11px] font-bold tracking-wide uppercase shadow-sm">
                      <Fire size={13} weight="fill" />
                      Featured #{activeHero + 1}
                    </span>
                    {activeFeatured?.resolution && (
                      <span className="px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-[11px] font-mono font-bold text-white/95 ring-1 ring-white/15">
                        {activeFeatured.resolution}
                      </span>
                    )}
                    {activeFeatured?.duration ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-[11px] font-mono text-zinc-300 ring-1 ring-white/15">
                        <Clock size={12} weight="bold" />
                        {formatDuration(activeFeatured.duration)}
                      </span>
                    ) : null}
                  </div>

                  {/* Title & Performer Header */}
                  <div>
                    <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-tight drop-shadow-md">
                      {activeFeatured ? (
                        <Link
                          href={`/performers/${encodeURIComponent(activeFeatured.username)}`}
                          className="hover:text-primary transition-colors pointer-events-auto inline-flex items-center gap-2"
                        >
                          <span>{activeFeatured.username}</span>
                          <CheckCircle size={22} weight="fill" className="text-primary shrink-0" />
                        </Link>
                      ) : (
                        "Vault Screening Room"
                      )}
                    </h1>
                    {activeFeatured?.room_title && (
                      <p className="mt-1.5 text-xs sm:text-sm text-zinc-300 font-normal line-clamp-2 leading-relaxed drop-shadow-sm">
                        {activeFeatured.room_title}
                      </p>
                    )}
                  </div>

                  {/* View Stats & Timestamp */}
                  {activeFeatured && (
                    <div className="flex items-center gap-3 text-xs text-zinc-400 font-mono pt-0.5">
                      {activeFeatured.viewers ? (
                        <span className="flex items-center gap-1.5 text-zinc-200">
                          <Eye size={14} weight="bold" />
                          {activeFeatured.viewers.toLocaleString()} views
                        </span>
                      ) : null}
                      {activeFeatured.timestamp ? (
                        <>
                          <span>•</span>
                          <span>{formatRelativeTime(activeFeatured.timestamp)}</span>
                        </>
                      ) : null}
                    </div>
                  )}

                  {/* Interactive Button Strip */}
                  <div className="pt-2 flex flex-wrap items-center gap-2.5 pointer-events-auto">
                    {activeFeatured ? (
                      <>
                        <Link
                          href={`/video/${encodeURIComponent(activeFeatured.id)}`}
                          className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-wider shadow-lg hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                        >
                          <Play size={15} weight="fill" />
                          Watch Now
                        </Link>
                        <Link
                          href={`/performers/${encodeURIComponent(activeFeatured.username)}`}
                          className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium text-xs backdrop-blur-md border border-white/10 transition-all cursor-pointer"
                        >
                          <UsersThree size={15} weight="bold" />
                          Performer Vault
                        </Link>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Right Stage: Top 4 Trending Queue */}
              <div className="border-t lg:border-t-0 lg:border-l border-white/[0.08] bg-zinc-950/60 p-4 sm:p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 mb-2 border-b border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <Fire size={15} weight="fill" className="text-primary" />
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-200">
                        Top Trending Queue
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500">Auto-playing</span>
                  </div>

                  {/* Queue Items */}
                  <div className="space-y-2">
                    {popularLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-16 rounded-xl bg-zinc-900/60 animate-pulse border border-white/[0.04]" />
                      ))
                    ) : (
                      marqueeRecordings.map((rec, idx) => {
                        const active = idx === activeHero;
                        const recThumb = proxyUrl(rec.thumbnail_url || rec.preview_url);
                        return (
                          <button
                            key={rec.id}
                            type="button"
                            onClick={() => setActiveHero(idx)}
                            className={`w-full flex items-center gap-3 p-2 rounded-xl transition-all text-left cursor-pointer border ${
                              active
                                ? "bg-white/[0.08] border-primary/50 ring-1 ring-primary/30 shadow-md"
                                : "bg-black/30 border-white/[0.04] hover:bg-white/[0.04] hover:border-white/10 text-zinc-400"
                            }`}
                          >
                            {/* Thumbnail Preview */}
                            <div className="relative w-20 aspect-video rounded-lg overflow-hidden bg-black/60 shrink-0 border border-white/10">
                              {recThumb ? (
                                <OptimizedImage
                                  src={recThumb}
                                  alt={rec.username}
                                  className="w-full h-full object-cover"
                                  containerClassName="w-full h-full"
                                  width="card"
                                />
                              ) : null}
                              {active && (
                                <div className="absolute inset-0 bg-primary/30 flex items-center justify-center">
                                  <Play size={14} weight="fill" className="text-white" />
                                </div>
                              )}
                            </div>

                            {/* Item Metadata */}
                            <div className="min-w-0 flex-1">
                              <div className={`text-xs font-bold truncate ${active ? "text-white" : "text-zinc-200"}`}>
                                {rec.username}
                              </div>
                              <div className="text-[10px] text-zinc-400 font-mono truncate">
                                {rec.duration ? formatDuration(rec.duration) : "Stream"} • {rec.viewers ? `${rec.viewers.toLocaleString()} views` : "HD"}
                              </div>
                            </div>

                            {/* Number Tag */}
                            <div className={`text-[11px] font-mono pr-1.5 ${active ? "text-primary font-bold" : "text-zinc-600"}`}>
                              0{idx + 1}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Direct Catalogue Button */}
                <div className="pt-3 border-t border-white/[0.06] mt-3">
                  <Link
                    href="/browse?sort=popular"
                    className="flex items-center justify-between text-xs font-medium text-zinc-400 hover:text-white transition-colors group px-1 py-0.5"
                  >
                    <span>View all top recordings</span>
                    <ArrowRight size={13} weight="bold" className="transition-transform group-hover:translate-x-1 text-primary" />
                  </Link>
                </div>
              </div>
            </div>

            {/* Bottom Marquee Control Ribbon: Fast Category Jumps & Telemetry */}
            <div className="border-t border-white/[0.08] bg-black/40 px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {/* Category Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider shrink-0 mr-1.5">
                  Explore:
                </span>
                {["Chaturbate", "Stripchat", "1080p 60fps", "Solo", "Couples", "Anal"].map((tag) => (
                  <Link
                    key={tag}
                    href={`/browse?search=${encodeURIComponent(tag)}`}
                    className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.10] text-xs text-zinc-300 hover:text-white border border-white/[0.06] hover:border-white/20 transition-all shrink-0"
                  >
                    {tag}
                  </Link>
                ))}
              </div>

              {/* Real-time Telemetry Counts */}
              <div className="flex items-center gap-4 text-[11px] font-mono text-zinc-400 tabular-nums shrink-0">
                <div>
                  <strong className="text-white">{stats?.total_recordings ? stats.total_recordings.toLocaleString() : "2,000+"}</strong> streams
                </div>
                <div>
                  <strong className="text-white">{stats?.total_performers ? stats.total_performers.toLocaleString() : "1,200+"}</strong> models
                </div>
                <div className="hidden md:block">
                  <strong className="text-white">{stats?.total_size_bytes ? formatBytes(stats.total_size_bytes) : "4.2 TB"}</strong> archive
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Continue Watching (Logged In Users) ─────────────────────── */}
      {user && continueWithThumbnails.length > 0 && (
        <section className="px-4 sm:px-6 py-6 border-b border-border/50">
          <div className="container mx-auto max-w-7xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Clock size={15} weight="bold" />
                </div>
                <div>
                  <h2 className="text-sm font-bold tracking-tight text-foreground">Continue Watching</h2>
                  <p className="text-[11px] text-muted-foreground">Pick up right where you paused</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-6">
              {continueWithThumbnails.map((item, i) => {
                const rec = cloudItemToRecording(parseCloudItem(item));
                return (
                  <div key={item.recording_id}>
                    <VideoCard
                      recording={rec}
                      isWatched
                      progress={item.progress}
                      fetchPriority={i < 4 ? "high" : undefined}
                      showAdd
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ─── Main Video Feed (Trending / Fresh Drops / Recommended) ──── */}
      <section className="px-4 sm:px-6 py-8 relative overflow-hidden">
        <div className="container mx-auto max-w-7xl">
          {/* Feed Filter Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-secondary/80 border border-border/70" role="tablist" aria-label="Archive feed tabs">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "popular"}
                onClick={() => setTab("popular")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  tab === "popular"
                    ? "bg-card text-foreground shadow-xs border border-border/80"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                <Fire size={14} weight={tab === "popular" ? "fill" : "regular"} className={tab === "popular" ? "text-primary" : "text-muted-foreground/60"} />
                Trending Now
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "recent"}
                onClick={() => setTab("recent")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  tab === "recent"
                    ? "bg-card text-foreground shadow-xs border border-border/80"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                <Clock size={14} weight={tab === "recent" ? "bold" : "regular"} className={tab === "recent" ? "text-primary" : "text-muted-foreground/60"} />
                Fresh Drops
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "recommended"}
                onClick={() => setTab("recommended")}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  tab === "recommended"
                    ? "bg-card text-foreground shadow-xs border border-border/80"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                <Sparkle size={14} weight={tab === "recommended" ? "fill" : "regular"} className={tab === "recommended" ? "text-primary" : "text-muted-foreground/60"} />
                Recommended
              </button>
            </div>

            <Link
              href={`/browse${tab === "recent" ? "?sort=newest" : tab === "popular" ? "?sort=popular" : ""}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors group"
            >
              Browse entire catalogue ({stats?.total_recordings?.toLocaleString() || "2,000+"})
              <ArrowRight size={13} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Feed Content Grid */}
          {feedState.loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8">
              {Array.from({ length: pageSize }).map((_, i) => (
                <VideoSkeleton key={i} />
              ))}
            </div>
          ) : feedState.error ? (
            <div className="py-16 text-center border border-border/60 rounded-2xl bg-secondary/20">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-3">
                <WarningCircle size={24} weight="duotone" className="text-destructive" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">Couldn&apos;t load recordings</p>
              <p className="text-xs text-muted-foreground mb-4 max-w-xs mx-auto">
                There may be a temporary connection issue. Try loading this feed again.
              </p>
              <button
                type="button"
                onClick={() => void feedState.retry()}
                className="inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold text-primary border border-primary/30 hover:border-primary/60 rounded-lg transition-colors cursor-pointer"
              >
                <ArrowClockwise size={13} weight="bold" />
                Retry feed
              </button>
            </div>
          ) : feedState.recordings && feedState.recordings.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8">
              {feedState.recordings.map((rec, i) => (
                <Fragment key={rec.id}>
                  <VideoCard recording={rec} fetchPriority={i < 4 ? "high" : undefined} isWatched={recentlyWatched.has(rec.id)} showAdd />
                  {isAdCard(feedState.recordings, i) && <AdGridCard />}
                </Fragment>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center border border-border/60 rounded-2xl bg-secondary/20">
              <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-3">
                <FilmStrip size={24} weight="duotone" className="text-muted-foreground/30" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">No recordings found</p>
              <p className="text-xs text-muted-foreground mb-4 max-w-xs mx-auto">
                Check back shortly as new broadcasts are recorded.
              </p>
              <Link
                href="/browse"
                className="inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold text-primary border border-primary/30 hover:border-primary/60 rounded-lg transition-colors"
              >
                Browse all recordings →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ─── Ad Placement Divider ────────────────────────────────────── */}
      <section className="px-4 sm:px-6 py-4 border-t border-border/50">
        <div className="container mx-auto max-w-7xl">
          <AdLeaderboard />
        </div>
      </section>

      {/* ─── Top Performers Showcase ─────────────────────────────────── */}
      {(topPerformers.length > 0 || performersLoading) && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-8 relative overflow-hidden">
          <div className="container mx-auto max-w-7xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <UsersThree size={18} weight="bold" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold tracking-tight text-foreground">Top Archival Performers</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Most catalogued cam models with active vaults</p>
                </div>
              </div>
              <Link
                href="/performers"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors group"
              >
                Directory <ArrowRight size={12} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>

            {performersLoading ? (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-y-8 gap-x-2 justify-items-center">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-2">
                    <Skeleton className="w-[72px] h-[72px] sm:w-[82px] sm:h-[82px] rounded-full" />
                    <Skeleton className="w-16 h-3" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-y-8 gap-x-2 justify-items-center">
                {topPerformers.slice(0, 20).map((perf, i) => (
                  <div key={perf.username}>
                    <PerformerCard performer={perf} variant="circle" fetchPriority={i < 4 ? "high" : undefined} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── Topic & Tag Matrix ──────────────────────────────────────── */}
      {Array.isArray(tags) && tags.length > 0 && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-8 relative overflow-hidden">
          <div className="container mx-auto max-w-7xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Tag size={18} weight="bold" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-bold tracking-tight text-foreground">Explore by Topic &amp; Tags</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Filter the index by performer room specialties</p>
                </div>
              </div>
              <Link
                href="/tags"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors group"
              >
                All tags ({tags.length}) <ArrowRight size={12} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.slice(0, 36).map(({ tag, count }) => (
                <Link
                  key={tag}
                  href={`/browse?tags=${encodeURIComponent(tag)}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs border border-border/70 text-foreground/85 hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded-lg bg-card/60"
                >
                  <span>{tag}</span>
                  <span className="text-[11px] text-muted-foreground font-mono tabular-nums">{count}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── Directory Console Index ─────────────────────────────────── */}
      <section aria-labelledby="archive-directory-title" className="border-t border-border/50 bg-card/20 px-4 sm:px-6 py-12">
        <div className="container mx-auto max-w-6xl">
          <div className="grid gap-8 sm:grid-cols-3">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <FilmStrip size={16} weight="bold" className="text-primary" />
                <h3 id="archive-directory-title" className="text-sm font-bold text-foreground">Catalogue Streams</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                High-definition recording archive indexed directly from public webcams with multi-mirror CDN distribution.
              </p>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link href="/browse?sort=popular" className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                    <TrendUp size={13} /> Most viewed streams
                  </Link>
                </li>
                <li>
                  <Link href="/browse?sort=newest" className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                    <Clock size={13} /> Latest 24-hour uploads
                  </Link>
                </li>
                <li>
                  <Link href="/browse?resolution=1080p" className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                    <Sparkle size={13} /> 1080p 60fps archive
                  </Link>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <UsersThree size={16} weight="bold" className="text-primary" />
                <h3 className="text-sm font-bold text-foreground">Performer Network</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Comprehensive catalogues indexed by performer username with timestamps, duration metrics, and video resolution.
              </p>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link href="/performers" className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                    <UsersThree size={13} /> Full performer index
                  </Link>
                </li>
                <li>
                  <Link href="/requests" className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                    <Lightning size={13} /> Request performer recording
                  </Link>
                </li>
                <li>
                  <Link href="/playlists" className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                    <Bookmarks size={13} /> Curated community playlists
                  </Link>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <ShieldCheck size={16} weight="bold" className="text-primary" />
                <h3 className="text-sm font-bold text-foreground">Protocol &amp; Safety</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Adult 18+ directory. Automated mirror health validation, zero personal telemetry tracking, and immediate takedown compliance.
              </p>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link href="/content-removal" className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                    <ShieldCheck size={13} /> Content removal &amp; DMCA
                  </Link>
                </li>
                <li>
                  <Link href="/settings" className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                    <SlidersHorizontal size={13} /> Data saver &amp; playback settings
                  </Link>
                </li>
                <li>
                  <Link href="/premium" className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5">
                    <Sparkle size={13} /> Ad-free premium pass
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
