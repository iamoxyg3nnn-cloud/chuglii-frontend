import { Fragment, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { Layout } from "@/components/Layout";
import { AdBanner } from "@/components/ads/AdBanner";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { VideoCard } from "@/components/VideoCard";
import { AdGridCard } from "@/components/ads/AdGridCard";
import { isAdCard } from "@/lib/ad-creatives";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, parseCloudItem, type CloudItem } from "@/lib/user-api";
import { CloudSyncIndicator } from "@/components/CloudSyncIndicator";
import { useRecentlyWatched } from "@/hooks/use-recently-watched";
import { usePreloadRecordings } from "@/hooks/use-preload-recordings";
import { setQueue, shuffleQueueItems, toQueueItem, type QueueItem } from "@/lib/play-queue";
import { byPositionThenNewest, moveItem } from "@/lib/list-order";
import { trackActivity } from "@/lib/rum";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  FilmStrip,
  PencilSimple,
  Check,
  X,
  Trash,
  Playlist,
  Play,
  Shuffle,
  User,
} from "@phosphor-icons/react";
import { formatRelativeTime } from "@/lib/formatters";
import { proxyUrl } from "@/lib/proxy-url";

function toRecording(r: ReturnType<typeof parseCloudItem>) {
  return {
    id: r.id,
    username: r.username,
    filename: r.filename,
    room_title: r.room_title ?? null,
    thumbnail_url: r.thumbnail_url ?? null,
    sprite_url: r.sprite_url ?? null,
    resolution: r.resolution ?? null,
    duration: r.duration ?? null,
    timestamp: r.timestamp,
    created_at: r.saved_at,
    tags: [] as string[],
    viewers: null,
    framerate: null,
    filesize: null,
    gender: null,
    embed_url: null,
    preview_url: r.preview_url ?? null,
    instance_id: null,
    updated_at: null,
    channel_id: null,
  };
}

