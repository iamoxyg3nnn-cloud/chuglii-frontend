import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Playlist, FilmStrip, User, Play } from "@phosphor-icons/react";
import { proxyUrl } from "@/lib/proxy-url";
import { formatRelativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export interface PlaylistAuthor {
  display_name?: string | null;
  avatar_url?: string | null;
  username?: string | null;
}

export interface PlaylistCardItem {
  recording_id: string;
  metadata?: string | null;
}

export interface PublicPlaylist {
  id: string;
  name: string;
  description?: string | null;
  item_count: number;
  created_at: string;
  updated_at: string;
  items?: PlaylistCardItem[];
  author?: PlaylistAuthor | null;
}

interface StackedPlaylistCardProps {
  playlist: PublicPlaylist;
}

function extractItemThumbnails(item?: PlaylistCardItem | null): string[] {
  if (!item?.metadata) return [];
  try {
    const parsed = typeof item.metadata === "string" ? JSON.parse(item.metadata) : item.metadata;
    const candidates: string[] = [];

    // 1. High-speed, highly reliable mirrors first (Pixhost, ImgChest, ImgPile)
    if (parsed.thumbnail_mirrors && typeof parsed.thumbnail_mirrors === "object") {
      const mirrors = parsed.thumbnail_mirrors as Record<string, string>;
      if (mirrors.Pixhost) candidates.push(mirrors.Pixhost);
      if (mirrors.ImgChest) candidates.push(mirrors.ImgChest);
      if (mirrors.ImgPile) candidates.push(mirrors.ImgPile);
      for (const [k, v] of Object.entries(mirrors)) {
        if (!["Pixhost", "ImgChest", "ImgPile", "Catbox"].includes(k) && typeof v === "string" && !candidates.includes(v)) {
          candidates.push(v);
        }
      }
      if (mirrors.Catbox && !candidates.includes(mirrors.Catbox)) {
        candidates.push(mirrors.Catbox);
      }
    }

    // 2. Canonical thumbnail_url
    if (parsed.thumbnail_url && !candidates.includes(parsed.thumbnail_url)) {
      candidates.push(parsed.thumbnail_url);
    }

    // 3. Fallback to preview mirrors if thumbnail is missing
    if (parsed.preview_mirrors && typeof parsed.preview_mirrors === "object") {
      const pMirrors = parsed.preview_mirrors as Record<string, string>;
      if (pMirrors.Pixhost && !candidates.includes(pMirrors.Pixhost)) candidates.push(pMirrors.Pixhost);
      if (pMirrors.ImgChest && !candidates.includes(pMirrors.ImgChest)) candidates.push(pMirrors.ImgChest);
    }
    if (parsed.preview_url && !candidates.includes(parsed.preview_url)) {
      candidates.push(parsed.preview_url);
    }

    return candidates.map((u) => proxyUrl(u)).filter((u): u is string => !!u);
  } catch {
    return [];
  }
}

/**
 * Resilient fast-failover thumbnail for playlist deck cards.
 * Steps through mirror candidates instantaneously upon error with zero freeze.
 */
function CardDeckImage({
  candidates,
  alt,
  className,
}: {
  candidates: string[];
  alt: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = candidates[Math.min(index, Math.max(0, candidates.length - 1))] ?? null;

  if (!src || index >= candidates.length) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-secondary text-muted-foreground/30 select-none">
        <FilmStrip size={28} weight="duotone" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-secondary overflow-hidden">
      <img
        key={src}
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setIndex((i) => i + 1);
        }}
        className={cn(
          "w-full h-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
          className
        )}
      />
      {!loaded && (
        <div className="absolute inset-0 bg-secondary/80 animate-pulse" />
      )}
    </div>
  );
}

