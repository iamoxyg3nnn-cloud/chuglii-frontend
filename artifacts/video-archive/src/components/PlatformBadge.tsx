import { memo } from "react";
import { cn } from "@/lib/utils";
import { getRecordingPlatform } from "@/lib/platform";

export interface PlatformBadgeProps {
  site?: string | null;
  username?: string | null;
  recording?: { username?: string | null; site?: string | null } | null;
  className?: string;
  variant?: "pill" | "subtle" | "dot-only";
}

export const PlatformBadge = memo(function PlatformBadge({
  site,
  username,
  recording,
  className,
  variant = "pill",
}: PlatformBadgeProps) {
  const targetSite = site ?? recording?.site;
  const targetUsername = username ?? recording?.username;
  const platform = getRecordingPlatform({ site: targetSite, username: targetUsername });
  const isStripchat = platform === "stripchat";
  const label = isStripchat ? "Stripchat" : "Chaturbate";

  if (variant === "dot-only") {
    return (
      <span
        className={cn(
          "inline-block w-2 h-2 rounded-full ring-2 ring-black/40 shrink-0",
          isStripchat ? "bg-rose-500" : "bg-amber-500",
          className
        )}
        title={`Recorded from ${label}`}
        aria-label={`Recorded from ${label}`}
      />
    );
  }

  if (variant === "subtle") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium tabular-nums",
          isStripchat ? "text-rose-300" : "text-amber-300",
          className
        )}
        title={`Recorded from ${label}`}
      >
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            isStripchat
              ? "bg-rose-400 shadow-[0_0_4px_rgba(244,63,94,0.6)]"
              : "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.6)]"
          )}
        />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md backdrop-blur-md ring-1 shadow-xs pointer-events-none select-none",
        isStripchat
          ? "bg-black/75 text-rose-300 ring-rose-500/40 border border-rose-500/20"
          : "bg-black/75 text-amber-300 ring-amber-500/40 border border-amber-500/20",
        className
      )}
      title={`Recorded from ${label}`}
      aria-label={`Recorded from ${label}`}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          isStripchat
            ? "bg-rose-400 shadow-[0_0_5px_rgba(244,63,94,0.7)]"
            : "bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.7)]"
        )}
      />
      <span>{label}</span>
    </span>
  );
});
