import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Layout } from "@/components/Layout";
import { useScrapedVideos, type ScrapedVideo, type ScrapedSortOption } from "@/hooks/useScrapedVideos";
import { AppPagination } from "@/components/ui/app-pagination";
import {
  Flame,
  Play,
  Eye,
  ThumbsUp,
  Clock,
  Sparkle,
  MagnifyingGlass,
  X,
  CaretDown,
  Funnel,
  FilmStrip,
  ArrowClockwise,
  BookmarkSimple,
  User
} from "@phosphor-icons/react";

const TAG_TABS = [
  { id: "All", label: "All Viral MMS" },
  { id: "desi", label: "Desi MMS" },
  { id: "bhabhi", label: "Bhabhi" },
  { id: "indian", label: "Indian" },
  { id: "viral", label: "Viral Clips" },
  { id: "pakistani", label: "Pakistani" },
  { id: "web-series", label: "Web Series" },
  { id: "amateur", label: "Amateur" },
  { id: "teen", label: "Teen" },
  { id: "village", label: "Village" },
  { id: "jav", label: "JAV" },
  { id: "Saved", label: "Saved" },
];

const SORT_OPTIONS: { id: ScrapedSortOption; label: string }[] = [
  { id: "newest", label: "Newest First" },
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Highest Rated" },
  { id: "longest", label: "Longest Duration" },
  { id: "oldest", label: "Oldest First" },
];

const ITEMS_PER_PAGE = 24;

