import { useState, useEffect, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useJapaneseVideos, type JapaneseVideo, type JapaneseSortOption } from "@/hooks/useJapaneseVideos";
import { JapaneseCard } from "@/components/JapaneseCard";
import { AppPagination } from "@/components/ui/app-pagination";
import {
  Sparkle,
  Eye,
  Clock,
  MagnifyingGlass,
  X,
  CaretDown,
  Funnel,
  FilmStrip,
  ArrowClockwise,
  GlobeHemisphereWest
} from "@phosphor-icons/react";

const JAV_TABS = [
  { id: "All", label: "All Japanese" },
  { id: "uncensored-jav", label: "Uncensored" },
  { id: "censored-jav", label: "Censored JAV" },
  { id: "amateur", label: "Amateur / FC2" },
  { id: "reducing-mosaic", label: "Decensored / AI" },
  { id: "fc2ppv", label: "FC2-PPV" },
  { id: "chinese-subtitles", label: "Chinese Sub" },
  { id: "english-subtitles", label: "English Sub" },
  { id: "popular", label: "Popular" },
  { id: "Saved", label: "Saved" },
];

const SORT_OPTIONS: { id: JapaneseSortOption; label: string }[] = [
  { id: "newest", label: "Newest First" },
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Highest Rated" },
  { id: "longest", label: "Longest Duration" },
  { id: "oldest", label: "Oldest First" },
];

const ITEMS_PER_PAGE = 24;

