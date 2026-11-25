import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { AdBanner } from "@/components/ads/AdBanner";
import { StackedPlaylistCard } from "@/components/StackedPlaylistCard";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type PublicPlaylist } from "@/lib/user-api";
import { trackActivity } from "@/lib/rum";
import { Playlist, Plus, FilmStrip, FolderSimplePlus, MagnifyingGlass, X } from "@phosphor-icons/react";
import { toast } from "@/hooks/use-toast";

function PlaylistSkeleton() {
  return (
    <div className="space-y-3 p-3 rounded-2xl border border-border/40 bg-card/60 animate-pulse">
      <div className="relative w-full pt-3 pb-0.5">
        <div className="absolute inset-x-4 top-0 aspect-video rounded-xl bg-neutral-900/60" />
        <div className="absolute inset-x-2 top-1.5 aspect-video rounded-xl bg-neutral-800/70" />
        <Skeleton className="relative w-full aspect-video rounded-xl z-10" />
      </div>
      <Skeleton className="h-4 w-3/4 rounded-md" />
      <div className="flex items-center gap-2 pt-1 border-t border-border/20">
        <Skeleton className="w-4.5 h-4.5 rounded-full shrink-0" />
        <Skeleton className="h-3 w-1/3 rounded-md" />
      </div>
    </div>
  );
}

