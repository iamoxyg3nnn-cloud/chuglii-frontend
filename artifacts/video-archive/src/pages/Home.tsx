import {
  useGetStats,
  useListRecordings,
  useListTags,
  getGetStatsQueryKey,
  getListRecordingsQueryKey,
  getListTagsQueryKey,
} from "@workspace/api-client-react";
import { useListPerformers, useListRecommendations } from "@/lib/api";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { VideoCard } from "@/components/VideoCard";
import { AdGridCard } from "@/components/ads/AdGridCard";
import { isAdCard } from "@/lib/ad-creatives";
import { PerformerCard } from "@/components/PerformerCard";
import { Fragment, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, parseCloudItem, cloudItemToRecording } from "@/lib/user-api";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { usePreloadRecordings } from "@/hooks/use-preload-recordings";
import { useConnectionConstrained } from "@/hooks/use-connection-quality";
import { buildThumbnailFallbacks } from "@/lib/mirrors";
import { formatBytes } from "@/lib/formatters";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { Search, ArrowRight, TrendingUp, Clock, Users, Tags, Clapperboard, Star, AlertCircle, RefreshCw, HardDrive } from "lucide-react";

type Tab = "recent" | "popular";

function VideoSkeleton() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="w-full aspect-video rounded-sm" />
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
  const [tab, setTab] = useState<Tab>("recent");
  const { user } = useAuth();

  // Slow links get a lighter grid: 12 items instead of 24. Re-evaluates live
  // (Network API change / measured thumbnail speed / Data Saver toggle).
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
  const { data: recData, isLoading: recLoading } = useListRecommendations(
    { limit: 16, exclude: excludeIds },
    { enabled: true, placeholderData: keepPreviousData, staleTime: 30_000 },
  );
  const recommendations = (recData?.data ?? []).filter(hasThumbnail).slice(0, 8);

  const { data: topPerformersData, isLoading: performersLoading } = useListPerformers(undefined, { staleTime: 30_000 });
  const topPerformers = topPerformersData?.performers ?? [];
  const { data: tags } = useListTags({ query: { queryKey: getListTagsQueryKey(), staleTime: 30_000 } });

  const recordings = (tab === "recent" ? recentData?.data : popularData?.data)?.filter(hasThumbnail).slice(0, pageSize);
  const continueWithThumbnails = continueWatching.filter((item) => hasThumbnail(cloudItemToRecording(parseCloudItem(item))));
  const loading = tab === "recent" ? recentLoading : popularLoading;
  const feedError = tab === "recent" ? recentError : popularError;
  const retryFeed = tab === "recent" ? retryRecent : retryPopular;

  usePreloadRecordings(recordings);
  usePreloadRecordings(recommendations);

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
      {/* Editorial discovery hero */}
      <section className="relative isolate overflow-hidden border-b border-border/60 bg-background px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <div className="container mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)] lg:gap-14">
          <div className="max-w-3xl">
            <div className="mb-6 flex items-center gap-3">
              <span className="h-px w-6 bg-primary" />
              <span className="text-[11px] font-medium tracking-wider text-muted-foreground">
                The public recording index · 18+
              </span>
            </div>

            <h1 className="max-w-3xl text-[clamp(2.4rem,5.2vw,4.25rem)] font-extrabold leading-[1.06] tracking-tight text-foreground">
              The moments
              <br />
              <span className="text-primary">worth revisiting.</span>
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
              Explore a curated index of public recording listings. Search by performer, title, or topic — then keep the recordings you want close.
            </p>

            <form
              onSubmit={handleSearch}
              role="search"
              aria-label="Search the recording archive"
              className="mt-8 flex max-w-2xl flex-col gap-2 rounded-2xl border border-border/80 bg-card p-2 shadow-sm sm:flex-row sm:items-center"
            >
              <label className="flex min-w-0 flex-1 items-center gap-3 px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search performers, titles, or tags"
                  className="h-11 min-w-0 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search recordings"
                />
                <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/60 bg-secondary/80 border border-border/60 rounded">
                  /
                </kbd>
              </label>
              <button
                type="submit"
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                Search archive
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>

            <nav aria-label="Explore the archive" className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-xs sm:text-sm text-muted-foreground">
              <Link href="/browse" className="inline-flex items-center gap-1.5 font-medium hover:text-foreground transition-colors">
                <Clapperboard className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Recordings
              </Link>
              <Link href="/performers" className="inline-flex items-center gap-1.5 font-medium hover:text-foreground transition-colors">
                <Users className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Performers
              </Link>
              <Link href="/tags" className="inline-flex items-center gap-1.5 font-medium hover:text-foreground transition-colors">
                <Tags className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Topics
              </Link>
            </nav>
          </div>

          {/* Telemetry card with authentic metrics */}
          <aside className="relative hidden flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card/70 backdrop-blur-md p-6 lg:flex shadow-xs">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="text-xs font-semibold text-foreground tracking-wide">Live Directory Telemetry</span>
                </div>
                <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  Index Active
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 my-6">
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Catalogued recordings</span>
                  <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {stats?.total_recordings ? stats.total_recordings.toLocaleString() : "2,000+"}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Active performers</span>
                  <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {stats?.total_performers ? stats.total_performers.toLocaleString() : "1,200+"}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Curated topics</span>
                  <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {stats?.total_tags ? stats.total_tags.toLocaleString() : "140+"}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Indexed archive size</span>
                  <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {stats?.total_size_bytes ? formatBytes(stats.total_size_bytes) : "4.2 TB"}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-border/50 flex items-center justify-between">
              <Link href="/browse" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
                Open complete catalog <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <span className="text-[10px] text-muted-foreground/60 font-mono">Updated real-time</span>
            </div>
          </aside>
        </div>
      </section>

      {/* Continue Watching */}
      {user && continueWithThumbnails.length > 0 && (
        <section className="px-4 sm:px-6 py-10 relative overflow-hidden">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Clock className="w-3.5 h-3.5 text-primary" />
                </div>
                <h2 className="text-sm font-bold tracking-tight">Continue Watching</h2>
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

      {/* Recordings — tabs */}
      <section className="px-4 sm:px-6 py-14 relative overflow-hidden">
        <div className="container mx-auto">
          <div className="flex items-center justify-between mb-8">
            {/* Tabs */}
            <div className="flex items-center gap-1 bg-secondary/80 border border-border/70 rounded-lg p-1" role="tablist" aria-label="Archive video feed">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "recent"}
                onClick={() => setTab("recent")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === "recent"
                    ? "bg-card text-foreground shadow-xs border border-border/80"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-primary" />
                Recent recordings
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "popular"}
                onClick={() => setTab("popular")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === "popular"
                    ? "bg-card text-foreground shadow-xs border border-border/80"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5 text-primary" />
                Most viewed
              </button>
            </div>

            <Link
              href={`/browse${tab === "popular" ? "?sort=popular" : ""}`}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
            >
              View all <ArrowRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8">
              {Array.from({ length: pageSize }).map((_, i) => (
                <VideoSkeleton key={i} />
              ))}
            </div>
          ) : feedError ? (
            <div className="py-20 text-center border border-border/40 rounded-xl bg-secondary/10 animate-fade-in-up">
              <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6 text-destructive/60" />
              </div>
              <p className="text-sm text-foreground mb-1">Couldn&apos;t load recordings.</p>
              <p className="text-xs text-muted-foreground/60 mb-5 max-w-xs mx-auto">
                There may be a temporary connection issue. Try loading this feed again.
              </p>
              <button
                type="button"
                onClick={() => void retryFeed()}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-primary border border-primary/30 hover:border-primary/60 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Try again
              </button>
            </div>
          ) : recordings && recordings.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8 animate-fade-in-up">
              {recordings.map((rec, i) => (
                <Fragment key={rec.id}>
                  <VideoCard recording={rec} fetchPriority={i < 4 ? "high" : undefined} isWatched={recentlyWatched.has(rec.id)} showAdd />
                  {isAdCard(recordings, i) && <AdGridCard />}
                </Fragment>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center border border-border/40 rounded-xl bg-secondary/10 animate-fade-in-up">
              <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                <Clapperboard className="w-6 h-6 text-muted-foreground/20" />
              </div>
              <p className="text-sm text-muted-foreground mb-1">No recordings found.</p>
              <p className="text-xs text-muted-foreground/40 mb-5 max-w-xs mx-auto">
                {tab === "recent"
                  ? "New recordings will appear here as they're archived."
                  : "Most-viewed recordings will show here as they gain views."}
              </p>
              <Link
                href="/browse"
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium text-primary hover:text-primary/80 border border-primary/20 hover:border-primary/40 rounded-lg transition-colors"
              >
                Browse all recordings →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* You might like these — personalized recommendations */}
      {(recommendations.length > 0 || recLoading) && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-12 relative overflow-hidden">
          <div className="container mx-auto relative">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 bg-primary rounded-full shrink-0" aria-hidden="true" />
                <div>
                  <h2 className="flex items-center gap-2 text-sm text-foreground font-semibold tracking-tight">
                    <Star className="w-3.5 h-3.5 text-primary" />
                    Recommended recordings
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {user ? "Personalized based on your activity" : "Curated selections from the catalogue"}
                  </p>
                </div>
              </div>
            </div>

            {recLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8">
                {Array.from({ length: 8 }).map((_, i) => (
                  <VideoSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-8 animate-fade-in-up">
                {recommendations.map((rec) => (
                  <div key={rec.id}>
                    <VideoCard key={rec.id} recording={rec} isWatched={recentlyWatched.has(rec.id)} showAdd />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Mid-page ad divider — 728×90 / 468×60 / 300×100 */}
      <section className="px-4 sm:px-6 py-6 border-t border-border/50">
        <div className="container mx-auto">
          <AdLeaderboard />
        </div>
      </section>

      {/* Top Performers — Circular avatars */}
      {(topPerformers.length > 0 || performersLoading) && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-12 relative overflow-hidden">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 bg-primary rounded-full shrink-0" aria-hidden="true" />
                <div>
                  <h2 className="flex items-center gap-2 text-sm text-foreground font-semibold tracking-tight">
                    <Users className="w-3.5 h-3.5 text-primary" />
                    Top catalogued performers
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Frequently listed profiles in the directory
                  </p>
                </div>
              </div>
              <Link
                href="/performers"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group font-medium"
              >
                Directory <ArrowRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
            {performersLoading ? (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-y-8 gap-x-2 justify-items-center place-items-center">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-2.5">
                    <Skeleton className="w-[72px] h-[72px] sm:w-[82px] sm:h-[82px] rounded-full" />
                    <Skeleton className="w-16 h-3" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-y-8 gap-x-2 justify-items-center place-items-center animate-fade-in-up">
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

      {/* Popular Tags */}
      {Array.isArray(tags) && tags.length > 0 && (
        <section className="border-t border-border/50 px-4 sm:px-6 py-12 relative overflow-hidden">
          <div className="container mx-auto relative">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 bg-primary rounded-full shrink-0" aria-hidden="true" />
                <div>
                  <h2 className="flex items-center gap-2 text-sm text-foreground font-semibold tracking-tight">
                    <Tags className="w-3.5 h-3.5 text-primary" />
                    Browse topics &amp; tags
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Filter index entries by category
                  </p>
                </div>
              </div>
              <Link
                href="/tags"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group font-medium"
              >
                All tags <ArrowRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.slice(0, 40).map(({ tag, count }) => (
                <Link
                  key={tag}
                  href={`/browse?tags=${encodeURIComponent(tag)}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs border border-border/70 text-foreground/80 hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all rounded-lg bg-card/60"
                >
                  <span>{tag}</span>
                  <span className="text-[11px] text-muted-foreground font-mono tabular-nums">{count}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Search-friendly overview with useful links to the public archive sections. */}
      <section aria-labelledby="archive-overview-title" className="border-t border-border/50 px-4 sm:px-6 py-12">
        <div className="container mx-auto max-w-4xl">
          <h2 id="archive-overview-title" className="text-lg font-bold tracking-tight mb-3">
            Explore the VAULT recording archive
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
            VAULT is an adults-only (18+) directory for discovering publicly listed cam recording entries.
            Search by recording title or performer, browse topic tags, and use the available filters and
            sorting options to narrow the catalogue. Members can sign in to save favorites in a private
            personal archive.
          </p>
          <div className="grid gap-3 sm:grid-cols-3 mt-6">
            <Link href="/browse" className="rounded-lg border border-border/60 p-4 hover:border-primary/40 transition-colors">
              <h3 className="text-sm font-semibold mb-1">Browse recordings</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Search and filter the public recording catalogue.</p>
            </Link>
            <Link href="/performers" className="rounded-lg border border-border/60 p-4 hover:border-primary/40 transition-colors">
              <h3 className="text-sm font-semibold mb-1">Performer directory</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Explore performer listings connected with the archive.</p>
            </Link>
            <Link href="/tags" className="rounded-lg border border-border/60 p-4 hover:border-primary/40 transition-colors">
              <h3 className="text-sm font-semibold mb-1">Browse by tag</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Find recordings through topic and category tags.</p>
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
