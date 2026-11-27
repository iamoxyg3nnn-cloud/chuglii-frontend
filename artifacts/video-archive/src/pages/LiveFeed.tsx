import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { MonitorPlay, WifiHigh, ArrowClockwise } from "@phosphor-icons/react";
import { resolveStream } from "@/pages/LiveWatch";

interface LiveStreamItem {
  id: string;
  title: string;
  title_en?: string | null;
  thumbnail_url: string;
  page_url: string;
  quality_label?: string | null;
  /** Server-side remux finished — a real live frame can be served. */
  remux_ready?: boolean;
  /** Worker-captured broadcast frame available (rotates per cycle). */
  has_frame?: boolean;
}

async function fetchLiveStreams(): Promise<{ streams: LiveStreamItem[] }> {
  const res = await fetch("/api/live/streams");
  if (!res.ok) throw new Error(`Failed to load live streams (${res.status})`);
  return res.json();
}

function proxiedThumb(url: string): string {
  if (!url) return "";
  // Covers are AES-encrypted upstream; the API fetches + decrypts + downscales.
  return `/api/live/thumb?url=${encodeURIComponent(url)}&w=640`;
}

/**
 * Live thumbnails: for remuxed videos the API grabs a REAL frame at the
 * current broadcast position (same clock formula as the player). The frame
 * rotates every 2 minutes server-side; the `tick` busts the browser cache so
 * the grid keeps updating while the tab is open.
 */
function liveThumbSrc(id: string, tick: number, fallbackUrl?: string): string {
  const fallback = fallbackUrl
    ? `&fallback=${encodeURIComponent(fallbackUrl)}`
    : "";
  return `/api/live/live-thumb/${id}?tick=${tick}${fallback}`;
}

function qualityRank(label?: string | null): number {
  if (!label) return 0;
  const m = label.match(/(\d+)p/i);
  return m ? Number(m[1]) : 0;
}

type QualityFilter = "all" | "hd" | "fhd";
type QualitySort = "site" | "quality";

const QUALITY_FILTERS: Array<{ id: QualityFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "hd", label: "HD+ (720p)" },
  { id: "fhd", label: "1080p only" },
];

function LiveCardSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden bg-card border border-border animate-pulse">
      <div className="aspect-video bg-muted" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 bg-muted rounded w-11/12" />
        <div className="h-3.5 bg-muted rounded w-2/3" />
      </div>
    </div>
  );
}

export function LiveFeed() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["live-streams"],
    queryFn: fetchLiveStreams,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [sortBy, setSortBy] = useState<QualitySort>("site");
  // Bumped every 2 minutes so live thumbnails re-fetch their fresh frame.
  const [thumbTick, setThumbTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setThumbTick((n) => n + 1), 120_000);
    return () => window.clearInterval(t);
  }, []);

  const streams = useMemo(() => {
    let list = data?.streams ?? [];
    if (qualityFilter === "hd") list = list.filter((s) => qualityRank(s.quality_label) >= 720);
    else if (qualityFilter === "fhd") list = list.filter((s) => qualityRank(s.quality_label) >= 1080);
    if (sortBy === "quality") {
      list = [...list].sort((a, b) => qualityRank(b.quality_label) - qualityRank(a.quality_label));
    }
    return list;
  }, [data, qualityFilter, sortBy]);
  // ── Stream prefetch ──────────────────────────────────────────────────────
  // Warm the resolve (token + remux status) for the first cards on load and
  // for any card the user hovers/touches, using the SAME react-query key the
  // watch page reads — so clicking a card renders instantly with the cached
  // token and the player starts buffering immediately.
  const prefetchStream = useCallback(
    (id: string) => {
      void queryClient.prefetchQuery({
        queryKey: ["live-resolve", id],
        queryFn: () => resolveStream(id),
        staleTime: 30_000,
      });
    },
    [queryClient],
  );
  const prefetchedRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<number[]>([]);
  useEffect(() => {
    if (!streams.length) return;
    streams.slice(0, 6).forEach((s, i) => {
      if (prefetchedRef.current.has(s.id)) return;
      prefetchedRef.current.add(s.id);
      const timer = window.setTimeout(() => prefetchStream(s.id), i * 400);
      timersRef.current.push(timer);
    });
  }, [streams, prefetchStream, prefetchedRef, timersRef]);
  useEffect(
    () => () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
    },
    [timersRef],
  );


  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30">
                <MonitorPlay size={20} weight="duotone" className="text-red-400" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight inline-flex items-center gap-2">
                  Watch Live
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/40">
                    <WifiHigh size={11} weight="bold" />
                    Live
                  </span>
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {streams.length > 0
                    ? `${streams.length} live monitoring streams`
                    : "Real-time monitoring streams"}
                </p>
              </div>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all disabled:opacity-50"
              aria-label="Refresh live streams"
            >
              <ArrowClockwise size={14} className={isFetching ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          {/* Quality filter + sort */}
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <div className="inline-flex rounded-xl border border-border overflow-hidden">
              {QUALITY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setQualityFilter(f.id)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    qualityFilter === f.id
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSortBy((s) => (s === "site" ? "quality" : "site"))}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                sortBy === "quality"
                  ? "border-primary/40 text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {sortBy === "quality" ? "Highest quality first" : "Site order"}
            </button>
            {streams.length !== (data?.streams.length ?? 0) && (
              <span className="text-xs text-muted-foreground">
                showing {streams.length} of {data?.streams.length}
              </span>
            )}
          </div>

          {/* Grid */}
          {isError ? (
            <div className="text-center py-24">
              <MonitorPlay size={40} className="mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground mb-4">Couldn't load live streams.</p>
              <button
                onClick={() => refetch()}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => <LiveCardSkeleton key={i} />)
                : streams.map((s) => (
                    <Link
                      key={s.id}
                      href={`/live/${s.id}`}
                      className="group"
                      onMouseEnter={() => prefetchStream(s.id)}
                      onTouchStart={() => prefetchStream(s.id)}
                    >
                      <div className="rounded-xl overflow-hidden bg-card border border-border hover:border-primary/40 transition-all duration-200">
                        <div className="relative aspect-video bg-muted">
                          {s.remux_ready || s.has_frame ? (
                            <img
                              src={liveThumbSrc(s.id, thumbTick, s.thumbnail_url)}
                              alt={s.title_en || s.title}
                              loading="lazy"
                              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                            />
                          ) : s.thumbnail_url ? (
                            <img
                              src={proxiedThumb(s.thumbnail_url)}
                              alt={s.title}
                              loading="lazy"
                              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                            />
                          ) : null}
                          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-600/90 text-white">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            Live
                          </span>
                          {s.quality_label ? (
                            <span className="absolute bottom-2 right-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/70 text-white/90 border border-white/10">
                              {s.quality_label}
                            </span>
                          ) : null}
                        </div>
                        <div className="p-3">
                          <h3
                            className="text-sm font-medium line-clamp-2 leading-snug group-hover:text-primary transition-colors"
                            title={s.title_en ? s.title : undefined}
                          >
                            {s.title_en || s.title}
                          </h3>
                        </div>
                      </div>
                    </Link>
                  ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

export default LiveFeed;
