import { useMemo, memo, useState, useEffect } from "react";
import { Link } from "wouter";
import { OptimizedImage, ImageUnavailable } from "@/components/ui/optimized-image";
import { SpriteSlideshow } from "@/components/SpriteSlideshow";
import { useHoverPreview } from "@/hooks/use-hover-preview";
import { getSpriteGrid } from "@/lib/sprite-grid";
import { proxyUrl, proxySpriteUrl } from "@/lib/proxy-url";
import { prefetchRoute } from "@/lib/route-chunks";
import { PlatformBadge } from "@/components/PlatformBadge";
interface Performer {
  username: string;
  recording_count?: number;
  latest_thumbnail?: string | null;
  sprite_url?: string | null;
  gender?: string | null;
  latest_timestamp?: string | null;
  /** Ordered image fallback chain from the API: thumbnail + its mirrors + sprite. */
  fallback_images?: string[] | null;
}

interface PerformerCardProps {
  performer?: Performer;
  performers?: Performer[];
  fetchPriority?: "high" | "low" | "auto";
  variant?: "square" | "circle";
}

function formatCount(n: number): string {
  if (n >= 1_000_000) {
    const m = (n / 1_000_000).toFixed(1);
    return `${m}M`;
  }
  if (n >= 1_000) {
    const k = (n / 1_000).toFixed(1);
    return `${k}k`;
  }
  return String(n);
}

// Sprite hover layer for performer cards. Sprites are the same framed previews
// used on recording cards; performers expose their latest recording's sprite
// at runtime, so hovering a portrait card plays the frames instead of a static
// thumbnail. Preloads the sprite ~2 viewports early via useHoverPreview.
function SpriteHover({ performer }: { performer: Performer }) {
  const spriteUrl = performer.sprite_url ? proxySpriteUrl(performer.sprite_url) : null;
  const { isHovered, hoverHandlers, viewportRef } = useHoverPreview({
    thumbnailUrl: performer.latest_thumbnail,
    previewUrl: null,
    spriteUrl,
  });
  const grid = useMemo(() => getSpriteGrid(performer.sprite_url), [performer.sprite_url]);
  if (!spriteUrl) return null;
  return (
    <>
      <div ref={viewportRef} className="absolute inset-0 z-20" {...hoverHandlers} />
      {isHovered && (
        <SpriteSlideshow
          spriteUrl={spriteUrl}
          cols={grid?.cols}
          rows={grid?.rows}
          className="absolute inset-0 z-30 w-full h-full object-cover"
        />
      )}
    </>
  );
}

function GroupCards({ performers }: { performers: Performer[] }) {
  return (
    <div className="flex items-center justify-center [&_svg]:size-full 
      [&:nth-child(1)]:[&_figure]:order-3 
      [&:nth-child(2)]:[&_figure]:order-2 
      [&:nth-child(3)]:[&_figure]:order-4 
      [&:nth-child(4)]:[&_figure]:order-1 
      [&:nth-child(5)]:[&_figure]:order-5 
      [&_figure]:[box-shadow:#0000001f_0_1px_3px,#0000003d_0_0_1px] 
      [&_figure]:[transition:all_.25s_ease] 
      hover:[&_figure]:z-[50] 
      hover:[&_figure]:size-16 
      [&:hover_figure:not(:hover)]:size-[38px]">
      {performers.map((p) => (
        <Link
          key={p.username}
          href={`/performers/${p.username}`}
          className="relative group w-full h-full"
          onMouseEnter={() => prefetchRoute("/performers")}
          onFocus={() => prefetchRoute("/performers")}
        >
          <figure className="flex items-center justify-center text-xl font-bold leading-none text-muted-foreground p-3 bg-card relative rounded-full object-cover border border-border/80 
            [&:where(:nth-child(4),_:nth-child(5))]:size-8 
            [&:where(:nth-child(4),_:nth-child(5))]:z-[3] 
            [&:where(:nth-child(2),_:nth-child(3))]:size-11 
            [&:where(:nth-child(2),_:nth-child(3))]:z-[4] 
            [&:nth-child(1)]:size-16 
            [&:nth-child(1)]:z-[6] 
            [&:where(:not(:nth-child(4)))]:-ml-2 
            cursor-pointer
            transition-transform duration-200
            group-hover:z-10
            group-hover:scale-105">
            {p.username.charAt(0).toUpperCase()}
          </figure>
        </Link>
      ))}
    </div>
  );
}

/**
 * Ordered candidate images for a performer card. The API sends
 * `fallback_images` — the chosen thumbnail, its mirrors on other hosts, then
 * the sprite. Cards walk the chain on load failure so an image shows whenever
 * the performer has any reachable copy (e.g. catbox primary blocked → pixhost
 * mirror loads). Older clients fall back to [thumbnail, sprite].
 */
function usePerformerImageCandidates(performer: Performer) {
  const candidates = useMemo(() => {
    const raw =
      performer.fallback_images && performer.fallback_images.length > 0
        ? performer.fallback_images
        : [performer.latest_thumbnail, performer.sprite_url];
    return raw
      .map((u) => proxyUrl(u))
      .filter((u): u is string => !!u);
  }, [performer.fallback_images, performer.latest_thumbnail, performer.sprite_url]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
  }, [performer.username]);
  const imageUrl = candidates[Math.min(index, candidates.length - 1)] ?? null;
  const onImageError = () => {
    if (index + 1 < candidates.length) setIndex((i) => i + 1);
  };
  return { imageUrl, onImageError };
}

