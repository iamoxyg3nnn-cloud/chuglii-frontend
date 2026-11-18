import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Playlist, FilmStrip, User, Play } from "@phosphor-icons/react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { proxyUrl } from "@/lib/proxy-url";

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
    if (parsed.thumbnail_mirrors && typeof parsed.thumbnail_mirrors === "object") {
      const mirrors = parsed.thumbnail_mirrors as Record<string, string>;
      if (mirrors.Pixhost) candidates.push(mirrors.Pixhost);
      if (mirrors.ImgChest) candidates.push(mirrors.ImgChest);
      for (const [k, v] of Object.entries(mirrors)) {
        if (k !== "Pixhost" && k !== "ImgChest" && typeof v === "string" && !candidates.includes(v)) {
          candidates.push(v);
        }
      }
    }
    if (parsed.thumbnail_url && !candidates.includes(parsed.thumbnail_url)) {
      candidates.push(parsed.thumbnail_url);
    }
    return candidates.map((u) => proxyUrl(u)).filter((u): u is string => !!u);
  } catch {
    return [];
  }
}

export function StackedPlaylistCard({ playlist }: StackedPlaylistCardProps) {
  const items = playlist.items ?? [];
  const topCandidates = useMemo(() => {
    const list: string[] = [];
    for (const it of items) {
      for (const u of extractItemThumbnails(it)) {
        if (!list.includes(u)) list.push(u);
      }
    }
    return list;
  }, [items]);
  const [topIndex, setTopIndex] = useState(0);
  const topThumb = topCandidates[Math.min(topIndex, Math.max(0, topCandidates.length - 1))] ?? null;

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
  const midThumb = midCandidates[0] ?? (playlist.item_count > 1 ? topThumb : null);

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
  const backThumb = backCandidates[0] ?? (playlist.item_count > 2 ? (midThumb ?? topThumb) : null);

  const authorName =
    playlist.author?.display_name ||
    playlist.author?.username ||
    "Community User";

  return (
    <Link
      href={`/collections/${playlist.id}`}
      className="group flex flex-col gap-3 p-3 rounded-2xl border border-border/30 hover:border-primary/40 bg-card/60 hover:bg-card transition-all duration-300 animate-fade-in-up cursor-pointer"
    >
      {/* Stacked Thumbnail Deck Container */}
      <div className="relative w-full aspect-video pt-2">
        {/* Back Stack Layer - visible when 3+ items exist */}
        {playlist.item_count > 2 && (
          <div className="absolute inset-x-4 -top-2 bottom-4 rounded-xl bg-muted/60 border border-border/40 overflow-hidden transform scale-[0.88] translate-y-[-8px] opacity-60 transition-transform duration-300 group-hover:scale-[0.90] group-hover:translate-y-[-10px] shadow-sm">
            {backThumb ? (
              <img src={backThumb} alt="" className="w-full h-full object-cover blur-[0.5px]" loading="lazy" decoding="async" />
            ) : (
              <div className="w-full h-full bg-secondary/80 flex items-center justify-center">
                <FilmStrip size={20} weight="duotone" className="text-muted-foreground/30" />
              </div>
            )}
          </div>
        )}

        {/* Middle Stack Layer - visible when 2+ items exist */}
        {playlist.item_count > 1 && (
          <div className="absolute inset-x-2 -top-1 bottom-2 rounded-xl bg-muted/80 border border-border/50 overflow-hidden transform scale-[0.94] translate-y-[-4px] opacity-85 transition-transform duration-300 group-hover:scale-[0.95] group-hover:translate-y-[-5px] shadow-md">
            {midThumb ? (
              <img src={midThumb} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
            ) : (
              <div className="w-full h-full bg-secondary flex items-center justify-center">
                <FilmStrip size={22} weight="duotone" className="text-muted-foreground/40" />
              </div>
            )}
          </div>
        )}

        {/* Top Front Layer */}
        <div className="relative w-full h-full rounded-xl overflow-hidden border border-border/60 bg-secondary shadow-lg transition-transform duration-300 group-hover:scale-[1.01]">
          {topThumb ? (
            <OptimizedImage
              src={topThumb}
              alt={playlist.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              containerClassName="w-full h-full"
              width="card"
              onError={() => {
                if (topIndex + 1 < topCandidates.length) {
                  setTopIndex((i) => i + 1);
                }
              }}
              fallback={
                <div className="w-full h-full flex items-center justify-center bg-secondary/90">
                  <FilmStrip size={28} weight="duotone" className="text-muted-foreground/30" />
                </div>
              }
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-secondary/90">
              <FilmStrip size={28} weight="duotone" className="text-muted-foreground/30" />
            </div>
          )}

          {/* Hover Play Overlay */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform duration-300">
              <Play size={24} weight="fill" className="ml-0.5" />
            </div>
          </div>

          {/* Item Count Badge Overlay */}
          <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 text-white text-[11px] font-semibold shadow-md">
            <Playlist size={14} weight="duotone" className="text-primary" />
            <span>{playlist.item_count} {playlist.item_count === 1 ? "video" : "videos"}</span>
          </div>
        </div>
      </div>

      {/* Meta details */}
      <div className="px-1 flex flex-col gap-1 min-w-0">
        <h3 className="text-sm font-bold tracking-tight text-foreground group-hover:text-primary transition-colors line-clamp-1">
          {playlist.name}
        </h3>
        {playlist.description && (
          <p className="text-xs text-muted-foreground line-clamp-1">
            {playlist.description}
          </p>
        )}

        {/* Author row */}
        <div className="flex items-center gap-2 mt-1 pt-1 border-t border-border/20">
          {playlist.author?.avatar_url ? (
            <img
              src={proxyUrl(playlist.author.avatar_url) || undefined}
              alt={authorName}
              className="w-5 h-5 rounded-full object-cover border border-border/40 shrink-0"
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-secondary border border-border/40 flex items-center justify-center shrink-0">
              <User size={12} weight="regular" className="text-muted-foreground" />
            </div>
          )}
          <span className="text-[11px] font-medium text-muted-foreground truncate">
            {authorName}
          </span>
        </div>
      </div>
    </Link>
  );
}
