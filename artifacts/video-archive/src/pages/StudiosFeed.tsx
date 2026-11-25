import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import {
  useStudiosVideos,
  MADOUER_SECTIONS,
  DASJ91_SECTIONS,
  MADOUHD_SECTIONS,
  type StudiosSortOption,
} from "@/hooks/useStudiosVideos";
import { StudiosCard, StudiosCardSkeleton } from "@/components/StudiosCard";
import { AppPagination } from "@/components/ui/app-pagination";
import {
  Sparkle,
  MagnifyingGlass,
  X,
  CaretDown,
  Funnel,
  FilmStrip,
  ArrowClockwise,
  MonitorPlay,
} from "@phosphor-icons/react";

const SORT_OPTIONS: { id: StudiosSortOption; label: string }[] = [
  { id: "newest", label: "Newest First" },
  { id: "oldest", label: "Oldest First" },
  { id: "quality", label: "Highest Quality" },
];

const ITEMS_PER_PAGE = 24;

const SITE_META: Record<string, { label: string; blurb: string }> = {
  madouer: {
    label: "Madou",
    blurb:
      "Produced studio content from the Madou network — full HLS streams with instant playback, quality labels and English titles.",
  },
  dasj91: {
    label: "91 Dasj",
    blurb:
      "91 Dasj archive — studio and drama productions streamed through play-time resolution, with English titles and section filters.",
  },
  madouhd: {
    label: "Madou HD",
    blurb:
      "Madou HD productions — direct HLS streams with instant playback, English titles and section filters.",
  },
};

export default function StudiosFeed({ site: siteProp }: { site?: string }) {
  const [, setLocation] = useLocation();
  const site = ["dasj91", "madouhd"].includes(siteProp || "") ? siteProp! : "madouer";
  const searchString = window.location.search;

  const queryParams = new URLSearchParams(searchString);
  const initialCategory = queryParams.get("cat") || "all";
  const initialPage = parseInt(queryParams.get("page") || "1", 10);
  const initialSort = (queryParams.get("sort") as StudiosSortOption) || "newest";
  const initialSearch = queryParams.get("q") || "";

  const activeSite = site;
  const [activeCategory, setActiveCategory] = useState<string>(initialCategory);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [activeSort, setActiveSort] = useState<StudiosSortOption>(initialSort);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearch);
  const [sortOpen, setSortOpen] = useState(false);

  const updateUrl = useCallback(
    (site: string, cat: string, page: number, sort: StudiosSortOption, search: string) => {
      const params = new URLSearchParams();
      if (site !== "madouer") params.set("site", site);
      if (cat !== "all") params.set("cat", cat);
      if (page > 1) params.set("page", page.toString());
      if (sort !== "newest") params.set("sort", sort);
      if (search) params.set("q", search);
      const queryString = params.toString();
      setLocation(`/chinese/${activeSite}${queryString ? `?${queryString}` : ""}`, { replace: true });
    },
    [setLocation]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    updateUrl(activeSite, activeCategory, currentPage, activeSort, debouncedSearch);
  }, [activeSite, activeCategory, currentPage, activeSort, debouncedSearch, updateUrl]);

  const { data, isLoading, isError, refetch } = useStudiosVideos({
    site: activeSite,
    category: activeCategory !== "all" ? activeCategory : undefined,
    search: debouncedSearch || undefined,
    sort: activeSort,
    limit: ITEMS_PER_PAGE,
    page: currentPage,
  });

  const videos = data?.items || [];
  const totalCount = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="relative border-b border-border/40 bg-gradient-to-b from-amber-950/20 via-background to-background py-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1.5">
                    <MonitorPlay size={13} weight="fill" className="text-amber-400" />
                    <span>Studios · {SITE_META[activeSite].label}</span>
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                  {SITE_META[activeSite].label} Studios Archive
                </h1>
                <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                  {SITE_META[activeSite].blurb}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-xl bg-card border border-border/50 text-right">
                  <div className="text-xs text-muted-foreground">Indexed Items</div>
                  <div className="text-lg font-bold text-amber-400">
                    {totalCount > 0 ? totalCount.toLocaleString() : "..."}
                  </div>
                </div>
              </div>
            </div>


            <nav
              aria-label="Studios sections"
              className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 pb-1"
            >
              <button
                onClick={() => {
                  setActiveCategory("all");
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                  activeCategory === "all"
                    ? "bg-secondary/70 text-foreground font-semibold border border-border/60"
                    : "bg-card/60 text-muted-foreground hover:text-foreground hover:bg-card border border-border/40"
                }`}
              >
                All Sections
              </button>
              {(activeSite === "dasj91"
                ? DASJ91_SECTIONS
                : activeSite === "madouhd"
                  ? MADOUHD_SECTIONS
                  : MADOUER_SECTIONS).map((r) => {
                const active = activeCategory === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      setActiveCategory(r.id);
                      setCurrentPage(1);
                    }}
                    aria-current={active ? "true" : undefined}
                    title={r.en}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                      active
                        ? "bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/40"
                        : "bg-card/60 text-muted-foreground hover:text-foreground hover:bg-card border border-border/40"
                    }`}
                  >
                    {r.en}
                  </button>
                );
              })}
            </nav>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <div className="relative flex-1">
                <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search studios videos"
                  placeholder="Search title..."
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
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {Array.from({ length: 12 }).map((_, idx) => <StudiosCardSkeleton key={idx} />)}
            </div>
          ) : isError ? (
            <div className="text-center py-20 space-y-4">
              <FilmStrip size={48} className="mx-auto text-muted-foreground/40" />
              <div className="text-base font-semibold text-foreground">Failed to load studios category</div>
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
          ) : videos.length === 0 ? (
            <div className="text-center py-20 space-y-3">
              <FilmStrip size={44} className="mx-auto text-muted-foreground/30" />
              <div className="text-sm font-semibold text-foreground">No items found</div>
              <p className="text-xs text-muted-foreground">Try another search or section filter.</p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                {videos.map((video) => (
                  <StudiosCard key={video.id} video={video} />
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