export function StackedPlaylistCard({ playlist }: StackedPlaylistCardProps) {
  const items = playlist.items ?? [];

  // Top candidates: prioritized across item 0, then backed up by remaining items
  const topCandidates = useMemo(() => {
    const list: string[] = [];
    for (const it of items) {
      for (const u of extractItemThumbnails(it)) {
        if (!list.includes(u)) list.push(u);
      }
    }
    return list;
  }, [items]);

  // Mid candidates: item 1's thumbnails, or fallback to top candidates
  const midCandidates = useMemo(() => {
    if (items.length > 1) {
      const list: string[] = [];
      for (let i = 1; i < items.length; i++) {
        for (const u of extractItemThumbnails(items[i])) {
          if (!list.includes(u)) list.push(u);
        }
      }
      if (list.length > 0) return list;
    }
    return topCandidates;
  }, [items, topCandidates]);

  // Back candidates: item 2's thumbnails, or fallback
  const backCandidates = useMemo(() => {
    if (items.length > 2) {
      const list: string[] = [];
      for (let i = 2; i < items.length; i++) {
        for (const u of extractItemThumbnails(items[i])) {
          if (!list.includes(u)) list.push(u);
        }
      }
      if (list.length > 0) return list;
    }
    return midCandidates;
  }, [items, midCandidates]);

  const authorName =
    playlist.author?.display_name ||
    playlist.author?.username ||
    "Community User";

  return (
    <Link
      href={`/collections/${playlist.id}`}
      className="group flex flex-col gap-3 p-3 rounded-2xl border border-border/40 hover:border-primary/50 bg-card/60 hover:bg-card/90 transition-all duration-300 animate-fade-in-up cursor-pointer shadow-xs hover:shadow-lg"
    >
      {/* Stacked Thumbnail Deck Container */}
      <div className="relative w-full pt-3 pb-0.5 select-none">
        {/* Back Stack Layer - visible when 3+ items exist */}
        {playlist.item_count > 2 && (
          <div className="absolute inset-x-4 top-0 aspect-video rounded-xl bg-neutral-900 border border-white/10 overflow-hidden opacity-55 shadow-xs z-[1] transition-all duration-300 group-hover:-translate-y-1 group-hover:opacity-75">
            <CardDeckImage
              candidates={backCandidates}
              alt=""
              className="filter brightness-75 blur-[0.3px]"
            />
          </div>
        )}

        {/* Middle Stack Layer - visible when 2+ items exist */}
        {playlist.item_count > 1 && (
          <div className="absolute inset-x-2 top-1.5 aspect-video rounded-xl bg-neutral-800 border border-white/15 overflow-hidden opacity-85 shadow-md z-[2] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:opacity-95">
            <CardDeckImage
              candidates={midCandidates}
              alt=""
              className="filter brightness-90"
            />
          </div>
        )}

        {/* Top Front Layer */}
        <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-border/70 bg-secondary shadow-lg z-10 transition-transform duration-300 group-hover:scale-[1.01]">
          <CardDeckImage
            candidates={topCandidates}
            alt={playlist.name}
            className="group-hover:scale-105 transition-transform duration-500"
          />

          {/* Dark Vignette / Gradient Scrim for high contrast */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent pointer-events-none" />

          {/* Hover Play Overlay */}
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-all duration-200 flex flex-col items-center justify-center gap-1.5 z-20">
            <div className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-xl transform scale-90 group-hover:scale-100 transition-transform duration-200">
              <Play size={20} weight="fill" className="ml-0.5" />
            </div>
            <span className="text-[11px] font-bold text-white tracking-wider uppercase drop-shadow-md">
              Play All
            </span>
          </div>

          {/* Video Count Pill */}
          <div className="absolute bottom-2.5 right-2.5 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/85 backdrop-blur-md border border-white/15 text-white text-[11px] font-semibold shadow-md tabular-nums">
            <Playlist size={13} weight="duotone" className="text-primary" />
            <span>{playlist.item_count} {playlist.item_count === 1 ? "video" : "videos"}</span>
          </div>
        </div>
      </div>

      {/* Meta details */}
      <div className="px-0.5 flex flex-col gap-1.5 min-w-0">
        <h3 className="text-[13px] font-bold tracking-tight text-foreground group-hover:text-primary transition-colors line-clamp-1 leading-snug">
          {playlist.name}
        </h3>
        {playlist.description && (
          <p className="text-[11px] text-muted-foreground/75 line-clamp-1 leading-normal">
            {playlist.description}
          </p>
        )}

        {/* Author & Activity row */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/20 text-[11px] text-muted-foreground/75 tabular-nums">
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            {playlist.author?.avatar_url ? (
              <img
                src={proxyUrl(playlist.author.avatar_url) || undefined}
                alt={authorName}
                className="w-4.5 h-4.5 rounded-full object-cover border border-white/10 shrink-0"
              />
            ) : (
              <div className="w-4.5 h-4.5 rounded-full bg-secondary border border-border/40 flex items-center justify-center shrink-0">
                <User size={10} weight="regular" className="text-muted-foreground" />
              </div>
            )}
            <span className="truncate font-medium text-foreground/80 hover:text-foreground">
              {authorName}
            </span>
          </div>

          <span className="shrink-0 text-[10px] text-muted-foreground/60">
            {formatRelativeTime(playlist.updated_at || playlist.created_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}
