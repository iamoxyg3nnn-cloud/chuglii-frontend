import { useEffect, useRef, useState } from "react";
import { Play, X, FilmStrip } from "@phosphor-icons/react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { proxyUrl } from "@/lib/proxy-url";
import { formatDuration } from "@/lib/formatters";
import { upNextTiming, secondsUntil, UP_NEXT_TICK_MS, UP_NEXT_LEAD_SECONDS } from "@/lib/up-next";
import { type QueueItem } from "@/lib/play-queue";
import { cn } from "@/lib/utils";

interface UpNextOverlayProps {
  /** The queued or recommended recording that plays when the countdown reaches zero. */
  next: QueueItem;
  /** Current recording length in seconds (`video.duration`) — the clock available. */
  durationSeconds: number;
  /** Whether to automatically navigate when countdown hits 0 (defaults to true). */
  autoplay?: boolean;
  /** Advance to `next` (navigates, scrolls to top, tracks). */
  onPlayNow: () => void;
}

/**
 * Countdown card shown over iframe-hosted players near the end of a queued
 * video. Cross-origin `ended` is unobservable, so the schedule comes from the
 * metadata duration (see lib/up-next.ts) — an estimate by nature.
 *
 * Controls: "Play now" advances immediately; the X cancels the countdown AND
 * the auto-advance entirely (the QueueBar below the player stays as the manual
 * path). Unknown duration → never renders.
 *
 * Positioned top-right so it never covers the host's playback controls along
 * the bottom edge, and sits above the site's own fullscreen button (z-20 vs
 * z-10) while visible.
 */
export function UpNextOverlay({ next, durationSeconds, autoplay = true, onPlayNow }: UpNextOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [cancelled, setCancelled] = useState(false);

  // Keep the latest callback without restarting the countdown on re-renders.
  const playRef = useRef(onPlayNow);
  useEffect(() => {
    playRef.current = onPlayNow;
  }, [onPlayNow]);

  useEffect(() => {
    if (cancelled) return;
    const timing = upNextTiming(durationSeconds);
    if (!timing) return; // unknown duration → overlay never shows
    const iv = setInterval(() => {
      const now = Date.now();
      if (now >= timing.endsAt) {
        clearInterval(iv); // never double-fire before unmount
        setVisible(false);
        if (autoplay) {
          playRef.current();
        }
        return;
      }
      if (now >= timing.showAt) {
        setVisible(true);
        setRemaining(secondsUntil(timing.endsAt, now));
      }
    }, UP_NEXT_TICK_MS);
    return () => clearInterval(iv);
  }, [cancelled, durationSeconds, autoplay]);

  if (!visible || cancelled) return null;

  const thumb = next.thumbnail_url ? proxyUrl(next.thumbnail_url) : null;
  const subtitle = next.room_title && next.room_title !== next.username ? next.room_title : null;
  const imminent = remaining <= 3;
  const progressPercent = Math.min(100, Math.max(0, ((UP_NEXT_LEAD_SECONDS - remaining) / UP_NEXT_LEAD_SECONDS) * 100));

  return (
    <div
      className="absolute top-3 right-3 z-30 w-[250px] sm:w-68 max-w-[calc(100%-1.5rem)] animate-in fade-in slide-in-from-top-2 duration-300"
      aria-label="Up next"
    >
      <div className="rounded-xl border border-primary/50 bg-black/90 backdrop-blur-md overflow-hidden shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-1.5">
            {autoplay && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              {autoplay ? "Autoplay Next" : "Up Next"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-[11px] font-bold tabular-nums font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/10",
                imminent ? "text-primary border-primary/50 animate-pulse" : "text-white/80",
              )}
            >
              {formatDuration(Math.max(remaining, 0))}
            </span>
            <button
              onClick={() => setCancelled(true)}
              aria-label="Cancel up next"
              title="Cancel autoplay"
              className="w-5 h-5 flex items-center justify-center rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X size={13} weight="bold" />
            </button>
          </div>
        </div>

        {/* Dynamic countdown progress bar */}
        {autoplay && (
          <div className="h-0.5 w-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-linear"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        <div className="flex gap-2.5 p-2.5">
          {thumb ? (
            <OptimizedImage
              src={thumb}
              alt=""
              width="thumb"
              className="w-28 h-16 object-cover rounded-[3px]"
              containerClassName="w-28 h-16 rounded-[3px] shrink-0"
              fallback={
                <div className="w-28 h-16 bg-secondary rounded-[3px] flex items-center justify-center shrink-0">
                  <FilmStrip size={20} weight="duotone" className="text-white/30" />
                </div>
              }
            />
          ) : (
            <div className="w-28 h-16 bg-secondary rounded-[3px] flex items-center justify-center shrink-0">
              <FilmStrip size={20} weight="duotone" className="text-white/30" />
            </div>
          )}
          <div className="min-w-0 flex-1 self-center">
            <p className="text-xs font-semibold text-white truncate">{next.username}</p>
            {subtitle && (
              <p className="text-[10px] text-white/50 truncate mt-0.5">{subtitle}</p>
            )}
            {next.duration != null && next.duration > 0 && (
              <p className="text-[10px] text-white/40 mt-1 tabular-nums">
                {formatDuration(next.duration)}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={() => playRef.current()}
          className="w-full flex items-center justify-center gap-1.5 h-8 text-xs font-semibold border-t border-white/10 text-primary hover:bg-primary/15 transition-colors"
        >
          <Play size={14} weight="fill" />
          Play now
        </button>
      </div>
    </div>
  );
}