function CircleCard({ performer, fetchPriority }: { performer: Performer; fetchPriority: "high" | "low" | "auto" }) {
  const initial = performer.username.charAt(0).toUpperCase();
  const { imageUrl, onImageError } = usePerformerImageCandidates(performer);
  return (
    <Link href={`/performers/${performer.username}`} className="group block outline-none w-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-full"
      onMouseEnter={() => prefetchRoute("/performers")}
      onFocus={() => prefetchRoute("/performers")}
    >
      <div className="flex flex-col items-center gap-2.5">
        {/* Circle container — fixed size, centered via grid justify-items-center */}
        <div className="relative w-[72px] h-[72px] sm:w-[82px] sm:h-[82px] shrink-0">
          <div className="relative w-full h-full rounded-full overflow-hidden ring-1 ring-border/50 group-hover:ring-primary/60 shadow-xs transition-all duration-200 ease-out group-hover:scale-[1.04]">
            {imageUrl ? (
              <OptimizedImage
                src={imageUrl}
                alt={performer.username}
                fetchPriority={fetchPriority}
                width="avatar"
                className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
                containerClassName="w-full h-full"
                onError={onImageError}
              />
            ) : (
              <div className="w-full h-full bg-secondary flex items-center justify-center">
                <span className="text-base font-bold text-muted-foreground/40">{initial}</span>
              </div>
            )}
          </div>
        </div>
        <div className="text-center min-w-0 w-[90px]">
          <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors duration-150">
            {performer.username}
          </p>
          <p className="text-[10px] text-muted-foreground/60 tabular-nums mt-0.5">
            {performer.recording_count ?? 0}
          </p>
        </div>
      </div>
    </Link>
  );
}

export const PerformerCard = memo(function PerformerCard({ performer, performers, fetchPriority = "low", variant = "square" }: PerformerCardProps) {
  if (performers && performers.length > 0) {
    return <GroupCards performers={performers} />;
  }

  if (!performer) return null;

  if (variant === "circle") {
    return <CircleCard performer={performer} fetchPriority={fetchPriority} />;
  }

  return <SquareCard performer={performer} fetchPriority={fetchPriority} />;
});

const SquareCard = memo(function SquareCard({ performer, fetchPriority }: { performer: Performer; fetchPriority: "high" | "low" | "auto" }) {
  const { imageUrl, onImageError } = usePerformerImageCandidates(performer);
  const initial = useMemo(() => performer.username.charAt(0).toUpperCase(), [performer.username]);
  const recCount = performer.recording_count ?? 0;

  return (
    <Link href={`/performers/${performer.username}`} className="group block outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
      onMouseEnter={() => prefetchRoute("/performers")}
      onFocus={() => prefetchRoute("/performers")}
    >
      <div className="relative overflow-hidden rounded-xl bg-card border border-border/40 hover:border-border/80 will-change-transform
        transition-all duration-200 ease-out
        group-hover:-translate-y-0.5
        group-hover:shadow-md"
      >
        <div className="relative aspect-[3/4] overflow-hidden">
          {imageUrl ? (
            <OptimizedImage
              src={imageUrl}
              alt={performer.username}
              fetchPriority={fetchPriority}
              width="thumb"
              className="object-cover object-top"
              containerClassName="absolute inset-0 w-full h-full"
              fallback={<ImageUnavailable initials={initial} />}
              noShimmer
              onError={onImageError}
            />
          ) : (
            <ImageUnavailable initials={initial} />
          )}

          <SpriteHover performer={performer} />

          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pt-14 pb-3 px-3">
            <p className="text-[13px] font-semibold text-white leading-tight truncate">
              {performer.username}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] font-medium text-white/70 tabular-nums">
                {recCount === 1 ? "1 recording" : `${formatCount(recCount)} recordings`}
              </span>
            </div>
          </div>

          <PlatformBadge username={performer.username} variant="pill" className="absolute top-2 left-2 z-30" />

          {recCount > 0 && (
            <div className="absolute top-2 right-2">
              <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-md
                bg-black/60 backdrop-blur-md ring-1 ring-white/10
                text-[10px] font-semibold text-white tabular-nums">
                {formatCount(recCount)}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
});