export default function CollectionDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState("");
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);

  // Query public playlist details
  const { data: publicPlaylist, isLoading: publicPlaylistLoading } = useQuery({
    queryKey: ["public-playlist", id],
    queryFn: () => userApi.getPublicPlaylist(id!),
    enabled: !!id,
    retry: false,
  });

  // Query public items
  const { data: publicItems = [], isLoading: publicItemsLoading } = useQuery({
    queryKey: ["public-playlist-items", id],
    queryFn: () => userApi.getPublicPlaylistItems(id!),
    enabled: !!id,
  });

  const isOwner = !!user && publicPlaylist?.user_id === user.id;

  const updateMeta = useTrackedMutation({
    mutationFn: (payload: { name?: string; description?: string | null }) =>
      userApi.updateCollection(id!, payload.name ?? publicPlaylist?.name ?? "Playlist", payload.description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["public-playlist", id] });
      queryClient.invalidateQueries({ queryKey: ["public-playlists"] });
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
    },
  });

  const removeItemCloud = useTrackedMutation({
    mutationFn: (recordingId: string) =>
      userApi.removeCollectionItem(id!, recordingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["public-playlist-items", id] });
      queryClient.invalidateQueries({ queryKey: ["public-playlist", id] });
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
    },
  });

  const recentlyWatched = useRecentlyWatched();

  const deleteCloud = useTrackedMutation({
    mutationFn: () => userApi.deleteCollection(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["public-playlists"] });
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
    },
  });

  const handleRemove = (recordingId: string) => {
    if (!isOwner) return;
    removeItemCloud.mutate(recordingId);
  };

  const handleRename = () => {
    if (!isOwner || !editName.trim()) return;
    updateMeta.mutate({ name: editName.trim() });
    setEditing(false);
  };

  const handleDescSave = () => {
    if (!isOwner) return;
    updateMeta.mutate({ description: editDesc.trim() ? editDesc.trim() : null });
    setEditingDesc(false);
  };

  type CloudItemWithId = CloudItem & { id: string };
  const sortedItems = useMemo<CloudItemWithId[]>(() => {
    const wrapped: CloudItemWithId[] = publicItems.map((it) => ({ ...it, id: it.recording_id }));
    const sorted = wrapped.sort(byPositionThenNewest);
    if (!order) return sorted;
    const byId = new Map(sorted.map((it) => [it.recording_id, it]));
    const arranged = order
      .map((rid) => byId.get(rid))
      .filter((it): it is CloudItemWithId => !!it);
    const fresh = sorted.filter((it) => !order.includes(it.recording_id));
    return [...arranged, ...fresh];
  }, [publicItems, order]);

  const commitOrder = (ids: string[]) => {
    setOrder(ids);
    reorderCloud.mutate(ids);
  };

  const reorderCloud = useTrackedMutation({
    mutationFn: (recording_ids: string[]) => userApi.reorderCollectionItems(id!, recording_ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["public-playlist-items", id] });
      setOrder(null);
    },
    onError: () => {
      setOrder(null);
    },
  });

  // Drag-and-drop remains available on desktop; explicit controls make the
  // same ordering action usable on touch screens and with a keyboard.
  const handleMoveItem = (recId: string, direction: "up" | "down") => {
    if (!isOwner || reorderCloud.isPending) return;
    const ids = sortedItems.map((it) => it.recording_id);
    const index = ids.indexOf(recId);
    const neighbor = ids[index + (direction === "up" ? -1 : 1)];
    if (!neighbor) return;
    const next = moveItem(ids, recId, neighbor, direction === "down");
    if (next !== ids) {
      commitOrder(next);
      trackActivity("collection_reorder", { meta: { collection_id: id, count: next.length, method: "controls" } });
    }
  };

  const handleDragStart = (recId: string) => (e: React.DragEvent) => {
    if (!isOwner) return;
    setDragId(recId);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", recId);
    } catch {
      /* ignore */
    }
  };

  const handleDragOver = (recId: string) => (e: React.DragEvent) => {
    if (!isOwner || !dragId || dragId === recId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropTarget((prev) => (prev?.id === recId && prev.after === after ? prev : { id: recId, after }));
  };

  const handleDropOn = (recId: string) => (e: React.DragEvent) => {
    if (!isOwner) return;
    e.preventDefault();
    const after = dropTarget?.id === recId ? dropTarget.after : false;
    if (dragId && dragId !== recId) {
      const base = sortedItems.map((it) => it.recording_id);
      const next = moveItem(base, dragId, recId, after);
      if (next !== base) {
        commitOrder(next);
        trackActivity("collection_reorder", { meta: { collection_id: id, count: next.length } });
      }
    }
    setDragId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDropTarget(null);
  };

  usePreloadRecordings(publicItems.map(parseCloudItem));

  const notFound = !publicPlaylistLoading && !publicPlaylist;
  const items = sortedItems;
  const playlistName = publicPlaylist?.name ?? "Playlist";
  const playlistDesc = publicPlaylist?.description ?? undefined;
  const playlistCreatedAt = publicPlaylist?.created_at;
  const authorName = publicPlaylist?.author?.display_name || publicPlaylist?.author?.username || "Community User";

  const previewCandidates = useMemo(() => {
    const urls: string[] = [];
    for (const it of items) {
      if (!it?.metadata) continue;
      try {
        const parsed = typeof it.metadata === "string" ? JSON.parse(it.metadata) : it.metadata;
        if (parsed.thumbnail_mirrors && typeof parsed.thumbnail_mirrors === "object") {
          const mirrors = parsed.thumbnail_mirrors as Record<string, string>;
          if (mirrors.Pixhost) urls.push(mirrors.Pixhost);
          if (mirrors.ImgChest) urls.push(mirrors.ImgChest);
          if (mirrors.ImgPile) urls.push(mirrors.ImgPile);
          for (const [k, v] of Object.entries(mirrors)) {
            if (!["Pixhost", "ImgChest", "ImgPile", "Catbox"].includes(k) && typeof v === "string" && !urls.includes(v)) {
              urls.push(v);
            }
          }
          if (mirrors.Catbox && !urls.includes(mirrors.Catbox)) {
            urls.push(mirrors.Catbox);
          }
        }
        if (parsed.thumbnail_url && !urls.includes(parsed.thumbnail_url)) {
          urls.push(parsed.thumbnail_url);
        }
        if (parsed.preview_mirrors && typeof parsed.preview_mirrors === "object") {
          const pMirrors = parsed.preview_mirrors as Record<string, string>;
          if (pMirrors.Pixhost && !urls.includes(pMirrors.Pixhost)) urls.push(pMirrors.Pixhost);
          if (pMirrors.ImgChest && !urls.includes(pMirrors.ImgChest)) urls.push(pMirrors.ImgChest);
        }
        if (parsed.preview_url && !urls.includes(parsed.preview_url)) {
          urls.push(parsed.preview_url);
        }
      } catch {}
    }
    return urls.map((u) => proxyUrl(u)).filter((u): u is string => !!u);
  }, [items]);

  const [previewIndex, setPreviewIndex] = useState(0);
  const previewThumbnail = previewCandidates[Math.min(previewIndex, Math.max(0, previewCandidates.length - 1))] ?? null;

  const listItems = (): QueueItem[] =>
    publicItems.map((it) => toQueueItem(parseCloudItem(it))).filter((it): it is QueueItem => it !== null);

  const startQueue = (title: string, items: QueueItem[], startIndex = 0) => {
    setQueue(title, items);
    sessionStorage.setItem("vauto", items[startIndex].id);
    window.scrollTo({ top: 0, behavior: "auto" });
    setLocation(`/video/${items[startIndex].id}`);
  };

  const handlePlayAll = () => {
    const queueItems = listItems();
    if (queueItems.length === 0) return;
    trackActivity("playlist_start", { meta: { mix: "playlist", count: queueItems.length, index: 0, order: "sequential" } });
    startQueue(playlistName, queueItems);
  };

  const handleShuffle = () => {
    const queueItems = listItems();
    if (queueItems.length === 0) return;
    const startId = queueItems[Math.floor(Math.random() * queueItems.length)].id;
    const shuffled = shuffleQueueItems(queueItems, startId);
    trackActivity("playlist_start", { meta: { mix: "playlist", count: shuffled.length, index: 0, order: "shuffle" } });
    startQueue(playlistName, shuffled);
  };

  if (notFound) {
    return (
      <Layout>
        <div className="container mx-auto px-4 sm:px-6 py-24 text-center">
          <Playlist size={40} weight="duotone" className="text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground mb-4">Playlist not found</p>
          <Link href="/playlists" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            <ArrowLeft size={13} weight="bold" /> Back to Playlists
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-7xl">
        <Link
          href="/playlists"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-6 group"
        >
          <ArrowLeft size={12} weight="bold" className="group-hover:-translate-x-0.5 transition-transform" />
          Back to Playlists
        </Link>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 mb-8 pb-6 border-b border-border/40">
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-secondary shrink-0 overflow-hidden border border-border/60 shadow-md relative">
            {previewThumbnail ? (
              <img
                key={previewThumbnail}
                src={previewThumbnail}
                alt={playlistName}
                loading="eager"
                decoding="async"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
                onError={() => {
                  if (previewIndex + 1 < previewCandidates.length) {
                    setPreviewIndex((i) => i + 1);
                  }
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-secondary">
                <FilmStrip size={28} weight="duotone" className="text-muted-foreground/30" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {editing && isOwner ? (
              <div className="flex items-center gap-2 mb-1">
                <input
                  autoFocus
                  type="text"
                  aria-label="Playlist name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  maxLength={80}
                  className="h-9 bg-background border border-primary/50 rounded-lg px-3 text-sm font-semibold outline-none flex-1 max-w-xs"
                />
                <button
                  onClick={handleRename}
                  className="text-green-500 hover:text-green-400 transition-colors"
                  aria-label="Save playlist name"
                  title="Save playlist name"
                >
                  <Check size={14} weight="bold" />
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Cancel renaming"
                  title="Cancel"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">{playlistName}</h1>
                {isOwner && (
                  <button
                    onClick={() => { setEditing(true); setEditName(playlistName); }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Rename playlist"
                    title="Rename playlist"
                  >
                    <PencilSimple size={14} weight="regular" />
                  </button>
                )}
              </div>
            )}

            {editingDesc && isOwner ? (
              <div className="flex items-center gap-2 mb-1">
                <input
                  autoFocus
                  type="text"
                  aria-label="Playlist description"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleDescSave();
                    if (e.key === "Escape") setEditingDesc(false);
                  }}
                  maxLength={200}
                  placeholder="Description (optional)"
                  className="h-8 bg-background border border-primary/50 rounded-lg px-2.5 text-sm outline-none flex-1 max-w-sm"
                />
                <button
                  onClick={handleDescSave}
                  className="text-green-500 hover:text-green-400 transition-colors"
                  aria-label="Save description"
                  title="Save description"
                >
                  <Check size={14} weight="bold" />
                </button>
                <button
                  onClick={() => setEditingDesc(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Cancel editing description"
                  title="Cancel"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>
            ) : (
              <button
                disabled={!isOwner}
                onClick={() => { if (isOwner) { setEditingDesc(true); setEditDesc(playlistDesc ?? ""); } }}
                className={cn("group/desc flex items-center gap-1.5 mb-1 text-left min-w-0", isOwner ? "cursor-pointer" : "cursor-default")}
                title={isOwner ? "Edit description" : undefined}
              >
                {playlistDesc ? (
                  <p className="text-sm text-muted-foreground truncate">{playlistDesc}</p>
                ) : isOwner ? (
                  <p className="text-xs text-muted-foreground/40 italic">Add a description…</p>
                ) : null}
                {isOwner && (
                  <PencilSimple size={12} weight="regular" className="shrink-0 text-muted-foreground/0 group-hover/desc:text-muted-foreground transition-colors" />
                )}
              </button>
            )}

            <div className="flex items-center gap-3 text-xs text-muted-foreground/70 mt-1">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                {publicPlaylist?.author?.avatar_url ? (
                  <img
                    src={proxyUrl(publicPlaylist.author.avatar_url) || undefined}
                    alt={authorName}
                    className="w-4 h-4 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <User size={14} weight="regular" className="text-muted-foreground" />
                )}
                <span>Created by <strong className="text-foreground">{authorName}</strong></span>
              </div>
              <span>•</span>
              <span>{items.length} {items.length === 1 ? "video" : "videos"}</span>
              {playlistCreatedAt && (
                <>
                  <span>•</span>
                  <span>{formatRelativeTime(playlistCreatedAt)}</span>
                </>
              )}
              {isOwner && <CloudSyncIndicator compact />}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {items.length > 0 && (
              <>
                <button
                  onClick={handlePlayAll}
                  className="flex items-center gap-2 h-10 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground transition-all rounded-xl cursor-pointer shadow-xs active:scale-95"
                >
                  <Play size={15} weight="fill" />
                  <span>Play all</span>
                </button>
                <button
                  onClick={handleShuffle}
                  className="flex items-center gap-1.5 h-10 px-3.5 text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground border border-border/50 transition-all rounded-xl cursor-pointer active:scale-95"
                  title="Shuffle play"
                >
                  <Shuffle size={14} weight="regular" />
                  <span className="hidden sm:inline">Shuffle</span>
                </button>
              </>
            )}
            {isOwner && (
              <button
                onClick={async () => {
                  if (!confirm("Delete this playlist? This cannot be undone.")) return;
                  try {
                    await deleteCloud.mutateAsync();
                    setLocation("/playlists");
                  } catch {
                    // Delete failed
                  }
                }}
                className="flex items-center gap-1.5 h-10 px-3 text-xs font-medium text-muted-foreground/60 hover:text-destructive border border-border/40 hover:border-destructive/40 hover:bg-destructive/10 rounded-xl transition-all cursor-pointer"
                title="Delete playlist"
              >
                <Trash size={14} weight="regular" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}
          </div>
        </div>

        {/* Top ad */}
        <AdLeaderboard className="mb-8" />

        {publicItemsLoading || publicPlaylistLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="aspect-video bg-secondary/30 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-border/40 rounded-2xl">
            <FilmStrip size={32} weight="duotone" className="text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No videos in this playlist yet.</p>
            {isOwner && (
              <p className="text-xs text-muted-foreground/60 mt-1">
                Open any video and use the "Add to Collection" button to add it here.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {items.map((item: CloudItem, i) => {
              const rec = parseCloudItem(item);
              const isDragging = dragId === rec.id;
              const dropHere = dropTarget?.id === rec.id ? dropTarget : null;
              return (
                <Fragment key={rec.id}>
                  <div
                    className={cn("relative group/card", isDragging && "opacity-40")}
                    draggable={isOwner}
                    onDragStart={handleDragStart(rec.id)}
                    onDragOver={handleDragOver(rec.id)}
                    onDrop={handleDropOn(rec.id)}
                    onDragEnd={handleDragEnd}
                    onDragLeave={() => setDropTarget((prev) => (prev?.id === rec.id ? null : prev))}
                  >
                    <VideoCard recording={toRecording(rec)} isWatched={recentlyWatched.has(rec.id)} />
                    <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
                      <div className="w-6 h-6 rounded-lg border border-primary/40 text-primary text-[10px] font-bold flex items-center justify-center bg-black/50 backdrop-blur-sm">
                        {i + 1}
                      </div>
                      {isOwner && (
                        <button
                          onClick={() => handleRemove(rec.id)}
                          className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm ring-1 ring-white/10 text-white/60 hover:text-red-400 hover:bg-red-600/60 hover:ring-red-600/30 transition-all rounded-lg opacity-0 group-hover/card:opacity-100 cursor-pointer"
                          aria-label="Remove from playlist"
                          title="Remove from playlist"
                        >
                          <Trash size={12} weight="regular" />
                        </button>
                      )}
                    </div>
                    {isOwner && (
                      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMoveItem(rec.id, "up")}
                          disabled={i === 0 || reorderCloud.isPending}
                          aria-label={`Move ${rec.username} up`}
                          title="Move up"
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-black/65 backdrop-blur-sm ring-1 ring-white/15 text-white hover:bg-black/85 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <ArrowUp size={13} weight="bold" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveItem(rec.id, "down")}
                          disabled={i === items.length - 1 || reorderCloud.isPending}
                          aria-label={`Move ${rec.username} down`}
                          title="Move down"
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-black/65 backdrop-blur-sm ring-1 ring-white/15 text-white hover:bg-black/85 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <ArrowDown size={13} weight="bold" />
                        </button>
                        <span className="sr-only">You can also drag this recording to reorder it.</span>
                      </div>
                    )}
                    {dropHere && (
                      <div
                        className={cn(
                          "absolute z-20 left-1 right-1 h-0.5 bg-primary rounded-full pointer-events-none",
                          dropHere.after ? "-bottom-1" : "-top-1",
                        )}
                      />
                    )}
                  </div>
                  {isAdCard(items, i) && <AdGridCard />}
                </Fragment>
              );
            })}
          </div>
        )}

        {/* Bottom ad */}
        <div className="mt-10 flex justify-center">
          <AdBanner file="medium-rect-300x250" />
        </div>
      </div>
    </Layout>
  );
}

// asset-cache-bust: 2026-11-25T2 (poisoned /assets/* immutable entries)

if (typeof window !== "undefined") { (window as unknown as { __chunkBuilds?: Record<string, number> }).__chunkBuilds = { b2: 1 }; }
