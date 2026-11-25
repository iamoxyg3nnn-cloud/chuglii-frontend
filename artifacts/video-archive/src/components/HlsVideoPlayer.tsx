import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { VideoPlayer, type VideoQualityOption } from "./VideoPlayer";

interface HlsVideoPlayerProps {
  /** Ordered proxied manifest URLs; fails over on fatal errors. */
  candidates: string[];
  poster?: string;
  title?: string;
  autoPlay?: boolean;
  /** Fired when every candidate failed — parent should fall back. */
  onExhausted?: () => void;
 }

const AUTO = "hls:auto";
const levelTag = (idx: number) => `hls:level:${idx}`;
const parseLevel = (url: string): number | null => {
  if (url === AUTO) return -1;
  const m = url.match(/^hls:level:(-?\d+)$/);
  return m ? Number(m[1]) : null;
};

/**
 * Plays HLS (m3u8) streams inside the app's native VideoPlayer by attaching
 * hls.js (MSE) to the underlying <video> element. Quality levels from the
 * manifest are surfaced through VideoPlayer's quality menu; fatal network
 * errors fail over to the next candidate URL (preserving position) and
 * onExhausted lets the parent fall back to the iframe edge player.
 */
export function HlsVideoPlayer({
  candidates,
  poster,
  title,
  autoPlay = true,
  onExhausted,
}: HlsVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const candidateIdxRef = useRef(0);
  const retriesRef = useRef(0);
  const exhaustedRef = useRef(false);
  const [levels, setLevels] = useState<VideoQualityOption[]>([]);
  const [activeLevel, setActiveLevel] = useState<string>(AUTO);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        /* already destroyed */
      }
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || candidates.length === 0) return;
    exhaustedRef.current = false;
    candidateIdxRef.current = 0;
    retriesRef.current = 0;
    setLevels([]);
    setActiveLevel(AUTO);

    const tryNextCandidate = (keepTime: boolean) => {
      const next = candidateIdxRef.current + 1;
      if (next >= candidates.length) {
        if (!exhaustedRef.current) {
          exhaustedRef.current = true;
          destroyHls();
          onExhausted?.();
        }
        return;
      }
      candidateIdxRef.current = next;
      retriesRef.current = 0;
      const t = keepTime ? video.currentTime || 0 : 0;
      loadCandidate(next, t);
    };

    const loadCandidate = (idx: number, resumeAt: number) => {
      destroyHls();
      if (!Hls.isSupported()) {
        // Native HLS (Safari/iOS): direct src on the video element.
        video.src = candidates[idx];
        video.addEventListener(
          "loadedmetadata",
          () => {
            if (resumeAt > 0) {
              try {
                video.currentTime = resumeAt;
              } catch {
                /* seek before data */
              }
            }
            video.play().catch(() => {});
          },
          { once: true },
        );
        return;
      }
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.FRAG_LOADED, () => {
        retriesRef.current = 0;
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        retriesRef.current = 0;
        const parsed = (hls.levels || [])
          .map((lvl, idx) => ({
            idx,
            height: lvl.height || 0,
            bitrate: lvl.bitrate || 0,
          }))
          .sort((a, b) =>
            b.height !== a.height ? b.height - a.height : b.bitrate - a.bitrate,
          );
        if (parsed.length > 1) {
          setLevels([
            { url: AUTO, label: "Auto (Best)" },
            ...parsed.map((item) => {
              let label = item.height ? `${item.height}p` : `Level ${item.idx + 1}`;
              if (item.height >= 1080) label += " Full HD";
              else if (item.height >= 720) label += " HD";
              return { url: levelTag(item.idx), label };
            }),
          ]);
        }
        hls.currentLevel = -1; // adaptive start
        if (resumeAt > 0) {
          try {
            video.currentTime = resumeAt;
          } catch {
            /* seek before data */
          }
        }
        if (autoPlay) {
          video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => {});
          });
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        setActiveLevel((current) =>
          current === AUTO ? current : levelTag(data.level),
        );
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retriesRef.current < 2) {
          retriesRef.current += 1;
          try {
            hls.startLoad();
          } catch {
            tryNextCandidate(true);
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError();
          } catch {
            tryNextCandidate(true);
          }
        } else {
          tryNextCandidate(true);
        }
      });

      hls.loadSource(candidates[idx]);
      hls.attachMedia(video);
    };

    loadCandidate(0, 0);

    return () => {
      destroyHls();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  const handleQualityChange = useCallback((url: string) => {
    const level = parseLevel(url);
    if (level === null || !hlsRef.current) return;
    hlsRef.current.currentLevel = level;
    setActiveLevel(url);
  }, []);

  const handleAutoDowngrade = useCallback(() => {
    const hls = hlsRef.current;
    if (!hls || hls.currentLevel <= 0) return;
    // Step one rendition down from the current locked level.
    hls.currentLevel = hls.currentLevel - 1;
    setActiveLevel(levelTag(hls.currentLevel));
  }, []);

  const handleError = useCallback(() => {
    // Native-path (Safari) errors: fail over to the next candidate.
    if (!hlsRef.current) {
      const video = videoRef.current;
      const next = candidateIdxRef.current + 1;
      if (next < candidates.length && video) {
        candidateIdxRef.current = next;
        video.src = candidates[next];
        video.play().catch(() => {});
      } else if (!exhaustedRef.current) {
        exhaustedRef.current = true;
        onExhausted?.();
      }
    }
  }, [candidates, onExhausted]);

  return (
    <VideoPlayer
      poster={poster}
      title={title}
      autoPlay={autoPlay}
      startMuted={autoPlay}
      qualities={levels}
      activeQualityUrl={activeLevel}
      onQualityChange={handleQualityChange}
      onAutoDowngrade={handleAutoDowngrade}
      onError={handleError}
      videoRef={videoRef}
      previewCandidates={candidates}
    />
  );
}
