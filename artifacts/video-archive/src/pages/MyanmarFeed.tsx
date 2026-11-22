import { useState, useEffect, useCallback } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { useMyanmarVideos, type MyanmarVideo, type MyanmarSortOption } from "@/hooks/useMyanmarVideos";
import { MyanmarCard } from "@/components/MyanmarCard";
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
  BookmarkSimple
} from "@phosphor-icons/react";

const MYANMAR_TABS = [
  { id: "All", label: "All Myanmar" },
  { id: "myanmar", label: "Myanmar Local" },
  { id: "mmporns", label: "MM Porns" },
  { id: "mamagyi", label: "VIP Ma Ma Gyi" },
  { id: "drkogyi", label: "VIP Dr Ko Gyi" },
  { id: "samusar", label: "Samusar" },
  { id: "drhmonegyi", label: "Dr.Hmone Gyi" },
  { id: "mmhdhub", label: "MM HD Hub" },
  { id: "kosargyi", label: "Ko Sar Gyi" },
  { id: "Saved", label: "Saved" },
];

const SORT_OPTIONS: { id: MyanmarSortOption; label: string }[] = [
  { id: "newest", label: "Newest First" },
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Highest Rated" },
  { id: "longest", label: "Longest Duration" },
  { id: "oldest", label: "Oldest First" },
];

const ITEMS_PER_PAGE = 24;

