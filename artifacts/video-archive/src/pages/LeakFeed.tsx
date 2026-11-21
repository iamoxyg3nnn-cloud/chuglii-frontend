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
  ArrowClockwise
} from "@phosphor-icons/react";

const FILTER_TAGS = [
  "All",
  "desi",
  "bhabhi",
  "amateur",
  "teen",
  "web-series",
  "milf",
  "mature",
  "village",
  "mallu",
  "tamil"
];

const SORT_OPTIONS: { id: ScrapedSortOption; label: string }[] = [
  { id: "newest", label: "Newest First" },
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Highest Rated" },
  { id: "longest", label: "Longest Duration" },
];

const ITEMS_PER_PAGE = 24;

export default function LeakFeed() {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();

  // Parse query params from URL
  const queryParams = new URLSearchParams(searchString);
  const initialTag = queryParams.get("tag") || "All";
  const initialPage = parseInt(queryParams.get("page") || "1", 10);
  const initialSort = (queryParams.get("sort") as ScrapedSortOption) || "newest";
  const initialSearch = queryParams.get("q") || "";

  const [activeTag, setActiveTag] = useState<string>(initialTag);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [activeSort, setActiveSort] = useState<ScrapedSortOption>(initialSort);
  const [searchQuery, setSearchQuery] = useState<string>(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initialSearch);
  const [sortOpen, setSortOpen] = useState(false);

  // Sync state if URL query params change externally
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const tag = params.get("tag") || "All";
    const p = parseInt(params.get("page") || "1", 10);
    const s = (params.get("sort") as ScrapedSortOption) || "newest";
    const q = params.get("q") || "";
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

  // Update URL query params
  const updateQueryParams = useCallback((tag: string, page: number, sort: ScrapedSortOption, q: string) => {
    const params = new URLSearchParams();
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
    updateQueryParams(tag, 1, activeSort, debouncedSearch);
  };

  const handleSortChange = (sort: ScrapedSortOption) => {
    setActiveSort(sort);
    setSortOpen(false);
    setCurrentPage(1);
    updateQueryParams(activeTag, 1, sort, debouncedSearch);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    updateQueryParams(activeTag, page, activeSort, debouncedSearch);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setDebouncedSearch("");
    setCurrentPage(1);
    updateQueryParams(activeTag, 1, activeSort, "");
  };

  // Query Supabase directly
  const { data, isLoading, isFetching } = useScrapedVideos({
    tag: activeTag === "All" ? undefined : activeTag,
    search: debouncedSearch,
    sort: activeSort,
    limit: ITEMS_PER_PAGE,
    page: currentPage,
  });

  const videos = data?.items || [];
  const totalCount = data?.total || 0;

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-24">
        {/* Header / Banner matching Browse hero */}
        <section className="relative border-b border-border/50 px-4 sm:px-6 py-8 overflow-hidden bg-card/20 backdrop-blur-sm">
          <div className="container mx-auto max-w-7xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 shadow-sm shadow-rose-500/10">
                    <Flame size={24} weight="fill" className="animate-pulse" />
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                        Leaks Catalog
                      </h1>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">
                        {totalCount.toLocaleString()} Videos
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground max-w-xl">
                  Dedicated scraped archive. Full direct CDN streams, hover trailers, and categorized Indian leaks.
                </p>
              </div>

              {/* Search Bar matching the real frontend Search component */}
              <div className="relative w-full md:w-80">
                <MagnifyingGlass
                  size={16}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search scraped leak titles..."
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
            </div>

            {/* Filter Pills & Sort Dropdown bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-6 pt-5 border-t border-border/40">
              {/* Category / Tag pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 max-w-full">
                {FILTER_TAGS.map((tag) => {
                  const isActive = activeTag.toLowerCase() === tag.toLowerCase();
                  return (
                    <button
                      key={tag}
                      onClick={() => handleTagClick(tag)}
                      type="button"
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 cursor-pointer capitalize whitespace-nowrap shrink-0 ${
                        isActive
                          ? "bg-rose-500 text-white shadow-sm shadow-rose-500/25 ring-1 ring-rose-400/50"
                          : "bg-secondary/70 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/40"
                      }`}
                    >
                      {tag === "All" && <Sparkle size={12} weight="fill" className="inline mr-1 -mt-0.5" />}
                      {tag}
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
                <h3 className="text-lg font-bold text-foreground mb-1">No videos found</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {debouncedSearch
                    ? `No scraped videos matched "${debouncedSearch}".`
                    : `No items found under tag "${activeTag}".`}
                </p>
                <button
                  onClick={() => {
                    setActiveTag("All");
                    handleClearSearch();
                  }}
                  type="button"
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 transition-colors cursor-pointer"
                >
                  Clear Filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {videos.map((video) => (
                  <LeakCard key={video.id} video={video} />
                ))}
              </div>
            )}

            {/* Standard App Pagination component */}
            <div className="mt-12 flex justify-center">
              <AppPagination
                itemsCount={totalCount}
                itemsPerPage={ITEMS_PER_PAGE}
                currentPage={currentPage}
                onPageChange={handlePageChange}
              />
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}

function LeakCard({ video }: { video: ScrapedVideo }) {
  const [isHovered, setIsHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (isHovered && videoRef.current && video.trailer_preview_url) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    } else if (!isHovered && videoRef.current) {
      videoRef.current.pause();
    }
  }, [isHovered, video.trailer_preview_url]);

  return (
    <Link href={`/leak/video/${video.id}`}>
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="group rounded-2xl overflow-hidden bg-card border border-border/50 hover:border-rose-500/60 hover:shadow-2xl hover:shadow-rose-500/10 transition-all duration-300 cursor-pointer flex flex-col h-full"
      >
        {/* Thumbnail / Hover Video Preview */}
        <div className="relative aspect-video w-full bg-black/60 overflow-hidden">
          {video.trailer_preview_url && isHovered ? (
            <video
              ref={videoRef}
              src={video.trailer_preview_url}
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <img
              src={video.thumbnail_url || ""}
              alt={video.title}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
            />
          )}

          {/* Hover Play Button Overlay */}
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-rose-500/95 text-white flex items-center justify-center shadow-xl shadow-rose-500/50 transform group-hover:scale-110 transition-transform">
              <Play size={20} weight="fill" className="ml-0.5" />
            </div>
          </div>

          {/* Duration Badge */}
          {video.duration_formatted && (
            <div className="absolute bottom-2.5 right-2.5 px-1.5 py-0.5 rounded-md bg-black/85 backdrop-blur-sm text-[11px] font-semibold text-white tracking-wide border border-white/10 shadow-sm">
              {video.duration_formatted}
            </div>
          )}

          {/* Views Badge */}
          {video.views_raw && (
            <div className="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-sm text-[11px] text-white/90 font-medium flex items-center gap-1 border border-white/10 shadow-sm">
              <Eye size={12} /> {video.views_raw}
            </div>
          )}
        </div>

        {/* Card Body matching VideoCard metadata */}
        <div className="p-4 flex-1 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold line-clamp-2 text-foreground group-hover:text-rose-400 transition-colors leading-snug">
              {video.title}
            </h3>

            {/* Tags preview */}
            {video.tags && video.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-2.5">
                {video.tags.slice(0, 2).map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded-md bg-secondary/80 text-[10px] text-muted-foreground font-medium capitalize"
                  >
                    #{t}
                  </span>
                ))}
                {video.tags.length > 2 && (
                  <span className="text-[10px] text-muted-foreground/60">
                    +{video.tags.length - 2}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Card Footer: Source & Upvotes */}
          <div className="mt-4 pt-3 border-t border-border/30 flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider text-[10px] text-rose-400">
              {video.source_site}
            </span>

            {video.rating_score !== null && (
              <span className="flex items-center gap-1 text-emerald-400 font-semibold text-xs">
                <ThumbsUp size={13} weight="fill" /> {video.rating_raw || `${video.rating_score}%`}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