export default function LeakFeed() {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();

  // Parse query params from URL
  const queryParams = new URLSearchParams(searchString);
  const initialCategory = queryParams.get("category") || "indian";
  const initialTag = queryParams.get("tag") || "All";
  const initialPage = parseInt(queryParams.get("page") || "1", 10);
  const initialSort = (queryParams.get("sort") as ScrapedSortOption) || "newest";
  const initialSearch = queryParams.get("q") || "";

  const [activeCategory, setActiveCategory] = useState<string>(initialCategory);
  const [activeTag, setActiveTag] = useState<string>(initialTag);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [activeSort, setActiveSort] = useState<ScrapedSortOption>(initialSort);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearch);
  const [sortOpen, setSortOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  // Load saved bookmarks from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("chuglii_saved_leaks");
      if (raw) setSavedIds(JSON.parse(raw));
    } catch {}
  }, []);

  // Sync state if URL query params change externally
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const cat = params.get("category") || "indian";
    const tag = params.get("tag") || "All";
    const p = parseInt(params.get("page") || "1", 10);
    const s = (params.get("sort") as ScrapedSortOption) || "newest";
    const q = params.get("q") || "";
    setActiveCategory(cat);
    setActiveTag(tag);
    setCurrentPage(p);
    setActiveSort(s);
    setSearchQuery(q);
    setDebouncedSearch(q);
  }, [searchString]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      if (searchQuery !== initialSearch) {
        setCurrentPage(1);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, initialSearch]);

  // Sync Document Title for SEO
  useEffect(() => {
    const prev = document.title;
    if (debouncedSearch) {
      document.title = `"${debouncedSearch}" - Viral MMS Leaks - Chuglii`;
    } else if (activeTag && activeTag !== "All") {
      document.title = `${activeTag.toUpperCase()} Leaks & Viral Clips - Chuglii`;
    } else {
      document.title = "Viral MMS Leaks & Private Video Feed - Chuglii";
    }
    return () => {
      document.title = prev;
    };
  }, [debouncedSearch, activeTag]);

  // Update URL query params
  const updateQueryParams = useCallback((cat: string, tag: string, page: number, sort: ScrapedSortOption, q: string) => {
    const params = new URLSearchParams();
    if (cat && cat !== "all") params.set("category", cat);
    if (tag && tag !== "All") params.set("tag", tag);
    if (page > 1) params.set("page", page.toString());
    if (sort && sort !== "newest") params.set("sort", sort);
    if (q && q.trim().length > 0) params.set("q", q.trim());
    const str = params.toString();
    setLocation(str ? `/leak?${str}` : "/leak");
  }, [setLocation]);

  const handleTagClick = (tag: string) => {
    setActiveTag(tag);
    setCurrentPage(1);
    updateQueryParams(activeCategory, tag, 1, activeSort, debouncedSearch);
  };

  const handleSortChange = (sort: ScrapedSortOption) => {
    setActiveSort(sort);
    setSortOpen(false);
    setCurrentPage(1);
    updateQueryParams(activeCategory, activeTag, 1, sort, debouncedSearch);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setDebouncedSearch("");
    setCurrentPage(1);
    updateQueryParams(activeCategory, activeTag, 1, activeSort, "");
  };

  // Query Hook - filtered by the parent scraper category & internal tag
  const queryTag = activeTag === "Saved" || activeTag === "All" ? undefined : activeTag;

  const { data, isLoading, isFetching, refetch } = useScrapedVideos({
    category: activeCategory,
    tag: queryTag,
    search: debouncedSearch || undefined,
    sort: activeSort,
    page: currentPage,
    limit: ITEMS_PER_PAGE,
  });

  const rawVideos = data?.items || [];
  const totalCount = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  // Client-side filter for Saved tab
  const videos = Array.isArray(rawVideos)
    ? (activeTag === "Saved" ? rawVideos.filter((v) => savedIds.includes(v.id)) : rawVideos)
    : [];

  // Active hover preview state
  const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = (id: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredVideoId(id);
    }, 200);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredVideoId(null);
  };

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        {/* Hero Section */}
        <section className="relative border-b border-border/50 bg-linear-to-b from-rose-950/20 via-background to-background py-8 sm:py-12">
          <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20 text-xs font-semibold uppercase tracking-wider mb-3">
                  <Flame size={14} weight="fill" className="animate-pulse" />
                  Category: Viral MMS &bull; MMSVibeX Archive
                </div>
                <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                  Viral MMS Leaks & Video Feed
                </h1>
                <p className="mt-2 text-sm sm:text-base text-muted-foreground max-w-2xl leading-relaxed">
                  Stream thousands of viral clips, uncut web-series, and exclusive leaked private tapes in high quality with instant previews.
                </p>
              </div>

              {/* Stats badges */}
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 text-xs shrink-0">
                <div className="px-3.5 py-2 rounded-xl bg-card border border-border/60 shadow-xs flex items-center gap-2">
                  <FilmStrip size={16} className="text-rose-500" />
                  <span className="font-semibold text-foreground">
                    {totalCount ? totalCount.toLocaleString() : "9,300+"}
                  </span>
                  <span className="text-muted-foreground">Videos</span>
                </div>
                <div className="px-3.5 py-2 rounded-xl bg-card border border-border/60 shadow-xs flex items-center gap-2">
                  <Sparkle size={16} className="text-amber-400" />
                  <span className="font-semibold text-foreground">
                    {totalCount ? Math.round(totalCount * 0.95).toLocaleString() : "8,800+"}
                  </span>
                  <span className="text-muted-foreground">HD Streams</span>
                </div>
                <button
                  onClick={() => refetch()}
                  title="Refresh leaks"
                  className={`p-2 rounded-xl bg-card border border-border/60 hover:bg-secondary text-muted-foreground hover:text-foreground transition-all cursor-pointer ${
                    isFetching ? "animate-spin text-rose-500" : ""
                  }`}
                >
                  <ArrowClockwise size={16} />
                </button>
              </div>
            </div>

            {/* Search Input & Quick Suggestions */}
            <div className="mt-6 sm:mt-8 max-w-2xl">
              <div className="relative">
                <MagnifyingGlass
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/80 pointer-events-none"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search leak titles, model names, tags..."
                  className="w-full h-10 pl-9 pr-9 rounded-xl bg-card border border-border/60 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500/50 transition-all shadow-inner"
                />
                {searchQuery && (
                  <button
                    onClick={handleClearSearch}
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Active Search Count & Quick Filter Chips */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5 text-xs">
                {debouncedSearch ? (
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 font-medium">
                    <span>Showing {totalCount.toLocaleString()} clips for &ldquo;{debouncedSearch}&rdquo;</span>
                    <button onClick={handleClearSearch} className="hover:text-white underline cursor-pointer text-[11px]">
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground/80">
                    <span className="text-[11px] font-medium mr-0.5 text-muted-foreground/60">Popular:</span>
                    {["Bhabhi", "Desi MMS", "Pakistani", "Indian", "Amateur", "Village", "Web Series"].map((kw) => (
                      <button
                        key={kw}
                        onClick={() => {
                          setSearchQuery(kw);
                          setDebouncedSearch(kw);
                          setCurrentPage(1);
                          updateQueryParams(activeCategory, activeTag, 1, activeSort, kw);
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

            {/* Category Filter Pills & Sort Dropdown bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-6 pt-5 border-t border-border/40">
              {/* Category / Tag pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 max-w-full">
                {TAG_TABS.map((tab) => {
                  const isActive = activeTag.toLowerCase() === tab.id.toLowerCase();
                  const isSavedTab = tab.id === "Saved";
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleTagClick(tab.id)}
                      type="button"
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 cursor-pointer capitalize whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                        isActive
                          ? "bg-rose-500 text-white shadow-sm shadow-rose-500/25 ring-1 ring-rose-400/50"
                          : "bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/40"
                      }`}
                    >
                      {tab.id === "All" && <Sparkle size={12} weight="fill" />}
                      {isSavedTab && <BookmarkSimple size={13} weight={isActive ? "fill" : "bold"} className={isActive ? "text-white" : "text-rose-400"} />}
                      <span>{tab.label}</span>
                      {isSavedTab && savedIds.length > 0 && (
                        <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                          isActive ? "bg-white/20 text-white" : "bg-rose-500/15 text-rose-400"
                        }`}>
                          {savedIds.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Sort Selector Dropdown */}
              <div className="relative shrink-0 self-end sm:self-auto">
                <button
                  onClick={() => setSortOpen(!sortOpen)}
                  type="button"
                  className="h-9 px-3.5 rounded-xl bg-card border border-border/60 hover:bg-secondary text-xs font-medium inline-flex items-center gap-2 text-foreground transition-colors cursor-pointer shadow-sm"
                >
                  <Funnel size={13} className="text-muted-foreground" />
                  <span>{SORT_OPTIONS.find((s) => s.id === activeSort)?.label}</span>
                  <CaretDown size={12} className={`transition-transform ${sortOpen ? "rotate-180" : ""}`} />
                </button>

                {sortOpen && (
                  <div className="absolute right-0 mt-1.5 w-44 rounded-xl bg-card border border-border/80 shadow-2xl z-30 py-1.5 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => handleSortChange(opt.id)}
                        type="button"
                        className={`w-full text-left px-3.5 py-2 text-xs font-medium transition-colors cursor-pointer ${
                          activeSort === opt.id
                            ? "bg-rose-500/15 text-rose-400 font-semibold"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Video Grid Section matching Browse grid */}
        <section className="px-4 sm:px-6 lg:px-8 py-8">
          <div className="container mx-auto max-w-7xl">
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-video bg-muted/40 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : videos.length === 0 ? (
              <div className="text-center py-24 bg-card/20 rounded-2xl border border-border/40 max-w-xl mx-auto px-4">
                <FilmStrip size={48} className="mx-auto text-muted-foreground/40 mb-3" />
                <h3 className="text-lg font-bold text-foreground mb-1">
                  {activeTag === "Saved" ? "No saved leaks yet" : "No videos found"}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {activeTag === "Saved"
                    ? "Click the bookmark icon on any leak video to save it here for quick access."
                    : "Try adjusting your search terms or selecting a different category."}
                </p>
                {(activeTag !== "All" || debouncedSearch) && (
                  <button
                    onClick={() => {
                      setActiveTag("All");
                      handleClearSearch();
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-medium bg-rose-500 text-white hover:bg-rose-600 transition-colors cursor-pointer"
                  >
                    View All Leaks
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 sm:gap-6">
                {videos.map((item) => {
                  const isHovered = hoveredVideoId === item.id;
                  const isSaved = savedIds.includes(item.id);

                  return (
                    <div
                      key={item.id}
                      className="group flex flex-col bg-card/40 border border-border/40 hover:border-rose-500/50 hover:shadow-xl rounded-2xl overflow-hidden transition-all duration-200"
                      onMouseEnter={() => handleMouseEnter(item.id)}
                      onMouseLeave={handleMouseLeave}
                    >
                      {/* Media container */}
                      <Link href={`/leak/video/${item.id}`}>
                        <div className="relative aspect-video w-full bg-muted/60 overflow-hidden cursor-pointer">
                          {isHovered && item.trailer_preview_url ? (
                            <video
                              src={item.trailer_preview_url}
                              autoPlay
                              muted
                              loop
                              playsInline
                              className="w-full h-full object-cover transition-opacity duration-200"
                            />
                          ) : (
                            <img
                              src={item.clean_thumbnail_url || item.thumbnail_url || undefined}
                              alt={item.title}
                              loading="lazy"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          )}

                          {/* Duration Badge */}
                          {item.duration_formatted && (
                            <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/80 backdrop-blur-xs text-[11px] font-semibold text-white tracking-wide">
                              {item.duration_formatted}
                            </div>
                          )}

                          {/* MP4 Stream Available indicator */}
                          {item.full_video_url && (
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-rose-500/90 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm">
                              HD Stream
                            </div>
                          )}

                          {/* Hover Play Icon overlay */}
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-10 h-10 rounded-full bg-rose-500/90 text-white flex items-center justify-center shadow-lg transform scale-75 group-hover:scale-100 transition-transform">
                              <Play size={18} weight="fill" className="ml-0.5" />
                            </div>
                          </div>

                          {/* Saved icon badge */}
                          {isSaved && (
                            <div className="absolute top-2 right-2 p-1 rounded-md bg-rose-500 text-white shadow-sm">
                              <BookmarkSimple size={12} weight="fill" />
                            </div>
                          )}
                        </div>
                      </Link>

                      {/* Content Card Body */}
                      <div className="p-3.5 flex flex-col flex-1 justify-between gap-2">
                        <div>
                          <Link href={`/leak/video/${item.id}`}>
                            <h3 className="font-semibold text-sm line-clamp-2 text-foreground group-hover:text-rose-400 transition-colors cursor-pointer leading-snug">
                              {item.title}
                            </h3>
                          </Link>

                          {/* Performer / Actor badge */}
                          {item.actors && item.actors.length > 0 && (
                            <div className="flex items-center gap-1 mt-1.5 text-[11px] text-rose-400 font-medium">
                              <User size={12} className="shrink-0" />
                              <span className="line-clamp-1 capitalize">{item.actors[0].replace(/-/g, " ")}</span>
                            </div>
                          )}

                          {/* Tags snippet */}
                          {item.tags && item.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {item.tags.slice(0, 3).map((t) => (
                                <button
                                  key={t}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    handleTagClick(t);
                                  }}
                                  className="text-[10px] text-muted-foreground hover:text-rose-400 px-1.5 py-0.5 rounded bg-secondary/80 transition-colors"
                                >
                                  #{t}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Card Footer: views & rating */}
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border/30">
                          <span className="flex items-center gap-1 font-medium">
                            <Eye size={12} /> {item.views_raw || "0 views"}
                          </span>
                          {item.rating_raw && (
                            <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                              <ThumbsUp size={11} weight="fill" /> {item.rating_raw}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination Controls */}
            {totalCount > ITEMS_PER_PAGE && (
              <div className="mt-10 flex justify-center">
                <AppPagination
                  itemsCount={totalCount}
                  itemsPerPage={ITEMS_PER_PAGE}
                  currentPage={currentPage}
                  onPageChange={(page) => {
                    setCurrentPage(page);
                    updateQueryParams(activeTag, page, activeSort, debouncedSearch);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}
