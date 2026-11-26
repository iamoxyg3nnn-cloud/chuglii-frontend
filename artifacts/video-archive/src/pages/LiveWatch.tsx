import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ArrowLeft, MonitorPlay, WifiHigh } from "@phosphor-icons/react";
import { Layout } from "@/components/Layout";
import { HlsVideoPlayer } from "@/components/HlsVideoPlayer";
import { SkeletonDetailPage } from "@/components/skeletons/PageSkeletons";

interface ResolvedStream {
  id: string;
  m3u8_url: string;
  poster_url: string | null;
  live: boolean;
  title_en?: string | null;
}

interface RemuxInfo {
  status: string;
  url?: string;
}

/** Shared with LiveFeed for hover/mount prefetch (same react-query key,
 *  so a prefetched resolve makes the watch page render instantly). */
export async function resolveStream(
  id: string,
  fresh = false,
): Promise<{ stream: ResolvedStream; remux?: RemuxInfo }> {
  const res = await fetch(
    `/api/live/resolve?id=${encodeURIComponent(id)}${fresh ? "&fresh=1" : ""}`,
  );
  if (!res.ok) throw new Error(`Failed to resolve stream (${res.status})`);
  return res.json();
}

/**
 * Watch page for a live monitoring stream. The API resolves the signed HLS
 * manifest at request time (tokens are minted per upstream page render); the
 * manifest itself is played through the same-origin /api/media proxy, which
 * rewrites segment and AES-key URIs back to us.
 */
export function LiveWatch() {
  const { id } = useParams();
  const [retryNonce, setRetryNonce] = useState(0);
  const [healedStream, setHealedStream] = useState<ResolvedStream | null>(null);
  const [healing, setHealing] = useState(false);
  // Server-side remux (silence-filled clean HLS). While it renders we play
  // the upstream feed; when it lands we hot-swap sources at the playhead.
  const [remuxUrl, setRemuxUrl] = useState<string | null>(null);
  const swapTimeRef = useRef<number | undefined>(undefined);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["live-resolve", id],
    queryFn: () => resolveStream(id!),
    enabled: !!id,
    staleTime: 30_000,
    retry: 1,
    // While the remux renders, keep asking — the response flips to
    // status:"ready" with a local URL, and we switch over seamlessly.
    refetchInterval: (query) =>
      query.state.data?.remux?.status === "ready" || remuxUrl ? false : 10_000,
  });

  // Hot-swap to the remuxed stream the moment it lands (remounts the player
  // with the clean local source, resuming at the current playhead).
  // NOTE: must live above the early returns — Rules of Hooks.
  const remux = data?.remux;
  useEffect(() => {
    if (remux?.status === "ready" && remux.url && remuxUrl === null) {
      swapTimeRef.current = document.querySelector("video")?.currentTime ?? undefined;
      setRemuxUrl(remux.url);
      setRetryNonce((n) => n + 1);
    }
  }, [remux?.status, remux?.url, remuxUrl]);

  if (!id) return <Layout><div className="min-h-screen bg-background" /></Layout>;
  if (isLoading) return <Layout><SkeletonDetailPage /></Layout>;

  const stream = healedStream ?? data?.stream;

  // Self-healing: when every candidate fails (dead token, CDN hiccup),
  // re-resolve with a cache-bypassing request and remount the player with
  // the fresh manifest.
  const handleExhausted = async () => {
    if (healing || !id) return;
    setHealing(true);
    try {
      const { stream: fresh } = await resolveStream(id, true);
      setHealedStream(fresh);
      setRetryNonce((n) => n + 1);
    } catch {
      // stay on the error screen
    } finally {
      setHealing(false);
    }
  };

  // Manifest goes through the media proxy: same-origin, CORS-safe, and the
  // proxy rewrites segment + EXT-X-KEY URIs back through itself.
  // Once the server-side remux is ready we play THAT instead — it's our own
  // clean, silence-filled HLS served straight from disk (no proxy, no origin
  // stalls, no audio holes), so it's used directly same-origin.
  const hlsCandidates = remuxUrl
    ? [remuxUrl]
    : stream?.m3u8_url
      ? [`/api/media?url=${encodeURIComponent(stream.m3u8_url)}`]
      : [];

  return (
    <Layout>
      <div className="min-h-screen bg-background text-foreground pb-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <Link href="/live">
              <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:text-amber-400 transition-colors cursor-pointer">
                <ArrowLeft size={15} /> Back to Watch Live
              </span>
            </Link>
            {stream?.live ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/40">
                <WifiHigh size={11} weight="bold" />
                Live
              </span>
            ) : null}
          </div>

          {isError || !stream ? (
            <div className="text-center py-24">
              <MonitorPlay size={40} className="mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground mb-4">
                Couldn't resolve this stream. The token may have expired.
              </p>
              <button
                onClick={() => { setRetryNonce((n) => n + 1); setHealedStream(null); void refetch(); }}
                disabled={isFetching || healing}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-50"
              >
                {isFetching || healing ? "Retrying…" : "Retry"}
              </button>
            </div>
          ) : hlsCandidates.length > 0 ? (
            <HlsVideoPlayer
              key={`live-${stream.id}-${retryNonce}`}
              candidates={hlsCandidates}
              startAt={remuxUrl ? swapTimeRef.current : undefined}
              poster={stream.poster_url
                ? `/api/live/thumb?url=${encodeURIComponent(stream.poster_url)}&w=1280`
                : undefined}
              autoPlay
              live={stream.live}
              onExhausted={() => void handleExhausted()}
            />
          ) : null}

          <h1 className="text-lg sm:text-xl font-bold tracking-tight mt-4 leading-snug">
            {stream ? stream.title_en || `Live stream #${stream.id}` : ""}
          </h1>
        </div>
      </div>
    </Layout>
  );
}

export default LiveWatch;
