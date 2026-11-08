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
  Lightning,
  Bookmarks,
  SlidersHorizontal,
  CaretLeft,
  CaretRight,
  Eye,
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
  const [_, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("popular");
  const [activeHero, setActiveHero] = useState(0);
  const [isHeroPaused, setIsHeroPaused] = useState(false);
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

  // Top 5 featured spotlight recordings for the hero billboard
  const spotlightRecordings = useMemo(() => {
    const list = popularData?.data?.filter(hasThumbnail) ?? [];
    return list.slice(0, 5);
  }, [popularData?.data]);

  const currentFeatured = spotlightRecordings[activeHero] ?? spotlightRecordings[0] ?? null;

  // Auto-advance hero billboard every 7s when not hovered
  useEffect(() => {
    if (isHeroPaused || spotlightRecordings.length <= 1) return;
    const timer = setInterval(() => {
      setActiveHero((prev) => (prev + 1) % spotlightRecordings.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [isHeroPaused, spotlightRecordings.length]);

  // Determine active feed data
  const feedState = useMemo(() => {
    if (tab === "popular") {
      const all = (popularData?.data ?? []).filter(hasThumbnail);
      const filtered = currentFeatured ? all.filter((r) => r.id !== currentFeatured.id) : all;
      return {
        recordings: filtered.slice(0, pageSize),
        loading: popularLoading,
        error: popularError,
        retry: retryPopular,
      };
    }
    if (tab === "recent") {
      const all = (recentData?.data ?? []).filter(hasThumbnail);
      const filtered = currentFeatured ? all.filter((r) => r.id !== currentFeatured.id) : all;
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
    currentFeatured,
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

  const heroBackdrop = currentFeatured
    ? proxyUrl(currentFeatured.sprite_url || currentFeatured.thumbnail_url || currentFeatured.preview_url)
    : null;

  return (
    <Layout>
      {/* ─── Cinematic Hero Billboard ──────────────────────────────── */}
      <section
        onMouseEnter={() => setIsHeroPaused(true)}
        onMouseLeave={() => setIsHeroPaused(false)}
        className="relative isolate overflow-hidden bg-black border-b border-border/70"
      >
        <div className="relative min-h-[480px] sm:min-h-[520px] lg:min-h-[580px] flex items-center">
          {/* Backdrop Image with Multi-layer Vignette */}
          {heroBackdrop ? (
            <div className="absolute inset-0 -z-10 overflow-hidden">
              <OptimizedImage
                key={currentFeatured?.id}
                src={heroBackdrop}
                alt={currentFeatured?.username || "Featured"}
                className="w-full h-full object-cover object-center filter brightness-[0.55] contrast-110 transition-opacity duration-700"
                containerClassName="w-full h-full"
                width="hero"
                fetchPriority="high"
                loading="eager"
              />
              {/* Deep Cinema Vignette Overlays */}
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent lg:w-3/4" />
              <div className="absolute inset-0 bg-radial-gradient from-transparent to-black/70 pointer-events-none" />
            </div>
          ) : (
            <div className="absolute inset-0 -z-10 bg-gradient-to-b from-card via-background to-background" />
          )}

          {/* Billboard Grid */}
          <div className="container mx-auto px-4 sm:px-6 py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-center w-full">
            {/* Left Content Column */}
            <div className="max-w-2xl space-y-4 sm:space-y-5">
              {/* Top Category Badge Row */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold tracking-wide uppercase shadow-sm">
                  <Fire size={14} weight="fill" />
                  Trending #{activeHero + 1}
                </span>
                {currentFeatured?.resolution && (
                  <span className="px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-[11px] font-mono font-semibold text-white/95 ring-1 ring-white/15">
                    {currentFeatured.resolution}
                  </span>
                )}
                {currentFeatured?.duration ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md text-[11px] font-mono text-zinc-300 ring-1 ring-white/10">
                    <Clock size={12} />
                    {formatDuration(currentFeatured.duration)}
                  </span>
                ) : null}
              </div>

              {/* Performer Name & Headline */}
              <div>
                <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-[1.05] drop-shadow-md">
                  {currentFeatured ? (
                    <Link
                      href={`/performers/${encodeURIComponent(currentFeatured.username)}`}
                      className="hover:text-primary transition-colors inline-flex items-center gap-3"
                    >
                      <span>{currentFeatured.username}</span>
                    </Link>
                  ) : (
                    "The Recording Vault"
                  )}
                </h1>
                {currentFeatured?.room_title && (
                  <p className="mt-2.5 text-sm sm:text-base text-zinc-300 font-normal line-clamp-2 max-w-xl leading-relaxed">
                    {currentFeatured.room_title}
                  </p>
                )}
              </div>

              {/* Metadata Details */}
              {currentFeatured && (
                <div className="flex items-center gap-3 text-xs text-zinc-400 font-mono pt-1">
                  {currentFeatured.viewers ? (
                    <span className="flex items-center gap-1.5 text-zinc-300">
                      <Eye size={14} weight="bold" />
                      {currentFeatured.viewers.toLocaleString()} views
                    </span>
                  ) : null}
                  {currentFeatured.timestamp ? (
                    <>
                      <span>•</span>
                      <span>Recorded {formatRelativeTime(currentFeatured.timestamp)}</span>
                    </>
                  ) : null}
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex flex-wrap items-center gap-3">
                {currentFeatured ? (
                  <>
                    <Link
                      href={`/video/${encodeURIComponent(currentFeatured.id)}`}
                      className="inline-flex items-center justify-center gap-2.5 h-12 px-7 rounded-xl bg-primary text-primary-foreground font-bold text-sm tracking-wide shadow-lg hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <Play size={18} weight="fill" />
                      Watch Recording
                    </Link>
                    <Link
                      href={`/performers/${encodeURIComponent(currentFeatured.username)}`}
                      className="inline-flex items-center justify-center gap-2 h-12 px-5 rounded-xl bg-white/10 backdrop-blur-md hover:bg-white/15 text-white font-medium text-sm border border-white/15 transition-all cursor-pointer"
                    >
                      <UsersThree size={16} weight="bold" />
                      Performer Vault
                    </Link>
                  </>
                ) : (
                  <Link
                    href="/browse"
                    className="inline-flex items-center justify-center gap-2.5 h-12 px-7 rounded-xl bg-primary text-primary-foreground font-bold text-sm tracking-wide shadow-lg hover:bg-primary/90 transition-all cursor-pointer"
                  >
                    <Play size={18} weight="fill" />
                    Browse Catalogue
                  </Link>
                )}
              </div>
            </div>

            {/* Right Shelf Carousel (Desktop) */}
            {spotlightRecordings.length > 1 && (
              <div className="hidden lg:flex flex-col justify-center space-y-3 z-10 w-full">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                    <Sparkle size={13} weight="fill" className="text-primary" />
                    Trending Spotlights
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setActiveHero((prev) => (prev - 1 + spotlightRecordings.length) % spotlightRecordings.length)}
                      className="w-7 h-7 rounded-lg bg-black/60 hover:bg-black/80 border border-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
                      aria-label="Previous spotlight stream"
                    >
                      <CaretLeft size={14} weight="bold" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveHero((prev) => (prev + 1) % spotlightRecordings.length)}
                      className="w-7 h-7 rounded-lg bg-black/60 hover:bg-black/80 border border-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
                      aria-label="Next spotlight stream"
                    >
                      <CaretRight size={14} weight="bold" />
                    </button>
                  </div>
                </div>

                {/* Thumbnail Cards */}
                <div className="space-y-2">
                  {spotlightRecordings.map((rec, idx) => {
                    const active = idx === activeHero;
                    const recThumb = proxyUrl(rec.thumbnail_url || rec.preview_url);
                    return (
                      <button
                        key={rec.id}
                        type="button"
                        onClick={() => setActiveHero(idx)}
                        className={`w-full flex items-center gap-3 p-2 rounded-xl transition-all text-left cursor-pointer border ${
                          active
                            ? "bg-white/15 border-primary/70 ring-1 ring-primary/40 shadow-lg backdrop-blur-md"
                            : "bg-black/50 border-white/5 hover:bg-black/70 hover:border-white/15 text-zinc-400"
                        }`}
                      >
                        <div className="relative w-16 aspect-video rounded-lg overflow-hidden bg-black/60 shrink-0 border border-white/10">
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
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-bold truncate ${active ? "text-white" : "text-zinc-200"}`}>
                            {rec.username}
                          </div>
                          <div className="text-[10px] text-zinc-400 font-mono truncate">
                            {rec.duration ? formatDuration(rec.duration) : "Stream"} • {rec.viewers ? `${rec.viewers.toLocaleString()} views` : "HD"}
                          </div>
                        </div>
                        <div className="text-[10px] font-mono text-zinc-500 pr-1">
                          0{idx + 1}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Mobile Carousel Indicator Dots */}
          {spotlightRecordings.length > 1 && (
            <div className="lg:hidden flex items-center justify-center gap-1.5 pb-4 z-10">
              {spotlightRecordings.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveHero(idx)}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    idx === activeHero ? "w-6 bg-primary" : "w-1.5 bg-white/30"
                  }`}
                  aria-label={`Jump to slide ${idx + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ─── Floating Command Search Bar ────────────────────────────── */}
      <div className="container mx-auto px-4 sm:px-6 -mt-6 sm:-mt-8 relative z-20">
        <div className="rounded-2xl border border-border/80 bg-card/95 backdrop-blur-xl p-3 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            {/* Search Input */}
            <form onSubmit={handleSearch} role="search" aria-label="Search recordings" className="flex-1 flex items-center">
              <div className="relative flex-1 flex items-center">
                <MagnifyingGlass size={18} weight="bold" className="absolute left-3.5 text-muted-foreground/70" />
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder="Search 2,000+ performers, titles, categories..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-11 w-full bg-secondary/50 rounded-xl pl-10 pr-20 text-sm text-foreground outline-none border border-border/60 focus:border-primary/50 focus:bg-secondary/80 transition-all placeholder:text-muted-foreground/60"
                  aria-label="Search recordings input"
                />
                <div className="absolute right-2 flex items-center gap-1.5">
                  <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/60 bg-background/80 border border-border/60 rounded">
                    /
                  </kbd>
                  <button
                    type="submit"
                    className="inline-flex h-7 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    Search
                  </button>
                </div>
              </div>
            </form>

            {/* Quick Explore Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
              <span className="text-[11px] font-mono text-muted-foreground/60 uppercase tracking-wider shrink-0 mr-1">
                Explore:
              </span>
              {["Chaturbate", "Stripchat", "1080p", "Solo", "Couples", "Anal"].map((tag) => (
                <Link
                  key={tag}
                  href={`/browse?search=${encodeURIComponent(tag)}`}
                  className="px-2.5 py-1 rounded-lg bg-secondary/50 hover:bg-secondary text-xs text-muted-foreground hover:text-foreground border border-border/40 hover:border-border transition-colors shrink-0"
                >
                  {tag}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Live Telemetry Status Strip ────────────────────────────── */}
      <div className="container mx-auto px-4 sm:px-6 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-4 py-2.5 px-4 rounded-xl bg-secondary/30 border border-border/50 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-mono text-[11px] text-foreground font-medium">MIRROR NETWORK SYNCHRONIZED</span>
          </div>

          <div className="flex items-center gap-5 font-mono text-[11px] tabular-nums">
            <div>
              <strong className="text-foreground">{stats?.total_recordings ? stats.total_recordings.toLocaleString() : "2,000+"}</strong> recordings
            </div>
            <div>
              <strong className="text-foreground">{stats?.total_performers ? stats.total_performers.toLocaleString() : "1,200+"}</strong> performers
            </div>
            <div className="hidden sm:block">
              <strong className="text-foreground">{stats?.total_tags ? stats.total_tags.toLocaleString() : "140+"}</strong> topics
            </div>
            <div className="hidden md:block">
              <strong className="text-foreground">{stats?.total_size_bytes ? formatBytes(stats.total_size_bytes) : "4.2 TB"}</strong> storage
            </div>
          </div>
        </div>
      </div>

      {/* ─── Continue Watching (Logged In Users) ─────────────────────── */}
      {user && continueWithThumbnails.length > 0 && (
        <section className="px-4 sm:px-6 py-8 border-b border-border/50 mt-4">
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
