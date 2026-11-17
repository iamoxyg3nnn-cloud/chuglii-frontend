import { memo } from "react";
import { cn } from "@/lib/utils";
import { getRecordingPlatform } from "@/lib/platform";

export interface PlatformBadgeProps {
  site?: string | null;
  username?: string | null;
  recording?: { username?: string | null; site?: string | null } | null;
  className?: string;
  variant?: "simple" | "pill" | "subtle" | "dot-only";
}

export const PlatformBadge = memo(function PlatformBadge({
  site,
  username,
  recording,
  className,
  variant = "simple",
}: PlatformBadgeProps) {
  const targetSite = site ?? recording?.site;
  const targetUsername = username ?? recording?.username;
  const platform = getRecordingPlatform({ site: targetSite, username: targetUsername });
  const isStripchat = platform === "stripchat";
  const label = isStripchat ? "Stripchat" : "Chaturbate";

  if (variant === "simple") {
    return (
      <span
        className={cn("text-muted-foreground/75 font-normal truncate", className)}
        title={`Recorded from ${label}`}
      >
        {label}
      </span>
    );
  }

  if (variant === "dot-only") {
    return (
      <span
        className={cn(
          "inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-muted-foreground/60",
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
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground/75 font-normal tabular-nums",
          className
        )}
        title={`Recorded from ${label}`}
      >
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-md ring-1 ring-white/10 text-white/80 pointer-events-none select-none",
        className
      )}
      title={`Recorded from ${label}`}
      aria-label={`Recorded from ${label}`}
    >
      <span>{label}</span>
    </span>
  );
});
