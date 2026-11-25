import { useState, useEffect, useCallback } from "react";
import { Link, useParams, useSearch, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import {
  useVoyeurhouseVideos,
  VOYEURHOUSE_SITES,
  VOYEURHOUSE_SITE_LABELS,
  VOYEURHOUSE_SITE_SOURCES,
  isVoyeurhouseSite,
  type VoyeurhouseSortOption,
} from "@/hooks/useVoyeurhouseVideos";
import { VoyeurhouseCard, VoyeurhouseCardSkeleton } from "@/components/VoyeurhouseCard";
import { AppPagination } from "@/components/ui/app-pagination";
import {
  Sparkle,
  MagnifyingGlass,
  X,
  CaretDown,
  Funnel,
  FilmStrip,
  ArrowClockwise,
  Broadcast,
} from "@phosphor-icons/react";

const VH_TABS = [
  { id: "All", label: "All videos" },
  { id: "Saved", label: "Saved" },
];

const SORT_OPTIONS: { id: VoyeurhouseSortOption; label: string }[] = [
  { id: "newest", label: "Newest First" },
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Highest Rated" },
  { id: "quality", label: "Highest Quality" },
  { id: "oldest", label: "Oldest First" },
];

const ITEMS_PER_PAGE = 24;

export default function VoyeurhouseFeed() {
  const { site: routeSite } = useParams<{ site: string }>();
  const site = isVoyeurhouseSite(routeSite) ? routeSite : undefined;
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  const queryParams = new URLSearchParams(searchString);
  const initialTab = queryParams.get("tag") || "All";
  const initialPage = parseInt(queryParams.get("page") || "1", 10);
  const initialSort = (queryParams.get("sort") as VoyeurhouseSortOption) || "newest";
  const initialSearch = queryParams.get("q") || "";

  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [activeSort, setActiveSort] = useState<VoyeurhouseSortOption>(initialSort);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearch);
  const [sortOpen, setSortOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("voyeurhouse_saved_videos");
      if (stored) setSavedIds(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  const handleToggleSave = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem("voyeurhouse_saved_videos", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const updateUrl = useCallback(
    (tab: string, page: number, sort: VoyeurhouseSortOption, search: string) => {
      const params = new URLSearchParams();
      if (tab !== "All") params.set("tag", tab);
      if (page > 1) params.set("page", page.toString());
      if (sort !== "newest") params.set("sort", sort);
      if (search) params.set("q", search);
      const queryString = params.toString();
      const basePath = site ? `/voyeurhouse/${site}` : "/voyeurhouse";
      setLocation(`${basePath}${queryString ? `?${queryString}` : ""}`, { replace: true });
    },
    [setLocation, site]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    updateUrl(activeTab, currentPage, activeSort, debouncedSearch);
  }, [activeTab, currentPage, activeSort, debouncedSearch, updateUrl]);

  const isSavedView = activeTab === "Saved";
  const { data, isLoading, isError, refetch } = useVoyeurhouseVideos({
    site,
    tag: !isSavedView && activeTab !== "All" ? activeTab : undefined,
    search: debouncedSearch || undefined,
    sort: activeSort,
    limit: ITEMS_PER_PAGE,
    page: currentPage,
  });

  const videos = data?.items || [];
  const totalCount = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const displayVideos = isSavedView ? videos.filter((v) => savedIds.includes(v.id)) : videos;

  if (!site) {
    return (
      <Layout>
        <div className="min-h-screen bg-background text-foreground pb-20">
          <section className="border-b border-border/40 bg-gradient-to-b from-amber-950/20 via-background to-background py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">Voyeur House</span>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Choose a source</h1>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Voyeur House, HotScopes, and RealLifeCam sites live in one category — each keeps its own isolated
                database, feed, and video routes. No data is shared or merged between them.
              </p>
            </div>
          </section>
          <section aria-label="Voyeur House source sections" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {VOYEURHOUSE_SITES.map((source) => (
                <Link key={source} href={`/voyeurhouse/${source}`}>
                  <span className="block h-full rounded-2xl border border-border/50 bg-card/60 p-5 hover:border-amber-500/50 hover:bg-card transition-colors">
                    <span className="block text-base font-semibold text-foreground">{VOYEURHOUSE_SITE_LABELS[source]}</span>
                    <span className="block mt-1 text-xs text-amber-400/80 font-mono">{VOYEURHOUSE_SITE_SOURCES[source]}</span>
                    <span className="block mt-3 text-xs text-muted-foreground">Open isolated source section →</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="relative border-b border-border/40 bg-gradient-to-b from-amber-950/20 via-background to-background py-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1.5">
                    <Broadcast size={13} weight="fill" className="text-amber-400" />
                    <span>{VOYEURHOUSE_SITE_LABELS[site]}</span>
                  </span>
                  <span className="text-xs text-muted-foreground/70">Isolated source database</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                  {VOYEURHOUSE_SITE_LABELS[site]}
                </h1>
                <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                  Videos collected from {VOYEURHOUSE_SITE_SOURCES[site]}. Dead streams are skipped automatically.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-xl bg-card border border-border/50 text-right">
                  <div className="text-xs text-muted-foreground">Indexed Videos</div>
                  <div className="text-lg font-bold text-amber-400">
                    {totalCount > 0 ? totalCount.toLocaleString() : "..."}
                  </div>
                </div>
              </div>
            </div>

            <nav aria-label="Voyeur House source sections" className="flex items-center gap-2 overflow-x-auto pt-1 pb-1">
              <Link href="/voyeurhouse">
                <span className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-card/60 text-muted-foreground hover:text-foreground border border-border/40 cursor-pointer">
                  All sources
                </span>
              </Link>
              {VOYEURHOUSE_SITES.map((source) => (
                <Link key={source} href={`/voyeurhouse/${source}`} aria-current={source === site ? "page" : undefined}>
                  <span className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${source === site ? "bg-amber-500 text-white border-amber-500" : "bg-card/60 text-muted-foreground hover:text-foreground border-border/40"}`}>
                    {VOYEURHOUSE_SITE_LABELS[source]}
                  </span>
                </Link>
              ))}
            </nav>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <div className="relative flex-1">
                <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search Voyeur House videos"
                  placeholder="Search video title or model..."
                  className="w-full pl-10 pr-9 py-2 rounded-xl bg-card/60 border border-border/50 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => setSortOpen(!sortOpen)}
                  aria-expanded={sortOpen}
                  aria-haspopup="menu"
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-card/60 border border-border/50 text-sm font-medium flex items-center justify-between gap-2 hover:border-border transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Funnel size={14} />
                    <span>Sort:</span>
                    <span className="text-foreground font-semibold">{SORT_OPTIONS.find((s) => s.id === activeSort)?.label}</span>
                  </span>
                  <CaretDown size={12} className={`transition-transform ${sortOpen ? "rotate-180" : ""}`} />
                </button>
                {sortOpen && (
                  <div className="absolute right-0 mt-1 w-52 rounded-xl bg-popover border border-border/60 shadow-xl py-1 z-30 animate-in fade-in zoom-in-95">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => {
                          setActiveSort(opt.id);
                          setSortOpen(false);
                          setCurrentPage(1);
                        }}
                        className={`w-full text-left px-3.5 py-2 text-xs font-medium flex items-center justify-between hover:bg-muted transition-colors ${
                          activeSort === opt.id ? "text-amber-400 font-bold bg-amber-500/10" : "text-foreground"
                        }`}
                      >
                        <span>{opt.label}</span>
                        {activeSort === opt.id && <Sparkle size={13} weight="fill" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 pb-1">
              {VH_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                    activeTab === tab.id
                      ? "bg-amber-500 text-white font-semibold shadow-sm shadow-amber-500/20"
                      : "bg-card/60 text-muted-foreground hover:text-foreground hover:bg-card border border-border/40"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {Array.from({ length: 12 }).map((_, idx) => <VoyeurhouseCardSkeleton key={idx} />)}
            </div>
          ) : isError ? (
            <div className="text-center py-20 space-y-4">
              <FilmStrip size={48} className="mx-auto text-muted-foreground/40" />
              <div className="text-base font-semibold text-foreground">Failed to load Voyeur House videos</div>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Unable to query the isolated Supabase RPC endpoint. Please verify your connection or refresh the page.
              </p>
              <button
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors"
              >
                <ArrowClockwise size={14} />
                <span>Retry</span>
              </button>
            </div>
          ) : displayVideos.length === 0 ? (
            <div className="text-center py-20 space-y-3">
              <FilmStrip size={44} className="mx-auto text-muted-foreground/30" />
              <div className="text-sm font-semibold text-foreground">No videos found</div>
              <p className="text-xs text-muted-foreground">Try another search or choose a different source section.</p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                {displayVideos.map((video) => (
                  <VoyeurhouseCard
                    key={video.id}
                    video={video}
                    isSaved={savedIds.includes(video.id)}
                    onToggleSave={handleToggleSave}
                  />
                ))}
              </div>
              {totalPages > 1 && (
                <div className="pt-6 border-t border-border/40 flex justify-center">
                  <AppPagination
                    itemsCount={totalCount}
                    itemsPerPage={ITEMS_PER_PAGE}
                    currentPage={currentPage}
                    onPageChange={(p) => {
                      setCurrentPage(p);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

// asset-cache-bust: 2026-11-25T2 (poisoned /assets/* immutable entries)

if (typeof window !== "undefined") { (window as unknown as { __chunkBuilds?: Record<string, number> }).__chunkBuilds = { b2: 1 }; }