export default function Playlists() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "count" | "name">("recent");

  // Fetch all public user-created playlists
  const { data: playlists = [], isLoading } = useQuery({
    queryKey: ["public-playlists"],
    queryFn: () => userApi.getPublicPlaylists(),
    staleTime: 30_000,
  });

  const totalVideos = useMemo(
    () => playlists.reduce((acc, p) => acc + (p.item_count || 0), 0),
    [playlists]
  );

  const filteredPlaylists = useMemo(() => {
    let result = [...playlists];

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((p) => {
        const nameMatch = p.name?.toLowerCase().includes(q);
        const descMatch = p.description?.toLowerCase().includes(q);
        const authorMatch = (p.author?.display_name || p.author?.username || "").toLowerCase().includes(q);
        return nameMatch || descMatch || authorMatch;
      });
    }

    if (sortBy === "count") {
      result.sort((a, b) => (b.item_count || 0) - (a.item_count || 0));
    } else if (sortBy === "name") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return result;
  }, [playlists, search, sortBy]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setLocation("/login");
      return;
    }
    if (!newName.trim() || creating) return;

    setCreating(true);
    try {
      const col = await userApi.createCollection(newName.trim(), newDesc.trim() || undefined);
      trackActivity("collection_create", { meta: { name: newName.trim().slice(0, 100) } });
      queryClient.invalidateQueries({ queryKey: ["public-playlists"] });
      queryClient.invalidateQueries({ queryKey: ["user", "collections"] });
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      toast({ title: "Playlist created", description: `"${newName.trim()}" has been created.` });
      setLocation(`/collections/${col.id}`);
    } catch (err) {
      toast({
        title: "Failed to create playlist",
        description: err instanceof Error ? err.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 sm:px-6 py-10 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
              <Playlist size={15} weight="duotone" className="text-primary" />
              <span>Curated Collections</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">Playlists</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 max-w-xl leading-relaxed">
              Browse public playlists created by the community, or build your own custom sets from archived recordings.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {user && (
              <Link
                href="/collections"
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors rounded-lg"
              >
                <FolderSimplePlus size={14} weight="regular" />
                My Playlists
              </Link>
            )}
            <button
              onClick={() => {
                if (!user) {
                  setLocation("/login");
                } else {
                  setShowCreate((v) => !v);
                }
              }}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground transition-all rounded-lg cursor-pointer shadow-xs active:scale-95"
            >
              <Plus size={13} weight="bold" />
              Create Playlist
            </button>
          </div>
        </div>

        {/* Top ad leaderboard */}
        <AdLeaderboard className="mb-8" />

        {/* Create Playlist Inline Form */}
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-8 p-5 border border-primary/30 bg-primary/5 rounded-2xl space-y-3 animate-fade-in-up"
          >
            <p className="text-xs font-semibold text-foreground">
              Create New Public Playlist
            </p>
            <div className="space-y-2">
              <input
                autoFocus
                type="text"
                placeholder="Playlist name *"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={80}
                required
                className="w-full h-10 bg-background border border-border/60 focus:border-primary/50 rounded-lg px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/10"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                maxLength={200}
                className="w-full h-10 bg-background border border-border/60 focus:border-primary/50 rounded-lg px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground transition-colors rounded-lg disabled:opacity-60 cursor-pointer"
              >
                {creating ? "Creating…" : "Create & Open"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setNewName("");
                  setNewDesc("");
                }}
                className="h-9 px-4 text-xs font-medium border border-border/50 text-muted-foreground hover:text-foreground transition-colors rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Filter, Sort & Search Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-border/40">
          {/* Quick Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setSortBy("recent")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                sortBy === "recent"
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "bg-secondary/70 text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              Latest
            </button>
            <button
              onClick={() => setSortBy("count")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                sortBy === "count"
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "bg-secondary/70 text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              Most Videos
            </button>
            <button
              onClick={() => setSortBy("name")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                sortBy === "name"
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "bg-secondary/70 text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              A–Z
            </button>

            {playlists.length > 0 && (
              <span className="text-[11px] text-muted-foreground/50 ml-2 hidden md:inline tabular-nums">
                {playlists.length} {playlists.length === 1 ? "playlist" : "playlists"} • {totalVideos} videos
              </span>
            )}
          </div>

          {/* Search Input */}
          <div className="relative sm:w-64">
            <MagnifyingGlass
              size={14}
              weight="bold"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              placeholder="Search playlists or creators..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-8 pr-8 bg-secondary/50 border border-border/50 focus:border-primary/50 rounded-lg text-xs outline-none transition-colors placeholder:text-muted-foreground/50"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Clear search"
              >
                <X size={12} weight="bold" />
              </button>
            )}
          </div>
        </div>

        {/* Content Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <PlaylistSkeleton key={i} />
            ))}
          </div>
        ) : filteredPlaylists.length === 0 ? (
          <div className="py-20 text-center border border-border/30 rounded-2xl bg-secondary/10 animate-fade-in-up">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <FilmStrip size={28} weight="duotone" className="text-muted-foreground/30" />
            </div>
            {search ? (
              <>
                <h3 className="text-base font-bold mb-1">No playlists match &ldquo;{search}&rdquo;</h3>
                <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
                  Try a different search term or clear the filter to see all community playlists.
                </p>
                <button
                  onClick={() => setSearch("")}
                  className="inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 transition-colors rounded-lg cursor-pointer"
                >
                  Clear search
                </button>
              </>
            ) : (
              <>
                <h3 className="text-base font-bold mb-1">No playlists created yet</h3>
                <p className="text-xs text-muted-foreground mb-6 max-w-sm mx-auto">
                  Be the first to build a custom playlist from the archive! Everyone will be able to see and play it here.
                </p>
                <button
                  onClick={() => {
                    if (!user) setLocation("/login");
                    else setShowCreate(true);
                  }}
                  className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground transition-colors rounded-lg cursor-pointer"
                >
                  <Plus size={13} weight="bold" />
                  Create Playlist
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 animate-fade-in-up">
            {filteredPlaylists.map((playlist: PublicPlaylist) => (
              <StackedPlaylistCard key={playlist.id} playlist={playlist} />
            ))}
          </div>
        )}

        {/* Bottom ad */}
        <div className="mt-12 flex justify-center">
          <AdBanner file="medium-rect-300x250" />
        </div>
      </div>
    </Layout>
  );
}

// asset-cache-bust: 2026-11-25T2 (poisoned /assets/* immutable entries)

if (typeof window !== "undefined") { (window as unknown as { __chunkBuilds?: Record<string, number> }).__chunkBuilds = { b2: 1 }; }
