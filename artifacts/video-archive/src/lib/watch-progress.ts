export interface PreviousWatchProgress {
  progress?: number | null;
  total_watch_ms?: number | null;
}

export interface WatchProgressSnapshot {
  progress: number;
  totalWatchMs: number;
}

/**
 * Merge this active session with the viewer's previous history. Progress is
 * monotonic, while total watch time remains cumulative across sessions.
 */
export function mergeWatchProgress(
  previous: PreviousWatchProgress,
  sessionWatchMs: number,
  durationMs: number,
): WatchProgressSnapshot {
  const priorTotal = Number.isFinite(previous.total_watch_ms)
    ? Math.max(0, previous.total_watch_ms ?? 0)
    : 0;
  const session = Number.isFinite(sessionWatchMs) ? Math.max(0, sessionWatchMs) : 0;
  const totalWatchMs = priorTotal + session;
  const priorProgress = Number.isFinite(previous.progress)
    ? Math.min(100, Math.max(0, previous.progress ?? 0))
    : 0;
  const estimatedProgress = durationMs > 0
    ? Math.min(100, Math.round((totalWatchMs / durationMs) * 100))
    : priorProgress;

  return {
    progress: Math.max(priorProgress, estimatedProgress),
    totalWatchMs,
  };
}
