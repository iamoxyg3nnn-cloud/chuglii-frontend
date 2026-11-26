import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { VideoPlayer, type VideoQualityOption } from "./VideoPlayer";

interface HlsVideoPlayerProps {
  /** Ordered proxied manifest URLs; fails over on fatal errors. */
  candidates: string[];
  poster?: string;
  title?: string;
  autoPlay?: boolean;
  /** Quality label from the DB probe (e.g. "660p") used when the manifest
   *  carries no RESOLUTION attribute (single-rendition playlists). */
  sourceQualityLabel?: string;
  /** Fired when every candidate failed — parent should fall back. */
  onExhausted?: () => void;
  /** Page-declared live mode (e.g. the sstp fake-live VOD loops). Combined
   *  with manifest-level live detection: either one turns on live UI. */
  live?: boolean;
  /** Seek here as soon as the manifest is parsed (used when hot-swapping
   *  to the remuxed source mid-view so the playhead doesn't jump to 0). */
  startAt?: number;
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
  sourceQualityLabel,
  onExhausted,
  live,
  startAt,
}: HlsVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const candidateIdxRef = useRef(0);
  const retriesRef = useRef(0);
  const exhaustedRef = useRef(false);
  const [levels, setLevels] = useState<VideoQualityOption[]>([]);
  const [activeLevel, setActiveLevel] = useState<string>(AUTO);
  const [manifestLive, setManifestLive] = useState(false);

  // ── Stall watchdog ────────────────────────────────────────────────────────
  // The upstream segmenter emits some fragments with NO audio track (verified:
  // ~25% of fragments in a sample stream are video-only). When hls.js appends
  // those, the audio SourceBuffer develops a hole while the video buffer keeps
  // growing. The <video> element needs data in EVERY track at the playhead, so
  // playback freezes at the hole and hls.js deadlocks in IDLE (it considers the
  // fragments already buffered and refuses to reload them).
  //
  // Recovery: when the playhead is stuck but at least one SourceBuffer has data
  // well ahead of it (the audio-hole signature — a pure slow-network stall has
  // NO data ahead), seek to the nearest position covered by ALL SourceBuffers,
  // falling back to the furthest buffered position. hls.js then loads/appends
  // around the new position and playback resumes (silent while the source has
  // no audio — the upstream simply lost it).
  const stallRef = useRef({ lastTime: 0, lastProgressAt: 0, jumps: 0 });
  const watchdogRef = useRef<number | null>(null);

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
    setManifestLive(false);

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
        // The upstream segment CDN is slow (~0.15 MB/s measured), so buffer
        // aggressively ahead: 90s guaranteed, up to 120MB / 600s. Segments are
        // low-bitrate (~0.5 Mbps), so this is only a few MB of memory and it
        // rides out origin stalls that would otherwise rebuffer.
        maxBufferLength: 90,
        maxMaxBufferLength: 600,
        maxBufferSize: 120 * 1000 * 1000,
        // Start fetching the first fragment while the manifest is still
        // parsing — shaves ~one round-trip off time-to-first-frame.
        startFragPrefetch: true,
        // Live manifests report duration=Infinity instead of the sliding
        // window length, so the UI can tell live from VOD.
        liveDurationInfinity: true,
      });
      hlsRef.current = hls;
      // Debug handle: lets devtools/console inspect buffer state, levels and
      // events of the live player (harmless in production).
      (window as unknown as { __hls?: unknown }).__hls = hls;

      hls.on(Hls.Events.FRAG_LOADED, () => {
        retriesRef.current = 0;
      });

      // Stall watchdog — see the comment above stallRef for the full story.
      const stall = stallRef.current;
      stall.lastTime = 0;
      stall.lastProgressAt = Date.now();
      stall.jumps = 0;
      const watchdog = window.setInterval(() => {
        const v = videoRef.current;
        const h = hlsRef.current;
        if (!v || !h || v.paused || v.ended) return;
        const now = Date.now();
        if (v.readyState >= 3 && v.currentTime > stall.lastTime + 0.2) {
          // healthy progress
          stall.lastTime = v.currentTime;
          stall.lastProgressAt = now;
          stall.jumps = 0;
          return;
        }
        if (v.readyState >= 3) {
          // playing but not advancing much yet — give it time
          return;
        }
        if (now - stall.lastProgressAt < 3500) return;
        // Stalled. Decide whether it's an audio-hole (data exists ahead in
        // some SourceBuffers) or plain network buffering (no data ahead).
        const ms = (h as unknown as { bufferController?: { mediaSource?: MediaSource | null } })
          .bufferController?.mediaSource ?? null;
        const sbs: SourceBuffer[] = ms ? Array.from(ms.sourceBuffers) : [];
        if (sbs.length === 0) return;
        const covers = (sb: SourceBuffer, t: number): boolean => {
          for (let i = 0; i < sb.buffered.length; i++) {
            if (sb.buffered.start(i) - 0.05 <= t && t <= sb.buffered.end(i) - 0.05) return true;
          }
          return false;
        };
        const maxEnd = Math.max(...sbs.map((sb) => {
          let e = 0;
          for (let i = 0; i < sb.buffered.length; i++) e = Math.max(e, sb.buffered.end(i));
          return e;
        }));
        const t = v.currentTime + 0.5;
        const allCoverAhead = sbs.every((sb) => covers(sb, t));
        if (allCoverAhead) return; // data ahead everywhere — not a hole; let hls.js work
        if (maxEnd < v.currentTime + 2) return; // nothing ahead — genuine buffering, wait
        // Find the nearest position > currentTime covered by ALL SourceBuffers.
        let target = maxEnd + 0.25;
        const candidates: number[] = [];
        for (const sb of sbs) {
          for (let i = 0; i < sb.buffered.length; i++) {
            const s = sb.buffered.start(i);
            if (s > v.currentTime + 0.5) candidates.push(s);
          }
        }
        for (const c of candidates.sort((a, b) => a - b)) {
          if (sbs.every((sb) => covers(sb, c))) {
            target = c + 0.1;
            break;
          }
        }
        if (stall.jumps >= 30 || target >= (isFinite(v.duration) ? v.duration - 1 : Infinity)) return;
        stall.jumps += 1;
        stall.lastProgressAt = now;
        try {
          v.currentTime = target;
        } catch {
          /* seek before data */
        }
      }, 1000);
      watchdogRef.current = watchdog;

      // Build the quality list from manifest levels. hls.js only knows real
      // heights after the first fragments are parsed, so (re)build on
      // LEVEL_UPDATED too.
      const buildLevels = () => {
        const parsed = (hls.levels || [])
          .map((lvl, idx) => ({
            idx,
            height: lvl.height || 0,
            bitrate: lvl.bitrate || 0,
          }))
          .sort((a, b) =>
            b.height !== a.height ? b.height - a.height : b.bitrate - a.bitrate,
          );
        if (!parsed.length) return;
        const options: VideoQualityOption[] = parsed.length > 1
          ? [
              { url: AUTO, label: "Auto (Best)" },
              ...parsed.map((item) => {
                let label = item.height ? `${item.height}p` : `Level ${item.idx + 1}`;
                if (item.height >= 1080) label += " Full HD";
                else if (item.height >= 720) label += " HD";
                return { url: levelTag(item.idx), label };
              }),
            ]
          : [{ url: levelTag(parsed[0].idx), label: parsed[0].height ? `${parsed[0].height}p` : (sourceQualityLabel || "Source") }];
        setLevels((prev) => (JSON.stringify(prev) === JSON.stringify(options) ? prev : options));
      };
      hls.on(Hls.Events.MANIFEST_PARSED, buildLevels);
      hls.on(Hls.Events.LEVEL_UPDATED, buildLevels);

      // Live detection: hls.js marks playlist details as live for EVENT /
      // sliding-window manifests (no #EXT-X-ENDLIST).
      const detectLive = () => {
        const details = hls.levels[hls.currentLevel]?.details ?? hls.levels[0]?.details;
        if (details) setManifestLive(!!details.live);
      };
      hls.on(Hls.Events.MANIFEST_PARSED, detectLive);
      hls.on(Hls.Events.LEVEL_UPDATED, detectLive);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        retriesRef.current = 0;
        hls.currentLevel = -1; // adaptive start
        const seekTo = resumeAt > 0 ? resumeAt : (startAt && startAt > 1 ? startAt : 0);
        if (seekTo > 0) {
          try {
            video.currentTime = seekTo;
          } catch {
            /* seek before data */
          }
        } else if (live) {
          // The upstream "live" streams are VOD loops. To make them behave
          // like a real surveillance feed, join at the CURRENT BROADCAST
          // POSITION of the loop — derived from the wall clock so every
          // viewer (and every visit) sees the same advancing "now" moment
          // instead of the recording restarting at 0:00 every time.
          // Join 10s BEHIND the live edge (like real live players) so there
          // is always buffered content to play immediately.
          const dur = hls.levels[0]?.details?.totalduration ?? 0;
          if (dur > 120) {
            try {
              const pos = ((Date.now() / 1000) % dur) - 10;
              video.currentTime = Math.max(0, pos);
            } catch {
              /* seek before data */
            }
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
      if (watchdogRef.current !== null) window.clearInterval(watchdogRef.current);
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

  const isLive = !!live || manifestLive;

  // Fake-live VOD loops (finite duration): restart at the end, exactly like
  // the source site's player. For true live (Infinity duration) loop is a
  // harmless no-op.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.loop = isLive;
  }, [isLive]);

  // Jump back to the live edge (true live only — for VOD-as-live the loop
  // already keeps viewers at the newest content).
  const handleGoLive = useCallback(() => {
    const hls = hlsRef.current;
    const video = videoRef.current;
    if (!hls || !video || !manifestLive) return;
    const edge = hls.liveSyncPosition;
    if (edge != null && Number.isFinite(edge)) {
      video.currentTime = edge;
    } else if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.max(0, video.duration - 2);
    }
    video.play().catch(() => {});
  }, [manifestLive]);

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
      live={isLive}
      onGoLive={manifestLive ? handleGoLive : undefined}
    />
  );
}
