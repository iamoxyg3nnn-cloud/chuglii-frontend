import { useState, useEffect, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useOnlyfansVideos, type OnlyfansVideo, type OnlyfansSortOption } from "@/hooks/useOnlyfansVideos";
import { OnlyfansCard, OnlyfansCardSkeleton } from "@/components/OnlyfansCard";
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
  Broadcast
} from "@phosphor-icons/react";

const OF_TABS = [
  { id: "All", label: "All OnlyFans" },
  { id: "1080p", label: "1080p Full HD" },
  { id: "4k", label: "4K UHD" },
  { id: "bryce-adams", label: "Bryce Adams" },
  { id: "sophieraiin", label: "Sophie Raiin" },
  { id: "christina-khalil", label: "Christina Khalil" },
  { id: "hannah-jo", label: "Hannah Jo" },
  { id: "aline-faria", label: "Aline Faria" },
  { id: "Saved", label: "Saved" },
];

const SORT_OPTIONS: { id: OnlyfansSortOption; label: string }[] = [
  { id: "newest", label: "Newest First" },
  { id: "quality", label: "Highest Quality (4K / 1080p)" },
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Highest Rated" },
  { id: "oldest", label: "Oldest First" },
];

const ITEMS_PER_PAGE = 24;

export default function OnlyfansFeed() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  const queryParams = new URLSearchParams(searchString);
  const initialCategory = queryParams.get("category") || "All";
  const initialTag = queryParams.get("tag") || "All";
  const initialPage = parseInt(queryParams.get("page") || "1", 10);
  const initialSort = (queryParams.get("sort") as OnlyfansSortOption) || "newest";
  const initialSearch = queryParams.get("q") || "";

  const [activeTab, setActiveTab] = useState<string>(initialCategory !== "All" ? initialCategory : initialTag);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [activeSort, setActiveSort] = useState<OnlyfansSortOption>(initialSort);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearch);
  const [sortOpen, setSortOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  // Load saved videos from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("onlyfans_saved_videos");
      if (stored) {
        setSavedIds(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  const handleToggleSave = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem("onlyfans_saved_videos", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Sync state to URL params
  const updateUrl = useCallback(
    (tab: string, page: number, sort: OnlyfansSortOption, search: string) => {
      const params = new URLSearchParams();
      if (tab !== "All") params.set("tag", tab);
      if (page > 1) params.set("page", page.toString());
      if (sort !== "newest") params.set("sort", sort);
      if (search) params.set("q", search);
      const queryString = params.toString();
      setLocation(`/onlyfans${queryString ? `?${queryString}` : ""}`, { replace: true });
    },
    [setLocation]
  );

  // Debounce search input
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

  // Hook query
  const isSavedView = activeTab === "Saved";
  const { data, isLoading, isError, refetch } = useOnlyfansVideos({
    tag: !isSavedView && activeTab !== "All" ? activeTab : undefined,
    search: debouncedSearch || undefined,
    sort: activeSort,
    limit: ITEMS_PER_PAGE,
    page: currentPage,
  });

  const videos = data?.items || [];
  const totalCount = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  // Filter saved if in Saved view
  const displayVideos = isSavedView
    ? videos.filter((v) => savedIds.includes(v.id))
    : videos;

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setCurrentPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        {/* Hero Header */}
        <div className="relative border-b border-border/40 bg-gradient-to-b from-cyan-950/20 via-background to-background py-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center gap-1.5">
                    <Broadcast size={13} weight="fill" className="animate-pulse text-cyan-400" />
                    <span>Cross-Site Verified Catalog</span>
                  </span>
                  <span className="text-xs text-muted-foreground/70">
                    Highest Quality Default • Zero Duplicates
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
                  <span>OnlyFans Leaks & Archives</span>
                </h1>
                <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                  Aggregated and deduplicated across Internet Chicks, Influencers Gone Wild, SheeshFans, and PimpBunny with automatic 1080p / 4K promotion.
                </p>
              </div>

              {/* Total Badge */}
              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 rounded-xl bg-card border border-border/50 text-right">
                  <div className="text-xs text-muted-foreground">Indexed Videos</div>
                  <div className="text-lg font-bold text-cyan-400">
                    {totalCount > 0 ? totalCount.toLocaleString() : "..."}
                  </div>
                </div>
              </div>
            </div>

            {/* Search and Filters Bar */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <div className="relative flex-1">
                <MagnifyingGlass
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search model, creator, or leak title..."
                  className="w-full pl-10 pr-9 py-2 rounded-xl bg-card/60 border border-border/50 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Sort Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setSortOpen(!sortOpen)}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-card/60 border border-border/50 text-sm font-medium flex items-center justify-between gap-2 hover:border-border transition-colors"
                >
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Funnel size={14} />
                    <span>Sort:</span>
                    <span className="text-foreground font-semibold">
                      {SORT_OPTIONS.find((s) => s.id === activeSort)?.label}
                    </span>
                  </span>
                  <CaretDown size={12} className={`transition-transform ${sortOpen ? "rotate-180" : ""}`} />
                </button>

                {sortOpen && (
                  <div className="absolute right-0 mt-1 w-56 rounded-xl bg-popover border border-border/60 shadow-xl py-1 z-30 animate-in fade-in zoom-in-95">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => {
                          setActiveSort(opt.id);
                          setSortOpen(false);
                          setCurrentPage(1);
                        }}
                        className={`w-full text-left px-3.5 py-2 text-xs font-medium flex items-center justify-between hover:bg-muted transition-colors ${
                          activeSort === opt.id ? "text-cyan-400 font-bold bg-cyan-500/10" : "text-foreground"
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

            {/* Quick Model / Category Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 pb-1">
              {OF_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                      isActive
                        ? "bg-cyan-500 text-white font-semibold shadow-sm shadow-cyan-500/20"
                        : "bg-card/60 text-muted-foreground hover:text-foreground hover:bg-card border border-border/40"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Video Grid */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {Array.from({ length: 12 }).map((_, idx) => (
                <OnlyfansCardSkeleton key={idx} />
              ))}
            </div>
          ) : isError ? (
            <div className="text-center py-20 space-y-4">
              <FilmStrip size={48} className="mx-auto text-muted-foreground/40" />
              <div className="text-base font-semibold text-foreground">Failed to load OnlyFans videos</div>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Unable to query Supabase RPC endpoint. Please verify your connection or refresh the page.
              </p>
              <button
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 text-white text-xs font-semibold hover:bg-cyan-600 transition-colors"
              >
                <ArrowClockwise size={14} />
                <span>Retry</span>
              </button>
            </div>
          ) : displayVideos.length === 0 ? (
            <div className="text-center py-20 space-y-3">
              <FilmStrip size={44} className="mx-auto text-muted-foreground/30" />
              <div className="text-sm font-semibold text-foreground">No videos found</div>
              <p className="text-xs text-muted-foreground">
                Try searching for another model or switching back to "All OnlyFans".
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                {displayVideos.map((video) => (
                  <OnlyfansCard
                    key={video.id}
                    video={video}
                    isSaved={savedIds.includes(video.id)}
                    onToggleSave={handleToggleSave}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pt-6 border-t border-border/40 flex justify-center">
                  <AppPagination
                    itemsCount={totalCount}
                    itemsPerPage={ITEMS_PER_PAGE}
                    currentPage={currentPage}
                    onPageChange={handlePageChange}
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
