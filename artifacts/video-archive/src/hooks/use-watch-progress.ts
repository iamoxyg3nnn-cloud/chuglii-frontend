import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, recordingToMeta } from "@/lib/user-api";
import { mergeWatchProgress } from "@/lib/watch-progress";
import type { Recording } from "@/lib/api";

interface WatchProgressOptions {
  video: Recording | null | undefined;
  /** Estimated duration in seconds (from metadata). If null, uses a default. */
  durationSeconds?: number | null;
  /** True only after the user starts an in-page player. */
  isActive: boolean;
}

/**
 * Tracks estimated watch time only while an in-page player has been started
 * and the document is visible. Cross-origin embeds do not expose play/pause or
 * seek events, so this is an active-session estimate, not exact media position.
 *
 * Existing history is loaded before tracking starts so a new session can never
 * overwrite a viewer's previously saved progress with a smaller percentage.
 */
export function useWatchProgress({ video, durationSeconds, isActive }: WatchProgressOptions) {
  const { user } = useAuth();
  const sessionWatchMsRef = useRef(0);
  const priorTotalWatchMsRef = useRef(0);
  const maxProgressRef = useRef(0);
  const lastActiveAtRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);
  const estimatedDurationMs = Math.max(1, (durationSeconds ?? 600) * 1000);

  useEffect(() => {
    sessionWatchMsRef.current = 0;
    priorTotalWatchMsRef.current = 0;
    maxProgressRef.current = 0;
    lastActiveAtRef.current = null;
  }, [video?.id]);

  const syncProgress = useCallback(() => {
    if (!video?.id || !user) return;
    const now = Date.now();
    if (lastActiveAtRef.current !== null) {
      sessionWatchMsRef.current += Math.max(0, now - lastActiveAtRef.current);
      lastActiveAtRef.current = now;
    }
    // Do not create empty history entries if the player was never started.
    if (sessionWatchMsRef.current <= 0) return;

    const snapshot = mergeWatchProgress(
      {
        progress: maxProgressRef.current,
        total_watch_ms: priorTotalWatchMsRef.current,
      },
      sessionWatchMsRef.current,
      estimatedDurationMs,
    );
    maxProgressRef.current = snapshot.progress;

    const meta = {
      id: video.id,
      username: video.username,
      filename: video.filename,
      room_title: video.room_title,
      thumbnail_url: video.thumbnail_url,
      preview_url: video.preview_url,
      sprite_url: video.sprite_url,
      resolution: video.resolution,
      timestamp: video.timestamp,
      saved_at: new Date().toISOString(),
    };

    userApi
      .updateHistoryProgress(
        video.id,
        snapshot.progress,
        sessionWatchMsRef.current,
        snapshot.totalWatchMs,
      )
      .catch(() => {
        userApi.addHistory(video.id, recordingToMeta(meta)).catch(() => {});
      });
  }, [video, user, estimatedDurationMs]);

  useEffect(() => {
    if (!video?.id || !user || !isActive) {
      lastActiveAtRef.current = null;
      return;
    }

    let cancelled = false;
    let interval: number | undefined;
    unmountedRef.current = false;

    const onVisibility = () => {
      if (document.hidden) {
        syncProgress();
        lastActiveAtRef.current = null;
      } else if (!unmountedRef.current) {
        lastActiveAtRef.current = Date.now();
      }
    };
    const onPageHide = () => {
      syncProgress();
      lastActiveAtRef.current = null;
    };
    const onPageShow = () => {
      if (!document.hidden && !unmountedRef.current) {
        lastActiveAtRef.current = Date.now();
      }
    };

    const beginTracking = async () => {
      // Seed from the existing row before the first write. This preserves
      // cumulative watch time and prevents progress from moving backwards.
      try {
        const history = await userApi.getHistory();
        if (cancelled) return;
        const previous = history.find((item) => item.recording_id === video.id);
        priorTotalWatchMsRef.current = Math.max(0, previous?.total_watch_ms ?? 0);
        maxProgressRef.current = Math.min(100, Math.max(0, previous?.progress ?? 0));
      } catch {
        // Do not risk overwriting existing progress when its current value
        // could not be loaded. A later page visit can retry the history read.
        return;
      }
      if (cancelled) return;

      lastActiveAtRef.current = document.hidden ? null : Date.now();
      interval = window.setInterval(() => {
        if (!document.hidden) syncProgress();
      }, 15_000);
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("pageshow", onPageShow);
    };

    void beginTracking();

    return () => {
      cancelled = true;
      unmountedRef.current = true;
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      syncProgress();
      lastActiveAtRef.current = null;
    };
  }, [video?.id, user, isActive, syncProgress]);
}