export default function MyanmarFeed() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  const queryParams = new URLSearchParams(searchString);
  const initialCategory = queryParams.get("category") || "All";
  const initialTag = queryParams.get("tag") || "All";
  const initialPage = parseInt(queryParams.get("page") || "1", 10);
  const initialSort = (queryParams.get("sort") as MyanmarSortOption) || "newest";
  const initialSearch = queryParams.get("q") || "";

  const [activeCategory, setActiveCategory] = useState<string>(initialCategory);
  const [activeTag, setActiveTag] = useState<string>(initialTag);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [activeSort, setActiveSort] = useState<MyanmarSortOption>(initialSort);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearch);
  const [sortOpen, setSortOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("chuglii_saved_myanmar");
      if (raw) setSavedIds(JSON.parse(raw));
    } catch {}
  }, []);

  const handleToggleSave = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      try {
        localStorage.setItem("chuglii_saved_myanmar", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      if (searchQuery !== debouncedSearch) setCurrentPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, debouncedSearch]);

  const updateURL = useCallback(
    (page: number, cat: string, tag: string, sort: MyanmarSortOption, q: string) => {
      const params = new URLSearchParams();
      if (cat && cat !== "All") params.set("category", cat);
      if (tag && tag !== "All") params.set("tag", tag);
      if (page > 1) params.set("page", page.toString());
      if (sort !== "newest") params.set("sort", sort);
      if (q.trim()) params.set("q", q.trim());
      const newQuery = params.toString();
      setLocation(`/myanmar${newQuery ? `?${newQuery}` : ""}`, { replace: true });
    },
    [setLocation]
  );

  const handleTabClick = (tabId: string) => {
    setActiveCategory(tabId);
    setActiveTag(tabId);
    setCurrentPage(1);
    updateURL(1, tabId, tabId, activeSort, debouncedSearch);
  };

  const handleSortChange = (sortId: MyanmarSortOption) => {
    setActiveSort(sortId);
    setSortOpen(false);
    setCurrentPage(1);
    updateURL(1, activeCategory, activeTag, sortId, debouncedSearch);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    updateURL(newPage, activeCategory, activeTag, activeSort, debouncedSearch);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const isSavedMode = activeTag === "Saved";

  const { data, isLoading, isError, refetch } = useMyanmarVideos({
    tag: isSavedMode ? undefined : activeTag,
    category: isSavedMode ? undefined : (activeCategory === "All" ? undefined : activeCategory),
    search: debouncedSearch,
    sort: activeSort,
    page: currentPage,
    limit: ITEMS_PER_PAGE,
  });

  const videos = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const displayedVideos = isSavedMode
    ? videos.filter((v) => savedIds.includes(v.id))
    : videos;

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          {/* Header Banner */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-rose-950/70 via-rose-900/30 to-background border border-rose-500/20 p-6 sm:p-8 mb-6 shadow-2xl">
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold mb-3">
                  <FilmStrip size={14} weight="fill" className="text-rose-400" />
                  <span>Myanmar Exclusive Archives</span>
                </div>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white flex items-center gap-2">
                  Myanmar Private & Leaks
                </h1>
                <p className="mt-2 text-sm text-rose-200/80 max-w-2xl leading-relaxed">
                  Fast streaming archives of viral Myanmar leaks, local amateur releases, and VIP uncensored content.
                </p>
              </div>

              {/* Total Count Badge */}
              <div className="flex items-center gap-3 self-start md:self-auto bg-black/40 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/10">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-400">
                  <Sparkle size={20} weight="fill" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase font-semibold">Total Archived</div>
                  <div className="text-lg font-bold text-white tabular-nums">
                    {total > 0 ? total.toLocaleString() : "Syncing..."}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Search & Filter Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-6">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Myanmar titles, tags..."
                className="w-full pl-10 pr-9 py-2 rounded-xl bg-card border border-border/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-rose-500 transition-colors"
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
                type="button"
                onClick={() => setSortOpen(!sortOpen)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border/50 text-sm font-medium text-foreground hover:bg-secondary/60 transition-colors w-full sm:w-auto justify-between"
              >
                <div className="flex items-center gap-2">
                  <Funnel size={14} className="text-rose-400" />
                  <span>{SORT_OPTIONS.find((s) => s.id === activeSort)?.label}</span>
                </div>
                <CaretDown size={14} className={`transition-transform duration-150 ${sortOpen ? "rotate-180" : ""}`} />
              </button>

              {sortOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl bg-popover border border-border/60 shadow-xl py-1 z-50">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => handleSortChange(opt.id)}
                      className={`w-full text-left px-4 py-2 text-xs transition-colors flex items-center justify-between ${
                        activeSort === opt.id
                          ? "bg-rose-500/10 text-rose-400 font-semibold"
                          : "text-foreground/80 hover:bg-secondary/60 hover:text-foreground"
                      }`}
                    >
                      <span>{opt.label}</span>
                      {activeSort === opt.id && <Sparkle size={12} weight="fill" className="text-rose-400" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tag Category Horizontal Scroll */}
          <div className="flex items-center gap-2 overflow-x-auto pb-4 scrollbar-none mb-6">
            {MYANMAR_TABS.map((tab) => {
              const active = activeTag === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
                    active
                      ? "bg-rose-500 text-white shadow-md shadow-rose-500/25"
                      : "bg-card/70 border border-border/40 text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  {tab.id === "Saved" && <BookmarkSimple size={13} weight={active ? "fill" : "bold"} />}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Videos Grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="rounded-2xl bg-card/40 border border-border/40 overflow-hidden animate-pulse">
                  <div className="aspect-[16/10] bg-muted/60" />
                  <div className="p-4 space-y-2">
                    <div className="h-4 bg-muted/60 rounded w-3/4" />
                    <div className="h-3 bg-muted/40 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="text-center py-20 bg-card/30 rounded-3xl border border-border/40 p-8">
              <p className="text-sm text-destructive mb-4">Failed to load Myanmar video feed.</p>
              <button
                onClick={() => refetch()}
                className="px-4 py-2 rounded-xl bg-rose-500 text-white text-xs font-semibold hover:bg-rose-600 transition-colors inline-flex items-center gap-2"
              >
                <ArrowClockwise size={14} /> Try Again
              </button>
            </div>
          ) : displayedVideos.length === 0 ? (
            <div className="text-center py-20 bg-card/20 rounded-3xl border border-border/40 p-8">
              <FilmStrip size={40} className="mx-auto text-muted-foreground/60 mb-3" />
              <h3 className="text-base font-semibold text-foreground mb-1">
                {isSavedMode ? "No Saved Myanmar Videos" : "No Videos Found"}
              </h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                {isSavedMode
                  ? "Click the bookmark icon on any Myanmar video to save it to this list."
                  : "Try clearing your search query or selecting another tag tab."}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
                {displayedVideos.map((video) => (
                  <MyanmarCard
                    key={video.id}
                    video={video}
                    isSaved={savedIds.includes(video.id)}
                    onToggleSave={handleToggleSave}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && !isSavedMode && (
                <div className="mt-10 flex justify-center">
                  <AppPagination
                    itemsCount={total}
                    itemsPerPage={ITEMS_PER_PAGE}
                    currentPage={currentPage}
                    onPageChange={handlePageChange}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
