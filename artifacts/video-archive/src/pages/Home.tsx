import {
  useGetStats,
  useListRecordings,
  useListTags,
  getGetStatsQueryKey,
  getListRecordingsQueryKey,
  getListTagsQueryKey,
  type Recording,
} from "@workspace/api-client-react";
import { useListPerformers, useListRecommendations } from "@/lib/api";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { AdGridCard } from "@/components/ads/AdGridCard";
import { isAdCard } from "@/lib/ad-creatives";
import { PerformerCard } from "@/components/PerformerCard";
import { Fragment, useState, useRef, useEffect, useMemo } from "react";
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
  MagnifyingGlass,
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
  CheckCircle,
  Lightning,
  Bookmarks,
  SlidersHorizontal,
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

/**
 * Featured Spotlight card in the hero — highlights the top trending recording
 * with direct launch action and rich metadata overlay.
 */
function FeaturedSpotlightCard({ recording }: { recording: Recording }) {
  const thumbUrl = proxyUrl(recording.sprite_url || recording.thumbnail_url || recording.preview_url);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-lg transition-all hover:border-primary/50">
      <Link href={`/video/${encodeURIComponent(recording.id)}`} className="block relative aspect-video w-full overflow-hidden bg-black/60">
        {thumbUrl ? (
          <OptimizedImage
            src={thumbUrl}
            alt={recording.username}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            containerClassName="w-full h-full"
            width="hero"
            fetchPriority="high"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-secondary/30">
            <FilmStrip size={48} weight="duotone" className="text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-black/20" />

        {/* Top Badges */}
        <div className="absolute top-3 inset-x-3 flex items-center justify-between pointer-events-none z-10">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-bold tracking-wider uppercase shadow-xs">
            <Fire size={13} weight="fill" />
            Trending #1
          </div>
          {recording.resolution && (
            <div className="px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[10px] font-mono font-bold text-white/90 ring-1 ring-white/10">
              {recording.resolution}
            </div>
          )}
        </div>

        {/* Center Play Button on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <div className="w-14 h-14 rounded-full bg-primary/95 text-primary-foreground flex items-center justify-center shadow-xl transform transition-transform group-hover:scale-110">
            <Play size={24} weight="fill" className="ml-0.5" />
          </div>
        </div>

        {/* Bottom Info overlay */}
        <div className="absolute bottom-3.5 inset-x-3.5 space-y-1 z-10">
          <div className="flex items-center gap-2">
            <span className="text-base sm:text-lg font-bold text-white group-hover:text-primary transition-colors truncate">
              {recording.username}
            </span>
            <CheckCircle size={15} weight="fill" className="text-primary shrink-0" />
          </div>
          {recording.room_title && (
            <p className="text-xs text-white/70 line-clamp-1 italic">
              {recording.room_title}
            </p>
          )}
          <div className="flex items-center gap-2 text-[11px] text-white/60 font-mono pt-1">
            {recording.duration ? (
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {formatDuration(recording.duration)}
              </span>
            ) : null}
            {recording.viewers ? (
              <>
                <span>•</span>
                <span>{recording.viewers.toLocaleString()} views</span>
              </>
            ) : null}
            {recording.timestamp ? (
              <>
                <span>•</span>
                <span>{formatRelativeTime(recording.timestamp)}</span>
              </>
            ) : null}
          </div>
        </div>
      </Link>
    </div>
  );
}

export default function Home() {
  const [_, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("popular");
  const { user } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: '/' focuses the hero search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchInputRef.current) {
        const target = e.target as HTMLElement;
        if (target && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  // Select top featured recording for the hero spotlight (from popular stream)
  const featuredRecording = useMemo(() => {
    const list = popularData?.data?.filter(hasThumbnail) ?? [];
    return list[0] ?? null;
  }, [popularData?.data]);

  // Determine active feed data
  const feedState = useMemo(() => {
    if (tab === "popular") {
      const all = (popularData?.data ?? []).filter(hasThumbnail);
      // Remove spotlighted video to avoid duplicate card right underneath
      const filtered = featuredRecording ? all.filter((r) => r.id !== featuredRecording.id) : all;
      return {
        recordings: filtered.slice(0, pageSize),
        loading: popularLoading,
        error: popularError,
        retry: retryPopular,
      };
    }
    if (tab === "recent") {
      const all = (recentData?.data ?? []).filter(hasThumbnail);
      const filtered = featuredRecording ? all.filter((r) => r.id !== featuredRecording.id) : all;
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
    featuredRecording,
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      setLocation(`/browse?search=${encodeURIComponent(search.trim())}`);
    } else {
      setLocation("/browse");
    }
  };

  return (
    <Layout>
      {/* ─── Hero Section with Featured Spotlight ────────────────────── */}
      <section className="relative isolate overflow-hidden border-b border-border/60 bg-gradient-to-b from-background via-background/95 to-card/20 px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
        <div className="container mx-auto grid max-w-7xl items-center gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)] lg:gap-12">
          {/* Left Column: Mission, Search & Telemetry */}
          <div className="max-w-2xl">
            {/* Live Indicator Pill */}
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-secondary/60 px-3 py-1 text-xs backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="font-mono text-[11px] font-semibold text-foreground tracking-wide">INDEX SYNCHRONIZED</span>
              <span className="text-border">·</span>
              <span className="font-mono text-[10px] text-muted-foreground/80">1080p ADULT ARCHIVE</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-foreground leading-[1.08]">
              The adult recording archive.
              <span className="block text-muted-foreground font-normal text-base sm:text-lg lg:text-xl mt-3 leading-relaxed">
                Direct streams, performer discographies, and frame-accurate timeline scrubbing with zero compromise.
              </span>
            </h1>

            {/* Search Input with Hotkey */}
            <form onSubmit={handleSearch} role="search" aria-label="Search the recording archive" className="mt-6 max-w-xl">
              <div className="relative flex items-center rounded-xl border border-border/80 bg-card/90 shadow-xs backdrop-blur-md transition-all focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
                <div className="pl-3.5 pr-2 text-muted-foreground/70" aria-hidden="true">
                  <MagnifyingGlass size={18} weight="bold" />
                </div>
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder="Search performers, titles, or tags..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60 pr-24"
                  aria-label="Search recordings"
                />
                <div className="absolute right-2 flex items-center gap-1.5">
                  <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/60 bg-secondary/80 border border-border/60 rounded">
                    /
                  </kbd>
                  <button
                    type="submit"
                    className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    Search
                  </button>
                </div>
              </div>
            </form>

            {/* Quick Jumps */}
            <div className="mt-3.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="text-[11px] text-muted-foreground/60 mr-1 font-mono uppercase tracking-wider">Fast Jumps:</span>
              {["Chaturbate", "Stripchat", "1080p", "Solo", "Couples"].map((tag) => (
                <Link
                  key={tag}
                  href={`/browse?search=${encodeURIComponent(tag)}`}
                  className="px-2 py-0.5 rounded-md bg-secondary/60 hover:bg-secondary text-xs text-muted-foreground hover:text-foreground border border-border/40 transition-colors"
                >
                  {tag}
                </Link>
              ))}
            </div>

            {/* Telemetry Counter Row */}
            <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 border-t border-border/50 max-w-xl">
              <div>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {stats?.total_recordings ? stats.total_recordings.toLocaleString() : "2,000+"}
                </div>
                <div className="text-[11px] text-muted-foreground">Recordings</div>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {stats?.total_performers ? stats.total_performers.toLocaleString() : "1,200+"}
                </div>
                <div className="text-[11px] text-muted-foreground">Performers</div>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {stats?.total_tags ? stats.total_tags.toLocaleString() : "140+"}
                </div>
                <div className="text-[11px] text-muted-foreground">Topics</div>
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {stats?.total_size_bytes ? formatBytes(stats.total_size_bytes) : "4.2 TB"}
                </div>
                <div className="text-[11px] text-muted-foreground">Indexed Size</div>
              </div>
            </div>
          </div>

          {/* Right Column: Featured Spotlight Card */}
          <div className="min-w-0">
            {popularLoading ? (
              <div className="aspect-video w-full rounded-2xl bg-secondary/30 animate-pulse border border-border/60" />
            ) : featuredRecording ? (
              <FeaturedSpotlightCard recording={featuredRecording} />
            ) : (
              <div className="aspect-video w-full rounded-2xl bg-secondary/20 border border-border/60 flex items-center justify-center">
                <FilmStrip size={44} weight="duotone" className="text-muted-foreground/30" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ─── Continue Watching (Logged In Users) ─────────────────────── */}
      {user && continueWithThumbnails.length > 0 && (
        <section className="px-4 sm:px-6 py-8 border-b border-border/50">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-5">
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

      {/* ─── Main Feed (Trending / Recent / Recommended) ─────────────── */}
      <section className="px-4 sm:px-6 py-10 relative overflow-hidden">
        <div className="container mx-auto">
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
                Trending
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
      <section className="px-4 sm:px-6 py-6 border-t border-border/50">
        <div className="container mx-auto">
          <AdLeaderboard />
        </div>
      </section>

      {/* ─── Top Performers Showcase ─────────────────────────────────── */}
      {(topPerformers.length > 0 || performersLoading) && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-10 relative overflow-hidden">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-6">
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
        <section className="border-t border-border/50 px-4 sm:px-6 py-10 relative overflow-hidden">
          <div className="container mx-auto">
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
