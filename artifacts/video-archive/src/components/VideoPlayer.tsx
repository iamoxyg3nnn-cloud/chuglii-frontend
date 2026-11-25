import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import {
  Play,
  Pause,
  SpeakerHigh,
  SpeakerLow,
  SpeakerSlash,
  CornersOut,
  CornersIn,
  PictureInPicture,
  GearSix,
  ArrowClockwise,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";

export interface VideoQualityOption {
  url: string;
  label: string;
}

export interface VideoProgressState {
  currentTime: number;
  duration: number;
  playing: boolean;
}

interface VideoPlayerProps {
  src: string;
  poster?: string;
  title?: string;
  autoPlay?: boolean;
  /** Autoplay is muted by default so browsers do not block it. */
  startMuted?: boolean;
  qualities?: VideoQualityOption[];
  activeQualityUrl?: string;
  onQualityChange?: (url: string) => void;
  onError?: (detail: { code?: number; message?: string; src: string }) => void;
  onProgress?: (state: VideoProgressState) => void;
  onReload?: () => void;
  onAutoDowngrade?: (fromUrl: string) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  className?: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VideoPlayer({
  src,
  poster,
  title,
  autoPlay = false,
  startMuted = autoPlay,
  qualities = [],
  activeQualityUrl,
  onQualityChange,
  onError,
  onProgress,
  onReload,
  onAutoDowngrade,
  videoRef: externalRef,
  className = "",
}: VideoPlayerProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef || internalRef;
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const onProgressRef = useRef(onProgress);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(startMuted);
  const [needsTap, setNeedsTap] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [stallNotice, setStallNotice] = useState<string | null>(null);
  const stallTimer = useRef<number | null>(null);
  const startupStallTimer = useRef<number | null>(null);
  const lastDowngradeAt = useRef(0);
  const playRequested = useRef(false);
  const lastProgressValue = useRef(0);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) { window.clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);

  const clearNoticeTimer = useCallback(() => {
    if (noticeTimer.current) { window.clearTimeout(noticeTimer.current); noticeTimer.current = null; }
  }, []);

  const showNotice = useCallback((message: string, delay: number) => {
    clearNoticeTimer();
    setStallNotice(message);
    noticeTimer.current = window.setTimeout(() => {
      setStallNotice(null);
      noticeTimer.current = null;
    }, delay);
  }, [clearNoticeTimer]);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (!videoRef.current?.paused) {
      hideTimer.current = window.setTimeout(() => { setShowControls(false); setShowSettings(false); }, 2800);
    }
  }, [clearHideTimer, videoRef]);

  const revealControls = useCallback(() => { setShowControls(true); scheduleHide(); }, [scheduleHide]);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    setError(false); setLoading(true); setPlaying(false); setCurrentTime(0); setDuration(0); setBuffered(0);
    setErrorMessage(null); setStallNotice(null); setNeedsTap(false); setMuted(startMuted);
    if (stallTimer.current) { window.clearTimeout(stallTimer.current); stallTimer.current = null; }
    if (startupStallTimer.current) { window.clearTimeout(startupStallTimer.current); startupStallTimer.current = null; }
    clearNoticeTimer();
    playRequested.current = autoPlay;
    lastProgressValue.current = 0;
  }, [src, autoPlay, startMuted, clearNoticeTimer]);

  useEffect(() => () => {
    if (stallTimer.current) window.clearTimeout(stallTimer.current);
    if (startupStallTimer.current) window.clearTimeout(startupStallTimer.current);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const clearStartupStallTimer = useCallback(() => {
    if (startupStallTimer.current) { window.clearTimeout(startupStallTimer.current); startupStallTimer.current = null; }
  }, []);

  const triggerStartupRecovery = useCallback((reason: string) => {
    const now = Date.now();
    if (now - lastDowngradeAt.current < 12000) return;
    lastDowngradeAt.current = now;
    if (qualities.length > 1 && onAutoDowngrade) {
      showNotice("Slow/blocked stream - trying lower quality...", 4000);
      onAutoDowngrade(activeQualityUrl || src);
      return;
    }
    showNotice(reason, 4000);
    onReload?.();
  }, [activeQualityUrl, onAutoDowngrade, onReload, qualities.length, showNotice, src]);

  const armStartupStallTimer = useCallback((delay = 9000) => {
    clearStartupStallTimer();
    startupStallTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (!v || error) return;
      const noProgress = !Number.isFinite(v.currentTime) || v.currentTime <= 0.1;
      const notReady = v.readyState < 2;
      const noBuffer = !v.buffered.length || v.buffered.end(0) < 0.5;
      if (playRequested.current && (noProgress || notReady || noBuffer)) {
        triggerStartupRecovery("Stream taking too long - retrying...");
      }
    }, delay);
  }, [clearStartupStallTimer, error, triggerStartupRecovery, videoRef]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    if (v.paused || v.ended) {
      playRequested.current = true;
      armStartupStallTimer(9000);
      v.play()
        .then(() => setNeedsTap(false))
        .catch((err: unknown) => {
          if ((err as DOMException)?.name === "NotAllowedError") {
            setNeedsTap(true);
            clearStartupStallTimer();
          }
        });
    } else {
      playRequested.current = false;
      clearStartupStallTimer();
      v.pause();
    }
  }, [armStartupStallTimer, clearStartupStallTimer, videoRef]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    v.muted = !v.muted; setMuted(v.muted);
    if (!v.muted && v.volume === 0) { v.volume = 0.5; setVolume(0.5); }
  }, [videoRef]);

  const changeVolume = useCallback((val: number) => {
    const v = videoRef.current; if (!v) return;
    const next = Math.min(1, Math.max(0, val));
    v.volume = next; v.muted = next === 0; setVolume(next); setMuted(next === 0);
  }, [videoRef]);

  const seek = useCallback((time: number) => {
    const v = videoRef.current; if (!v || !Number.isFinite(time)) return;
    v.currentTime = Math.min(Math.max(0, time), v.duration || time); setCurrentTime(v.currentTime);
  }, [videoRef]);

  const emitProgress = useCallback((playing: boolean) => {
    const v = videoRef.current;
    if (!v) return;
    onProgressRef.current?.({
      currentTime: v.currentTime || 0,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      playing,
    });
  }, [videoRef]);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current; const v = videoRef.current as any; if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (el.requestFullscreen) await el.requestFullscreen();
      else if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen();
    } catch {}
  }, [videoRef]);

  const togglePiP = useCallback(async () => {
    const v = videoRef.current as any; if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (v.requestPictureInPicture) await v.requestPictureInPicture();
    } catch {}
  }, [videoRef]);

  const setRate = useCallback((rate: number) => {
    const v = videoRef.current; if (!v) return;
    v.playbackRate = rate; setPlaybackRate(rate); setShowSettings(false);
  }, [videoRef]);

  const onTimeUpdate = () => {
    const v = videoRef.current; if (!v) return;
    setCurrentTime(v.currentTime);
    emitProgress(!v.paused && !v.ended);
    if (v.buffered.length > 0) { try { setBuffered(v.buffered.end(v.buffered.length - 1)); } catch {} }
    if (v.currentTime > 0.25 || v.readyState >= 3) {
      clearStartupStallTimer();
      playRequested.current = false;
      lastProgressValue.current = v.currentTime;
      setNeedsTap(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button" || tag === "a" || target?.isContentEditable) return;
    switch (e.key.toLowerCase()) {
      case " ": case "k": e.preventDefault(); togglePlay(); break;
      case "arrowleft": case "j": e.preventDefault(); seek((videoRef.current?.currentTime || 0) - 5); revealControls(); break;
      case "arrowright": case "l": e.preventDefault(); seek((videoRef.current?.currentTime || 0) + 5); revealControls(); break;
      case "arrowup": e.preventDefault(); changeVolume(volume + 0.05); revealControls(); break;
      case "arrowdown": e.preventDefault(); changeVolume(volume - 0.05); revealControls(); break;
      case "m": e.preventDefault(); toggleMute(); break;
      case "f": e.preventDefault(); toggleFullscreen(); break;
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const VolumeIcon = muted || volume === 0 ? SpeakerSlash : volume < 0.5 ? SpeakerLow : SpeakerHigh;
  const activeQuality = qualities.find((q) => q.url === (activeQualityUrl || src))?.label || "Quality";

  return (
    <div
      ref={containerRef}
      className={`group/player relative w-full h-full bg-black overflow-hidden select-none outline-none ${className}`}
      onMouseMove={revealControls}
      onMouseLeave={() => { if (playing) { setShowControls(false); setShowSettings(false); } }}
      onTouchStart={revealControls}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={title ? `Video player: ${title}` : "Video player"}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        muted={muted}
        playsInline
        preload="metadata"
        {...({ referrerPolicy: "no-referrer" } as any)}
        className="w-full h-full object-contain"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => { setPlaying(true); emitProgress(true); scheduleHide(); if (playRequested.current) armStartupStallTimer(9000); }}
        onPause={() => { setPlaying(false); emitProgress(false); setShowControls(true); clearHideTimer(); }}
        onEnded={() => { setPlaying(false); emitProgress(false); setShowControls(true); playRequested.current = false; clearStartupStallTimer(); }}
        onTimeUpdate={onTimeUpdate}
        onVolumeChange={() => { const v = videoRef.current; if (v) { setMuted(v.muted); setVolume(v.volume); } }}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onLoadedMetadata={() => { setDuration(videoRef.current?.duration || 0); setLoading(false); }}
        onLoadedData={() => { setLoading(false); if (playRequested.current) armStartupStallTimer(9000); }}
        onWaiting={() => {
          setLoading(true);
          if (stallTimer.current) window.clearTimeout(stallTimer.current);
          stallTimer.current = window.setTimeout(() => {
            const now = Date.now();
            if (now - lastDowngradeAt.current < 8000) return;
            if (qualities.length > 1 && onAutoDowngrade) {
              lastDowngradeAt.current = now;
              showNotice("Slow network - switching to lower quality...", 3500);
              onAutoDowngrade(activeQualityUrl || src);
            } else {
              showNotice("Buffering... slow network detected", 3000);
            }
          }, 2800);
          if (playRequested.current) armStartupStallTimer(9000);
        }}
        onCanPlay={() => { setLoading(false); setError(false); if (stallTimer.current) { window.clearTimeout(stallTimer.current); stallTimer.current = null; } }}
        onPlaying={() => { setLoading(false); emitProgress(true); clearStartupStallTimer(); playRequested.current = false; setNeedsTap(false); if (stallTimer.current) { window.clearTimeout(stallTimer.current); stallTimer.current = null; } }}
        onStalled={() => { setLoading(true); if (playRequested.current) armStartupStallTimer(7000); }}
        onError={() => {
          const v = videoRef.current;
          setLoading(false); setError(true);
          setErrorMessage(v?.error?.message || null);
          clearStartupStallTimer(); clearNoticeTimer();
          playRequested.current = false;
          if (stallTimer.current) { window.clearTimeout(stallTimer.current); stallTimer.current = null; }
          onError?.({ code: v?.error?.code, message: v?.error?.message, src });
        }}
      />

      <div className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 via-black/20 to-transparent transition-opacity duration-300 ${showControls || !playing ? "opacity-100" : "opacity-0"}`} />
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/80 via-black/30 to-transparent transition-opacity duration-300 ${showControls || !playing ? "opacity-100" : "opacity-0"}`} />

      {stallNotice && (
        <div className="absolute left-3 top-14 sm:left-4 sm:top-16 z-20 pointer-events-none">
          <div className="inline-flex items-center gap-2 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 px-3 py-1.5 text-[11px] sm:text-xs text-white/90 shadow-lg">
            <SpinnerGap size={13} className="animate-spin text-cyan-400" />
            <span>{stallNotice}</span>
          </div>
        </div>
      )}

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {loading && !error && (
          <div className="pointer-events-auto flex items-center justify-center w-16 h-16 rounded-full bg-black/45 backdrop-blur-md border border-white/10">
            <SpinnerGap size={30} className="text-cyan-400 animate-spin" />
          </div>
        )}
        {!loading && !error && !playing && (
          <button type="button" onClick={togglePlay} className="pointer-events-auto flex items-center justify-center w-[72px] h-[72px] sm:w-20 sm:h-20 rounded-full bg-cyan-500/90 hover:bg-cyan-400 text-white shadow-2xl shadow-cyan-500/30 backdrop-blur-sm transition-all duration-200 hover:scale-105 active:scale-95" aria-label={needsTap ? "Tap to play video" : "Play video"}>
            <Play size={34} weight="fill" className="ml-1" />
          </button>
        )}
        {error && (
          <div className="pointer-events-auto flex flex-col items-center gap-3 p-6 rounded-2xl bg-black/60 backdrop-blur-md border border-white/10 text-center max-w-sm mx-4">
            <div className="w-12 h-12 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center"><WarningCircle size={28} weight="bold" /></div>
            <div>
              <p className="text-sm font-semibold text-white">Playback failed</p>
              <p className="text-xs text-white/60 mt-1">{errorMessage || "This stream may be unavailable or expired. Try another mirror if one is listed."}</p>
            </div>
            {onReload && (
              <button type="button" onClick={onReload} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white text-xs font-semibold transition-colors">
                <ArrowClockwise size={14} weight="bold" /> Retry / Next source
              </button>
            )}
          </div>
        )}
      </div>

      <div className={`absolute inset-x-0 top-0 p-3 sm:p-4 flex items-start justify-between gap-3 transition-opacity duration-300 ${showControls || !playing ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="min-w-0 flex-1">{title && <p className="text-sm sm:text-base font-semibold text-white/95 line-clamp-1 drop-shadow">{title}</p>}</div>
        {qualities.length > 1 && (
          <div className="relative shrink-0">
            <button type="button" onClick={() => setShowSettings((s) => !s)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/45 hover:bg-black/65 backdrop-blur-md border border-white/10 text-white text-xs font-semibold transition-colors" aria-label="Video settings">
              <GearSix size={15} weight="bold" /><span>{activeQuality}</span>
            </button>
            {showSettings && (
              <div className="absolute right-0 top-full mt-2 w-52 rounded-xl bg-zinc-950/95 backdrop-blur-xl border border-white/10 shadow-2xl p-2 z-20">
                <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">Quality</p>
                {qualities.map((q) => {
                  const active = q.url === (activeQualityUrl || src);
                  return (
                    <button key={q.url} type="button" onClick={() => { onQualityChange?.(q.url); setShowSettings(false); }} className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm transition-colors ${active ? "bg-cyan-500/20 text-cyan-300" : "text-white/85 hover:bg-white/10"}`}>
                      <span>{q.label}</span>{active && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                    </button>
                  );
                })}
                <div className="my-1.5 border-t border-white/10" />
                <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">Speed</p>
                <div className="flex flex-wrap gap-1 px-1 pb-1">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <button key={r} type="button" onClick={() => setRate(r)} className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${playbackRate === r ? "bg-cyan-500/20 text-cyan-300" : "text-white/70 hover:bg-white/10 hover:text-white"}`}>{r}x</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`absolute inset-x-0 bottom-0 px-3 sm:px-4 pb-3 sm:pb-4 transition-opacity duration-300 ${showControls || !playing ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="group/seek relative mb-3 h-5 flex items-center"
          onMouseMove={(e) => { const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)); setHoverTime(pct * duration); setHoverX(e.clientX - rect.left); }}
          onMouseLeave={() => setHoverTime(null)}
        >
          {hoverTime !== null && duration > 0 && (
            <div className="absolute -top-7 -translate-x-1/2 px-2 py-1 rounded-md bg-black/90 border border-white/10 text-[11px] font-medium text-white tabular-nums" style={{ left: hoverX }}>{formatTime(hoverTime)}</div>
          )}
          <div className="absolute inset-x-0 h-1 group-hover/seek:h-1.5 rounded-full bg-white/20 transition-all">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufferedPct}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-cyan-400" style={{ width: `${progress}%` }} />
          </div>
          <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-cyan-400 shadow-[0_0_0_4px_rgba(34,211,238,0.2)] opacity-0 group-hover/seek:opacity-100 transition-opacity" style={{ left: `calc(${progress}% - 7px)` }} />
          <input type="range" min={0} max={duration || 0} step={0.1} value={currentTime} onChange={(e) => seek(Number(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" aria-label="Seek" />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button type="button" onClick={togglePlay} className="p-2 rounded-lg text-white hover:bg-white/10 transition-colors" aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={22} weight="fill" /> : <Play size={22} weight="fill" />}
          </button>
          <div className="flex items-center gap-1 group/vol">
            <button type="button" onClick={toggleMute} className="p-2 rounded-lg text-white hover:bg-white/10 transition-colors" aria-label={muted ? "Unmute" : "Mute"}>
              <VolumeIcon size={20} weight="fill" />
            </button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => changeVolume(Number(e.target.value))} className="w-12 sm:w-20 sm:group-hover/vol:w-24 transition-all accent-cyan-400 h-1" aria-label="Volume" />
          </div>
          <div className="text-xs sm:text-sm font-medium text-white/90 tabular-nums">
            <span>{formatTime(currentTime)}</span><span className="text-white/40 mx-1">/</span><span className="text-white/70">{formatTime(duration)}</span>
          </div>
          <div className="flex-1" />
          {typeof document !== "undefined" && document.pictureInPictureEnabled && (
            <button type="button" onClick={togglePiP} className="inline-flex p-2 rounded-lg text-white/85 hover:text-white hover:bg-white/10 transition-colors" aria-label="Picture in picture"><PictureInPicture size={20} /></button>
          )}
          <button type="button" onClick={toggleFullscreen} className="p-2 rounded-lg text-white/85 hover:text-white hover:bg-white/10 transition-colors" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {fullscreen ? <CornersIn size={20} weight="bold" /> : <CornersOut size={20} weight="bold" />}
          </button>
        </div>
      </div>
    </div>
  );
}