export default function JapaneseFeed() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  const queryParams = new URLSearchParams(searchString);
  const initialCategory = queryParams.get("category") || "All";
  const initialTag = queryParams.get("tag") || "All";
  const initialPage = parseInt(queryParams.get("page") || "1", 10);
  const initialSort = (queryParams.get("sort") as JapaneseSortOption) || "newest";
  const initialSearch = queryParams.get("q") || "";

  const [activeTab, setActiveTab] = useState<string>(initialCategory !== "All" ? initialCategory : initialTag);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [activeSort, setActiveSort] = useState<JapaneseSortOption>(initialSort);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearch);
  const [sortOpen, setSortOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("chuglii_saved_japanese");
      if (raw) setSavedIds(JSON.parse(raw));
    } catch {}
  }, []);

  // Sync state if URL query params change externally (browser back/forward)
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const cat = params.get("category") || "All";
    const tag = params.get("tag") || "All";
    const p = parseInt(params.get("page") || "1", 10);
    const s = (params.get("sort") as JapaneseSortOption) || "newest";
    const q = params.get("q") || "";
    setActiveTab(cat !== "All" ? cat : tag);
    setCurrentPage(p);
    setActiveSort(s);
    setSearchQuery(q);
    setDebouncedSearch(q);
  }, [searchString]);

  const updateUrl = useCallback(
    (opts: { tab?: string; page?: number; sort?: JapaneseSortOption; q?: string }) => {
      const p = new URLSearchParams();
      const tab = opts.tab !== undefined ? opts.tab : activeTab;
      const page = opts.page !== undefined ? opts.page : currentPage;
      const sort = opts.sort !== undefined ? opts.sort : activeSort;
      const q = opts.q !== undefined ? opts.q : debouncedSearch;

      if (tab && tab !== "All") p.set("category", tab);
      if (page > 1) p.set("page", String(page));
      if (sort !== "newest") p.set("sort", sort);
      if (q && q.trim()) p.set("q", q.trim());

      const qs = p.toString();
      setLocation(qs ? `/japanese?${qs}` : "/japanese", { replace: true });
    },
    [activeTab, currentPage, activeSort, debouncedSearch, setLocation]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      if (searchQuery !== debouncedSearch) {
        setCurrentPage(1);
        updateUrl({ q: searchQuery, page: 1 });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, debouncedSearch, updateUrl]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setCurrentPage(1);
    updateUrl({ tab: tabId, page: 1 });
  };

  const handleSortChange = (sortId: JapaneseSortOption) => {
    setActiveSort(sortId);
    setSortOpen(false);
    setCurrentPage(1);
    updateUrl({ sort: sortId, page: 1 });
  };

  const handleToggleSave = (id: string) => {
    let next: string[];
    if (savedIds.includes(id)) {
      next = savedIds.filter((x) => x !== id);
    } else {
      next = [id, ...savedIds];
    }
    setSavedIds(next);
    localStorage.setItem("chuglii_saved_japanese", JSON.stringify(next));
  };

  const isSavedTab = activeTab === "Saved";

  const { data, isLoading, isError, refetch } = useJapaneseVideos({
    category: !isSavedTab && activeTab !== "All" ? activeTab : undefined,
    search: debouncedSearch || undefined,
    sort: activeSort,
    limit: ITEMS_PER_PAGE,
    page: currentPage,
  });

  const rawVideos = data?.items || [];
  const filteredVideos = isSavedTab
    ? rawVideos.filter((v) => savedIds.includes(v.id))
    : rawVideos;
  const displayVideos = Array.from(new Map(filteredVideos.map((v) => [v.id, v])).values());

  const totalCount = isSavedTab ? savedIds.length : (data?.total || 0);
  const totalPages = isSavedTab
    ? Math.max(1, Math.ceil(savedIds.length / ITEMS_PER_PAGE))
    : (data?.totalPages || 1);

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
          {/* Header Banner */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8 pb-6 border-b border-border/40">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 mb-3">
                <GlobeHemisphereWest size={14} weight="bold" />
                <span>Isolated Catalog &bull; Japanese JAV</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground flex items-center gap-3">
                <span>Japanese Adult Vault</span>
                <span className="text-sm font-normal text-muted-foreground px-2.5 py-0.5 rounded-full bg-secondary border border-border/40">
                  {totalCount.toLocaleString()} {totalCount === 1 ? "video" : "videos"}
                </span>
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground mt-2 max-w-2xl">
                High-definition uncensored Japanese videos, amateur recordings, FC2-PPV releases, and decensored archives.
              </p>
            </div>

            {/* Search Input Bar & Quick Chips */}
            <div className="w-full md:w-96">
              <div className="relative">
                <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search code (FC2, ROYD, MISM), actor, tag..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-secondary/80 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all shadow-inner"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setDebouncedSearch("");
                      setCurrentPage(1);
                      updateUrl({ q: "", page: 1 });
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Active Search Count & Quick Filter Chips */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5 text-xs">
                {debouncedSearch ? (
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 font-medium text-[11px]">
                    <span>Showing {totalCount.toLocaleString()} releases for &ldquo;{debouncedSearch}&rdquo;</span>
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setDebouncedSearch("");
                        setCurrentPage(1);
                        updateUrl({ q: "", page: 1 });
                      }}
                      className="hover:text-white underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground/80">
                    <span className="text-[11px] font-medium mr-0.5 text-muted-foreground/60">Popular:</span>
                    {["FC2-PPV", "Uncensored", "Amateur", "Squirting", "Slim", "Decensored"].map((kw) => (
                      <button
                        key={kw}
                        onClick={() => {
                          setSearchQuery(kw);
                          setDebouncedSearch(kw);
                          setCurrentPage(1);
                          updateUrl({ q: kw, page: 1 });
                        }}
                        className="px-2 py-0.5 rounded-md bg-secondary/60 hover:bg-secondary hover:text-foreground text-[11px] transition-colors cursor-pointer border border-border/30"
                      >
                        {kw}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Subcategory Filter Tabs & Sorting */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 sm:pb-0 scrollbar-none">
              {JAV_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-medium whitespace-nowrap transition-all cursor-pointer ${
                      isActive
                        ? "bg-rose-500 text-white font-semibold shadow-md shadow-rose-500/20"
                        : "bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/30"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Sort Dropdown */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setSortOpen(!sortOpen)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-secondary/80 hover:bg-secondary text-foreground border border-border/40 transition-colors cursor-pointer"
              >
                <Funnel size={14} className="text-rose-400" />
                <span>Sort: {SORT_OPTIONS.find((s) => s.id === activeSort)?.label}</span>
                <CaretDown size={12} className={`transition-transform duration-200 ${sortOpen ? "rotate-180" : ""}`} />
              </button>

              {sortOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} />
                  <div className="absolute right-0 mt-2 w-48 rounded-xl bg-card border border-border/60 shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => handleSortChange(opt.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                          activeSort === opt.id
                            ? "bg-rose-500/15 text-rose-400 font-semibold"
                            : "text-foreground hover:bg-secondary"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Videos Grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-2xl bg-card/40 border border-border/20 overflow-hidden animate-pulse">
                  <div className="aspect-[16/10] bg-muted/60" />
                  <div className="p-3.5 space-y-2">
                    <div className="h-4 bg-muted/60 rounded w-3/4" />
                    <div className="h-3 bg-muted/40 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="text-center py-16 bg-card/30 rounded-2xl border border-border/40 p-8">
              <FilmStrip size={48} className="mx-auto text-rose-500 mb-3" />
              <h3 className="text-lg font-semibold text-foreground mb-1">Failed to load Japanese catalog</h3>
              <p className="text-sm text-muted-foreground mb-4">An error occurred while connecting to the database.</p>
              <button
                onClick={() => refetch()}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500 text-white inline-flex items-center gap-1.5 hover:bg-rose-600 transition-colors cursor-pointer"
              >
                <ArrowClockwise size={14} /> Retry
              </button>
            </div>
          ) : displayVideos.length === 0 ? (
            <div className="text-center py-20 bg-card/30 rounded-2xl border border-border/40 p-8">
              <FilmStrip size={48} className="mx-auto text-muted-foreground/60 mb-3" />
              <h3 className="text-lg font-semibold text-foreground mb-1">No videos found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {isSavedTab
                  ? "You haven't saved any Japanese videos to your favorites yet."
                  : "No videos matched your filter or search criteria."}
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-secondary hover:bg-secondary/80 text-foreground transition-colors cursor-pointer"
                >
                  Clear search query
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {displayVideos.map((video) => (
                <JapaneseCard
                  key={video.id}
                  video={video}
                  isSaved={savedIds.includes(video.id)}
                  onToggleSave={handleToggleSave}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-12 flex justify-center">
              <AppPagination
                itemsCount={totalCount}
                itemsPerPage={ITEMS_PER_PAGE}
                currentPage={currentPage}
                onPageChange={(p) => {
                  setCurrentPage(p);
                  updateUrl({ page: p });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
